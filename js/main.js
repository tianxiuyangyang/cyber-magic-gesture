/**
 * 星尘粒子场：摄像头 + 手势 + 大规模自由粒子。
 *
 * 流程：
 *   - 主界面（菜单）不渲染任何粒子，只有一张干净的科技感界面
 *   - 点击进入后开启摄像头/手势（首次）或直接继续（已就绪），全屏只剩粒子与你的手
 *   - 游戏中按 ESC：退出全屏并回到主界面；再次进入无需重新加载模型
 *   - 没有任何鼠标交互，也不隐藏系统光标
 *
 * 手势：
 *   - 食指单指：指尖推力场，推开粒子、扫出尾流
 *   - 拇指 + 食指捏合：所有粒子向捏合点聚拢并旋转
 *     但它们始终带着挣脱意愿，越靠近核心越拼命往外逃
 *   - 松开捏合：冲击波散开，粒子回归自由漂移
 */

import { CAMERA, GESTURE, INITIAL, FIELD, CORE_COLOR, rgba } from './config.js';
import {
  GestureInterpreter,
  mirrorPoints,
  coverViewport,
  HAND_CONNECTIONS,
} from './gestures.js';
import { ParticleSystem } from './particles.js';
import { HandStatusView } from './hand-status.js';
import { demoHandAt } from './demo.js';

const TAU = Math.PI * 2;

const dom = {};
const state = {
  mode: 'gate', // gate | camera | demo | selftest
  busy: false,
  mirror: INITIAL.mirror,
  delegate: 'auto',
  gesture: null,
  raf: 0,
  lastFrame: 0,
  videoTime: -1,
  lastDetectionAt: 0,
  detectErrors: 0,
  detections: 0,

  // 力场强度（0..1，随时间渐变而不是跳变）
  pinchStrength: 0,
  pinchTarget: 0,
  ringStrength: 0,
  ringTarget: 0,

  // 屏幕位置（CSS 像素）
  attractorPos: null,
  ringPos: null,
  cursorPos: null,
  cursorAlpha: 0,

  // 演示
  demoStart: 0,

  // 外骨骼面板 / 空格提示
  panelVisible: false,
  panelHideTimer: 0,
  hintVisible: false,
  hintTimer: 0,
  hintHideTimer: 0,
  fps: 0,
  fpsCount: 0,
  fpsSince: 0,

  // 调试（仅 URL 参数打开）
  preview: false,

  wakeLock: null,
};

let interpreter = null;
let system = null;
let statusView = null;
let tracker = null;
let camera = null;
let trackerModule = null;
let sessionReady = false;
let manualFullscreenChange = false;

boot();

function deviceScale() {
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
  const budget = Math.sqrt(3_600_000 / (cssWidth * cssHeight));
  return Math.max(1, Math.min(maxDpr, budget));
}

function boot() {
  dom.board = document.getElementById('board');
  dom.video = document.getElementById('camera');
  dom.gate = document.getElementById('gate');
  dom.gateStatus = document.getElementById('gate-status');
  dom.start = document.getElementById('start');
  dom.preview = document.getElementById('preview');
  dom.previewCanvas = document.getElementById('preview-canvas');
  dom.previewStatus = document.getElementById('preview-status');
  dom.panel = document.getElementById('hand-panel');
  dom.stage = document.getElementById('skeleton-stage');
  dom.skeleton = document.getElementById('hand-skeleton');
  dom.backend = document.getElementById('tracker-backend');
  dom.fps = document.getElementById('hand-fps');
  dom.handSide = document.getElementById('hand-side');
  dom.handGesture = document.getElementById('hand-gesture');
  dom.handScore = document.getElementById('hand-score');
  dom.message = document.getElementById('hand-message');
  dom.points = document.getElementById('hand-points');
  dom.fingerRow = document.getElementById('finger-row');
  dom.hint = document.getElementById('space-hint');

  if (!dom.board || !dom.start) return;

  interpreter = new GestureInterpreter(GESTURE);
  system = new ParticleSystem(dom.board);
  system.resize(window.innerWidth, window.innerHeight, deviceScale());
  statusView = new HandStatusView({
    panel: dom.panel,
    stage: dom.stage,
    canvas: dom.skeleton,
    backend: dom.backend,
    fps: dom.fps,
    side: dom.handSide,
    gesture: dom.handGesture,
    score: dom.handScore,
    message: dom.message,
    points: dom.points,
    fingerRow: dom.fingerRow,
  });

  window.__cyberMagic = {
    get state() {
      return state;
    },
    get system() {
      return system;
    },
    get interpreter() {
      return interpreter;
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
  if (params.get('mirror') === '0') state.mirror = false;
  state.preview = params.get('preview') === '1';

  if (params.has('selftest')) {
    runSelfTest();
    return;
  }
  if (params.has('demo')) {
    runDemo();
    return;
  }
  if (params.get('autostart') === '1') {
    enterCamera();
    return;
  }

  // 主界面：不启动粒子循环，画布保持隐藏
  dom.start.focus({ preventScroll: true });
  console.info(
    '%c赛博魔法 · 星尘粒子场%c\n指尖推开 · 捏合聚拢 · ESC 返回主界面',
    'color:#64e0e8;font-size:15px;font-weight:600',
    'color:#7f95a7',
  );
}

// ============================================================
// 入口 / 菜单
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
  if (sessionReady && camera && tracker) {
    await resumeField();
    return;
  }

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
      maxHands: 1,
    });
    sessionReady = true;
    state.mode = 'camera';
    resetSession();
    statusView.setBackend(tracker.backend || 'AUTO');
    document.body.dataset.camera = 'live';
    document.body.dataset.videoSize = `${camera.video.videoWidth}x${camera.video.videoHeight}`;
    document.body.dataset.mirror = String(state.mirror);
    setStatus('');
    hideGate();
    requestWakeLock();
    startLoop();
  } catch (error) {
    console.error('[进入粒子场]', error);
    loaded?.stopCamera(camera);
    camera = null;
    tracker?.close();
    tracker = null;
    sessionReady = false;
    document.body.dataset.camera = 'error';
    document.body.dataset.cameraError = error?.name || String(error);
    setBusy(false);
    setStatus(humanizeError(error), true);
    dom.start.textContent = '重试摄像头';
    return;
  }
  setBusy(false);
}

/** 从菜单继续：摄像头/模型都还在，无需重新加载。 */
async function resumeField() {
  if (state.mode !== 'gate' || state.busy) return;
  setBusy(true);
  await requestFullscreen();
  resetSession();
  state.mode = 'camera';
  statusView.setBackend(tracker?.backend || 'AUTO');
  document.body.dataset.camera = 'live';
  setStatus('');
  hideGate();
  requestWakeLock();
  startLoop();
  setBusy(false);
}

function resetSession() {
  state.videoTime = -1;
  state.lastDetectionAt = performance.now();
  state.detections = 0;
  state.gesture = null;
  state.pinchStrength = 0;
  state.pinchTarget = 0;
  state.ringStrength = 0;
  state.ringTarget = 0;
  state.attractorPos = null;
  state.ringPos = null;
  state.cursorPos = null;
  state.cursorAlpha = 0;
  state.panelVisible = false;
  state.fps = 0;
  state.fpsCount = 0;
  state.fpsSince = 0;
  system.setRing(null);
  window.clearTimeout(state.panelHideTimer);
  dom.panel?.classList.remove('is-visible');
  dom.panel?.setAttribute('aria-hidden', 'true');
  if (dom.panel) dom.panel.hidden = true;
  statusView?.setFps(0);
  statusView?.update(null);
  hideHint(true);
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

/** 回到主界面（ESC / 退出全屏时调用）。粒子循环暂停，摄像头保持就绪。 */
async function returnToMenu() {
  if (state.mode === 'gate' || state.mode === 'selftest') return;
  state.mode = 'gate';
  releaseWakeLock();
  showMenu(sessionReady ? '已暂停 · 点击继续' : '');
  dom.start.focus({ preventScroll: true });
  if (document.fullscreenElement) {
    try {
      manualFullscreenChange = true;
      await document.exitFullscreen();
    } catch {
      manualFullscreenChange = false;
    }
  }
}

function showMenu(message) {
  stopLoop();
  state.pinchStrength = 0;
  state.pinchTarget = 0;
  state.ringStrength = 0;
  state.ringTarget = 0;
  state.attractorPos = null;
  state.ringPos = null;
  state.cursorPos = null;
  state.cursorAlpha = 0;
  state.gesture = null;
  system.setAttractor(null);
  system.setRepulsor(null);
  system.setRing(null);
  dom.preview.hidden = true;
  state.panelVisible = false;
  window.clearTimeout(state.panelHideTimer);
  dom.panel?.classList.remove('is-visible');
  dom.panel?.setAttribute('aria-hidden', 'true');
  if (dom.panel) dom.panel.hidden = true;
  hideHint(true);

  document.body.classList.remove('is-live');
  dom.gate.hidden = false;
  dom.gate.classList.add('is-hidden');
  window.requestAnimationFrame(() => {
    dom.gate.classList.remove('is-hidden');
  });
  dom.start.disabled = false;
  dom.start.textContent = sessionReady ? '继续粒子场' : '进入粒子场';
  setStatus(message || '');
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
      manualFullscreenChange = true;
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

function releaseWakeLock() {
  try {
    state.wakeLock?.release?.();
  } catch {
    // 忽略
  }
  state.wakeLock = null;
}

// ============================================================
// 主循环
// ============================================================

function startLoop() {
  if (state.raf) return;
  state.lastFrame = performance.now();
  state.raf = window.requestAnimationFrame(frame);
}

function stopLoop() {
  if (!state.raf) return;
  window.cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function frame(now) {
  state.raf = window.requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;

  if (state.mode === 'camera') cameraTick(now);
  else if (state.mode === 'demo') demoTick(now);

  updateForces(dt);
  system.update(dt);
  system.render(now);
  drawGestureCursor(now);
  updatePreview();
}

function cameraTick(now) {
  const viewport = coverViewport(
    camera?.video?.videoWidth || 0,
    camera?.video?.videoHeight || 0,
    system.width,
    system.height,
  );

  // 摄像头断流/推理停更时，力场自然松开，粒子回归自由
  if (state.gesture?.present && now - state.lastDetectionAt > 900) {
    applyGesture(interpreter.update(null, viewport));
    if (state.panelVisible) statusView.update(state.gesture);
  }
  if (!camera || !tracker) return;

  const video = camera.video;
  if (video.readyState < 2) return;
  if (video.currentTime === state.videoTime) return;
  state.videoTime = video.currentTime;

  let hands;
  try {
    hands = tracker.detect(video, now);
  } catch (error) {
    state.detectErrors += 1;
    if (state.detectErrors < 3) console.warn('[手势] 检测失败：', error);
    return;
  }
  state.detectErrors = 0;

  const hand = hands.length > 0 ? mirrorHand(hands[0]) : null;
  const gesture = interpreter.update(hand, viewport);
  applyGesture(gesture);
  state.detections += 1;
  state.lastDetectionAt = now;

  // 面板可见时才画骨架，避免不必要的开销
  state.fpsCount += 1;
  if (!state.fpsSince) state.fpsSince = now;
  if (now - state.fpsSince >= 600) {
    state.fps = (state.fpsCount * 1000) / (now - state.fpsSince);
    state.fpsCount = 0;
    state.fpsSince = now;
    if (state.panelVisible) statusView.setFps(state.fps);
  }
  if (state.panelVisible) statusView.update(gesture);
}

function mirrorHand(hand) {
  if (!state.mirror) return hand;
  return {
    ...hand,
    points: mirrorPoints(hand.points),
  };
}

/** 手势 → 力场目标。 */
function applyGesture(gesture) {
  state.gesture = gesture;

  if (!gesture.present) {
    state.pinchTarget = 0;
    state.ringTarget = 0;
    state.cursorPos = null;
    return;
  }

  if (gesture.pinch) {
    state.pinchTarget = 1;
    state.ringTarget = 0;
    if (gesture.pinchPoint) {
      state.attractorPos = gesture.pinchPoint;
      state.cursorPos = gesture.pinchPoint;
    }
    if (gesture.pinchStarted && gesture.pinchPoint) {
      system.burst(gesture.pinchPoint[0], gesture.pinchPoint[1], 1.25);
    }
    return;
  }

  state.pinchTarget = 0;
  if (gesture.pinchEnded && gesture.pinchPoint) {
    system.burst(gesture.pinchPoint[0], gesture.pinchPoint[1], 0.6);
  }

  // 伸出食指：不再向外推成圆，而是形成围绕指尖的三维中空星环
  if (gesture.pointing && !gesture.pinch && gesture.indexTip) {
    state.ringTarget = 1;
    state.ringPos = gesture.indexTip;
  } else {
    state.ringTarget = 0;
  }
  if (gesture.cursor) state.cursorPos = gesture.cursor;
}

/** 力场强度渐变 + 组装吸引/星环对象 + 光标淡入淡出。 */
function updateForces(dt) {
  const rampIn = FIELD.attractRampIn > 0 ? 1 / FIELD.attractRampIn : 20;
  const rampOut = FIELD.attractRampOut > 0 ? 1 / FIELD.attractRampOut : 20;
  const pinchRate = state.pinchTarget > state.pinchStrength ? rampIn : rampOut;
  state.pinchStrength = state.pinchTarget > state.pinchStrength
    ? Math.min(state.pinchTarget, state.pinchStrength + pinchRate * dt)
    : Math.max(state.pinchTarget, state.pinchStrength - pinchRate * dt);
  if (state.pinchStrength < 0.002 && state.pinchTarget === 0) {
    state.pinchStrength = 0;
    state.attractorPos = null;
  }

  // 星环力度渐入/渐出：伸出食指时所有粒子收束到三维中空环
  const ringIn = FIELD.ringRampIn > 0 ? 1 / FIELD.ringRampIn : 20;
  const ringOut = FIELD.ringRampOut > 0 ? 1 / FIELD.ringRampOut : 20;
  const ringRate = state.ringTarget > state.ringStrength ? ringIn : ringOut;
  state.ringStrength = state.ringTarget > state.ringStrength
    ? Math.min(state.ringTarget, state.ringStrength + ringRate * dt)
    : Math.max(state.ringTarget, state.ringStrength - ringRate * dt);
  if (state.ringStrength < 0.002 && state.ringTarget === 0) {
    state.ringStrength = 0;
    state.ringPos = null;
  }

  const minDim = Math.min(system.width, system.height);
  if (state.pinchStrength > 0.001 && state.attractorPos) {
    system.setAttractor({
      x: state.attractorPos[0],
      y: state.attractorPos[1],
      strength: state.pinchStrength,
      sigma: minDim * FIELD.attractSigma,
      coreRadius: FIELD.coreRadius,
      escapeReach: minDim * FIELD.escapeReach,
    });
  } else {
    system.setAttractor(null);
  }

  if (state.ringStrength > 0.001 && state.ringPos) {
    system.setRing({
      x: state.ringPos[0],
      y: state.ringPos[1],
      strength: state.ringStrength,
      radius: minDim * FIELD.ringRadius,
      tube: minDim * FIELD.ringTube,
      tilt: FIELD.ringTilt,
      perspective: FIELD.ringPerspective,
    });
  } else {
    system.setRing(null);
  }

  // 指尖光圈淡入淡出
  const goal = state.cursorPos ? 1 : 0;
  const speed = goal ? 22 : 9;
  state.cursorAlpha += (goal - state.cursorAlpha) * (1 - Math.exp(-dt * speed));
  if (!goal && state.cursorAlpha < 0.004) state.cursorAlpha = 0;
}

/** 指尖/捏合点的小光圈（“手指”本身的可视化）。 */
function drawGestureCursor(now) {
  if (!state.cursorPos || state.cursorAlpha <= 0.004) return;
  const [x, y] = state.cursorPos;
  const alpha = state.cursorAlpha;
  const pinching = state.pinchStrength > 0.5 || state.pinchTarget > 0;
  const ringing = state.ringStrength > 0.02 && !pinching;
  const color = pinching ? CORE_COLOR : [110, 226, 236];

  const ctx = system.ctx;
  ctx.save();
  ctx.setTransform(system.scale, 0, 0, system.scale, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;

  const pulse = 1 + Math.sin(now * 0.0024) * 0.04;
  const ringRadius = (pinching ? 15 : ringing ? 13 : 11) * (pinching ? 1.45 : 1) * pulse;

  const halo = ctx.createRadialGradient(x, y, 0, x, y, ringRadius * 3);
  halo.addColorStop(0, rgba(color, 0.4));
  halo.addColorStop(0.5, rgba(color, 0.12));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, ringRadius * 3, 0, TAU);
  ctx.fill();

  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(x, y, ringRadius, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.beginPath();
  ctx.arc(x, y, ringRadius + 3.4, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.beginPath();
  ctx.arc(x, y, 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ============================================================
// 按键（没有任何鼠标交互）
// ============================================================

function bindInput() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
}

function onKeyDown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

  // 按一下空格持续显示外骨骼，再按一下收起；主界面里空格没有面板可显示
  if (event.code === 'Space') {
    if (state.mode === 'gate') {
      event.preventDefault();
      return;
    }
    if (state.mode !== 'camera' && state.mode !== 'demo') return;
    event.preventDefault();
    if (event.repeat) return;
    togglePanel();
    return;
  }

  if (event.code === 'Escape') {
    if (state.mode === 'camera' || state.mode === 'demo') {
      event.preventDefault();
      returnToMenu();
    }
    return;
  }

  if (event.code === 'KeyF' && !event.repeat) {
    toggleFullscreen();
  }
}

function onMouseMove() {
  if (state.mode !== 'camera' && state.mode !== 'demo') return;
  if (state.panelVisible) return;
  showHint();
}

/** 空格切换：按一下持续显示，再按一下收起。 */
function togglePanel() {
  if (state.panelVisible) hidePanel();
  else showPanel();
}

function showPanel() {
  if (state.mode !== 'camera' && state.mode !== 'demo') return;
  hideHint();
  state.panelVisible = true;
  window.clearTimeout(state.panelHideTimer);
  dom.panel.hidden = false;
  dom.panel.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => {
    if (!state.panelVisible) return;
    dom.panel.classList.add('is-visible');
    statusView.resize();
    statusView.update(state.gesture || null);
    statusView.setFps(state.mode === 'demo' ? 30 : state.fps);
  });
}

function hidePanel() {
  state.panelVisible = false;
  dom.panel.classList.remove('is-visible');
  dom.panel.setAttribute('aria-hidden', 'true');
  window.clearTimeout(state.panelHideTimer);
  state.panelHideTimer = window.setTimeout(() => {
    if (!state.panelVisible) dom.panel.hidden = true;
  }, 350);
}

function showHint() {
  window.clearTimeout(state.hintTimer);
  window.clearTimeout(state.hintHideTimer);
  if (!state.hintVisible) {
    state.hintVisible = true;
    dom.hint.hidden = false;
    window.requestAnimationFrame(() => {
      if (state.hintVisible) dom.hint.classList.add('is-visible');
    });
  }
  state.hintTimer = window.setTimeout(() => hideHint(), 2400);
}

function hideHint(immediate = false) {
  window.clearTimeout(state.hintTimer);
  window.clearTimeout(state.hintHideTimer);
  state.hintVisible = false;
  dom.hint?.classList.remove('is-visible');
  if (!dom.hint) return;
  if (immediate) {
    dom.hint.hidden = true;
    return;
  }
  state.hintHideTimer = window.setTimeout(() => {
    if (!state.hintVisible) dom.hint.hidden = true;
  }, 320);
}

function bindWindow() {
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('pagehide', cleanup, { once: true });
}

function onResize() {
  if (!system) return;
  system.resize(window.innerWidth, window.innerHeight, deviceScale());
  if (state.panelVisible) statusView.resize();
}

/** 浏览器用 ESC 退出全屏时不一定把按键传给页面，这里兜底回菜单。 */
function onFullscreenChange() {
  onResize();
  if (!document.fullscreenElement && state.mode === 'camera' && !manualFullscreenChange) {
    returnToMenu();
  }
  manualFullscreenChange = false;
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') requestWakeLock();
}

function onWindowBlur() {
  // 切走窗口时松开力场，避免回来时残留一个聚拢核心 / 星环
  state.pinchTarget = 0;
  state.ringTarget = 0;
  hideHint(true);
}

function cleanup() {
  stopLoop();
  trackerModule?.stopCamera(camera);
  camera = null;
  tracker?.close();
  tracker = null;
  sessionReady = false;
  releaseWakeLock();
}

// ============================================================
// 调试：摄像头预览（仅 ?preview=1 打开）
// ============================================================

function updatePreview() {
  if (state.mode !== 'camera' || !state.preview || !camera) {
    if (dom.preview && dom.preview.hidden === false) dom.preview.hidden = true;
    return;
  }

  const video = camera.video;
  if (!video || video.readyState < 2 || !video.videoWidth) return;
  if (dom.preview.hidden) dom.preview.hidden = false;

  const canvas = dom.previewCanvas;
  const width = 480;
  const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  if (state.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();

  const viewport = coverViewport(video.videoWidth, video.videoHeight, system.width, system.height);
  let nx0 = Math.max(0, -viewport[0] / viewport[2]);
  let nx1 = Math.min(1, (system.width - viewport[0]) / viewport[2]);
  const ny0 = Math.max(0, -viewport[1] / viewport[3]);
  const ny1 = Math.min(1, (system.height - viewport[1]) / viewport[3]);
  if (state.mirror) {
    const left = 1 - nx1;
    nx1 = 1 - nx0;
    nx0 = left;
  }
  const x0 = Math.max(0, nx0 * width);
  const x1 = Math.min(width, nx1 * width);
  const y0 = Math.max(0, ny0 * height);
  const y1 = Math.min(height, ny1 * height);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  if (y0 > 0) ctx.fillRect(0, 0, width, y0);
  if (y1 < height) ctx.fillRect(0, y1, width, height - y1);
  if (x0 > 0) ctx.fillRect(0, y0, x0, Math.max(0, y1 - y0));
  if (x1 < width) ctx.fillRect(x1, y0, width - x1, Math.max(0, y1 - y0));

  ctx.save();
  ctx.strokeStyle = 'rgba(150, 240, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(0, x1 - x0 - 1), Math.max(0, y1 - y0 - 1));
  ctx.restore();

  const points = state.gesture?.landmarks;
  if (points && points.length >= 21) {
    const project = (point) => [point[0] * width, point[1] * height];
    ctx.strokeStyle = 'rgba(100, 224, 232, 0.9)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const [start, end] of HAND_CONNECTIONS) {
      const a = project(points[start]);
      const b = project(points[end]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    for (let i = 0; i < 21; i += 1) {
      const [x, y] = project(points[i]);
      ctx.fillStyle = i === 4 || i === 8 ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, i === 4 || i === 8 ? 3.4 : 2.2, 0, TAU);
      ctx.fill();
    }
  }

  let status;
  if (state.detectErrors > 5) {
    status = '识别异常 · 请刷新或查看控制台';
  } else if (state.gesture?.present) {
    status = `手部已识别 ${Math.round((state.gesture.score || 0) * 100)}%`;
  } else {
    status = '未识别到手部 · 把手放进画面';
  }
  if (dom.previewStatus.textContent !== status) dom.previewStatus.textContent = status;
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
  state.demoStart = performance.now();
  document.body.dataset.demo = 'running';
  statusView.setBackend('DEMO');
  statusView.setFps(30);
  startLoop();
}

function demoTick(now) {
  const elapsed = (now - state.demoStart) / 1000;
  const hand = demoHandAt(elapsed);
  const gesture = interpreter.update(hand, [system.width, system.height]);
  applyGesture(gesture);
  if (state.panelVisible) {
    statusView.setFps(30);
    statusView.update(gesture);
  }
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
