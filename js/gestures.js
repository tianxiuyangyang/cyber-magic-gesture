/**
 * 手势与手部骨架识别。
 *
 * - 把 MediaPipe 的 21 个关键点规范化为内部格式
 * - 平滑全部关节点，供右上角骨架窗稳定显示
 * - 识别单指、捏合、张开手掌、握拳等状态
 * - 不含任何画笔或画布逻辑
 *
 * 本模块不依赖 DOM，可以直接在 Node 里测试。
 */

import { GESTURE } from './config.js';

// MediaPipe 手部关键点编号
export const WRIST = 0;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_PIP = 10;
export const MIDDLE_TIP = 12;
export const RING_PIP = 14;
export const RING_TIP = 16;
export const PINKY_PIP = 18;
export const PINKY_TIP = 20;

/** 手部骨骼连线。 */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const FINGER_INFO = Object.freeze({
  thumb: { label: '拇指', tip: THUMB_TIP, joint: THUMB_IP, points: [1, 2, 3, 4] },
  index: { label: '食指', tip: INDEX_TIP, joint: INDEX_PIP, points: [5, 6, 7, 8] },
  middle: { label: '中指', tip: MIDDLE_TIP, joint: MIDDLE_PIP, points: [9, 10, 11, 12] },
  ring: { label: '无名指', tip: RING_TIP, joint: RING_PIP, points: [13, 14, 15, 16] },
  pinky: { label: '小指', tip: PINKY_TIP, joint: PINKY_PIP, points: [17, 18, 19, 20] },
});

const FINGER_KEYS = Object.keys(FINGER_INFO);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 手掌尺度：手腕到中指根，用来把像素距离归一化，抗远近变化。 */
export function handScale(points) {
  return Math.max(dist(points[WRIST], points[MIDDLE_MCP]), 1e-6);
}

/** 指尖离手腕明显比第二关节远，即认为这根手指是伸直的。 */
export function fingerExtended(points, tip, pip) {
  return dist(points[tip], points[WRIST]) > dist(points[pip], points[WRIST]) * 1.08;
}

/** 拇指稍微特殊：以拇指第二关节作为比较基准。 */
export function thumbExtended(points) {
  return dist(points[THUMB_TIP], points[WRIST]) > dist(points[THUMB_IP], points[WRIST]) * 1.08;
}

/** 返回五根手指的伸展状态。 */
export function fingerStates(points) {
  if (!Array.isArray(points) || points.length < 21) {
    return { thumb: false, index: false, middle: false, ring: false, pinky: false };
  }
  return {
    thumb: thumbExtended(points),
    index: fingerExtended(points, INDEX_TIP, INDEX_PIP),
    middle: fingerExtended(points, MIDDLE_TIP, MIDDLE_PIP),
    ring: fingerExtended(points, RING_TIP, RING_PIP),
    pinky: fingerExtended(points, PINKY_TIP, PINKY_PIP),
  };
}

/** 只伸出食指（其余三指收起）。 */
export function isPointing(points) {
  if (!fingerExtended(points, INDEX_TIP, INDEX_PIP)) return false;
  for (const [tip, pip] of [[MIDDLE_TIP, MIDDLE_PIP], [RING_TIP, RING_PIP], [PINKY_TIP, PINKY_PIP]]) {
    if (fingerExtended(points, tip, pip)) return false;
  }
  return true;
}

/** 拇指尖与食指尖的距离，除以手掌尺度。越小说明越接近捏合。 */
export function pinchRatio(points) {
  return dist(points[THUMB_TIP], points[INDEX_TIP]) / handScale(points);
}

/** 五指指尖聚拢程度：越小越接近“结印”。 */
export function fingertipSpreadRatio(points) {
  if (!Array.isArray(points) || points.length < 21) return Infinity;
  const tips = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP].map((index) => points[index]);
  const center = [
    tips.reduce((sum, point) => sum + point[0], 0) / tips.length,
    tips.reduce((sum, point) => sum + point[1], 0) / tips.length,
  ];
  const spread = tips.reduce((sum, point) => (
    sum + Math.hypot(point[0] - center[0], point[1] - center[1])
  ), 0) / tips.length;
  return spread / handScale(points);
}
/** 为状态窗生成稳定、可读的手势名称。 */
export function classifyHandPose(points, pinching = false) {
  if (!Array.isArray(points) || points.length < 21) {
    return {
      id: 'none',
      label: '等待识别',
      detail: '把手放进摄像头画面',
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    };
  }

  const fingers = fingerStates(points);
  const base = { fingers };

  if (fingertipSpreadRatio(points) < 0.25) {
    return { ...base, id: 'seal', label: '结印', detail: '五指指尖聚拢，双手成印' };
  }
  if (pinching) {
    return { ...base, id: 'pinch', label: '捏合', detail: '拇指与食指已闭合' };
  }
  if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return { ...base, id: 'point', label: '食指指向', detail: '食指伸展，其余手指收拢' };
  }
  if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
    return { ...base, id: 'peace', label: '双指手势', detail: '食指与中指伸展' };
  }
  if (fingers.index && fingers.middle && fingers.ring && !fingers.pinky) {
    return { ...base, id: 'three', label: '三指手势', detail: '食指、中指与无名指伸展' };
  }
  if (fingers.index && fingers.middle && fingers.ring && fingers.pinky) {
    return fingers.thumb
      ? { ...base, id: 'open', label: '张开手掌', detail: '五根手指全部伸展' }
      : { ...base, id: 'four', label: '四指伸展', detail: '四根手指伸展，拇指收拢' };
  }
  if (!fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return fingers.thumb
      ? { ...base, id: 'thumb', label: '拇指伸展', detail: '拇指伸出，其余手指收拢' }
      : { ...base, id: 'fist', label: '握拳', detail: '五根手指均已收拢' };
  }
  return { ...base, id: 'other', label: '手势变化中', detail: '调整手部角度，保持 21 点可见' };
}

function ema(prev, next, alpha) {
  if (!prev) return [next[0], next[1]];
  return [
    prev[0] + (next[0] - prev[0]) * alpha,
    prev[1] + (next[1] - prev[1]) * alpha,
  ];
}

/** 把 21 个关键点统一成 [[x, y], ...]；数据不合法时返回 null。 */
export function normalizeHand(hand) {
  if (!hand || !Array.isArray(hand.points) || hand.points.length < 21) return null;
  const points = new Array(21);
  for (let i = 0; i < 21; i += 1) {
    const point = hand.points[i];
    const x = Array.isArray(point) ? Number(point[0]) : Number(point?.x);
    const y = Array.isArray(point) ? Number(point[1]) : Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points[i] = [x, y];
  }
  return {
    points,
    label: hand.label || 'Unknown',
    score: Number(hand.score) || 0,
  };
}

/** 镜像关键点：摄像头画面和屏幕方向相反，x 翻转成“照镜子”的直觉。 */
export function mirrorPoints(points) {
  return points.map(([x, y]) => [1 - x, y]);
}

/** 手部骨架状态机：只判断手势，不触发绘画。 */
export class GestureInterpreter {
  constructor(options = {}) {
    this.cfg = { ...GESTURE, ...options };
    this.reset();
  }

  reset() {
    this.pinch = false;
    this.pointing = false;
    this._pinchOn = 0;
    this._pinchOff = 0;
    this._pointOn = 0;
    this._pointOff = 0;
    this._landmarksSmooth = null;
  }

  /**
   * @param {object|null} hand 归一化手部关键点
   * @returns {{present: boolean, landmarks: number[][]|null, pose: object}}
   */
  update(hand) {
    const state = {
      present: false,
      label: '',
      score: 0,
      landmarks: null,
      pinchRatio: 1,
      pinch: false,
      pointing: false,
      pinchStarted: false,
      pinchEnded: false,
      pose: classifyHandPose(null),
    };

    const normalized = normalizeHand(hand);
    if (!normalized) {
      if (this.pinch) state.pinchEnded = true;
      this.reset();
      return state;
    }

    const cfg = this.cfg;
    const rawPoints = normalized.points;
    const smooth = Math.max(0.01, Math.min(1, cfg.smoothing));
    if (!this._landmarksSmooth) {
      this._landmarksSmooth = rawPoints.map((point) => [...point]);
    } else {
      this._landmarksSmooth = this._landmarksSmooth.map((point, index) =>
        ema(point, rawPoints[index], smooth),
      );
    }
    const points = this._landmarksSmooth;
    const ratio = pinchRatio(points);

    // 捏合：滞回阈值 + 连续帧确认
    if (!this.pinch) {
      this._pinchOn = ratio < cfg.pinchStartRatio ? this._pinchOn + 1 : 0;
      this._pinchOff = 0;
      if (this._pinchOn >= cfg.pinchOnFrames) {
        this.pinch = true;
        state.pinchStarted = true;
      }
    } else {
      this._pinchOff = ratio > cfg.pinchReleaseRatio ? this._pinchOff + 1 : 0;
      this._pinchOn = 0;
      if (this._pinchOff >= cfg.pinchOffFrames) {
        this.pinch = false;
        state.pinchEnded = true;
      }
    }

    // 单指状态也做连续帧确认，避免骨架名字来回跳
    const rawPointing = isPointing(points);
    if (rawPointing) {
      this._pointOn += 1;
      this._pointOff = 0;
    } else {
      this._pointOff += 1;
      this._pointOn = 0;
    }
    if (!this.pointing && this._pointOn >= cfg.pointOnFrames) {
      this.pointing = true;
    } else if (this.pointing && this._pointOff >= cfg.pointOffFrames) {
      this.pointing = false;
    }

    const pose = classifyHandPose(points, this.pinch);
    state.present = true;
    state.label = normalized.label;
    state.score = normalized.score;
    state.landmarks = points;
    state.pinchRatio = ratio;
    state.pinch = this.pinch;
    state.pointing = this.pointing;
    state.pose = pose;
    return state;
  }
}

