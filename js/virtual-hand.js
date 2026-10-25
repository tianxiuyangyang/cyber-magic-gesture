/**
 * 大屏虚拟手：由玩家 21 点手部骨架驱动。
 *
 * - 位置、尺度、旋转和每根手指的弯曲都会同步
 * - 两次模型检测之间按帧插值，保持顺滑跟随
 * - 高亮青蓝色能量手，绘制在能量球下方
 */

import { rgba } from './config.js';
import { projectNormalizedPoints } from './screen-projection.js';

const TAU = Math.PI * 2;
const FINGERS = [
  { ids: [1, 2, 3, 4], width: 16 },
  { ids: [5, 6, 7, 8], width: 15 },
  { ids: [9, 10, 11, 12], width: 16 },
  { ids: [13, 14, 15, 16], width: 14 },
  { ids: [17, 18, 19, 20], width: 12 },
];
const PALM = [0, 5, 9, 13, 17];
const TIPS = new Set([4, 8, 12, 16, 20]);
const COLORS = {
  core: [231, 254, 255],
  cyan: [103, 230, 255],
  blue: [28, 126, 255],
  deep: [26, 58, 221],
};

export class VirtualHandExperience {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') || null;
    this.enabled = false;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.tracks = new Map();
    this.lastRender = 0;
    this.wasActive = false;
    this.resize();
  }

  get primaryTrack() {
    return this.tracks.values().next().value || null;
  }

  get currentPoints() {
    return this.primaryTrack?.currentPoints || null;
  }

  get alpha() {
    let alpha = 0;
    for (const track of this.tracks.values()) alpha = Math.max(alpha, track.alpha);
    return alpha;
  }

  get targetLandmarks() {
    return this.primaryTrack?.targetLandmarks || null;
  }

  get handCount() {
    return this.tracks.size;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.canvas) this.canvas.hidden = !this.enabled;
    if (!this.enabled) this.clear();
    else this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    for (const track of this.tracks.values()) {
      if (!track.targetLandmarks) continue;
      const projected = projectNormalizedPoints(track.targetLandmarks, width, height);
      if (projected.length === 21) track.currentPoints = projected;
    }
  }

  update(hands, now) {
    if (!this.enabled) return;
    const list = (Array.isArray(hands) ? hands : [hands])
      .filter((hand) => hand?.points?.length >= 21)
      .slice(0, 2);
    const used = new Set();
    list.forEach((hand, index) => {
      const label = hand.label && hand.label !== 'Unknown' ? hand.label : `hand-${index}`;
      let key = label;
      if (used.has(key)) key = `${label}-${index}`;
      used.add(key);
      let track = this.tracks.get(key);
      if (!track) {
        track = {
          key,
          targetLandmarks: null,
          currentPoints: null,
          lastTargetAt: 0,
          alpha: 0,
          demoHold: false,
        };
        this.tracks.set(key, track);
      }
      track.targetLandmarks = hand.points;
      track.lastTargetAt = now;
      if (!track.currentPoints) {
        track.currentPoints = projectNormalizedPoints(hand.points, this.width, this.height);
        track.alpha = 1;
      }
    });
  }

  showDemo(hand, now = performance.now()) {
    this.showDemoHands([hand], now);
  }

  showDemoHands(hands, now = performance.now()) {
    if (!this.enabled) return;
    this.clear();
    this.update(hands, now);
    for (const track of this.tracks.values()) {
      track.demoHold = true;
      track.currentPoints = projectNormalizedPoints(track.targetLandmarks, this.width, this.height);
      track.alpha = 1;
    }
    this.wasActive = this.tracks.size > 0;
    this.render(now, true);
  }

  render(now, force = false) {
    if (!this.enabled || !this.ctx) return;
    let hasLive = false;
    for (const track of this.tracks.values()) {
      const active = track.demoHold || (!!track.targetLandmarks && now - track.lastTargetAt < 320);
      if (active || track.alpha > 0.01) {
        hasLive = true;
        break;
      }
    }
    if (!hasLive && !this.wasActive && !force) return;

    const dt = Math.max(0, Math.min(0.05, (now - (this.lastRender || now)) / 1000));
    this.lastRender = now;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    let anyVisible = false;
    for (const track of this.tracks.values()) {
      const active = track.demoHold || (!!track.targetLandmarks && now - track.lastTargetAt < 320);
      const fade = 1 - Math.exp(-dt * (active ? 20 : 11));
      track.alpha += ((active ? 1 : 0) - track.alpha) * fade;

      if (active && track.targetLandmarks) {
        const target = projectNormalizedPoints(track.targetLandmarks, this.width, this.height);
        if (target.length === 21) {
          if (!track.currentPoints || track.currentPoints.length !== 21) {
            track.currentPoints = target;
          } else {
            let maxMove = 0;
            for (let i = 0; i < 21; i += 1) {
              maxMove = Math.max(
                maxMove,
                Math.hypot(
                  target[i][0] - track.currentPoints[i][0],
                  target[i][1] - track.currentPoints[i][1],
                ),
              );
            }
            const rate = 25 + Math.min(38, maxMove * 0.7);
            const follow = 1 - Math.exp(-dt * rate);
            track.currentPoints = track.currentPoints.map((point, index) => [
              point[0] + (target[index][0] - point[0]) * follow,
              point[1] + (target[index][1] - point[1]) * follow,
            ]);
          }
        }
      }

      if (track.alpha > 0.01 && track.currentPoints) {
        anyVisible = true;
        this.drawHand(ctx, track.currentPoints, track.alpha);
      }
    }
    this.wasActive = anyVisible;
  }
  drawHand(ctx, points, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 掌心的半透明能量体
    const palmCenter = average(points, PALM);
    const palmRadius = Math.max(
      70,
      Math.hypot(points[0][0] - points[9][0], points[0][1] - points[9][1]) * 1.7,
    );
    const palmGradient = ctx.createRadialGradient(
      palmCenter[0], palmCenter[1], 0,
      palmCenter[0], palmCenter[1], palmRadius,
    );
    palmGradient.addColorStop(0, rgba(COLORS.core, 0.24));
    palmGradient.addColorStop(0.34, rgba(COLORS.cyan, 0.16));
    palmGradient.addColorStop(0.72, rgba(COLORS.blue, 0.07));
    palmGradient.addColorStop(1, rgba(COLORS.deep, 0));
    ctx.fillStyle = palmGradient;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const index of [5, 9, 13, 17]) ctx.lineTo(points[index][0], points[index][1]);
    ctx.closePath();
    ctx.fill();

    // 外层光晕
    ctx.save();
    ctx.shadowColor = rgba(COLORS.blue, 0.9);
    ctx.shadowBlur = 28;
    ctx.strokeStyle = rgba(COLORS.blue, 0.13);
    for (const finger of FINGERS) this.drawFinger(ctx, points, finger, 3.2);
    this.drawPalmFrame(ctx, points, 3.1);
    ctx.restore();

    // 青蓝色手部主体
    ctx.shadowColor = rgba(COLORS.cyan, 0.78);
    ctx.shadowBlur = 14;
    ctx.strokeStyle = rgba(COLORS.cyan, 0.28);
    for (const finger of FINGERS) this.drawFinger(ctx, points, finger, 2.2);
    this.drawPalmFrame(ctx, points, 2.2);

    // 高亮能量核心
    ctx.shadowColor = rgba(COLORS.core, 0.88);
    ctx.shadowBlur = 8;
    ctx.strokeStyle = rgba(COLORS.core, 0.76);
    for (const finger of FINGERS) this.drawFinger(ctx, points, finger, 0.72);
    this.drawPalmFrame(ctx, points, 0.72);

    // 关节点
    ctx.shadowBlur = 0;
    for (let index = 0; index < points.length; index += 1) {
      const [x, y] = points[index];
      const tip = TIPS.has(index);
      const radius = tip ? 4.2 : index === 0 ? 5.2 : 2.5;
      ctx.fillStyle = tip ? rgba(COLORS.core, 0.98) : rgba(COLORS.cyan, 0.72);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
      if (tip) {
        ctx.strokeStyle = rgba(COLORS.cyan, 0.44);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, TAU);
        ctx.stroke();
      }
    }

    // 掌心能量纹路
    ctx.globalAlpha = alpha * 0.34;
    ctx.strokeStyle = rgba(COLORS.cyan, 0.65);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 8]);
    ctx.beginPath();
    ctx.arc(palmCenter[0], palmCenter[1], palmRadius * 0.32, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawFinger(ctx, points, finger, scale) {
    for (let i = 0; i < finger.ids.length - 1; i += 1) {
      const from = points[finger.ids[i]];
      const to = points[finger.ids[i + 1]];
      const width = finger.width * scale * (1 - i * 0.09);
      capsule(ctx, from, to, width);
    }
  }

  drawPalmFrame(ctx, points, scale) {
    ctx.lineWidth = Math.max(1, 2.2 * scale);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const index of [5, 9, 13, 17]) ctx.lineTo(points[index][0], points[index][1]);
    ctx.closePath();
    ctx.stroke();
    capsule(ctx, points[5], points[9], 22 * scale);
    capsule(ctx, points[9], points[13], 22 * scale);
    capsule(ctx, points[13], points[17], 19 * scale);
  }

  clear() {
    this.tracks.clear();
    this.wasActive = false;
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

function capsule(ctx, from, to, width) {
  ctx.lineWidth = Math.max(1, width);
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
}

function average(points, indices) {
  let x = 0;
  let y = 0;
  for (const index of indices) {
    x += points[index][0];
    y += points[index][1];
  }
  return [x / indices.length, y / indices.length];
}



