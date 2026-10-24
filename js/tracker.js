/**
 * 摄像头 + MediaPipe HandLandmarker 封装。
 *
 * MediaPipe 运行时（wasm）和手部模型都放在本地，不依赖任何 CDN，
 * 断网也能启动；页面必须通过 http://localhost 打开（摄像头权限要求安全上下文）。
 */

import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { CAMERA } from './config.js';
import { mapLandmarkerResult } from './landmark-result.js';

const WASM_PATH = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_PATH = new URL('../assets/hand_landmarker.task', import.meta.url).href;

const HAND_OPTIONS = {
  runningMode: 'VIDEO',
  numHands: 1,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

export class HandTracker {
  constructor(landmarker, backend = 'GPU') {
    this.landmarker = landmarker;
    this.backend = backend;
    this.closed = false;
  }

  /**
   * 初始化手部检测。默认优先用 GPU（WebGL）加速，失败时自动退回 CPU。
   * @param {{onProgress?: (text: string) => void, delegate?: 'auto'|'GPU'|'CPU', maxHands?: number}} options
   */
  static async create({ onProgress, delegate = 'auto', maxHands = 1 } = {}) {
    onProgress?.('正在加载手势引擎…');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

    onProgress?.('正在加载手部模型…');
    const requested = String(delegate || 'auto').toUpperCase();
    const backends = requested === 'CPU' || requested === 'GPU' ? [requested] : ['GPU', 'CPU'];
    let lastError = null;

    for (const backend of backends) {
      try {
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...HAND_OPTIONS,
          numHands: Math.max(1, Math.min(2, Number(maxHands) || 1)),
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: backend },
        });
        return new HandTracker(landmarker, backend);
      } catch (error) {
        lastError = error;
        if (backend === 'GPU') {
          console.warn('[手势] GPU 加速不可用，改用 CPU：', error);
          onProgress?.('正在加载手部模型（CPU）…');
        }
      }
    }
    throw lastError || new Error('手部模型初始化失败');
  }

  /**
   * 检测一帧。
   * @param {HTMLVideoElement|HTMLCanvasElement} source
   * @param {number} timestampMs 必须单调递增
   * @returns {Array<{points: number[][], label: string, score: number}>}
   */
  detect(source, timestampMs) {
    if (this.closed) return [];
    return mapLandmarkerResult(this.landmarker.detectForVideo(source, timestampMs));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.landmarker.close();
    } catch {
      // 关闭失败不影响页面退出
    }
  }
}

function waitForMetadata(video, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth > 0) {
      resolve();
      return;
    }
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('摄像头没有画面'));
    };
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('摄像头启动超时'));
    }, timeoutMs);
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

/**
 * 打开前置摄像头。
 * @returns {Promise<{video: HTMLVideoElement, stream: MediaStream}>}
 */
export async function openCamera(options = CAMERA) {
  if (!window.isSecureContext) {
    throw new Error('INSECURE_CONTEXT');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('NO_MEDIA_DEVICES');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: options.width },
      height: { ideal: options.height },
      frameRate: { ideal: options.frameRate, max: 60 },
    },
  });

  const video = document.getElementById('camera');
  if (!video) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('页面缺少摄像头元素');
  }

  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await waitForMetadata(video);
    await video.play();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  return { video, stream };
}

export function stopCamera(camera) {
  if (!camera) return;
  try {
    camera.stream?.getTracks().forEach((track) => track.stop());
  } catch {
    // 忽略
  }
  try {
    if (camera.video) camera.video.srcObject = null;
  } catch {
    // 忽略
  }
}

/** 把摄像头/模型错误翻译成能看懂的提示。 */
export function describeError(error) {
  const name = error?.name || '';
  const message = error?.message || String(error || '');

  if (message === 'INSECURE_CONTEXT') {
    return '摄像头需要安全上下文\n请通过 http://127.0.0.1 打开（不要直接双击 index.html）';
  }
  if (message === 'NO_MEDIA_DEVICES') {
    return '这个浏览器不支持摄像头访问\n请用最新版 Chrome / Edge 打开';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '摄像头权限被拒绝\n点地址栏左侧的摄像头图标 → 允许，然后重试';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有找到摄像头\n请检查摄像头是否插好、隐私开关是否打开';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '摄像头被其他程序占用\n关掉会议 / 直播 / 相机软件后重试';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '摄像头的分辨率不满足要求\n可以先用鼠标模式画';
  }
  if (message === '摄像头启动超时' || message === '摄像头没有画面') {
    return `${message}\n请拔插摄像头或关掉占用它的程序后重试`;
  }
  return `启动失败：${message || name || '未知错误'}`;
}

