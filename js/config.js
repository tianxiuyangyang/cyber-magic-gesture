/**
 * 全局参数：星尘粒子场。
 *
 * 手势阈值沿用已验证的捏合/单指判定；粒子场的所有力参数集中在这里，
 * 改这里就能调「聚拢的力度」「挣脱的倔强程度」和整体观感。
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

/** 初始显示设置。 */
export const INITIAL = Object.freeze({
  mirror: true,
});

/** 外骨骼面板配色（RGB，供 canvas 使用）。 */
export const HAND_COLORS = Object.freeze({
  bone: [100, 224, 232],
  joint: [206, 250, 255],
  pinch: [189, 162, 255],
  muted: [83, 118, 132],
});

/** 粒子场参数。距离单位除注明外都是 CSS 像素，力是 px/s²。 */
export const FIELD = Object.freeze({
  // ---- 数量与形态 ----
  density: 2300,          // 每多少平方 CSS 像素一颗粒子
  minCount: 320,
  maxCount: 900,
  sizes: [0.7, 2.4],      // 核心半径范围（px）
  baseAlpha: [0.35, 0.95],
  twinkleSpeed: [0.6, 2.4], // 闪烁频率（弧度/秒）
  halo: 7,                // 辉光半径 = 核心半径 × halo

  // ---- 自由游走（它们天生想漂着） ----
  wanderSpeed: 34,        // 漂移速度（px/s）
  wanderTurn: 1.5,        // 游走方向每秒转动的幅度
  wanderJitter: 26,       // 随机抖动加速度
  homeK: 0.15,            // 「回到老家」的弹性：约束越强，越想挣脱（1/s²）
  homeCap: 500,           // 回家的拉力封顶距离（防止把刚聚拢的星云拽散）
  damping: 0.65,          // 速度阻尼（1/s）
  maxSpeed: 1300,
  margin: 110,            // 可以漂出屏幕多远才被拉回

  // ---- 捏合聚拢 ----
  attractSigma: 0.38,     // 吸引范围（min(宽,高) 的倍数），远处也能感到拉力
  attractStrength: 3400,  // 最大吸引力（px/s²）
  swirl: 0.5,             // 核心附近旋涡强度（远处自动衰减，保证聚得拢）
  coreRadius: 80,         // 软核半径：粒子悬停在核心外这一圈
  coreK: 9000,            // 软核排斥系数（越靠近顶得越狠）
  coreGrip: 6,            // 近核径向粘滞（1/s）：吃掉冲入速度，防止弹飞
  tangentDamp: 3.5,       // 近核切向阻尼（1/s）：压低轨道速度，让粒子落进核心圈
  escapeGain: 0.9,        // 挣脱冲动的积累速度（越靠近捏合点越憋不住）
  escapeReach: 0.5,       // 挣脱冲动的影响范围（min(宽,高) 的倍数）
  escapeMax: 6000,        // 挣脱时的最大反向加速度（近核时足以把粒子推出去）
  escapeImpulse: 320,     // 随机挣脱冲量（px/s，以径向为主）
  escapeInterval: [0.5, 1.6], // 随机挣脱间隔（秒）
  attractRampIn: 0.32,    // 捏合开始的力度渐入（秒）
  attractRampOut: 0.5,    // 松开的力度渐出（秒）

  // ---- 指尖推开 ----
  pushRadius: 160,        // 推开半径
  pushStrength: 4200,     // 最大推开加速度
  pushRampIn: 0.18,       // 指尖力场渐入
  pushRampOut: 0.22,      // 渐出

  // ---- 渲染 ----
  trailFade: 0.15,        // 拖尾淡出（越大拖尾越短）
  linkDistance: 80,       // 粒子间连线的距离阈值
  linkAlpha: 0.075,       // 连线最大透明度
  linkPerParticle: 3,     // 每颗粒子最多连几条线
  streakMinSpeed: 130,    // 速度超过多少开始画流星拖尾（px/s）
  streakMaxLen: 46,       // 流星拖尾最大长度
  ringLife: 1.1,          // 捏合脉冲环寿命（秒）
  ringSpeed: 340,         // 脉冲环扩展速度（px/s）
  hotRadius: 240,         // 靠近捏合核心多少像素内粒子开始“升温”变色
  hotMix: 0.5,            // 升温时向核心琥珀色混合的比例

  // 调色板：权重越大出现越多。整体是青蓝紫的冷色科技感。
  palette: [
    { color: [110, 226, 236], weight: 0.3 },   // 青
    { color: [104, 158, 255], weight: 0.26 },  // 蓝
    { color: [176, 132, 255], weight: 0.18 },  // 紫
    { color: [56, 214, 194], weight: 0.12 },   // 青绿
    { color: [226, 246, 255], weight: 0.1 },   // 冰白
    { color: [244, 130, 224], weight: 0.04 },  // 品红点缀
  ],
});

/** 捏合核心的视觉颜色（琥珀色，与青蓝粒子形成对比）。 */
export const CORE_COLOR = [255, 196, 96];

/** 把 [r,g,b] + 透明度转成 canvas 可用的 rgba 字符串。 */
export function rgba(color, alpha = 1) {
  const r = Math.round(color[0]);
  const g = Math.round(color[1]);
  const b = Math.round(color[2]);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
