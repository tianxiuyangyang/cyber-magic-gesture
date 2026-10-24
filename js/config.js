/**
 * 手势识别参数。
 *
 * 网页版现在只做骨架与手势状态监测，不再保存画笔参数。
 */

/** 手势状态机参数。 */
export const GESTURE = Object.freeze({
  // 关节点平滑系数：越大越跟手，越小越平稳（0-1）
  smoothing: 0.42,
  // 捏合判定：拇指尖-食指尖距离 / 手掌尺度，带迟滞避免抖动
  pinchStartRatio: 0.3,
  pinchReleaseRatio: 0.45,
  pinchOnFrames: 2,
  pinchOffFrames: 3,
  // “只伸出食指”的确认帧数
  pointOnFrames: 2,
  pointOffFrames: 3,
});

/** 摄像头采集参数。640x480 在普通摄像头上最容易跑满 30 FPS。 */
export const CAMERA = Object.freeze({
  width: 640,
  height: 480,
  frameRate: 30,
});

/** 状态窗配色（RGB，供 canvas 使用）。 */
export const HAND_COLORS = Object.freeze({
  bone: [100, 224, 232],
  joint: [206, 250, 255],
  pinch: [189, 162, 255],
  muted: [83, 118, 132],
});

/** 初始显示设置。 */
export const INITIAL = Object.freeze({
  mirror: true,
});

/** 把 [r,g,b] + 透明度转成 canvas 可用的 rgba 字符串。 */
export function rgba(color, alpha = 1) {
  const r = Math.round(color[0]);
  const g = Math.round(color[1]);
  const b = Math.round(color[2]);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
