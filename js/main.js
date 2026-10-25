/**
 * 网页版入口：摄像头 + MediaPipe 手部识别 + 右上角骨骼状态窗。
 *
 * 页面不显示摄像头画面，也不包含画笔功能；只展示 21 点骨架、
 * 当前手势、左右手、置信度和手指伸展状态。
 */

import { CAMERA, GESTURE, INITIAL } from './config.js';
import { GestureInterpreter, mirrorPoints } from './gestures.js';
import { HandStatusView } from './hand-status.js';
import { ENERGY_BREAKPOINT, EnergyExperience } from './energy-skill.js';
import { VirtualHandExperience } from './virtual-hand.js';
import { CyberpunkCityBackground } from './city-background.js';
import { DomainExperience } from './domain-skill.js';
import { makeHand } from './scripted-hand.js';

const NO_REPEAT_CODES = new Set(['KeyH', 'KeyF', 'KeyM']);

const dom = {};
const state = {
  mode: 'gate', // gate | camera | demo | selftest
  busy: false,
  mirror: INITIAL.mirror,
  gesture: null,
  raf: 0,
  lastVideoTime: -1,
  lastDetectionAt: 0,
  detectErrors: 0,
  detectionCount: 0,
  fpsCount: 0,
  fpsSince: 0,
  delegate: 'auto',
  helpTimer: 0,
  wakeLock: null,
  energyEnabled: false,
};

let interpreter = null;
let statusView = null;
let energyExperience = null;
let virtualHand = null;
let cityBackground = null;
let domainExperience = null;
let tracker = null;
let camera = null;
let trackerModule = null;

boot();

function boot() {
  dom.gate = document.getElementById('gate');
  dom.gateStatus = document.getElementById('gate-status');
  dom.start = document.getElementById('start');
  dom.panel = document.getElementById('hand-panel');
  dom.stage = document.getElementById('skeleton-stage');
  dom.skeleton = document.getElementById('hand-skeleton');
  dom.backend = document.getElementById('tracker-backend');
  dom.fps = document.getElementById('hand-fps');
  dom.handSide = document.getElementById('hand-side');
  dom.gesture = document.getElementById('hand-gesture');
  dom.score = document.getElementById('hand-score');
  dom.message = document.getElementById('hand-message');
  dom.points = document.getElementById('hand-points');
  dom.fingerRow = document.getElementById('finger-row');
  dom.help = document.getElementById('help');
  dom.energyCanvas = document.getElementById('energy-canvas');
  dom.energyHint = document.getElementById('energy-hint');
  dom.virtualHandCanvas = document.getElementById('virtual-hand-canvas');
  dom.cityBackdrop = document.getElementById('city-backdrop');
  dom.cityCanvas = document.getElementById('city-canvas');
  dom.domainCanvas = document.getElementById('domain-canvas');

  if (!dom.start) return;

  interpreter = new GestureInterpreter(GESTURE);
  statusView = new HandStatusView({
    panel: dom.panel,
    stage: dom.stage,
    canvas: dom.skeleton,
    backend: dom.backend,
    fps: dom.fps,
    side: dom.handSide,
    gesture: dom.gesture,
    score: dom.score,
    message: dom.message,
    points: dom.points,
    fingerRow: dom.fingerRow,
  });
  energyExperience = new EnergyExperience(dom.energyCanvas, dom.energyHint);
  virtualHand = new VirtualHandExperience(dom.virtualHandCanvas);
  cityBackground = new CyberpunkCityBackground(dom.cityCanvas, dom.cityBackdrop);
  domainExperience = new DomainExperience(dom.domainCanvas);

  window.__cyberMagic = {
    get interpreter() {
      return interpreter;
    },
    get statusView() {
      return statusView;
    },
    get energy() {
      return energyExperience;
    },
    get virtualHand() {
      return virtualHand;
    },
    get cityBackground() {
      return cityBackground;
    },
    get domain() {
      return domainExperience;
    },
    get state() {
      return state;
    },
    get camera() {
      return camera;
    },
    get tracker() {
      return tracker;
    },
  };

  bindGate();
  bindInput();
  bindWindow();

  const params = new URLSearchParams(window.location.search);
  state.delegate = (params.get('delegate') || 'auto').toUpperCase();
  if (params.has('selftest')) {
    runSelfTest();
    return;
  }
  if (params.has('demo')) {
    if (params.get('demo') === 'domain') runDomainDemo();
    else runDemo();
    return;
  }
  if (params.get('autostart') === '1') {
    enterCamera();
    return;
  }

  dom.start.focus({ preventScroll: true });
  console.info(
    '%c赛博魔法 · 手势骨骼%c\n21 点骨架 · 大屏捏合/弹指 · H 查看快捷键',
    'color:#64e0e8;font-size:15px;font-weight:600',
    'color:#7f95a7',
  );
}

// ============================================================
// 入口
// ============================================================

function bindGate() {
  dom.start.addEventListener('click', enterCamera);
}

function setStatus(text, isError = false) {
  dom.gateStatus.textContent = text || '';
  dom.gateStatus.classList.toggle('is-error', !!isError);
}

function setBusy(busy) {
  state.busy = busy;
  dom.start.disabled = busy;
  dom.gate.setAttribute('aria-busy', String(busy));
}

function humanizeError(error) {
  if (trackerModule?.describeError) return trackerModule.describeError(error);
  return `启动失败：${error?.message || error || '未知错误'}`;
}

async function enterCamera() {
  if (state.mode !== 'gate' || state.busy) return;
  setBusy(true);
  setStatus('正在请求摄像头…');
  let loaded = null;

  try {
    await requestFullscreen();
    loaded = await loadTrackerModule();
    camera = await loaded.openCamera(CAMERA);
    setStatus('正在加载手势引擎…');
    tracker = await loaded.HandTracker.create({
      onProgress: setStatus,
      delegate: state.delegate,
      maxHands: isLargeViewport() ? 2 : 1,
    });

    state.mode = 'camera';
    state.lastVideoTime = -1;
    state.lastDetectionAt = performance.now();
    state.detectionCount = 0;
    state.fpsCount = 0;
    state.fpsSince = state.lastDetectionAt;
    document.body.dataset.camera = 'live';
    document.body.dataset.videoSize = `${camera.video.videoWidth}x${camera.video.videoHeight}`;
    document.body.dataset.mirror = String(state.mirror);

    statusView.setBackend(tracker.backend || 'AUTO');
    statusView.update(interpreter.update(null));
    showPanel();
    syncEnergySkill();
    setStatus('');
    hideGate();
    requestWakeLock();
    startLoop();
  } catch (error) {
    console.error('[启动识别]', error);
    loaded?.stopCamera(camera);
    camera = null;
    tracker?.close();
    tracker = null;
    document.body.dataset.camera = 'error';
    document.body.dataset.cameraError = error?.name || String(error);
    setBusy(false);
    setStatus(humanizeError(error), true);
    dom.start.textContent = '重试摄像头';
    return;
  }
  setBusy(false);
}

function isLargeViewport() {
  return window.matchMedia(ENERGY_BREAKPOINT).matches;
}

function syncEnergySkill() {
  const enabled = state.mode !== 'gate'
    && state.mode !== 'selftest'
    && isLargeViewport();
  state.energyEnabled = enabled;
  energyExperience.setEnabled(enabled);
  virtualHand.setEnabled(enabled);
  cityBackground.setEnabled(enabled);
  domainExperience.setEnabled(enabled);
}

function showPanel() {
  dom.panel.hidden = false;
  dom.panel.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => {
    dom.panel.classList.add('is-visible');
    statusView.resize();
  });
}

function hideGate() {
  dom.gate.classList.add('is-hidden');
  document.body.classList.add('is-live');
  try {
    document.activeElement?.blur?.();
  } catch {
    // 忽略
  }
  window.setTimeout(() => {
    if (state.mode !== 'gate') dom.gate.hidden = true;
  }, 650);
}

async function requestFullscreen() {
  if (document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (error) {
    console.warn('[全屏] 自动全屏失败：', error);
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (error) {
    console.warn('[全屏] 切换失败：', error);
  }
}

async function requestWakeLock() {
  if (state.mode === 'gate' || state.mode === 'selftest') return;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener?.('release', () => {
      state.wakeLock = null;
    });
  } catch {
    state.wakeLock = null;
  }
}

// ============================================================
// 主循环
// ============================================================

function startLoop() {
  if (state.raf) return;
  state.raf = window.requestAnimationFrame(frame);
}

function frame(now) {
  state.raf = window.requestAnimationFrame(frame);
  if (state.mode === 'camera') cameraTick(now);
  if (state.energyEnabled) {
    virtualHand.render(now);
    energyExperience.render(now);
    domainExperience.render(now);
  }
}

function cameraTick(now) {
  // 摄像头断流或推理长时间没有更新时，状态窗回到等待状态。
  if (state.gesture?.present && now - state.lastDetectionAt > 900) {
    updateGesture(interpreter.update(null), now, 0);
    if (state.energyEnabled) {
      domainExperience.update([], now);
      energyExperience.update([], now);
    }
  }
  if (!camera || !tracker) return;

  const video = camera.video;
  if (video.readyState < 2 || video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;

  let hands;
  try {
    hands = tracker.detect(video, now);
  } catch (error) {
    state.detectErrors += 1;
    if (state.detectErrors < 3) console.warn('[手势] 检测失败：', error);
    return;
  }
  state.detectErrors = 0;

  const mirroredHands = hands.map(mirrorHand);
  if (state.energyEnabled) {
    const domainState = domainExperience.update(mirroredHands, now);
    const energyHands = domainExperience.suppressEnergy() ? [] : mirroredHands;
    energyExperience.update(energyHands, now);
    if (domainState?.type === 'ready' || domainState?.type === 'activate') {
      energyExperience.hideHint();
    }
  }
  const visibleHands = state.energyEnabled ? mirroredHands : mirroredHands.slice(0, 1);
  const best = chooseBestHand(visibleHands);
  if (state.energyEnabled) virtualHand.update(visibleHands, now);
  updateGesture(interpreter.update(best), now, visibleHands.length);
}

function chooseBestHand(hands) {
  if (!Array.isArray(hands) || hands.length === 0) return null;
  return hands.reduce((best, hand) => ((hand?.score || 0) > (best?.score || 0) ? hand : best), null);
}

function mirrorHand(hand) {
  if (!state.mirror) return hand;
  return {
    ...hand,
    points: mirrorPoints(hand.points),
  };
}

function updateGesture(gesture, now, handCount = gesture?.present ? 1 : 0) {
  state.gesture = gesture;
  state.detectionCount += 1;
  state.fpsCount += 1;
  state.lastDetectionAt = now;
  statusView.update(gesture);

  const elapsed = now - state.fpsSince;
  if (elapsed >= 600) {
    statusView.setFps((state.fpsCount * 1000) / elapsed);
    state.fpsCount = 0;
    state.fpsSince = now;
  }
  document.body.dataset.handCount = String(handCount);
}

// ============================================================
// 输入与窗口
// ============================================================

function bindInput() {
  window.addEventListener('keydown', onKeyDown);
}

function onKeyDown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const code = event.code;

  if (state.mode === 'gate') {
    if (code === 'KeyF') toggleFullscreen();
    return;
  }
  if (state.mode === 'selftest') return;
  if (NO_REPEAT_CODES.has(code) && event.repeat) return;

  switch (code) {
    case 'KeyH':
      toggleHelp();
      break;
    case 'KeyF':
      toggleFullscreen();
      break;
    case 'KeyM':
      state.mirror = !state.mirror;
      document.body.dataset.mirror = String(state.mirror);
      break;
    case 'Escape':
      closeHelp();
      break;
    default:
      break;
  }
}

function bindWindow() {
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('fullscreenchange', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', cleanup, { once: true });
}

function onResize() {
  statusView?.resize();
  energyExperience?.resize();
  virtualHand?.resize();
  cityBackground?.resize();
  domainExperience?.resize();
  if (state.mode === 'camera' || state.mode === 'demo') syncEnergySkill();
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') requestWakeLock();
}

function cleanup() {
  if (state.raf) {
    window.cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
  trackerModule?.stopCamera(camera);
  camera = null;
  tracker?.close();
  tracker = null;
  try {
    state.wakeLock?.release?.();
  } catch {
    // 忽略
  }
  state.wakeLock = null;
  energyExperience?.clear();
  virtualHand?.clear();
  cityBackground?.setEnabled(false);
  domainExperience?.clear();
}

// ============================================================
// 帮助
// ============================================================

function toggleHelp(forceOpen) {
  if (state.mode === 'gate' || state.mode === 'selftest') return;
  const open = forceOpen ?? !dom.help.classList.contains('is-open');
  dom.help.hidden = false;
  dom.help.classList.toggle('is-open', open);
  dom.help.setAttribute('aria-hidden', String(!open));

  window.clearTimeout(state.helpTimer);
  if (open) state.helpTimer = window.setTimeout(closeHelp, 9000);
}

function closeHelp() {
  if (!dom.help || !dom.help.classList.contains('is-open')) return;
  dom.help.classList.remove('is-open');
  dom.help.setAttribute('aria-hidden', 'true');
  window.clearTimeout(state.helpTimer);
}

// ============================================================
// 调试模式
// ============================================================

async function loadTrackerModule() {
  if (!trackerModule) trackerModule = await import('./tracker.js');
  return trackerModule;
}

function runDemo() {
  dom.gate.hidden = true;
  document.body.classList.add('is-live');
  state.mode = 'demo';
  showPanel();
  statusView.setBackend('DEMO');
  statusView.setFps(30);

  const hand = makeHand('pinch', [0.62, 0.48]);
  interpreter.update(hand);
  const gesture = interpreter.update(hand);
  gesture.score = 0.98;
  state.gesture = gesture;
  statusView.update(gesture);
  syncEnergySkill();
  if (state.energyEnabled) {
    const now = performance.now();
    energyExperience.showDemo(hand, now);
    virtualHand.showDemo(hand, now);
    startLoop();
  }
  window.requestAnimationFrame(() => {
    statusView.resize();
    statusView.update(gesture);
  });

  document.body.dataset.demo = 'done';
  document.body.dataset.handCount = '1';
  document.title = 'DEMO_DONE';
  console.info('[demo] 骨骼状态窗与能量球演示已就绪');
}

function runDomainDemo() {
  dom.gate.hidden = true;
  document.body.classList.add('is-live');
  state.mode = 'demo';
  showPanel();
  statusView.setBackend('DEMO');
  statusView.setFps(30);

  const left = makeHand('seal', [0.4, 0.52]);
  const right = makeHand('seal', [0.6, 0.52]);
  interpreter.update(left);
  const gesture = interpreter.update(left);
  gesture.score = 0.98;
  gesture.pose = {
    ...gesture.pose,
    id: 'seal',
    label: '结印',
    detail: '双手五指指尖聚拢成印',
  };
  state.gesture = gesture;
  statusView.update(gesture);
  syncEnergySkill();
  if (state.energyEnabled) {
    const now = performance.now();
    virtualHand.showDemoHands([left, right], now);
    domainExperience.showDemo(now);
    startLoop();
  }
  window.requestAnimationFrame(() => {
    statusView.resize();
    statusView.update(gesture);
  });

  document.body.dataset.demo = 'domain';
  document.body.dataset.handCount = '2';
  document.title = 'DOMAIN_DEMO_DONE';
  console.info('[demo] 伏魔御厨子演示已就绪');
}
async function runSelfTest() {
  dom.gate.hidden = true;
  document.body.classList.add('is-live');
  state.mode = 'selftest';
  document.body.dataset.selftest = 'running';

  const output = document.createElement('pre');
  output.id = 'selftest-result';
  document.body.appendChild(output);

  const result = { ok: false };
  try {
    const loaded = await loadTrackerModule();
    const started = performance.now();
    tracker = await loaded.HandTracker.create();
    result.backend = tracker.backend || 'unknown';
    result.initMs = Math.round(performance.now() - started);

    const frame = document.createElement('canvas');
    frame.width = 640;
    frame.height = 480;
    const ctx = frame.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, frame.width, frame.height);

    const inferStart = performance.now();
    const hands = tracker.detect(frame, performance.now());
    result.inferMs = Math.round(performance.now() - inferStart);
    result.hands = hands.length;
    result.ok = Array.isArray(hands);
    tracker.close();
    tracker = null;
  } catch (error) {
    result.error = error?.stack || String(error);
    console.error('[selftest]', error);
  }

  document.body.dataset.selftest = result.ok ? 'ok' : 'fail';
  document.body.dataset.selftestDetail = JSON.stringify(result);
  document.title = result.ok ? 'SELFTEST_OK' : 'SELFTEST_FAIL';
  output.textContent = JSON.stringify(result, null, 2);
  console.info('[selftest]', result);
}


















