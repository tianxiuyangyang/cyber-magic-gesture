/**
 * ?demo=1 的演示编排：没有摄像头也能看到星尘粒子场的完整效果。
 *
 * 时间轴（秒）：
 *   0.0 – 1.6   自由漂浮，什么都不做
 *   1.6 – 3.0   食指从右向左扫过，推开粒子留下尾流
 *   3.0 – 3.6   过渡
 *   3.6 – 5.8   捏合从右上扫向屏幕中心，所有粒子开始聚拢
 *   5.8 – …     捏合停在中心，粒子持续旋转、挣扎、逃逸
 */

import { makeHand } from './scripted-hand.js';

const TAU = Math.PI * 2;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * 返回演示时间 t（秒）对应的合成手（或 null 表示手不在画面里）。
 * 坐标为归一化（0-1），main.js 会映射到屏幕。
 */
export function demoHandAt(t) {
  if (t < 0) return null;
  if (t < 1.6) return null;

  if (t < 3.0) {
    const k = (t - 1.6) / 1.4;
    const x = 0.84 - 0.32 * k;
    const y = 0.62 + 0.1 * Math.sin(k * TAU * 1.5);
    return makeHand('point', [x, y]);
  }

  if (t < 3.6) return null;

  const k = Math.min(1, (t - 3.6) / 2.2);
  const e = easeInOut(k);
  const x = 0.78 - 0.28 * e;
  const y = 0.62 - 0.12 * e + 0.02 * Math.sin(t * 3);
  return makeHand('pinch', [x, y]);
}
