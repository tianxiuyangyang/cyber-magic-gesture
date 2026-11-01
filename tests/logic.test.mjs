/**
 * 逻辑测试（不需要摄像头，也不需要浏览器）：
 *
 *     cd web
 *     node --test tests/logic.test.mjs
 *
 * 覆盖：手势分类、捏合滞回、屏幕坐标映射、cover 裁切、
 * MediaPipe 字段映射、镜像、脚本动作，以及粒子场的物理：
 * 自由漂移、捏合吸引、核心排斥、挣脱冲动、指尖推开、限速。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FIELD, GESTURE } from '../js/config.js';
import {
  GestureInterpreter,
  classifyHandPose,
  coverViewport,
  fingerStates,
  isPointing,
  mirrorPoints,
  pinchRatio,
} from '../js/gestures.js';
import { buildScriptedHands, makeHand } from '../js/scripted-hand.js';
import { mapLandmarkerResult } from '../js/landmark-result.js';
import { createParticle, pickColor, stepParticle } from '../js/particles.js';

/** 可复现的伪随机源。 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ATTRACTOR = {
  x: 900,
  y: 500,
  strength: 1,
  sigma: 800,
  coreRadius: FIELD.coreRadius,
  escapeReach: 500,
};

// ============================================================
// 手势
// ============================================================

test('五根手指伸展状态与常见手势分类', () => {
  const point = makeHand('point', [0.6, 0.5]);
  const pinch = makeHand('pinch', [0.6, 0.5]);
  const open = makeHand('open', [0.6, 0.5]);
  const fist = makeHand('fist', [0.6, 0.5]);
  const peace = makeHand('peace', [0.6, 0.5]);
  const seal = makeHand('seal', [0.6, 0.5]);

  assert.equal(point.points.length, 21);
  assert.ok(isPointing(point.points), '单指伸出应被识别');
  assert.ok(!isPointing(pinch.points), '捏合时不应算单指');

  assert.deepEqual(fingerStates(fist.points), {
    thumb: false,
    index: false,
    middle: false,
    ring: false,
    pinky: false,
  });
  assert.equal(classifyHandPose(point.points).id, 'point');
  assert.equal(classifyHandPose(pinch.points, true).id, 'pinch');
  assert.equal(classifyHandPose(open.points).id, 'open');
  assert.equal(classifyHandPose(fist.points).id, 'fist');
  assert.equal(classifyHandPose(peace.points).id, 'peace');
  assert.equal(classifyHandPose(seal.points).id, 'seal');
});

test('手势状态机：单指 → 捏合 → 手离开', () => {
  const interp = new GestureInterpreter();
  const pointing = makeHand('point', [0.6, 0.5]);
  const pinching = makeHand('pinch', [0.6, 0.5]);

  interp.update(pointing);
  let state = interp.update(pointing);
  assert.ok(state.present);
  assert.ok(state.pointing, '连续两帧单指后进入指向状态');
  assert.equal(state.pose.id, 'point');

  state = interp.update(pinching);
  for (let i = 0; i < 7 && !state.pinch; i += 1) state = interp.update(pinching);
  assert.ok(state.pinch, '连续捏合帧后触发捏合');
  assert.equal(state.pose.id, 'pinch');

  state = interp.update(null);
  assert.ok(state.pinchEnded && !state.present, '手离开后结束捏合');
  assert.equal(state.pose.id, 'none');
  assert.equal(state.landmarks, null);
});

test('捏合滞回：中间态不触发', () => {
  const interp = new GestureInterpreter({
    pinchStartRatio: 0.3,
    pinchReleaseRatio: 0.45,
  });
  const hand = makeHand('pinch', [0.5, 0.5]);
  const loose = {
    points: hand.points.map((point) => [...point]),
    label: hand.label,
    score: hand.score,
  };
  loose.points[8] = [loose.points[8][0] + 0.04, loose.points[8][1] + 0.02];

  const ratio = pinchRatio(loose.points);
  assert.ok(ratio > 0.3 && ratio < 0.45, `构造的中间态应落在滞回区间（实际 ${ratio}）`);

  let state = null;
  for (let i = 0; i < 4; i += 1) state = interp.update(loose);
  assert.ok(!state.pinch, '中间态不应触发捏合');
});

test('手部关键点会平滑且保持 21 点', () => {
  const interp = new GestureInterpreter({ smoothing: 0.5 });
  const hand = makeHand('open', [0.5, 0.5]);
  const state = interp.update(hand);
  assert.equal(state.landmarks.length, 21);
  assert.equal(state.landmarks[8].length, 2);
  assert.ok(state.landmarks.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert.ok(GESTURE.pointOnFrames >= 1);
});

test('兼容 MediaPipe 的 {x, y} 关键点格式与左右手', () => {
  const hand = makeHand('open', [0.4, 0.6]);
  const asObjects = {
    points: hand.points.map(([x, y]) => ({ x, y })),
    label: 'Left',
    score: 0.9,
  };
  const state = new GestureInterpreter().update(asObjects);
  assert.ok(state.present);
  assert.equal(state.label, 'Left');
  assert.equal(state.score, 0.9);
  assert.equal(state.landmarks.length, 21);
});

test('镜像后的骨架仍然可以识别手势', () => {
  const point = makeHand('point', [0.35, 0.5]);
  const mirrored = mirrorPoints(point.points);
  assert.ok(isPointing(mirrored));
  assert.equal(classifyHandPose(mirrored).id, 'point');
});

test('摄像头画面按 cover 铺满屏幕（不拉伸）', () => {
  const [x, y, width, height] = coverViewport(640, 480, 1920, 1080);
  assert.equal(x, 0, '4:3 画面铺满 16:9 时横向刚好');
  assert.ok(Math.abs(y + 180) < 1e-9, '上下各裁掉 180px');
  assert.equal(width, 1920);
  assert.equal(height, 1440);
  assert.ok(Math.abs(width / 640 - height / 480) < 1e-9, '横纵缩放比例一致，不会变形');

  const [x2, y2, width2, height2] = coverViewport(1280, 720, 1920, 1080);
  assert.equal(x2, 0);
  assert.equal(y2, 0);
  assert.equal(width2, 1920);
  assert.equal(height2, 1080);

  const [x3, , width3, height3] = coverViewport(640, 480, 500, 1000);
  assert.ok(x3 < 0, '竖屏时左右需要裁切');
  assert.ok(Math.abs(height3 - 1000) < 1e-9);
  assert.ok(Math.abs(width3 - 1333.3333333333) < 1e-6);
});

test('手部屏幕坐标映射：指尖 / 捏合中点 / 光标', () => {
  const viewport = coverViewport(640, 480, 1920, 1080);
  const interp = new GestureInterpreter();
  const state = interp.update(makeHand('point', [0.5, 0.5]), viewport);
  assert.ok(Math.abs(state.indexTip[0] - 960) < 1e-6);
  assert.ok(Math.abs(state.indexTip[1] - 540) < 1e-6);
  assert.deepEqual(state.cursor, state.indexTip, '指向时光标在指尖');

  const interp2 = new GestureInterpreter();
  const pinching = makeHand('pinch', [0.5, 0.5]);
  let pinchState = interp2.update(pinching, [1280, 720]);
  for (let i = 0; i < 7 && !pinchState.pinch; i += 1) {
    pinchState = interp2.update(pinching, [1280, 720]);
  }
  assert.ok(pinchState.pinch);
  assert.deepEqual(pinchState.pinchPoint, [640, 360], '捏合中点是拇指尖与食指尖的中点');
  assert.deepEqual(pinchState.cursor, pinchState.pinchPoint, '捏合时光标在捏合点');
});

test('MediaPipe 结果字段映射（landmarks / handednesses）', () => {
  const points = Array.from({ length: 21 }, (_, index) => ({
    x: index / 20,
    y: 0.5,
  }));

  const hands = mapLandmarkerResult({
    landmarks: [points],
    handednesses: [[{ categoryName: 'Right', score: 0.97 }]],
  });
  assert.equal(hands.length, 1);
  assert.equal(hands[0].points.length, 21);
  assert.deepEqual(hands[0].points[8], [0.4, 0.5]);
  assert.equal(hands[0].label, 'Right');
  assert.equal(hands[0].score, 0.97);
  assert.equal(hands[0].depths.length, 21);
  assert.equal(hands[0].z, 0);

  const legacy = mapLandmarkerResult({
    handLandmarks: [points],
    handedness: [[{ categoryName: 'Left', score: 0.8 }]],
  });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].label, 'Left');
  assert.equal(legacy[0].score, 0.8);

  assert.deepEqual(mapLandmarkerResult(null), []);
  assert.deepEqual(mapLandmarkerResult({}), []);
});

test('脚本动作包含单指与捏合状态', () => {
  const interp = new GestureInterpreter();
  let pointingFrames = 0;
  let pinchFrames = 0;

  for (const hand of buildScriptedHands(160)) {
    const state = interp.update(hand);
    if (state.pose.id === 'point') pointingFrames += 1;
    if (state.pose.id === 'pinch') pinchFrames += 1;
  }

  assert.ok(pointingFrames > 30, `应有足够单指帧（实际 ${pointingFrames}）`);
  assert.ok(pinchFrames > 30, `应有足够捏合帧（实际 ${pinchFrames}）`);
});

// ============================================================
// 粒子场物理
// ============================================================

test('粒子创建：落在画面内，颜色来自调色板', () => {
  const rand = seeded(11);
  const p = createParticle(1920, 1080, rand);
  assert.ok(p.x >= 0 && p.x <= 1920);
  assert.ok(p.y >= 0 && p.y <= 1080);
  assert.ok(p.size > 0 && p.alpha > 0 && p.alpha <= 1);
  assert.ok(p.depth >= 0.3 && p.depth <= 1, '粒子应有远近层次');
  assert.equal(p.flash, 0);
  assert.equal(typeof p.glint, 'boolean');

  const colors = new Set();
  for (let i = 0; i < 200; i += 1) {
    const color = pickColor(rand);
    colors.add(color.join(','));
    assert.ok(
      FIELD.palette.some((item) => item.color.join(',') === color.join(',')),
      '颜色必须来自调色板',
    );
  }
  assert.ok(colors.size >= 2, '调色板应按权重出现多种颜色');
});

test('粒子自由漂移：没有力场也在动（它们想自由）', () => {
  const p = createParticle(1000, 800, seeded(2));
  p.vx = 0;
  p.vy = 0;
  const x0 = p.x;
  const y0 = p.y;
  for (let i = 0; i < 30; i += 1) {
    stepParticle(p, {}, 1 / 60, FIELD, () => 0.5);
  }
  assert.ok(
    Math.hypot(p.x - x0, p.y - y0) > 0.01,
    '自由漂移应让粒子移动',
  );
});

test('捏合吸引：远处的粒子会朝捏合点加速', () => {
  const p = createParticle(1000, 800, seeded(3));
  p.x = 100;
  p.y = 100;
  p.vx = 0;
  p.vy = 0;
  p.homeX = 100;
  p.homeY = 100;
  const x0 = p.x;
  for (let i = 0; i < 60; i += 1) {
    stepParticle(p, { attractor: ATTRACTOR }, 1 / 60, FIELD, () => 0.5);
  }
  assert.ok(p.x > x0 + 1, `被吸引的粒子应朝捏合点移动（Δx=${(p.x - x0).toFixed(1)}）`);
  assert.ok(p.vx > 0, '速度应指向捏合点方向');
});

test('核心排斥：靠近捏合点会被顶开，不会塌成一个点', () => {
  const p = createParticle(1000, 800, seeded(4));
  p.x = ATTRACTOR.x + 10;
  p.y = ATTRACTOR.y;
  p.vx = 0;
  p.vy = 0;
  p.homeX = p.x;
  p.homeY = p.y;
  p.escapeUrge = 0.4;
  for (let i = 0; i < 30; i += 1) {
    stepParticle(p, { attractor: ATTRACTOR }, 1 / 60, FIELD, () => 0.5);
  }
  const d = Math.hypot(p.x - ATTRACTOR.x, p.y - ATTRACTOR.y);
  assert.ok(d > 12, `核心排斥应把粒子顶开（d=${d.toFixed(1)}）`);
});

test('挣脱冲动：捏合时积累，松开后消退', () => {
  const p = createParticle(1000, 800, seeded(5));
  p.x = ATTRACTOR.x - 200;
  p.y = ATTRACTOR.y;
  p.vx = 0;
  p.vy = 0;
  p.escapeUrge = 0;

  stepParticle(p, { attractor: ATTRACTOR }, 0.5, FIELD, () => 0.5);
  const urge = p.escapeUrge;
  assert.ok(urge > 0, `捏合期间挣脱冲动应积累（urge=${urge.toFixed(3)}）`);

  stepParticle(p, {}, 0.5, FIELD, () => 0.5);
  assert.ok(p.escapeUrge < urge, '松开后挣脱冲动应消退');
});

test('挣脱冲量会点亮粒子，随后重新暗下去', () => {
  const p = createParticle(1000, 800, seeded(8));
  p.x = ATTRACTOR.x - 120;
  p.y = ATTRACTOR.y;
  p.vx = 0;
  p.vy = 0;
  p.escapeTimer = 0;
  stepParticle(p, { attractor: ATTRACTOR }, 1 / 60, FIELD, () => 0.5);
  assert.ok(p.flash > 0.9, `挣脱瞬间应被点亮（flash=${p.flash.toFixed(2)}）`);

  for (let i = 0; i < 60; i += 1) {
    stepParticle(p, {}, 1 / 60, FIELD, () => 0.5);
  }
  assert.equal(p.flash, 0, '离开捏合后闪光应完全熄灭');
});

test('指尖推开：力场半径内的粒子被推远', () => {
  const p = createParticle(1000, 800, seeded(6));
  p.x = 560;
  p.y = 400;
  p.vx = 0;
  p.vy = 0;
  p.homeX = 560;
  p.homeY = 400;
  const repulsor = { x: 500, y: 400, strength: 1 };
  for (let i = 0; i < 20; i += 1) {
    stepParticle(p, { repulsor }, 1 / 60, FIELD, () => 0.5);
  }
  assert.ok(p.x > 560 + 1, `指尖附近的粒子应被推开（Δx=${(p.x - 560).toFixed(1)}）`);
  assert.ok(Math.abs(p.y - 400) < 60, '推力以径向为主，不应大幅偏移');
});

test('粒子速度不会超过上限', () => {
  const p = createParticle(1000, 800, seeded(7));
  p.vx = 50000;
  p.vy = -50000;
  stepParticle(p, {}, 1 / 60, FIELD, () => 0.5);
  assert.ok(
    Math.hypot(p.vx, p.vy) <= FIELD.maxSpeed + 1e-6,
    '速度应被限制在 maxSpeed 内',
  );
});
