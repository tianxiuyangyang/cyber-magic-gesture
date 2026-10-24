/**
 * 大屏赛博朋克城市背景。
 * 使用程序化 Canvas 绘制，离线可用，不依赖外部图片。
 */

const TAU = Math.PI * 2;

export class CyberpunkCityBackground {
  constructor(canvas, container = null) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas?.getContext('2d', { alpha: false }) || null;
    this.enabled = false;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.resize();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.container) this.container.hidden = !this.enabled;
    if (this.canvas) this.canvas.hidden = !this.enabled;
    if (this.enabled) this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const dpr = Math.min(1.75, Math.max(1, window.devicePixelRatio || 1));
    if (width === this.width && height === this.height && dpr === this.dpr && this.drawn) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.enabled) this.draw();
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const rng = createRng(20261025);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 深空与城市雾霾
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#02030d');
    sky.addColorStop(0.27, '#071126');
    sky.addColorStop(0.52, '#10254a');
    sky.addColorStop(0.7, '#173658');
    sky.addColorStop(0.82, '#07101c');
    sky.addColorStop(1, '#010205');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 星点和大气颗粒
    for (let i = 0; i < 150; i += 1) {
      const x = rng() * w;
      const y = rng() * h * 0.58;
      const r = 0.4 + rng() * 1.25;
      ctx.fillStyle = `rgba(${130 + rng() * 90}, ${205 + rng() * 45}, 255, ${0.08 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    // 地平线上的巨型霓虹环
    const horizon = h * 0.62;
    const ringX = w * 0.52;
    const ringY = horizon - h * 0.06;
    const ringR = Math.min(w, h) * 0.19;
    const ringGlow = ctx.createRadialGradient(ringX, ringY, ringR * 0.3, ringX, ringY, ringR * 1.65);
    ringGlow.addColorStop(0, 'rgba(51, 213, 255, 0.14)');
    ringGlow.addColorStop(0.5, 'rgba(95, 74, 255, 0.07)');
    ringGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ringGlow;
    ctx.fillRect(ringX - ringR * 1.8, ringY - ringR * 1.8, ringR * 3.6, ringR * 3.6);
    ctx.save();
    ctx.strokeStyle = 'rgba(91, 224, 255, 0.34)';
    ctx.shadowColor = 'rgba(65, 206, 255, 0.9)';
    ctx.shadowBlur = 24;
    ctx.lineWidth = Math.max(1, w * 0.0014);
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringR, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 55, 207, 0.18)';
    ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringR * 0.94, Math.PI * 0.15, Math.PI * 1.72);
    ctx.stroke();
    ctx.restore();

    // 远处天际线
    drawSkyline(ctx, rng, w, h, horizon, {
      minHeight: h * 0.055,
      maxHeight: h * 0.2,
      color: '#071522',
      edge: 'rgba(55, 167, 220, 0.09)',
      windows: 0.14,
      centerGap: 0.05,
    });

    // 中景天际线
    drawSkyline(ctx, rng, w, h, horizon + h * 0.035, {
      minHeight: h * 0.1,
      maxHeight: h * 0.32,
      color: '#050b14',
      edge: 'rgba(70, 199, 255, 0.18)',
      windows: 0.25,
      centerGap: 0.14,
    });

    // 两侧近景高楼，给中央留出表演空间
    drawNearTower(ctx, rng, -w * 0.03, horizon + h * 0.07, w * 0.19, h * 0.58, 'cyan');
    drawNearTower(ctx, rng, w * 0.84, horizon + h * 0.05, w * 0.2, h * 0.61, 'magenta');

    // 城市低空雾
    const fog = ctx.createLinearGradient(0, horizon - h * 0.02, 0, h);
    fog.addColorStop(0, 'rgba(24, 112, 154, 0.22)');
    fog.addColorStop(0.28, 'rgba(8, 29, 48, 0.5)');
    fog.addColorStop(1, 'rgba(1, 2, 5, 0.96)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, horizon - h * 0.02, w, h - horizon + h * 0.02);

    // 高架道路与透视引导线
    drawHighway(ctx, w, h, horizon);
    drawNeonCables(ctx, rng, w, h, horizon);

    // 全息广告牌
    drawHologram(ctx, w * 0.09, h * 0.24, w * 0.055, h * 0.17, 'cyan', rng);
    drawHologram(ctx, w * 0.87, h * 0.31, w * 0.06, h * 0.15, 'magenta', rng);
    drawHologram(ctx, w * 0.79, h * 0.19, w * 0.045, h * 0.1, 'violet', rng);

    // 斜向雨丝
    ctx.save();
    ctx.strokeStyle = 'rgba(111, 207, 255, 0.11)';
    ctx.lineWidth = 1;
    for (let i = 0; i < Math.round(w / 12); i += 1) {
      const x = rng() * w;
      const y = rng() * h;
      const length = 8 + rng() * 26;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - length * 0.22, y + length);
      ctx.stroke();
    }
    ctx.restore();

    // 暗角与青蓝雾光，保证前景可读
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.max(w, h) * 0.72);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.58, 'rgba(0, 3, 9, 0.08)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.82)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    const centerHaze = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.min(w, h) * 0.38);
    centerHaze.addColorStop(0, 'rgba(31, 130, 184, 0.05)');
    centerHaze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerHaze;
    ctx.fillRect(0, 0, w, h);

    this.drawn = true;
  }
}

function drawSkyline(ctx, rng, w, h, baseY, options) {
  let x = -20;
  while (x < w + 20) {
    const width = 24 + rng() * 86;
    const centerDistance = Math.abs((x + width * 0.5) / w - 0.5);
    const gapFactor = centerDistance < options.centerGap ? 0.58 : 1;
    const height = (options.minHeight + rng() * (options.maxHeight - options.minHeight)) * gapFactor;
    const top = baseY - height;
    ctx.fillStyle = options.color;
    ctx.fillRect(x, top, width, height);
    ctx.strokeStyle = options.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1);

    // 窗户
    const cellW = 5 + rng() * 5;
    const cellH = 4 + rng() * 5;
    for (let wy = top + 9; wy < baseY - 7; wy += cellH + 5) {
      for (let wx = x + 5; wx < x + width - 5; wx += cellW + 5) {
        if (rng() > options.windows) continue;
        const cyan = rng() > 0.24;
        ctx.fillStyle = cyan
          ? `rgba(78, 216, 255, ${0.12 + rng() * 0.34})`
          : `rgba(255, 67, 198, ${0.08 + rng() * 0.25})`;
        ctx.fillRect(wx, wy, cellW, cellH);
      }
    }

    // 屋顶灯与天线
    if (rng() > 0.45) {
      const lightX = x + width * (0.25 + rng() * 0.5);
      ctx.shadowColor = 'rgba(255, 60, 199, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255, 104, 218, 0.82)';
      ctx.fillRect(lightX, top - 2, 2, 2);
      ctx.shadowBlur = 0;
    }
    if (height > h * 0.18 && rng() > 0.65) {
      ctx.strokeStyle = 'rgba(95, 193, 232, 0.18)';
      ctx.beginPath();
      ctx.moveTo(x + width * 0.5, top);
      ctx.lineTo(x + width * 0.5, top - 14 - rng() * 34);
      ctx.stroke();
    }
    x += width + 3 + rng() * 10;
  }
}

function drawNearTower(ctx, rng, x, baseY, width, height, tone) {
  const top = baseY - height;
  const color = tone === 'magenta' ? '#080711' : '#050b13';
  const accent = tone === 'magenta' ? '255, 52, 196' : '47, 211, 255';
  ctx.fillStyle = color;
  ctx.fillRect(x, top, width, height);
  ctx.strokeStyle = `rgba(${accent}, 0.22)`;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, top, width, height);

  for (let wy = top + 18; wy < baseY; wy += 18) {
    for (let wx = x + 12; wx < x + width - 10; wx += 17) {
      if (rng() > 0.22) continue;
      ctx.fillStyle = `rgba(${accent}, ${0.12 + rng() * 0.38})`;
      ctx.fillRect(wx, wy, 5, 3);
    }
  }
  ctx.save();
  ctx.shadowColor = `rgba(${accent}, 0.95)`;
  ctx.shadowBlur = 18;
  ctx.fillStyle = `rgba(${accent}, 0.7)`;
  ctx.fillRect(x + width * 0.16, top + 18, width * 0.68, 2);
  ctx.restore();
}

function drawHighway(ctx, w, h, horizon) {
  const vx = w * 0.5;
  const vy = horizon + h * 0.02;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = -4; i <= 4; i += 1) {
    const bottomX = vx + i * w * 0.16;
    ctx.strokeStyle = i === 0 ? 'rgba(255, 50, 198, 0.34)' : 'rgba(49, 194, 255, 0.18)';
    ctx.lineWidth = i === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(bottomX, h + 20);
    ctx.stroke();
  }
  for (let i = 1; i <= 5; i += 1) {
    const t = i / 6;
    const y = vy + (h - vy) * t * t;
    ctx.strokeStyle = `rgba(77, 211, 255, ${0.08 + t * 0.2})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, y);
    ctx.lineTo(w + 20, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNeonCables(ctx, rng, w, h, horizon) {
  ctx.save();
  ctx.strokeStyle = 'rgba(99, 193, 226, 0.13)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i += 1) {
    const y = horizon - h * (0.04 + rng() * 0.2);
    ctx.beginPath();
    ctx.moveTo(-20, y);
    ctx.bezierCurveTo(w * 0.3, y + 26 + rng() * 28, w * 0.7, y - 16 - rng() * 20, w + 20, y + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHologram(ctx, x, y, width, height, tone, rng) {
  const color = tone === 'magenta'
    ? '255, 64, 205'
    : tone === 'violet'
      ? '146, 108, 255'
      : '67, 220, 255';
  ctx.save();
  ctx.shadowColor = `rgba(${color}, 0.9)`;
  ctx.shadowBlur = 20;
  ctx.strokeStyle = `rgba(${color}, 0.55)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = `rgba(${color}, 0.055)`;
  ctx.fillRect(x, y, width, height);
  for (let i = 0; i < 6; i += 1) {
    const lineY = y + height * (0.16 + i * 0.12);
    ctx.fillStyle = `rgba(${color}, ${0.18 + rng() * 0.34})`;
    ctx.fillRect(x + width * 0.13, lineY, width * (0.3 + rng() * 0.56), 1.2);
  }
  ctx.restore();
}

function createRng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


