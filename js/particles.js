/**
 * 星尘粒子场：大量自由漂浮的发光粒子。
 *
 * 交互由力场驱动：
 *   - 平时：每颗粒子沿自己缓慢旋转的方向漂移（天生想自由）
 *   - 捏合：所有粒子被拉向捏合点并形成旋涡；但它们会积累「挣脱冲动」，
 *     越靠近核心越想往外窜，核心处还有 1/d² 排斥，因此永远聚不成一个点，
 *     而是围着捏合点旋转、挣扎、不断逃逸又不断被拉回
 *   - 指尖：把附近的粒子推开，扫过时留下尾流
 *
 * stepParticle / createParticle / pickColor 是纯逻辑，不依赖 DOM，可在 Node 测试；
 * ParticleSystem 负责画布渲染（辉光精灵、拖尾、近邻连线、脉冲环、捏合核心）。
 */

import { FIELD, CORE_COLOR, rgba } from './config.js';

const TAU = Math.PI * 2;

// ============================================================
// 纯逻辑
// ============================================================

/** 按权重从调色板里挑一个颜色。 */
export function pickColor(rand = Math.random) {
  const palette = FIELD.palette;
  let total = 0;
  for (const item of palette) total += item.weight;
  let roll = rand() * total;
  for (const item of palette) {
    roll -= item.weight;
    if (roll <= 0) return item.color;
  }
  return palette[palette.length - 1].color;
}

/**
 * 三维环面上的目标点（正交投影 + 轻微透视）。
 *
 * 环面先按 tilt 绕 X 轴倾斜，再按 yaw 绕 Y 轴、roll 绕视线轴缓慢翻滚；
 * 粒子在 (theta, phi) 上分布，theta 随 spin 旋转、phi 随 tubeSpin 自旋。
 * 环中心永远留空，形成中空的三维星环。
 */export function ringTarget(particle, ring) {
  const radius = Math.max(1, ring.radius || 1);
  const tube = Math.max(0, ring.tube || 0);
  const theta = (particle.ringPhase || 0) + (ring.spin || 0);
  const phi = (particle.ringTubeAngle || 0) + (ring.tubeSpin || 0);
  const tubeRadius = Number.isFinite(particle.ringTubeRadius) ? particle.ringTubeRadius : 0;

  const radial = radius + tubeRadius * Math.cos(phi);
  let x = radial * Math.cos(theta);
  let y = radial * Math.sin(theta);
  let z = tubeRadius * Math.sin(phi);

  // 绕 X 轴倾斜
  const tilt = ring.tilt || 0;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const y1 = y * ct - z * st;
  const z1 = y * st + z * ct;

  // 绕 Y 轴缓慢转动
  const yaw = ring.yaw || 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;

  // 绕视线轴翻滚
  const roll = ring.roll || 0;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const x3 = x2 * cr - y1 * sr;
  const y3 = x2 * sr + y1 * cr;

  const depth = z2 / (radius + tube || 1);
  const perspective = 1 + depth * (ring.perspective || 0);
  return {
    x: ring.x + x3 * perspective,
    y: ring.y + y3 * perspective,
    depth,
  };
}

/**
 * 把粒子均匀铺满整个环面。
 *
 * 关键：先按粒子当前相对环心的方位排序，再按顺序分配等间距的 theta。
 * 这样即使所有粒子原本挤在同一侧，也会沿圆周均匀展开，而不是叠在一段弧上；
 * 同时保持原有圆周顺序，收束过程不会大量交叉。
 */
export function seedRingPhases(particles, ring, rand = Math.random) {
  const count = particles.length;
  if (!count) return;
  const order = particles.map((particle, index) => ({
    particle,
    index,
    angle: Math.atan2(particle.y - ring.y, particle.x - ring.x),
  }));
  order.sort((a, b) => a.angle - b.angle || a.index - b.index);

  const tube = Math.max(0, ring.tube || 0);
  for (let rank = 0; rank < order.length; rank += 1) {
    const particle = order[rank].particle;
    particle.ringPhase = (rank / count) * TAU;
    particle.ringTubeRadius = tube * (0.22 + 0.78 * Math.sqrt(rand()));
    particle.ringTubeAngle = rand() * TAU;
    particle.ringDepth = 0;
  }
}

/** 在 [0,width]×[0,height] 里随机生成一颗粒子。 */
export function createParticle(width, height, rand = Math.random) {
  const depth = 0.3 + rand() * 0.7;              // 0.3 远景 … 1 近景
  const size = (FIELD.sizes[0] + rand() * (FIELD.sizes[1] - FIELD.sizes[0]))
    * (0.55 + depth * 0.7);
  const x = rand() * Math.max(1, width);
  const y = rand() * Math.max(1, height);
  return {
    x,
    y,
    vx: (rand() - 0.5) * 40,
    vy: (rand() - 0.5) * 40,
    homeX: x,
    homeY: y,
    depth,
    size,
    alpha: Math.min(
      1,
      (FIELD.baseAlpha[0] + rand() * (FIELD.baseAlpha[1] - FIELD.baseAlpha[0]))
        * (0.45 + depth * 0.6),
    ),
    twinkle: rand() * TAU,
    twinkleSpeed: FIELD.twinkleSpeed[0] + rand() * (FIELD.twinkleSpeed[1] - FIELD.twinkleSpeed[0]),
    color: pickColor(rand),
    glint: rand() < 0.05,                        // 少量星芒十字，增加科技感
    flash: 0,                                    // 挣脱瞬间的亮度
    wanderAngle: rand() * TAU,
    wanderSpeedMul: (0.55 + rand() * 0.7) * (0.5 + depth * 0.7),
    escapeUrge: 0,
    escapeMul: 0.6 + rand() * 1.3, // 每颗粒子的挣脱倔强程度不同，星云才有厚度与逃逸者
    escapeTimer: FIELD.escapeInterval[0] + rand() * (FIELD.escapeInterval[1] - FIELD.escapeInterval[0]),
  };
}

/**
 * 推进一颗粒子一步（原地修改 p）。
 *
 * @param {object} p 粒子
 * @param {object} [forces]
 * @param {{x:number,y:number,strength:number,sigma:number,coreRadius:number,escapeReach:number}|null} forces.attractor
 *   捏合吸引核心。strength 0..1；sigma/coreRadius/escapeReach 为绝对像素值。
 * @param {{x:number,y:number,strength:number}|null} forces.repulsor 指尖推开力场（备用）
 * @param {{x:number,y:number,strength:number,radius:number,tube:number,tilt:number,spin:number,tubeSpin:number,yaw:number,roll:number,perspective:number}|null} forces.ring
 *   伸出食指时的三维中空星环；radius/tube 为像素值。
 * @param {{width:number,height:number}|null} forces.bounds 屏幕边界（超出过多时温和弹回）
 * @param {number} dt 步长（秒）
 * @param {object} [cfg] 参数（默认 FIELD）
 * @param {() => number} [rand] 随机源（测试可注入确定性随机）
 */
export function stepParticle(p, forces = {}, dt, cfg = FIELD, rand = Math.random) {
  const { attractor = null, repulsor = null, ring = null, bounds = null } = forces;
  const ringBlend = ring ? Math.min(1, Math.max(0, ring.strength || 0)) : 0;
  const freeScale = 1 - ringBlend * 0.94;
  let ax = 0;
  let ay = 0;

  // 1) 自由游走：缓慢旋转的方向 + 随机抖动 —— 它们生来就想漂
  ax += Math.cos(p.wanderAngle) * cfg.wanderSpeed * p.wanderSpeedMul * freeScale;
  ay += Math.sin(p.wanderAngle) * cfg.wanderSpeed * p.wanderSpeedMul * freeScale;
  p.wanderAngle += (rand() - 0.5) * cfg.wanderTurn * dt;
  ax += (rand() - 0.5) * cfg.wanderJitter * freeScale;
  ay += (rand() - 0.5) * cfg.wanderJitter * freeScale;

  // 2) 回家的弹性：聚拢越狠，想回到原位的愿望越强（束缚与挣脱的拉扯）。
  //    距离太远时封顶，避免刚聚起来的星云又被拽散。
  {
    let hx = p.homeX - p.x;
    let hy = p.homeY - p.y;
    const homeDist = Math.hypot(hx, hy);
    if (homeDist > cfg.homeCap) {
      hx *= cfg.homeCap / homeDist;
      hy *= cfg.homeCap / homeDist;
    }
    const homeScale = 1 - ringBlend * 0.97;
    ax += hx * cfg.homeK * homeScale;
    ay += hy * cfg.homeK * homeScale;
  }

  // 3) 捏合：吸引 + 旋涡 + 软核排斥 + 挣脱冲动 + 近核粘滞
  if (attractor && attractor.strength > 0.001) {
    const dx = attractor.x - p.x;
    const dy = attractor.y - p.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const dirX = dx / d;
    const dirY = dy / d;

    const sigma = attractor.sigma > 0 ? attractor.sigma : 260;
    const pull = (cfg.attractStrength * attractor.strength) / (1 + (d * d) / (sigma * sigma));

    // 旋涡：只在核心附近搅动（贝尔形），远处以径向吸入为主。
    // 如果全程都给切向力，粒子会在中距离停成一个大环而不是聚拢。
    const coreRadius = attractor.coreRadius > 0 ? attractor.coreRadius : cfg.coreRadius;
    const bell = Math.exp(-(d * d) / ((coreRadius * 3) * (coreRadius * 3)));
    const swirlMag = pull * cfg.swirl * bell;
    ax += dirX * pull - dirY * swirlMag;
    ay += dirY * pull + dirX * swirlMag;

    // 软核排斥：越靠近捏合点顶得越狠（到 coreRadius 处归零），
    // 粒子悬停在核心外一圈，而不是塌成一个点。
    const pushMag = d < coreRadius
      ? cfg.coreK * (1 - d / coreRadius) * (1 - d / coreRadius)
      : 0;
    ax -= dirX * pushMag;
    ay -= dirY * pushMag;

    // 挣脱冲动：离核心越近憋得越快；力道按 closeness 立方衰减，
    // 只有真正靠近核心时才剧烈向外顶——远处只是「不太想过去」。
    const escapeReach = attractor.escapeReach > 0 ? attractor.escapeReach : 320;
    const closeness = Math.max(0, 1 - Math.min(1, d / escapeReach));
    p.escapeUrge = Math.min(1, p.escapeUrge + cfg.escapeGain * closeness * dt);
    const escapeAccel = cfg.escapeMax * p.escapeUrge * closeness * closeness * closeness
      * (p.escapeMul ?? 1);
    const jitter = 0.85 + rand() * 0.3;
    ax -= dirX * escapeAccel * jitter;
    ay -= dirY * escapeAccel * jitter;

    // 不定时的挣脱冲量：以径向为主往外窜一下，然后又被拉回来
    p.escapeTimer -= dt;
    if (p.escapeTimer <= 0) {
      p.escapeTimer = cfg.escapeInterval[0] + rand() * (cfg.escapeInterval[1] - cfg.escapeInterval[0]);
      const impulse = cfg.escapeImpulse * (0.5 + rand() * 0.7) * (0.6 + 0.7 * (p.escapeMul ?? 1));
      const tangent = rand() < 0.5 ? 1 : -1;
      p.vx += (-dirX * 0.9 - dirY * 0.5 * tangent) * impulse;
      p.vy += (-dirY * 0.9 + dirX * 0.5 * tangent) * impulse;
      p.flash = 1; // 挣脱瞬间的亮度，渲染时会画成更亮的流星
    }

    // 近核粘滞：把冲进核心的径向速度吃掉，防止高速过冲后整个弹飞
    if (d < coreRadius * 3.2) {
      const radialSpeed = p.vx * dirX + p.vy * dirY;
      const damped = radialSpeed * Math.exp(-cfg.coreGrip * dt);
      p.vx += (damped - radialSpeed) * dirX;
      p.vy += (damped - radialSpeed) * dirY;

      // 近核切向阻尼：把轨道速度压下来，粒子才能真正落进核心圈
      const tangentX = -dirY;
      const tangentY = dirX;
      const tangentSpeed = p.vx * tangentX + p.vy * tangentY;
      const tangentDamped = tangentSpeed * Math.exp(-cfg.tangentDamp * dt);
      p.vx += (tangentDamped - tangentSpeed) * tangentX;
      p.vy += (tangentDamped - tangentSpeed) * tangentY;
    }
  } else {
    p.escapeUrge = Math.max(0, p.escapeUrge - dt * 0.8);
  }

  // 4) 指尖推开（备用；伸出食指现在改为三维星环）
  if (repulsor && repulsor.strength > 0.001) {
    const dx = p.x - repulsor.x;
    const dy = p.y - repulsor.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    if (d < cfg.pushRadius) {
      const falloff = 1 - d / cfg.pushRadius;
      const push = cfg.pushStrength * repulsor.strength * falloff * falloff;
      const ux = dx / d;
      const uy = dy / d;
      ax += ux * push * (0.9 + rand() * 0.25);
      ay += uy * push * (0.9 + rand() * 0.25);
      ax += -uy * push * 0.22;
      ay += ux * push * 0.22;
    }
  }

  // 5) 三维星环：把粒子收束到指尖周围的中空环面上，并沿环持续旋转
  if (ring && ringBlend > 0.001) {
    if (p.ringPhase == null) {
      // 兜底：正常由 seedRingPhases 均匀分配；这里用随机相位避免退化成一段弧
      p.ringPhase = rand() * TAU;
      p.ringTubeRadius = ring.tube * (0.2 + 0.8 * Math.sqrt(rand()));
      p.ringTubeAngle = rand() * TAU;
    }

    const target = ringTarget(p, ring);
    const stiffness = cfg.ringStiffness * ringBlend;
    const maxAccel = cfg.ringMaxAccel * ringBlend;
    let fx = (target.x - p.x) * stiffness - p.vx * cfg.ringDamping;
    let fy = (target.y - p.y) * stiffness - p.vy * cfg.ringDamping;
    fx = Math.max(-maxAccel, Math.min(maxAccel, fx));
    fy = Math.max(-maxAccel, Math.min(maxAccel, fy));
    ax += fx;
    ay += fy;
    p.ringDepth = target.depth;
  } else {
    p.ringDepth = 0;
  }

  // 6) 积分与限速
  const damping = Math.exp(-cfg.damping * dt);
  p.vx = (p.vx + ax * dt) * damping;
  p.vy = (p.vy + ay * dt) * damping;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > cfg.maxSpeed) {
    const clamp = cfg.maxSpeed / speed;
    p.vx *= clamp;
    p.vy *= clamp;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // 挣脱的余辉随时间衰减
  if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 2.6);

  // 7) 漂出屏幕太多就温和地弹回来（平时是自由的，只是别丢太远）
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const margin = cfg.margin;
    if (p.x < -margin) {
      p.x = -margin;
      p.vx = Math.abs(p.vx) * 0.4;
    } else if (p.x > bounds.width + margin) {
      p.x = bounds.width + margin;
      p.vx = -Math.abs(p.vx) * 0.4;
    }
    if (p.y < -margin) {
      p.y = -margin;
      p.vy = Math.abs(p.vy) * 0.4;
    } else if (p.y > bounds.height + margin) {
      p.y = bounds.height + margin;
      p.vy = -Math.abs(p.vy) * 0.4;
    }
  }
}

// ============================================================
// 渲染
// ============================================================

export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.particles = [];
    this.attractor = null;
    this.repulsor = null;
    this.ring = null;
    this.rings = [];
    this.time = 0;
    this._sprites = new Map();
    this._linkStyles = [];
    this._cells = [];
    this._cols = 1;
    this._rows = 1;
    this._baseFilled = false;
  }

  get count() {
    return this.particles.length;
  }

  targetCount() {
    const area = Math.max(0, this.width * this.height);
    return Math.max(FIELD.minCount, Math.min(FIELD.maxCount, Math.round(area / FIELD.density)));
  }

  /** 按窗口大小调整画布与粒子数量；粒子位置按比例迁移。 */
  resize(cssWidth, cssHeight, scale) {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    const nextScale = Math.max(1, Math.min(2, Number(scale) || 1));
    const changed = width !== this.width || height !== this.height || nextScale !== this.scale;
    if (changed) {
      const oldWidth = Math.max(1, this.width);
      const oldHeight = Math.max(1, this.height);
      this.width = width;
      this.height = height;
      this.scale = nextScale;
      this.canvas.width = Math.round(width * nextScale);
      this.canvas.height = Math.round(height * nextScale);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      if (this.particles.length > 0) {
        const sx = width / oldWidth;
        const sy = height / oldHeight;
        for (const particle of this.particles) {
          particle.x *= sx;
          particle.y *= sy;
          particle.homeX *= sx;
          particle.homeY *= sy;
        }
      }
      this._baseFilled = false;
    }
    const target = this.targetCount();
    while (this.particles.length < target) {
      this.particles.push(createParticle(this.width, this.height));
    }
    if (this.particles.length > target) {
      this.particles.length = target;
    }
  }

  setAttractor(attractor) {
    this.attractor = attractor;
  }

  setRepulsor(repulsor) {
    this.repulsor = repulsor;
  }

  /** 设置三维星环；传 null 时散开，并清空粒子的环面轨道槽。 */
  setRing(ring) {
    if (!ring) {
      if (this.ring) {
        for (const particle of this.particles) {
          particle.ringPhase = null;
          particle.ringDepth = 0;
        }
      }
      this.ring = null;
      return;
    }

    // 首次成环，或环面存在但还有新粒子没分到轨道时，重新均匀铺满
    if (!this.ring || this.particles.some((particle) => particle.ringPhase == null)) {
      seedRingPhases(this.particles, ring);
    }
    this.ring = ring;
  }

  /** 在 (x,y) 放一个脉冲环（捏合开始/结束时的冲击波）。 */
  burst(x, y, power = 1) {
    this.rings.push({ x, y, age: 0, life: FIELD.ringLife, power });
  }

  update(dt) {
    const clamped = Math.min(0.05, Math.max(0, dt));
    this.time += clamped;
    if (this.ring) {
      // 环面旋转、管截面自旋与缓慢翻滚。
      // yaw 只做小幅左右摆动，避免整圈转到侧面时投影变薄、环心被填满。
      this.ring.spin = this.time * FIELD.ringSpin;
      this.ring.tubeSpin = this.time * FIELD.ringTubeSpin;
      this.ring.yaw = Math.sin(this.time * FIELD.ringYawSpeed) * FIELD.ringYaw;
      this.ring.roll = this.time * FIELD.ringRoll;
      this.ring.tilt = FIELD.ringTilt + Math.sin(this.time * 0.45) * 0.05;
    }
    const forces = {
      attractor: this.attractor,
      repulsor: this.repulsor,
      ring: this.ring,
      bounds: { width: this.width, height: this.height },
    };
    for (const particle of this.particles) {
      stepParticle(particle, forces, clamped, FIELD, Math.random);
    }
    for (const ring of this.rings) ring.age += clamped;
    if (this.rings.length > 0) {
      this.rings = this.rings.filter((ring) => ring.age < ring.life);
    }
  }

  render(now = 0) {
    const { ctx, width, height, scale } = this;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // 深空底色 + 拖尾淡出
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!this._baseFilled) {
      ctx.fillStyle = '#04070d';
      ctx.fillRect(0, 0, width, height);
      this._baseFilled = true;
    } else {
      ctx.fillStyle = `rgba(4, 7, 13, ${FIELD.trailFade})`;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.globalCompositeOperation = 'lighter';

    this._buildGrid();
    this._drawLinks(ctx);

    const attractor = this.attractor;
    const ringActive = !!this.ring;
    for (const particle of this.particles) {
      const speed = Math.hypot(particle.vx, particle.vy);
      const depth = ringActive && Number.isFinite(particle.ringDepth) ? particle.ringDepth : 0;
      const size = particle.size * (1 + depth * FIELD.ringDepthSize);
      const twinkle = 0.72 + 0.28 * Math.sin(this.time * particle.twinkleSpeed + particle.twinkle);
      const alpha = Math.min(1, particle.alpha * twinkle * (1 + depth * 0.12));
      const flash = particle.flash > 0 ? particle.flash : 0;
      let hot = false;
      if (attractor) {
        const d = Math.hypot(particle.x - attractor.x, particle.y - attractor.y);
        hot = d < FIELD.hotRadius;
      }

      // 流星尾迹（挣脱瞬间更亮、更长）
      if (speed > FIELD.streakMinSpeed || flash > 0.02) {
        const length = Math.min(
          FIELD.streakMaxLen + flash * 26,
          (speed - FIELD.streakMinSpeed) * 0.03 + 4 + flash * 22,
        );
        const k = Math.min(1, Math.max(0, (speed - FIELD.streakMinSpeed) / 700));
        const inverse = length / (speed || 1);
        ctx.strokeStyle = flash > 0.05
          ? `rgba(255, 226, 186, ${0.22 + flash * 0.4})`
          : rgba(particle.color, 0.05 + alpha * 0.3 * k);
        ctx.lineWidth = Math.max(0.6, size * (0.8 + flash * 0.5));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(particle.x - particle.vx * inverse, particle.y - particle.vy * inverse);
        ctx.lineTo(particle.x, particle.y);
        ctx.stroke();
      }

      // 星芒十字（少量粒子，增加精致感）
      if (particle.glint) {
        const arm = size * (3.6 + flash * 2);
        ctx.strokeStyle = `rgba(222, 250, 255, ${0.16 * alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(particle.x - arm, particle.y);
        ctx.lineTo(particle.x + arm, particle.y);
        ctx.moveTo(particle.x, particle.y - arm);
        ctx.lineTo(particle.x, particle.y + arm);
        ctx.stroke();
      }

      // 辉光 + 白心（靠近捏合核心时颜色变暖）
      const sprite = this._sprite(particle.color, hot);
      const half = size * FIELD.halo;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, particle.x - half, particle.y - half, half * 2, half * 2);
      ctx.fillStyle = flash > 0.02
        ? `rgba(255, 248, 230, ${0.92})`
        : 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0.5, size * (0.55 + flash * 0.25)), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this._drawRings(ctx);
    if (this.attractor && this.attractor.strength > 0.01) {
      this._drawCore(ctx, this.attractor, now);
    }
  }

  // ---------------- 内部 ----------------

  _sprite(color, hot = false) {
    const key = `${color.join(',')}${hot ? '|hot' : ''}`;
    let sprite = this._sprites.get(key);
    if (!sprite) {
      const tint = hot
        ? color.map((value, index) => Math.round(value + (CORE_COLOR[index] - value) * FIELD.hotMix))
        : color;
      sprite = document.createElement('canvas');
      sprite.width = 64;
      sprite.height = 64;
      const ctx = sprite.getContext('2d');
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, rgba(tint, 1));
      gradient.addColorStop(0.22, rgba(tint, 0.55));
      gradient.addColorStop(0.55, rgba(tint, 0.12));
      gradient.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      this._sprites.set(key, sprite);
    }
    return sprite;
  }

  _buildGrid() {
    const cell = Math.max(32, FIELD.linkDistance);
    this._cols = Math.max(1, Math.ceil(this.width / cell));
    this._rows = Math.max(1, Math.ceil(this.height / cell));
    this._cells.length = this._cols * this._rows;
    this._cells.fill(null);
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      const cx = Math.min(this._cols - 1, Math.max(0, Math.floor(particle.x / cell)));
      const cy = Math.min(this._rows - 1, Math.max(0, Math.floor(particle.y / cell)));
      const index = cy * this._cols + cx;
      if (!this._cells[index]) this._cells[index] = [];
      this._cells[index].push(i);
    }
  }

  _linkStyle(level) {
    let style = this._linkStyles[level];
    if (!style) {
      style = `rgba(120, 190, 255, ${((level / 16) * FIELD.linkAlpha).toFixed(3)})`;
      this._linkStyles[level] = style;
    }
    return style;
  }

  _drawLinks(ctx) {
    const { particles, _cells, _cols, _rows, attractor } = this;
    const maxDistance = FIELD.linkDistance;
    const maxDistance2 = maxDistance * maxDistance;
    const boostRadius = FIELD.hotRadius * 1.6;
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      let boost = 1;
      if (attractor) {
        const dc = Math.hypot(particle.x - attractor.x, particle.y - attractor.y);
        boost = 1 + 2.4 * Math.max(0, 1 - dc / boostRadius);
      }
      const cx = Math.min(_cols - 1, Math.max(0, Math.floor(particle.x / maxDistance)));
      const cy = Math.min(_rows - 1, Math.max(0, Math.floor(particle.y / maxDistance)));
      let used = 0;
      for (let oy = -1; oy <= 1 && used < FIELD.linkPerParticle; oy += 1) {
        const ny = cy + oy;
        if (ny < 0 || ny >= _rows) continue;
        for (let ox = -1; ox <= 1 && used < FIELD.linkPerParticle; ox += 1) {
          const nx = cx + ox;
          if (nx < 0 || nx >= _cols) continue;
          const bucket = _cells[ny * _cols + nx];
          if (!bucket) continue;
          for (let k = 0; k < bucket.length && used < FIELD.linkPerParticle; k += 1) {
            const j = bucket[k];
            if (j <= i) continue;
            const other = particles[j];
            const dx = other.x - particle.x;
            const dy = other.y - particle.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= maxDistance2) continue;
            const d = Math.sqrt(d2);
            const level = Math.min(
              16,
              Math.max(1, Math.round(16 * (1 - d / maxDistance) * boost)),
            );
            ctx.strokeStyle = this._linkStyle(level);
            ctx.beginPath();
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
            used += 1;
          }
        }
      }
    }
  }

  _drawRings(ctx) {
    for (const ring of this.rings) {
      const t = Math.min(1, ring.age / ring.life);
      const ease = 1 - Math.pow(1 - t, 3);
      const radius = 10 + ease * FIELD.ringSpeed * ring.life;
      ctx.strokeStyle = rgba(CORE_COLOR, (1 - t) * 0.6 * ring.power);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba([255, 255, 255], (1 - t) * 0.3 * ring.power);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius * 0.9, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(CORE_COLOR, (1 - t) * 0.2 * ring.power);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius * 0.84, 0, TAU);
      ctx.stroke();
    }
  }

  _drawCore(ctx, attractor, now) {
    const { x, y, strength } = attractor;
    const s = Math.min(1, Math.max(0, strength));
    const t = now * 0.001;
    const pulse = 1 + Math.sin(t * 4) * 0.05;
    const base = 52 * (0.6 + s * 0.55) * pulse;

    // 大范围光晕：暖色核心 + 一圈冷色
    const halo = ctx.createRadialGradient(x, y, 0, x, y, base * 3.6);
    halo.addColorStop(0, rgba(CORE_COLOR, 0.42 * s));
    halo.addColorStop(0.28, rgba(CORE_COLOR, 0.16 * s));
    halo.addColorStop(0.66, rgba([120, 220, 255], 0.05 * s));
    halo.addColorStop(1, rgba(CORE_COLOR, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, base * 3.6, 0, TAU);
    ctx.fill();

    // 旋转的锥形能量环
    if (typeof ctx.createConicGradient === 'function') {
      const sweep = ctx.createConicGradient(t * 0.7, x, y);
      sweep.addColorStop(0, rgba(CORE_COLOR, 0));
      sweep.addColorStop(0.12, rgba(CORE_COLOR, 0.6 * s));
      sweep.addColorStop(0.2, rgba(CORE_COLOR, 0));
      sweep.addColorStop(0.5, rgba([150, 240, 255], 0.45 * s));
      sweep.addColorStop(0.62, rgba(CORE_COLOR, 0));
      sweep.addColorStop(0.82, rgba(CORE_COLOR, 0.3 * s));
      sweep.addColorStop(1, rgba(CORE_COLOR, 0));
      ctx.strokeStyle = sweep;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, base * 1.02, 0, TAU);
      ctx.stroke();
    }

    // 两圈反向旋转的虚线轨道
    for (let ring = 0; ring < 2; ring += 1) {
      const radius = base * (ring === 0 ? 0.66 : 0.95);
      const direction = ring === 0 ? 1 : -1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(direction * t * (ring === 0 ? 1.1 : 0.75));
      ctx.strokeStyle = rgba(CORE_COLOR, (ring === 0 ? 0.55 : 0.3) * s);
      ctx.lineWidth = 1.4;
      ctx.setLineDash(ring === 0 ? [13, 9] : [3, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);

    // 三颗沿轨道运行的亮点
    for (let i = 0; i < 3; i += 1) {
      const radius = base * (0.64 + i * 0.26);
      const angle = t * (1.8 - i * 0.35) * (i === 1 ? -1 : 1) + i * 2.1;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      const r = 1.6 + i * 0.5;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 5);
      glow.addColorStop(0, rgba([255, 255, 255], 0.9 * s));
      glow.addColorStop(0.35, rgba(CORE_COLOR, 0.6 * s));
      glow.addColorStop(1, rgba(CORE_COLOR, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 5, 0, TAU);
      ctx.fill();
    }

    // 八条缓慢旋转的短射线
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.25);
    ctx.strokeStyle = rgba(CORE_COLOR, 0.18 * s);
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * base * 1.15, Math.sin(angle) * base * 1.15);
      ctx.lineTo(Math.cos(angle) * base * 1.52, Math.sin(angle) * base * 1.52);
      ctx.stroke();
    }
    ctx.restore();

    // 内圈热光 + 核心亮点
    const inner = ctx.createRadialGradient(x, y, 0, x, y, base * 0.55);
    inner.addColorStop(0, rgba([255, 255, 255], 0.9 * s));
    inner.addColorStop(0.4, rgba(CORE_COLOR, 0.35 * s));
    inner.addColorStop(1, rgba(CORE_COLOR, 0));
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(x, y, base * 0.55, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.beginPath();
    ctx.arc(x, y, 3 + 2.8 * s, 0, TAU);
    ctx.fill();
  }
}
