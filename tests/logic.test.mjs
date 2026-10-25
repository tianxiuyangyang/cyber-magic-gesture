/**
 * 逻辑测试（不需要摄像头，也不需要浏览器）：
 *
 *     cd web
 *     node --test tests/logic.test.mjs
 *
 * 覆盖：手指状态、手势分类、捏合滞回、21 点状态机、
 * MediaPipe 字段映射、镜像、骨架适配和脚本动作。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GESTURE } from '../js/config.js';
import {
  GestureInterpreter,
  classifyHandPose,
  fingerStates,
  isPointing,
  mirrorPoints,
  pinchRatio,
} from '../js/gestures.js';
import { buildScriptedHands, makeHand } from '../js/scripted-hand.js';
import { mapLandmarkerResult } from '../js/landmark-result.js';
import { fitLandmarks } from '../js/hand-status.js';
import { EnergySkill, analyzeEnergyGesture } from '../js/energy-skill.js';
import { projectNormalizedPoint } from '../js/screen-projection.js';
import { analyzeDomainSeal, DomainSkill } from '../js/domain-skill.js';

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

test('骨架等比适配到右上角小窗并保持居中', () => {
  const points = [[0.25, 0.25], [0.75, 0.75], [0.5, 0.1]];
  const fitted = fitLandmarks(points, 280, 166, 18);
  assert.equal(fitted.length, 3);

  const xs = fitted.map(([x]) => x);
  const ys = fitted.map(([, y]) => y);
  assert.ok(Math.min(...xs) >= 18 - 1e-6);
  assert.ok(Math.max(...xs) <= 262 + 1e-6);
  assert.ok(Math.min(...ys) >= 18 - 1e-6);
  assert.ok(Math.max(...ys) <= 148 + 1e-6);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 140) < 1e-6);
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 83) < 1e-6);
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


test('能量技能：只有拇指食指捏合才触发', () => {
  const pinch = makeHand('pinch', [0.5, 0.55]);
  const active = analyzeEnergyGesture([pinch]);
  assert.ok(active.active);
  assert.equal(active.mode, 'pinch');
  assert.ok(active.point[0] > 0.3 && active.point[0] < 0.7);

  const peace = makeHand('peace', [0.5, 0.55]);
  const open = makeHand('open', [0.5, 0.55]);
  const point = makeHand('point', [0.5, 0.55]);
  const left = makeHand('open', [0.36, 0.55]);
  const right = makeHand('open', [0.64, 0.55]);
  assert.equal(analyzeEnergyGesture([peace]).active, false);
  assert.equal(analyzeEnergyGesture([open]).active, false);
  assert.equal(analyzeEnergyGesture([point]).active, false);
  assert.equal(analyzeEnergyGesture([left, right]).active, false);
});
test('能量技能：蓄能后快速前推触发发射', () => {
  const skill = new EnergySkill({ holdMs: 80, chargeMs: 300, fireThreshold: 1 });
  const hand = makeHand('pinch', [0.5, 0.56]);
  hand.z = 0;

  let event = skill.update([hand], 1000);
  assert.equal(event.type, 'charge');
  assert.equal(event.visible, false);

  event = skill.update([hand], 1200);
  assert.equal(event.type, 'charge');
  assert.ok(event.visible, '稳定手势后能量球应显示');
  assert.ok(event.charge > 0);

  const pushed = makeHand('pinch', [0.5, 0.56], 0.48);
  pushed.z = -0.08;
  event = skill.update([pushed], 1235);
  assert.equal(event.type, 'fire');
  assert.equal(event.point.length >= 2, true);
  assert.ok(event.power >= 0.7);
  assert.equal(event.fireType, 'city');
});

test('能量技能：握拳不会误触发', () => {
  const fist = makeHand('fist', [0.5, 0.5]);
  const analysis = analyzeEnergyGesture([fist]);
  assert.equal(analysis.active, false);
});



test('虚拟手投影保持摄像头比例且中心对齐', () => {
  const center = projectNormalizedPoint([0.5, 0.5], 1440, 900);
  assert.deepEqual(center, [720, 450]);

  const dx = projectNormalizedPoint([0.6, 0.5], 1440, 900);
  const dy = projectNormalizedPoint([0.5, 0.6], 1440, 900);
  const horizontal = Math.hypot(dx[0] - center[0], dx[1] - center[1]);
  const vertical = Math.hypot(dy[0] - center[0], dy[1] - center[1]);
  assert.ok(Math.abs(horizontal / vertical - 4 / 3) < 1e-9, '虚拟手不应被横向拉伸');
});
test('能量技能：弹开手指会射向城市并爆炸', () => {
  const skill = new EnergySkill({ holdMs: 80, chargeMs: 300, fireThreshold: 1 });
  const pinch = makeHand('pinch', [0.5, 0.56]);
  pinch.z = 0;

  skill.update([pinch], 1000);
  const charged = skill.update([pinch], 1200);
  assert.ok(charged.visible);

  const snapped = makeHand('open', [0.5, 0.56]);
  let event = skill.update([snapped], 1270);
  assert.equal(event.type, 'fire', '捏合张开应触发弹指发射');
  assert.equal(event.fireType, 'city');
  assert.equal(event.power, 1);

  skill.update([pinch], 2200);
  event = skill.update([pinch], 2500);
  assert.ok(event.visible);
  const flicked = {
    points: pinch.points.map((point) => [...point]),
    label: pinch.label,
    score: pinch.score,
    z: 0,
  };
  flicked.points[12] = [flicked.points[12][0] + 0.16, flicked.points[12][1] - 0.1];
  event = skill.update([flicked], 2530);
  assert.equal(event.type, 'fire', '捏合中快速弹指也应发射');
});
test('伏魔御厨子：必须双手五指聚拢成印', () => {
  const left = makeHand('seal', [0.38, 0.55]);
  const right = makeHand('seal', [0.62, 0.55]);
  const seal = analyzeDomainSeal([left, right]);
  assert.ok(seal.active);
  assert.ok(seal.spread < 0.5);
  assert.equal(analyzeDomainSeal([left]).active, false);
  assert.equal(analyzeDomainSeal([makeHand('open', [0.38, 0.55]), right]).active, false);
});

test('伏魔御厨子：结印启动后进入 5 秒斩击与终结阶段', () => {
  const skill = new DomainSkill({ holdMs: 100, barrageMs: 5000, finalMs: 2500, cooldownMs: 12000 });
  const left = makeHand('seal', [0.38, 0.55]);
  const right = makeHand('seal', [0.62, 0.55]);

  let event = skill.update([left, right], 1000);
  assert.equal(event.type, 'ready');
  event = skill.update([left, right], 1100);
  assert.equal(event.type, 'activate');

  event = skill.update([left, right], 3000);
  assert.equal(event.type, 'barrage');
  event = skill.update([left, right], 6300);
  assert.equal(event.type, 'final');
  assert.ok(event.progress > 0 && event.progress < 1);
  event = skill.update([left, right], 8700);
  assert.equal(event.type, 'done');
});


