/**
 * 大屏手势技能：聚能蓝色能量球，快速前推时发射。
 *
 * 只在大屏启用（由 main.js 判断）。逻辑层不依赖 DOM，便于 Node 测试。
 */

import { handScale, pinchRatio } from './gestures.js';
import { rgba } from './config.js';
import { projectNormalizedPoint } from './screen-projection.js';

const TAU = Math.PI * 2;

export const ENERGY_PINCH_RATIO = 0.45;
export const ENERGY_BREAKPOINT = '(min-width: 960px) and (min-height: 600px)';

const COLORS = {
  white: [247, 255, 255],
  cyan: [104, 231, 255],
  blue: [31, 137, 255],
  deep: [34, 63, 255],
  violet: [117, 112, 255],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function handDepth(hand) {
  const z = Number(hand?.z);
  if (Number.isFinite(z)) return z;
  const depths = hand?.depths;
  if (Array.isArray(depths) && depths.length) {
    return depths.reduce((sum, value) => sum + (Number(value) || 0), 0) / depths.length;
  }
  return 0;
}

/**
 * 只有拇指与食指捏合时才判定为聚能手势。
 * 其他手型（张开手掌、双指、单指或双手合拢）都不会生成能量球。
 */
export function analyzeEnergyGesture(hands) {
  const valid = (Array.isArray(hands) ? hands : []).filter(
    (hand) => hand?.points?.length >= 21,
  );
  let candidate = null;
  for (const hand of valid) {
    const ratio = pinchRatio(hand.points);
    if (!candidate || ratio < candidate.ratio) candidate = { hand, ratio };
  }
  if (!candidate) return { active: false };

  const points = candidate.hand.points;
  const point = [
    (points[4][0] + points[8][0]) * 0.5,
    (points[4][1] + points[8][1]) * 0.5,
  ];
  const base = {
    point,
    points,
    scale: handScale(points),
    z: handDepth(candidate.hand),
    pinchRatio: candidate.ratio,
    separation: 0,
  };
  if (candidate.ratio > ENERGY_PINCH_RATIO) {
    return { ...base, active: false };
  }
  return {
    ...base,
    active: true,
    mode: 'pinch',
    label: '捏合聚能',
    ratio: candidate.ratio,
  };
}
/** 纯逻辑技能状态机。 */
export class EnergySkill {
  constructor(options = {}) {
    this.holdMs = options.holdMs ?? 180;
    this.chargeMs = options.chargeMs ?? 760;
    this.fireThreshold = options.fireThreshold ?? 1;
    this.cooldownMs = options.cooldownMs ?? 850;
    this.reset();
  }

  reset() {
    this.active = false;
    this.mode = '';
    this.startedAt = 0;
    this.charge = 0;
    this.prev = null;
    this.lastFireAt = -Infinity;
  }

  update(hands, now) {
    if (!Number.isFinite(now)) return { type: 'none', charge: 0 };
    const sample = analyzeEnergyGesture(hands);
    const prev = this.prev;

    // 捏合张开/弹指的瞬间：球已经出现，就沿城市方向发射。
    if (!sample.active) {
      const wasReady = this.active && this.startedAt > 0 && now - this.startedAt >= this.holdMs;
      const quickRelease = prev
        && Number.isFinite(sample.pinchRatio)
        && sample.pinchRatio > prev.pinchRatio + 0.08
        && now - prev.at < 240;
      if (wasReady && quickRelease && now >= this.lastFireAt + this.cooldownMs) {
        return this.fireEvent(prev.point, now);
      }
      this.active = false;
      this.mode = '';
      this.startedAt = 0;
      this.charge = 0;
      this.prev = null;
      return { type: 'none', charge: 0, point: null };
    }

    if (!this.active || this.mode !== sample.mode) {
      this.active = true;
      this.mode = sample.mode;
      this.startedAt = now;
      this.charge = 0;
      this.prev = { ...sample, at: now };
      return {
        type: 'charge',
        charge: 0,
        visible: false,
        point: sample.point,
        mode: sample.mode,
        label: sample.label,
      };
    }

    const hold = now - this.startedAt;
    const cooldownLeft = this.lastFireAt + this.cooldownMs - now;
    this.charge = cooldownLeft > 0 ? 0 : clamp((hold - this.holdMs) / this.chargeMs, 0, 1);
    const ready = cooldownLeft <= 0 && hold >= this.holdMs;

    let fire = false;
    if (prev && ready) {
      const dt = Math.max(0.001, Math.min(0.18, (now - prev.at) / 1000));
      const dx = sample.point[0] - prev.point[0];
      const dy = sample.point[1] - prev.point[1];
      const speed = Math.hypot(dx, dy) / dt;
      const scaleRate = (sample.scale / Math.max(prev.scale, 1e-5) - 1) / dt;
      const depthRate = (prev.z - sample.z) / dt;

      // 弹指判定：扣除手掌整体位移后，拇指/食指/中指尖端的相对速度。
      let snapSpeed = 0;
      if (prev.points && sample.points) {
        const palmDx = sample.points[0][0] - prev.points[0][0];
        const palmDy = sample.points[0][1] - prev.points[0][1];
        for (const index of [4, 8, 12]) {
          const relX = sample.points[index][0] - prev.points[index][0] - palmDx;
          const relY = sample.points[index][1] - prev.points[index][1] - palmDy;
          snapSpeed = Math.max(snapSpeed, Math.hypot(relX, relY) / dt);
        }
      }

      const screenScore = speed / 1.1;
      const scaleScore = scaleRate / 1.25;
      const depthScore = depthRate / 0.55;
      const snapScore = snapSpeed / 1.8;
      const strongest = Math.max(screenScore, scaleScore, depthScore, snapScore);
      if (strongest >= this.fireThreshold) fire = true;
    }

    if (fire) return this.fireEvent(prev?.point || sample.point, now);

    const event = {
      type: 'charge',
      charge: this.charge,
      visible: hold >= this.holdMs,
      point: sample.point,
      mode: sample.mode,
      label: sample.label,
      power: this.charge,
      direction: null,
      fireType: 'city',
    };
    this.prev = { ...sample, at: now };
    return event;
  }

  fireEvent(point, now) {
    this.lastFireAt = now;
    this.active = false;
    this.mode = '';
    this.startedAt = 0;
    this.charge = 0;
    this.prev = null;
    return {
      type: 'fire',
      charge: 1,
      visible: false,
      point: point || [0.5, 0.5],
      mode: 'pinch',
      label: '捏合聚能',
      power: 1,
      direction: null,
      fireType: 'city',
    };
  }
}
/** 大屏 canvas 动画。 */
export class EnergyExperience {
  constructor(canvas, hint) {
    this.canvas = canvas;
    this.hint = hint;
    this.ctx = canvas?.getContext('2d') || null;
    this.enabled = false;
    this.skill = new EnergySkill();
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.chargePoint = null;
    this.chargePower = 0;
    this.visible = false;
    this.projectiles = [];
    this.explosions = [];
    this.sparks = [];
    this.flash = null;
    this.lastRender = 0;
    this.hintTimer = 0;
    this.hintFrame = 0;
    this.wasActive = false;
    this.demoPower = 0;
    this.demoPoint = null;
    this.resize();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    document.body.classList.toggle('energy-enabled', this.enabled);
    if (this.canvas) this.canvas.hidden = !this.enabled;
    if (this.hint) this.hint.hidden = !this.enabled;
    document.body.dataset.energySkill = this.enabled ? 'on' : 'off';
    if (!this.enabled) {
      this.clear();
      this.hideHint();
    } else {
      this.resize();
      this.showHint();
    }
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

  showHint() {
    if (!this.hint || !this.enabled) return;
    window.clearTimeout(this.hintTimer);
    window.cancelAnimationFrame(this.hintFrame);
    this.hint.hidden = false;
    this.hintFrame = window.requestAnimationFrame(() => this.hint.classList.add('is-visible'));
    this.hintTimer = window.setTimeout(() => this.hideHint(), 8000);
  }

  hideHint() {
    if (!this.hint) return;
    window.clearTimeout(this.hintTimer);
    window.cancelAnimationFrame(this.hintFrame);
    this.hint.classList.remove('is-visible');
    this.hintTimer = window.setTimeout(() => {
      if (!this.hint.classList.contains('is-visible')) this.hint.hidden = true;
    }, 380);
  }

  update(hands, now) {
    if (!this.enabled) return;
    const event = this.skill.update(hands, now);
    if (event.type === 'none') {
      this.visible = false;
      this.chargePower = 0;
      return;
    }
    if (event.type === 'fire') {
      this.visible = false;
      this.chargePower = 0;
      this.hideHint();
      this.spawnFire(event, now);
      return;
    }
    this.visible = !!event.visible;
    this.chargePower = event.charge || 0;
    this.chargePoint = event.point;
    if (this.visible) {
      this.demoPower = 0;
      this.demoPoint = null;
      this.hideHint();
    }
  }

  showDemo(hand, now = performance.now()) {
    if (!this.enabled || !hand?.points?.length) return;
    const point = [
      (hand.points[4][0] + hand.points[8][0]) * 0.5,
      (hand.points[4][1] + hand.points[8][1]) * 0.5,
    ];
    this.demoPoint = point;
    this.demoPower = 0.78;
    this.chargePoint = point;
    this.chargePower = 0.78;
    this.visible = true;
    this.hideHint();
    this.render(now);
  }

  spawnFire(event, now) {
    const point = event.point || this.chargePoint || [0.5, 0.5];
    const [screenX, screenY] = projectNormalizedPoint(point, this.width, this.height)
      || [this.width * 0.5, this.height * 0.5];
    const targetX = this.width * (0.36 + Math.random() * 0.28);
    const targetY = this.height * (0.5 + Math.random() * 0.08);
    this.projectiles.push({
      type: 'city',
      x: screenX,
      y: screenY,
      ox: screenX,
      oy: screenY,
      targetX,
      targetY,
      controlX: (screenX + targetX) * 0.5 + (Math.random() - 0.5) * this.width * 0.12,
      controlY: Math.min(screenY, targetY) - this.height * (0.08 + Math.random() * 0.08),
      born: now,
      age: 0,
      life: 760,
      seed: Math.random() * 1000,
      power: Math.max(0.7, this.chargePower || 0.7),
    });
  }

  detonate(projectile, now) {
    this.explosions.push({
      x: projectile.targetX,
      y: projectile.targetY,
      born: now,
      life: 1150,
      seed: projectile.seed,
      radius: Math.min(this.width, this.height) * (0.16 + Math.random() * 0.035),
    });
    this.flash = {
      x: projectile.targetX,
      y: projectile.targetY,
      born: now,
      life: 560,
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count = reduced ? 24 : 76;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 80 + Math.random() * 620;
      this.sparks.push({
        x: projectile.targetX,
        y: projectile.targetY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        born: now,
        life: 420 + Math.random() * 720,
        size: 1.2 + Math.random() * 4.2,
      });
    }
  }
  render(now) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const active = this.visible || this.projectiles.length > 0 || this.explosions.length > 0 || this.sparks.length > 0 || !!this.flash;
    if (!active) {
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
    ctx.globalCompositeOperation = 'lighter';

    if (this.visible && this.chargePoint) {
      const p = this.demoPoint || this.chargePoint;
      const [screenX, screenY] = projectNormalizedPoint(p, this.width, this.height)
        || [this.width * 0.5, this.height * 0.5];
      this.drawOrb(ctx, screenX, screenY, this.chargePower, now, 1);
      this.drawChargeRings(ctx, screenX, screenY, this.chargePower, now);
    }

    this.projectiles = this.projectiles.filter((projectile) => {
      projectile.age = now - projectile.born;
      if (projectile.age >= projectile.life) {
        this.detonate(projectile, now);
        return false;
      }
      this.drawProjectile(ctx, projectile, now);
      return true;
    });

    this.explosions = this.explosions.filter((explosion) => {
      const age = now - explosion.born;
      if (age >= explosion.life) return false;
      this.drawExplosion(ctx, explosion, now);
      return true;
    });

    this.sparks = this.sparks.filter((spark) => {
      const age = now - spark.born;
      if (age >= spark.life) return false;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vx *= 0.985;
      spark.vy *= 0.985;
      const alpha = 1 - age / spark.life;
      ctx.fillStyle = rgba(COLORS.cyan, alpha * 0.9);
      ctx.shadowColor = rgba(COLORS.blue, alpha);
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * alpha, 0, TAU);
      ctx.fill();
      return true;
    });
    ctx.shadowBlur = 0;

    if (this.flash) {
      const age = now - this.flash.born;
      if (age >= this.flash.life) {
        this.flash = null;
      } else {
        const alpha = (1 - age / this.flash.life) * 0.34;
        const gradient = ctx.createRadialGradient(
          this.flash.x, this.flash.y, 0,
          this.flash.x, this.flash.y, Math.max(this.width, this.height) * 0.7,
        );
        gradient.addColorStop(0, rgba(COLORS.white, alpha));
        gradient.addColorStop(0.16, rgba(COLORS.cyan, alpha * 0.78));
        gradient.addColorStop(0.44, rgba(COLORS.blue, alpha * 0.28));
        gradient.addColorStop(1, rgba(COLORS.deep, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawOrb(ctx, x, y, power, now, alpha = 1) {
    const pulse = 0.94 + Math.sin(now * 0.008) * 0.06;
    const radius = (54 + power * 74) * pulse;
    const haloRadius = radius * 2.35;

    ctx.save();
    ctx.globalAlpha = alpha;
    const halo = ctx.createRadialGradient(x, y, radius * 0.08, x, y, haloRadius);
    halo.addColorStop(0, rgba(COLORS.white, 0.98));
    halo.addColorStop(0.1, rgba(COLORS.cyan, 0.92));
    halo.addColorStop(0.28, rgba(COLORS.blue, 0.48));
    halo.addColorStop(0.62, rgba(COLORS.deep, 0.16));
    halo.addColorStop(1, rgba(COLORS.deep, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, haloRadius, 0, TAU);
    ctx.fill();

    ctx.shadowColor = rgba(COLORS.cyan, 0.95);
    ctx.shadowBlur = 34;
    ctx.strokeStyle = rgba(COLORS.cyan, 0.82);
    ctx.lineWidth = 1.4 + power * 1.8;
    for (let i = 0; i < 3; i += 1) {
      const spin = now * (0.0012 + i * 0.00035) + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * (0.72 + i * 0.12), radius * (0.24 + i * 0.05), spin, 0, TAU);
      ctx.stroke();
    }

    // 球体内部的电弧
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 5; i += 1) {
      const base = now * 0.0013 + i * (TAU / 5);
      let px = x + Math.cos(base) * radius * 0.18;
      let py = y + Math.sin(base) * radius * 0.18;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let step = 1; step <= 4; step += 1) {
        const angle = base + (step / 4) * 0.5 + Math.sin(now * 0.006 + i + step) * 0.3;
        const rr = radius * (0.22 + step * 0.15);
        px = x + Math.cos(angle) * rr;
        py = y + Math.sin(angle) * rr;
        ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(COLORS.white, 0.5 + power * 0.3);
      ctx.stroke();
    }

    // 核心
    const core = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.42);
    core.addColorStop(0, rgba(COLORS.white, 1));
    core.addColorStop(0.25, rgba(COLORS.cyan, 0.96));
    core.addColorStop(0.75, rgba(COLORS.blue, 0.58));
    core.addColorStop(1, rgba(COLORS.blue, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.42, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawChargeRings(ctx, x, y, power, now) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(now * 0.00035);
    ctx.strokeStyle = rgba(COLORS.cyan, 0.2 + power * 0.3);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, 105 + power * 46, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * TAU + now * 0.0006;
      const radius = 92 + power * 38 + Math.sin(now * 0.004 + i) * 5;
      ctx.fillStyle = rgba(i % 3 === 0 ? COLORS.white : COLORS.cyan, 0.35 + power * 0.45);
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 1.4 + power, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawProjectile(ctx, projectile, now) {
    const t = clamp(projectile.age / projectile.life, 0, 1);
    const eased = 1 - Math.pow(1 - t, 2.4);
    const u = 1 - eased;
    const pointAt = (progress) => {
      const inv = 1 - progress;
      return [
        inv * inv * projectile.ox + 2 * inv * progress * projectile.controlX + progress * progress * projectile.targetX,
        inv * inv * projectile.oy + 2 * inv * progress * projectile.controlY + progress * progress * projectile.targetY,
      ];
    };
    const [x, y] = pointAt(eased);
    const alpha = 1 - t * 0.16;
    const orbPower = 1 - t * 0.36;

    ctx.save();
    // 飞向城市时的蓝色拖尾
    for (let i = 6; i >= 1; i -= 1) {
      const past = pointAt(Math.max(0, eased - i * 0.035));
      const trailAlpha = (1 - i / 7) * (1 - t * 0.5) * 0.46;
      const trailRadius = 20 * (1 - i / 9) * (1 - t * 0.36);
      ctx.fillStyle = rgba(i % 2 ? COLORS.cyan : COLORS.blue, trailAlpha);
      ctx.shadowColor = rgba(COLORS.cyan, trailAlpha);
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(past[0], past[1], Math.max(1, trailRadius), 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = rgba(COLORS.cyan, 0.44 * alpha);
    ctx.lineWidth = 7 * (1 - t * 0.45);
    ctx.shadowColor = rgba(COLORS.blue, 0.9);
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.moveTo(projectile.ox, projectile.oy);
    ctx.quadraticCurveTo(projectile.controlX, projectile.controlY, x, y);
    ctx.stroke();
    ctx.restore();

    this.drawOrb(ctx, x, y, orbPower, now, alpha);
  }

  drawExplosion(ctx, explosion, now) {
    const t = clamp((now - explosion.born) / explosion.life, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const fade = 1 - t;
    const radius = explosion.radius * (0.18 + eased * 1.15);
    const x = explosion.x;
    const y = explosion.y;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 白热核心与青蓝能量云
    const core = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.35);
    core.addColorStop(0, rgba(COLORS.white, fade * 0.96));
    core.addColorStop(0.08, rgba(COLORS.cyan, fade * 0.86));
    core.addColorStop(0.3, rgba(COLORS.blue, fade * 0.4));
    core.addColorStop(0.68, rgba(COLORS.deep, fade * 0.14));
    core.addColorStop(1, rgba(COLORS.deep, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.35, 0, TAU);
    ctx.fill();

    // 冲击波环
    for (let i = 0; i < 3; i += 1) {
      const ringT = clamp(t * 1.2 - i * 0.12, 0, 1);
      const ringRadius = explosion.radius * (0.2 + ringT * (1.5 + i * 0.35));
      ctx.strokeStyle = rgba(i === 0 ? COLORS.white : COLORS.cyan, (1 - ringT) * 0.6);
      ctx.lineWidth = Math.max(1, 4.5 * (1 - ringT));
      ctx.shadowColor = rgba(COLORS.cyan, 0.9);
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.ellipse(x, y, ringRadius, ringRadius * (0.52 + i * 0.08), 0, 0, TAU);
      ctx.stroke();
    }

    // 向外炸开的电弧
    ctx.lineWidth = Math.max(1, 2.4 * fade);
    for (let i = 0; i < 14; i += 1) {
      const r1 = seeded(explosion.seed, i * 3 + 1);
      const r2 = seeded(explosion.seed, i * 3 + 2);
      const angle = (i / 14) * TAU + (r1 - 0.5) * 0.3;
      const inner = radius * (0.3 + r2 * 0.16);
      const outer = radius * (0.9 + r1 * 0.75);
      const bend = (r2 - 0.5) * 0.18;
      ctx.strokeStyle = rgba(i % 3 === 0 ? COLORS.white : COLORS.cyan, fade * 0.66);
      ctx.shadowColor = rgba(COLORS.blue, fade);
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      ctx.lineTo(
        x + Math.cos(angle + bend) * (inner + outer) * 0.52,
        y + Math.sin(angle + bend) * (inner + outer) * 0.52,
      );
      ctx.lineTo(x + Math.cos(angle - bend * 0.5) * outer, y + Math.sin(angle - bend * 0.5) * outer);
      ctx.stroke();
    }

    // 向城市上空升起的能量柱
    const beam = ctx.createLinearGradient(x, y - radius * 1.9, x, y + radius * 0.2);
    beam.addColorStop(0, rgba(COLORS.cyan, 0));
    beam.addColorStop(0.52, rgba(COLORS.cyan, fade * 0.2));
    beam.addColorStop(1, rgba(COLORS.white, fade * 0.48));
    ctx.fillStyle = beam;
    ctx.fillRect(x - 9 * fade, y - radius * 1.9, 18 * fade, radius * 2.1);
    ctx.restore();
  }
  clear() {
    this.visible = false;
    this.chargePoint = null;
    this.chargePower = 0;
    this.projectiles = [];
    this.explosions = [];
    this.sparks = [];
    this.flash = null;
    this.demoPower = 0;
    this.demoPoint = null;
    this.wasActive = false;
    this.skill.reset();
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

