/**
 * 右上角手势骨骼状态窗。
 *
 * canvas 只画手部 21 点骨架，不绘制摄像头画面。
 */

import { HAND_COLORS, rgba } from './config.js';
import { HAND_CONNECTIONS, FINGER_INFO } from './gestures.js';

const TAU = Math.PI * 2;
const TIP_IDS = new Set([4, 8, 12, 16, 20]);
const FINGER_KEYS = Object.keys(FINGER_INFO);

/** 把归一化手部坐标按等比方式适配进小窗，留出呼吸空间。 */
export function fitLandmarks(points, width, height, padding = 16) {
  if (!Array.isArray(points) || points.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const spanX = Math.max(maxX - minX, 0.01);
  const spanY = Math.max(maxY - minY, 0.01);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const contentWidth = spanX * scale;
  const contentHeight = spanY * scale;
  const originX = (width - contentWidth) * 0.5 - minX * scale;
  const originY = (height - contentHeight) * 0.5 - minY * scale;
  return points.map(([x, y]) => [originX + x * scale, originY + y * scale]);
}

export class HandStatusView {
  constructor(elements) {
    this.el = elements;
    this.ctx = elements.canvas.getContext('2d');
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;
    this.gesture = null;
    this._resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resize();
    this._resizeObserver?.observe(this.el.canvas);
  }

  resize() {
    if (!this.el.canvas) return;
    const rect = this.el.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.el.canvas.clientWidth || 280));
    const height = Math.max(1, Math.round(rect.height || this.el.canvas.clientHeight || 166));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (width === this.cssWidth && height === this.cssHeight && dpr === this.dpr) return false;
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    this.el.canvas.width = Math.round(width * dpr);
    this.el.canvas.height = Math.round(height * dpr);
    if (this.gesture) this.draw(this.gesture);
    return true;
  }

  setBackend(backend) {
    const text = String(backend || 'AUTO').toUpperCase();
    if (this.el.backend.textContent !== text) this.el.backend.textContent = text;
  }

  setFps(fps) {
    const text = Number.isFinite(fps) && fps > 0 ? `${Math.round(fps)} FPS` : '-- FPS';
    if (this.el.fps.textContent !== text) this.el.fps.textContent = text;
  }

  update(gesture) {
    this.gesture = gesture;
    const present = !!gesture?.present && gesture.landmarks?.length >= 21;
    const pose = gesture?.pose || { id: 'none', label: '等待识别', detail: '把手放进摄像头画面', fingers: {} };

    this.el.panel.dataset.pose = pose.id;
    this.el.stage.dataset.pose = pose.id;
    this.el.stage.classList.toggle('is-empty', !present);
    this.setText(this.el.gesture, pose.label);
    this.setText(this.el.score, present ? `${Math.round((gesture.score || 0) * 100)}%` : '--');
    this.setText(this.el.side, present ? handSideLabel(gesture.label) : '--');
    this.setText(this.el.points, present ? '21 / 21' : '0 / 21');
    this.setText(this.el.message, present ? pose.detail : '把手放进摄像头画面');

    const fingers = pose.fingers || {};
    for (const key of FINGER_KEYS) {
      const item = this.el.fingerRow.querySelector(`[data-finger="${key}"]`);
      item?.classList.toggle('is-extended', !!fingers[key]);
    }

    this.draw(present ? gesture : null);
    document.body.dataset.handPresent = present ? 'true' : 'false';
    document.body.dataset.handPose = pose.id;
  }

  setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  draw(gesture) {
    const ctx = this.ctx;
    const width = this.cssWidth;
    const height = this.cssHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!gesture?.landmarks?.length) return;

    const points = fitLandmarks(gesture.landmarks, width, height, 18);
    const pinch = !!gesture.pinch;
    const boneColor = pinch ? HAND_COLORS.pinch : HAND_COLORS.bone;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 骨架外辉光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(boneColor, 0.16);
    ctx.lineWidth = 7;
    ctx.shadowColor = rgba(boneColor, 0.55);
    ctx.shadowBlur = 12;
    this.strokeConnections(ctx, points);
    ctx.restore();

    // 骨架主线
    ctx.strokeStyle = rgba(boneColor, 0.9);
    ctx.lineWidth = 1.75;
    ctx.shadowColor = rgba(boneColor, 0.45);
    ctx.shadowBlur = 5;
    this.strokeConnections(ctx, points);
    ctx.shadowBlur = 0;

    // 捏合时强调拇指尖与食指尖
    if (pinch) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = rgba(HAND_COLORS.pinch, 0.72);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(points[4][0], points[4][1]);
      ctx.lineTo(points[8][0], points[8][1]);
      ctx.stroke();
      ctx.restore();
    }

    // 关节点
    for (let index = 0; index < points.length; index += 1) {
      const [x, y] = points[index];
      const isTip = TIP_IDS.has(index);
      const radius = isTip ? 3.2 : index === 0 ? 3.6 : 2.1;
      ctx.fillStyle = isTip ? rgba(HAND_COLORS.joint, 0.98) : rgba(boneColor, 0.82);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();

      if (isTip) {
        ctx.strokeStyle = rgba(boneColor, 0.52);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 5.3, 0, TAU);
        ctx.stroke();
      }
    }

    // 手腕标记
    ctx.strokeStyle = rgba(HAND_COLORS.joint, 0.58);
    ctx.lineWidth = 1;
    ctx.strokeRect(points[0][0] - 2.5, points[0][1] - 2.5, 5, 5);
  }

  strokeConnections(ctx, points) {
    ctx.beginPath();
    for (const [start, end] of HAND_CONNECTIONS) {
      ctx.moveTo(points[start][0], points[start][1]);
      ctx.lineTo(points[end][0], points[end][1]);
    }
    ctx.stroke();
  }
}

function handSideLabel(label) {
  if (label === 'Left') return 'LEFT / 左手';
  if (label === 'Right') return 'RIGHT / 右手';
  return String(label || 'UNKNOWN').toUpperCase();
}

