/**
 * 脚本化的“手”：用 21 个归一化关键点合成常见姿势。
 *
 * 用于 ?demo=1 的状态窗预览，以及 Node 单元测试。
 * 本模块不依赖 DOM。
 */

// 局部坐标：x 向右，y 向下（手指向上所以是负数），单位约等于手掌长度
const BASE = {
  wrist: [0.0, 0.0],
  thumb_cmc: [0.12, -0.02],
  thumb_mcp: [0.2, -0.1],
  thumb_ip: [0.27, -0.17],
  thumb_tip: [0.33, -0.22],
  index_mcp: [0.16, -0.34],
  index_pip: [0.18, -0.5],
  index_dip: [0.19, -0.6],
  index_tip: [0.2, -0.7],
  middle_mcp: [0.05, -0.37],
  middle_pip: [0.05, -0.55],
  middle_dip: [0.05, -0.66],
  middle_tip: [0.05, -0.77],
  ring_mcp: [-0.05, -0.35],
  ring_pip: [-0.06, -0.51],
  ring_dip: [-0.06, -0.61],
  ring_tip: [-0.06, -0.71],
  pinky_mcp: [-0.14, -0.3],
  pinky_pip: [-0.17, -0.43],
  pinky_dip: [-0.18, -0.51],
  pinky_tip: [-0.19, -0.59],
};

const ORDER = [
  'wrist',
  'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  'index_mcp', 'index_pip', 'index_dip', 'index_tip',
  'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip',
  'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip',
  'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip',
];

function foldFinger(points, name, x, y, scale) {
  points[`${name}_dip`] = [x * scale, y * scale];
  points[`${name}_tip`] = [x * scale, (y + 0.025) * scale];
}

function basePoints(scale, pose) {
  const points = {};
  for (const [name, [x, y]] of Object.entries(BASE)) {
    points[name] = [x * scale, y * scale];
  }

  if (pose === 'point') {
    foldFinger(points, 'middle', 0.05, -0.41, scale);
    foldFinger(points, 'ring', -0.06, -0.39, scale);
    foldFinger(points, 'pinky', -0.16, -0.35, scale);
  } else if (pose === 'pinch') {
    const common = [0.19 * scale, -0.32 * scale];
    points.thumb_tip = common;
    points.thumb_ip = [0.23 * scale, -0.26 * scale];
    points.index_tip = common;
    points.index_dip = [0.19 * scale, -0.38 * scale];
    points.index_pip = [0.18 * scale, -0.45 * scale];
    foldFinger(points, 'middle', 0.05, -0.41, scale);
    foldFinger(points, 'ring', -0.06, -0.39, scale);
    foldFinger(points, 'pinky', -0.16, -0.35, scale);
  } else if (pose === 'fist') {
    foldFinger(points, 'index', 0.16, -0.37, scale);
    foldFinger(points, 'middle', 0.05, -0.4, scale);
    foldFinger(points, 'ring', -0.06, -0.38, scale);
    foldFinger(points, 'pinky', -0.16, -0.34, scale);
    points.thumb_tip = [0.1 * scale, -0.08 * scale];
    points.thumb_ip = [0.17 * scale, -0.14 * scale];
  } else if (pose === 'peace') {
    foldFinger(points, 'ring', -0.06, -0.39, scale);
    foldFinger(points, 'pinky', -0.16, -0.35, scale);
  }

  return points;
}

/**
 * 生成一只“手”。
 * @param {'point'|'pinch'|'open'|'fist'|'peace'} pose
 * @param {[number, number]} anchor 对应手势的关键点（point 用食指尖，其余用拇指尖）
 * @param {number} scale 手掌尺度（归一化单位）
 */
export function makeHand(pose, anchor, scale = 0.34) {
  const points = basePoints(scale, pose);
  const ref = pose === 'point' ? points.index_tip : points.thumb_tip;
  const dx = anchor[0] - ref[0];
  const dy = anchor[1] - ref[1];
  return {
    points: ORDER.map((name) => [points[name][0] + dx, points[name][1] + dy]),
    label: 'Right',
    score: 0.99,
  };
}

/** 一段可复现的动作：单指 → 捏合。 */
export function buildScriptedHands(frames = 160) {
  const hands = [];
  for (let i = 0; i < frames; i += 1) {
    if (i >= 12 && i < 60) {
      const t = (i - 12) / 47;
      const x = 0.28 + 0.44 * t;
      const y = 0.62 + 0.16 * Math.sin(t * Math.PI * 3);
      hands.push(makeHand('point', [x, y]));
    } else if (i >= 72 && i < 120) {
      const t = (i - 72) / 47;
      const x = 0.28 + 0.22 * t;
      const y = 0.52 - 0.08 * t;
      hands.push(makeHand('pinch', [x, y]));
    } else {
      hands.push(null);
    }
  }
  return hands;
}
