/**
 * 伏魔御厨子：双手五指聚拢成印后触发。
 *
 * 前 5 秒持续生成大量空间斩，随后以 2.5 秒慢动作完成巨型空间斩。
 * 纯识别逻辑可独立测试，Canvas 表现只在大屏启用。
 */

import { handScale } from './gestures.js';
import { projectNormalizedPoint } from './screen-projection.js';

const TAU = Math.PI * 2;
const TIP_INDICES = [4, 8, 12, 16, 20];
const DOMAIN_RED = [255, 58, 67];
const DOMAIN_DEEP = [92, 0, 18];
const DOMAIN_WHITE = [255, 238, 232];
const DOMAIN_CYAN = [126, 225, 255];

/** 双手五指指尖聚拢成印。 */
export function analyzeDomainSeal(hands) {
  const valid = (Array.isArray(hands) ? hands : []).filter(
    (hand) => hand?.points?.length >= 21,
  );
  if (valid.length < 2) return { active: false, hands: valid.length };

  const metrics = valid.slice(0, 2).map((hand) => {
    const points = hand.points;
    const scale = Math.max(handScale(points), 1e-5);
    const tips = TIP_INDICES.map((index) => points[index]);
    const center = [
      tips.reduce((sum, point) => sum + point[0], 0) / tips.length,
      tips.reduce((sum, point) => sum + point[1], 0) / tips.length,
    ];
    const spread = tips.reduce((sum, point) => (
      sum + Math.hypot(point[0] - center[0], point[1] - center[1])
    ), 0) / tips.length;
    return { hand, center, scale, spread: spread / scale };
  });

  const active = metrics.every((metric) => metric.spread < 0.5);
  if (!active) {
    return {
      active: false,
      hands: valid.length,
      spread: Math.max(...metrics.map((metric) => metric.spread)),
    };
  }
  return {
    active: true,
    hands: valid.length,
    point: [
      (metrics[0].center[0] + metrics[1].center[0]) * 0.5,
      (metrics[0].center[1] + metrics[1].center[1]) * 0.5,
    ],
    spread: Math.max(...metrics.map((metric) => metric.spread)),
  };
}

export class DomainSkill {
  constructor(options = {}) {
    this.holdMs = options.holdMs ?? 480;
    this.barrageMs = options.barrageMs ?? 5000;
    this.finalMs = options.finalMs ?? 2500;
    this.cooldownMs = options.cooldownMs ?? 12000;
    this.reset();
  }

  reset() {
    this.active = false;
    this.startedAt = 0;
    this.lastStartedAt = -Infinity;
    this.poseStartedAt = 0;
    this.readyPoint = null;
  }

  update(hands, now) {
    const seal = analyzeDomainSeal(hands);
    this.readyPoint = seal.active ? seal.point : null;

    if (this.active) {
      const elapsed = now - this.startedAt;
      if (elapsed < this.barrageMs) {
        return { type: 'barrage', elapsed, duration: this.barrageMs, point: seal.point };
      }
      if (elapsed < this.barrageMs + this.finalMs) {
        return {
          type: 'final',
          elapsed,
          progress: (elapsed - this.barrageMs) / this.finalMs,
          point: seal.point,
        };
      }
      this.active = false;
      this.readyPoint = null;
      return { type: 'done', elapsed };
    }

    if (!seal.active) {
      this.poseStartedAt = 0;
      return { type: 'idle', point: null };
    }

    if (!this.poseStartedAt) this.poseStartedAt = now;
    const hold = now - this.poseStartedAt;
    if (hold < this.holdMs) {
      return {
        type: 'ready',
        progress: hold / this.holdMs,
        point: seal.point,
      };
    }

    if (now < this.lastStartedAt + this.cooldownMs) {
      return { type: 'cooldown', point: seal.point };
    }

    this.active = true;
    this.startedAt = now;
    this.lastStartedAt = now;
    this.readyPoint = seal.point;
    return { type: 'activate', point: seal.point, elapsed: 0 };
  }
}

export class DomainExperience {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') || null;
    this.enabled = false;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.skill = new DomainSkill();
    this.active = false;
    this.startedAt = 0;
    this.readyPoint = null;
    this.readyProgress = 0;
    this.slashes = [];
    this.shards = [];
    this.nextSpawnAt = 0;
    this.lastRender = 0;
    this.flash = 0;
    this.wasActive = false;
    this.resize();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.canvas) this.canvas.hidden = !this.enabled;
    if (!this.enabled) this.clear();
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
  }

  suppressEnergy() {
    return this.active || this.phase === 'ready' || this.phase === 'cooldown';
  }

  update(hands, now) {
    if (!this.enabled) return;
    const result = this.skill.update(hands, now);
    this.phase = result.type;
    this.readyPoint = result.point || null;
    this.readyProgress = result.progress || 0;
    if (result.type === 'activate') this.start(now);
    if (result.type === 'done') this.finish();
    return result;
  }

  start(now) {
    this.active = true;
    this.phase = 'barrage';
    this.startedAt = now;
    this.nextSpawnAt = now;
    this.slashes = [];
    this.shards = [];
    this.flash = 1;
    document.body.classList.add('domain-active');
    document.body.dataset.domain = 'active';
  }

  finish() {
    this.active = false;
    this.phase = 'done';
    this.readyPoint = null;
    this.slashes = [];
    this.shards = [];
    document.body.classList.remove('domain-active');
    document.body.dataset.domain = 'done';
  }

  render(now) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const ready = !this.active && this.readyPoint && this.phase !== 'done';
    if (!this.active && !ready) {
      if (this.wasActive) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        this.wasActive = false;
      }
      return;
    }

    const dt = Math.max(0, Math.min(0.05, (now - (this.lastRender || now)) / 1000));
    this.lastRender = now;
    this.wasActive = true;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (!this.active) {
      this.drawReadySeal(ctx, this.readyPoint, this.readyProgress, now);
      return;
    }

    const elapsed = now - this.startedAt;
    if (elapsed >= 7500) {
      this.finish();
      ctx.clearRect(0, 0, this.width, this.height);
      return;
    }

    this.drawDomainBackdrop(ctx, now, elapsed);
    if (elapsed < 5000) {
      this.pruneSlashes(now);
      this.spawnSlashes(now, elapsed);
      this.drawSlashes(ctx, now);
      this.drawBarrageHud(ctx, elapsed);
    } else {
      this.drawFinalSlash(ctx, (elapsed - 5000) / 2500, elapsed);
    }
    this.flash = Math.max(0, this.flash - dt * 1.8);
  }

  spawnSlashes(now, elapsed) {
    const interval = 16;
    if (now >= this.nextSpawnAt) {
      const minimumBurst = elapsed < 3800 ? 3 : 1;
      const bursts = minimumBurst + Math.min(4, Math.floor((now - this.nextSpawnAt) / interval));
      this.nextSpawnAt = now + interval;
      for (let i = 0; i < bursts; i += 1) {
        this.slashes.push(this.makeSlash(now, elapsed));
        if (Math.random() > 0.72) this.slashes.push(this.makeSlash(now, elapsed, true));
      }
    }
    // 即使设备帧率较低，也保证领域内维持足够密集的空间斩。
    let filler = 0;
    while (this.slashes.length < 72 && filler < 48) {
      this.slashes.push(this.makeSlash(now, elapsed, Math.random() > 0.8));
      filler += 1;
    }
    if (this.slashes.length > 120) this.slashes.splice(0, this.slashes.length - 120);
  }
  makeSlash(now, elapsed, cross = false) {
    const x = this.width * (0.1 + Math.random() * 0.8);
    const y = this.height * (0.1 + Math.random() * 0.72);
    const angle = -Math.PI * 0.8 + Math.random() * Math.PI * 1.6;
    const length = this.width * (0.035 + Math.random() * 0.28);
    const bend = (Math.random() - 0.5) * length * 0.34;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    const points = [
      [x - Math.cos(angle) * length * 0.5, y - Math.sin(angle) * length * 0.5],
      [x + normalX * bend, y + normalY * bend],
      [x + Math.cos(angle) * length * 0.5, y + Math.sin(angle) * length * 0.5],
    ];
    const slash = {
      points,
      born: now,
      life: 240 + Math.random() * 420,
      width: 1 + Math.random() * 5,
      hot: Math.random() > 0.42,
      cross: null,
    };
    if (cross) {
      const a2 = angle + Math.PI * (0.35 + Math.random() * 0.3);
      const len2 = length * (0.48 + Math.random() * 0.35);
      slash.cross = [
        [x - Math.cos(a2) * len2 * 0.5, y - Math.sin(a2) * len2 * 0.5],
        [x, y],
        [x + Math.cos(a2) * len2 * 0.5, y + Math.sin(a2) * len2 * 0.5],
      ];
    }
    return slash;
  }

  pruneSlashes(now) {
    this.slashes = this.slashes.filter((slash) => now - slash.born < slash.life);
  }

  drawSlashes(ctx, now) {
    for (const slash of this.slashes) {
      const age = now - slash.born;
      const t = age / slash.life;
      const alpha = Math.sin(Math.min(1, t * 1.35) * Math.PI) * (1 - t * 0.18);
      this.drawSlashPath(ctx, slash.points, slash.width, alpha, slash.hot);
      if (slash.cross) this.drawSlashPath(ctx, slash.cross, slash.width * 0.72, alpha * 0.9, false);
    }
  }
  drawSlashPath(ctx, points, width, alpha, hot) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.82 * alpha})`;
    ctx.lineWidth = width + 5;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.quadraticCurveTo(points[1][0], points[1][1], points[2][0], points[2][1]);
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = `rgba(75, 200, 255, ${0.9 * alpha})`;
    ctx.shadowBlur = 14 + width * 3;
    ctx.strokeStyle = `rgba(88, 210, 255, ${0.72 * alpha})`;
    ctx.lineWidth = width + 1.5;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.quadraticCurveTo(points[1][0], points[1][1], points[2][0], points[2][1]);
    ctx.stroke();

    ctx.shadowColor = `rgba(255, 238, 232, ${0.9 * alpha})`;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = hot
      ? `rgba(255, 244, 240, ${0.94 * alpha})`
      : `rgba(174, 226, 255, ${0.72 * alpha})`;
    ctx.lineWidth = Math.max(0.7, width * 0.35);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.quadraticCurveTo(points[1][0], points[1][1], points[2][0], points[2][1]);
    ctx.stroke();
    ctx.restore();
  }

  drawReadySeal(ctx, point, progress, now) {
    const p = projectNormalizedPoint(point, this.width, this.height)
      || [this.width * 0.5, this.height * 0.5];
    const pulse = 0.82 + Math.sin(now * 0.008) * 0.18;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(p[0], p[1]);
    ctx.strokeStyle = `rgba(170, 235, 255, ${0.32 + progress * 0.5})`;
    ctx.shadowColor = 'rgba(70, 205, 255, 0.95)';
    ctx.shadowBlur = 24;
    ctx.lineWidth = 1.4 + progress * 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, (42 + progress * 24) * pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, 66 + progress * 18, -Math.PI * 0.3, Math.PI * 1.15);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * TAU + now * 0.0007;
      ctx.fillStyle = `rgba(${185 + i * 4}, 235, 255, ${0.35 + progress * 0.4})`;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * (78 + progress * 14), Math.sin(angle) * (78 + progress * 14), 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDomainBackdrop(ctx, now, elapsed) {
    const pulse = 0.88 + Math.sin(now * 0.006) * 0.12;
    ctx.save();
    const veil = ctx.createRadialGradient(
      this.width * 0.5, this.height * 0.46, 0,
      this.width * 0.5, this.height * 0.46, Math.max(this.width, this.height) * 0.72,
    );
    veil.addColorStop(0, `rgba(4, 18, 30, ${0.11 + this.flash * 0.18})`);
    veil.addColorStop(0.55, 'rgba(3, 8, 15, 0.3)');
    veil.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, this.width, this.height);

    // 中央神社轮廓
    const cx = this.width * 0.5;
    const baseY = this.height * 0.77;
    const topY = this.height * 0.24;
    const half = Math.min(this.width * 0.19, this.height * 0.31);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(174, 233, 255, 0.3)';
    ctx.shadowColor = 'rgba(74, 210, 255, 0.9)';
    ctx.shadowBlur = 26;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - half, baseY);
    ctx.lineTo(cx - half * 0.78, topY + 42);
    ctx.lineTo(cx - half * 0.42, topY + 42);
    ctx.lineTo(cx - half * 0.22, baseY);
    ctx.moveTo(cx + half, baseY);
    ctx.lineTo(cx + half * 0.78, topY + 42);
    ctx.lineTo(cx + half * 0.42, topY + 42);
    ctx.lineTo(cx + half * 0.22, baseY);
    ctx.moveTo(cx - half * 0.92, topY + 36);
    ctx.lineTo(cx + half * 0.92, topY + 36);
    ctx.moveTo(cx - half * 0.68, topY + 8);
    ctx.lineTo(cx + half * 0.68, topY + 8);
    ctx.stroke();

    // 领域内快速掠过的红色空间纹路
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i += 1) {
      const y = this.height * (0.08 + i * 0.052);
      const offset = Math.sin(i * 2.7 + now * 0.0018) * this.width * 0.12;
      ctx.strokeStyle = `rgba(170, 230, 255, ${0.025 + (i % 4) * 0.012})`;
      ctx.beginPath();
      ctx.moveTo(-40 + offset, y);
      ctx.lineTo(this.width + 40, y - this.height * 0.04);
      ctx.stroke();
    }

    // 全屏脉动红光
    const flashAlpha = this.flash * 0.22 * pulse;
    if (flashAlpha > 0.005) {
      ctx.fillStyle = `rgba(190, 240, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
  }

  drawBarrageHud(ctx, elapsed) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(75, 205, 255, 0.95)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(224, 249, 255, 0.82)';
    ctx.font = `600 ${Math.max(22, Math.min(42, this.width * 0.028))}px "Microsoft YaHei UI", sans-serif`;
    ctx.fillText('伏 魔 御 厨 子', this.width * 0.5, this.height * 0.13);
    ctx.fillStyle = 'rgba(154, 220, 242, 0.62)';
    ctx.font = `500 ${Math.max(9, this.width * 0.008)}px ui-monospace, Consolas, monospace`;
    ctx.fillText(`DOMAIN EXPANSION  ${(5 - elapsed / 1000).toFixed(1)}s`, this.width * 0.5, this.height * 0.16);
    ctx.restore();
  }

  drawFinalSlash(ctx, progress, elapsed) {
    const p = Math.max(0, Math.min(1, progress));
    const slow = 1 - Math.pow(1 - p, 2.2);
    const windup = Math.min(1, p / 0.14);
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.16 + slow * 0.32})`;
    ctx.fillRect(0, 0, this.width, this.height);

    const x0 = -this.width * 0.12;
    const y0 = this.height * 0.18;
    const x1 = this.width * 1.12;
    const y1 = this.height * 0.84;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const endT = Math.max(0.03, slow);
    const shake = (1 - slow) * Math.sin(elapsed * 0.09) * 7;
    ctx.translate(shake, -shake * 0.4);

    // 巨斩路径带有轻微空间折线
    const points = [];
    const steps = 32;
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * endT;
      const nx = x0 + dx * t;
      const ny = y0 + dy * t;
      const jitter = Math.sin(i * 2.9 + elapsed * 0.003) * (this.height * 0.006);
      points.push([nx - Math.sin(Math.atan2(dy, dx)) * jitter, ny + Math.cos(Math.atan2(dy, dx)) * jitter]);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.86 * windup})`;
    ctx.lineWidth = 34 + 34 * slow;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points) ctx.lineTo(point[0], point[1]);
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(76, 210, 255, 1)';
    ctx.shadowBlur = 40;
    ctx.strokeStyle = `rgba(88, 214, 255, ${0.55 + windup * 0.35})`;
    ctx.lineWidth = 13 + 12 * windup;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points) ctx.lineTo(point[0], point[1]);
    ctx.stroke();

    ctx.shadowColor = 'rgba(255, 248, 240, 0.95)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255, 250, 245, ${0.92 * windup})`;
    ctx.lineWidth = 2.4 + 2 * windup;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points) ctx.lineTo(point[0], point[1]);
    ctx.stroke();

    // 慢动作空间碎片
    const shardCount = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 18 : 64;
    for (let i = 0; i < shardCount; i += 1) {
      const random = seeded(77, i);
      const along = windup * (0.15 + random * 0.85);
      const side = (seeded(91, i) - 0.5) * (90 + slow * 220);
      const sx = x0 + dx * along - Math.sin(Math.atan2(dy, dx)) * side;
      const sy = y0 + dy * along + Math.cos(Math.atan2(dy, dx)) * side;
      const size = 2 + seeded(121, i) * 9;
      ctx.fillStyle = `rgba(${i % 3 === 0 ? '245, 253, 255' : '90, 214, 255'}, ${0.2 + windup * 0.55})`;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(dy, dx) + (seeded(151, i) - 0.5) * 0.8);
      ctx.fillRect(-size, -size * 0.15, size * 2, size * 0.3);
      ctx.restore();
    }

    if (p > 0.68) {
      const fade = Math.min(1, (p - 0.68) / 0.32);
      ctx.fillStyle = `rgba(90, 214, 255, ${fade * 0.08})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(76, 210, 255, 0.95)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = `rgba(255, 230, 225, ${fade * 0.82})`;
      ctx.font = `600 ${Math.max(24, Math.min(54, this.width * 0.034))}px "Microsoft YaHei UI", sans-serif`;
      ctx.fillText('空 间 斩', this.width * 0.5, this.height * 0.91);
    }
    ctx.restore();
  }

  showDemo(now = performance.now()) {
    if (!this.enabled) return;
    this.start(now);
    this.render(now);
  }

  clear() {
    this.active = false;
    this.phase = 'idle';
    this.readyPoint = null;
    this.readyProgress = 0;
    this.slashes = [];
    this.shards = [];
    this.skill.reset();
    this.wasActive = false;
    document.body.classList.remove('domain-active');
    document.body.dataset.domain = 'off';
    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

function seeded(seed, index) {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}











