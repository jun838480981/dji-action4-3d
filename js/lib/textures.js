/* ============================================================
   textures.js — all textures are generated on <canvas> at runtime.
   No external image / model / font files are loaded.
   ============================================================ */
(function () {
  'use strict';
  const { THREE } = window.THREE_BUNDLE;
  window.DJI = window.DJI || {};

  /* ---------- canvas helpers ---------- */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function makeTexture(canvas, opts) {
    opts = opts || {};
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (opts.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    if (opts.flipY === false) t.flipY = false;
    t.needsUpdate = true;
    return t;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function fitText(ctx, text, maxWidth, size, weight, family) {
    let s = size;
    do {
      ctx.font = weight + ' ' + s + 'px ' + family;
      if (ctx.measureText(text).width <= maxWidth) break;
      s -= 1;
    } while (s > 6);
    return s;
  }

  /* ============================================================
     1. Camera preview art used by both displays
     ============================================================ */
  function drawPreview(ctx, W, H, seed) {
    const R = rng(seed || 7);
    const horizon = H * 0.62;

    // sky
    let sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#07111e');
    sky.addColorStop(0.42, '#132c3f');
    sky.addColorStop(0.74, '#456070');
    sky.addColorStop(1, '#f0a263');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    // stars
    for (let i = 0; i < 60; i++) {
      const x = R() * W, y = R() * horizon * 0.62, a = 0.12 + R() * 0.5;
      ctx.fillStyle = 'rgba(190,235,255,' + a.toFixed(2) + ')';
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    // sun glow
    const sx = W * 0.68, sy = horizon - H * 0.03, sr = H * 0.056;
    let glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.3);
    glow.addColorStop(0, 'rgba(255,207,146,.95)');
    glow.addColorStop(0.16, 'rgba(255,163,98,.55)');
    glow.addColorStop(0.45, 'rgba(255,124,82,.16)');
    glow.addColorStop(1, 'rgba(255,124,82,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = '#ffe4bd';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();

    // cloud bands
    for (let i = 0; i < 5; i++) {
      const y = horizon - H * (0.1 + R() * 0.32);
      const h = 2 + R() * 8;
      const g = ctx.createLinearGradient(0, y, 0, y + h * 4);
      g.addColorStop(0, 'rgba(255,173,123,' + (0.03 + R() * 0.08).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(255,173,123,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, h * 5);
    }

    // distant mountain ridges
    const ridges = [
      { h: 0.2, color: '#233746', blur: 0 },
      { h: 0.13, color: '#16242f', blur: 0 }
    ];
    ridges.forEach(function (rg, idx) {
      ctx.fillStyle = rg.color;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      const steps = 12 + idx * 4;
      for (let i = 0; i <= steps; i++) {
        const x = (W / steps) * i;
        const y = horizon - H * (0.02 + R() * rg.h * (idx ? 0.6 : 1));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, horizon);
      ctx.closePath();
      ctx.fill();
    });

    // water
    let water = ctx.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, '#253a44');
    water.addColorStop(0.4, '#12222c');
    water.addColorStop(1, '#070f16');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, W, H - horizon);

    // sun reflection
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 34; i++) {
      const t = i / 34;
      const y = horizon + 2 + t * (H - horizon) * 0.8;
      const w = W * (0.035 + t * 0.16) * (0.5 + R());
      ctx.fillStyle = 'rgba(255,166,108,' + (0.16 * (1 - t)).toFixed(3) + ')';
      ctx.fillRect(sx - w / 2 + (R() - 0.5) * W * 0.03, y, w, 1.2 + t * 2.4);
    }
    ctx.restore();

    // foreground rocks silhouette
    ctx.fillStyle = '#05090d';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H * 0.86);
    for (let i = 1; i <= 8; i++) {
      ctx.lineTo(W * (i / 8), H * (0.91 - R() * 0.09));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // vignette
    const v = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.24, W / 2, H * 0.5, W * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.72, 'rgba(0,0,0,.12)');
    v.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTopBar(ctx, W, H, isFront) {
    const pad = W * 0.032;
    const barH = H * 0.15;
    let g = ctx.createLinearGradient(0, 0, 0, barH);
    g.addColorStop(0, 'rgba(0,0,0,.58)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, barH);

    const fs = Math.round(H * 0.052);
    const mono = '"Cascadia Code", Consolas, monospace';
    const sans = '"Segoe UI", Arial, sans-serif';

    // REC
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(pad + fs * 0.32, pad + fs * 0.5, fs * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 ' + fs + 'px ' + mono;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('REC', pad + fs * 0.8, pad + fs * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '400 ' + Math.round(fs * 0.92) + 'px ' + mono;
    ctx.fillText('00:12:34', pad + fs * 2.35, pad + fs * 0.5);

    // right: signal + battery
    const bx = W - pad - fs * 2.1;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = Math.max(1.5, fs * 0.075);
    roundRectPath(ctx, bx, pad + fs * 0.25, fs * 1.55, fs * 0.62, fs * 0.12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(bx + fs * 0.14, pad + fs * 0.4, fs * 1.05, fs * 0.32);
    ctx.fillRect(bx + fs * 1.58, pad + fs * 0.38, fs * 0.12, fs * 0.36);
    ctx.font = '600 ' + Math.round(fs * 0.72) + 'px ' + mono;
    ctx.textAlign = 'right';
    ctx.fillText('03:47', bx - fs * 0.3, pad + fs * 0.55);

    // center: resolution chip
    const chipW = W * 0.19, chipH = H * 0.085;
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    roundRectPath(ctx, W / 2 - chipW / 2, pad + fs * 0.02, chipW, chipH, chipH * 0.24);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '600 ' + Math.round(H * 0.046) + 'px ' + mono;
    ctx.fillText(isFront ? '4K / 60' : '4K · 60FPS', W / 2, pad + chipH * 0.52);

    // mode tiny caption
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '400 ' + Math.round(H * 0.03) + 'px ' + mono;
    ctx.fillText('D-LOG M · 10-BIT', W / 2, pad + chipH + H * 0.045);
    ctx.textAlign = 'left';
  }

  function drawFrameGuides(ctx, W, H, scale) {
    scale = scale || 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.17)';
    ctx.lineWidth = Math.max(1, W * 0.0009);
    // rule of thirds
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo((W / 3) * i, H * 0.17);
      ctx.lineTo((W / 3) * i, H * 0.83);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W * 0.08, (H / 3) * i + H * 0.06);
      ctx.lineTo(W * 0.92, (H / 3) * i + H * 0.06);
      ctx.stroke();
    }
    // center focus brackets
    const cx = W / 2, cy = H / 2;
    const bw = W * 0.075 * scale, bh = H * 0.12 * scale, arm = bw * 0.4;
    ctx.strokeStyle = 'rgba(255,255,255,.82)';
    ctx.lineWidth = Math.max(1.4, W * 0.0016);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
      ctx.beginPath();
      ctx.moveTo(cx + d[0] * bw - d[0] * arm, cy + d[1] * bh);
      ctx.lineTo(cx + d[0] * bw, cy + d[1] * bh);
      ctx.lineTo(cx + d[0] * bw, cy + d[1] * bh - d[1] * arm);
      ctx.stroke();
    });
    // center dot
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, W * 0.0018), 0, Math.PI * 2);
    ctx.fill();

    // horizon indicator
    const hy = H * 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = Math.max(1, W * 0.001);
    ctx.beginPath();
    ctx.moveTo(W * 0.38, hy); ctx.lineTo(W * 0.45, hy);
    ctx.moveTo(W * 0.55, hy); ctx.lineTo(W * 0.62, hy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, hy - H * 0.012); ctx.lineTo(cx, hy + H * 0.012);
    ctx.stroke();

    // stabilization badge
    ctx.font = '400 ' + Math.round(H * 0.028) + 'px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.textAlign = 'left';
    ctx.fillText('ROCKSTEADY 3.0', W * 0.08, H * 0.2);

    // corner crop marks
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    const m = W * 0.02, L = W * 0.022;
    ctx.beginPath();
    ctx.moveTo(m, m + L); ctx.lineTo(m, m); ctx.lineTo(m + L, m);
    ctx.moveTo(W - m, m + L); ctx.lineTo(W - m, m); ctx.lineTo(W - m - L, m);
    ctx.moveTo(m, H - m - L); ctx.lineTo(m, H - m); ctx.lineTo(m + L, H - m);
    ctx.moveTo(W - m, H - m - L); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m - L, H - m);
    ctx.stroke();
    ctx.restore();
  }

  function drawBottomBar(ctx, W, H) {
    const barY = H * 0.8;
    let g = ctx.createLinearGradient(0, barY - H * 0.12, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,.5)');
    g.addColorStop(1, 'rgba(0,0,0,.76)');
    ctx.fillStyle = g;
    ctx.fillRect(0, barY - H * 0.12, W, H - barY + H * 0.12);

    const mono = '"Cascadia Code", Consolas, monospace';
    const pad = W * 0.032;
    const fs = Math.round(H * 0.038);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.86)';
    ctx.font = '400 ' + fs + 'px ' + mono;
    ctx.fillText('1/120', pad, H * 0.9);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText('ISO 100', pad + fs * 4.1, H * 0.9);
    ctx.fillText('F2.8', pad + fs * 8.4, H * 0.9);

    // record button
    const rx = W - pad - H * 0.11, ry = H * 0.895, rr = H * 0.072;
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = Math.max(2, H * 0.006);
    ctx.beginPath();
    ctx.arc(rx, ry, rr + H * 0.018, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fill();

    // mode strip
    const modes = ['VIDEO', 'PHOTO', 'SLOW-MO'];
    ctx.textAlign = 'center';
    ctx.font = '600 ' + Math.round(fs * 0.92) + 'px ' + mono;
    modes.forEach(function (m, i) {
      const mx = W / 2 + (i - 1) * W * 0.12;
      ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,.36)';
      ctx.fillText(m, mx, H * 0.89);
      if (i === 0) {
        ctx.fillStyle = '#4fe3ff';
        ctx.fillRect(mx - W * 0.024, H * 0.93, W * 0.048, 2);
      }
    });

    // fov badge
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.font = '400 ' + Math.round(fs * 0.86) + 'px ' + mono;
    ctx.fillText('155° ULTRA WIDE', W - pad - H * 0.17, H * 0.82);
    ctx.textAlign = 'left';
  }

  function screenRear() {
    const W = 1024, H = 576;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    drawPreview(ctx, W, H, 11);
    drawTopBar(ctx, W, H, false);
    drawFrameGuides(ctx, W, H, 1);
    drawBottomBar(ctx, W, H);
    return makeTexture(c);
  }

  function screenFront() {
    // 1.4" 320×320 square panel — selfie / parameter monitor
    const W = 512, H = 512;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    drawPreview(ctx, W, H, 29);
    drawTopBar(ctx, W, H, true);
    drawFrameGuides(ctx, W, H, 1.15);
    const g = ctx.createLinearGradient(0, H * 0.8, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.7)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.8, W, H * 0.2);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '500 ' + Math.round(H * 0.035) + 'px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('4K · 60', W * 0.045, H * 0.915);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.textAlign = 'center';
    ctx.font = '400 ' + Math.round(H * 0.026) + 'px "Cascadia Code", Consolas, monospace';
    ctx.fillText('SELFIE · 1.4"', W * 0.5, H * 0.955);
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(W - W * 0.08, H * 0.91, H * 0.032, 0, Math.PI * 2);
    ctx.fill();
    return makeTexture(c);
  }

  /* ============================================================
     2. Mainboard PCB
     ============================================================ */
  function pcbTexture() {
    const W = 1024, H = 640;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    const R = rng(20230404);

    // solder mask
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, '#07120f');
    base.addColorStop(0.45, '#0a1a15');
    base.addColorStop(1, '#06100d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // copper pour patches
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(36,90,72,' + (0.06 + R() * 0.09).toFixed(2) + ')';
      const x = R() * W, y = R() * H, w = 80 + R() * 300, h = 60 + R() * 240;
      ctx.fillRect(x, y, w, h);
    }

    // traces
    ctx.lineCap = 'round';
    for (let i = 0; i < 150; i++) {
      let x = Math.round((R() * W) / 8) * 8;
      let y = Math.round((R() * H) / 8) * 8;
      const dirs = [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1], [-1, 1]];
      let dir = dirs[Math.floor(R() * 8)];
      ctx.strokeStyle = R() > 0.72 ? 'rgba(126,168,112,.28)' : 'rgba(45,116,92,.34)';
      ctx.lineWidth = 1 + R() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(R() * 5);
      for (let s = 0; s < segs; s++) {
        const len = 14 + R() * 120;
        x += dir[0] * len;
        y += dir[1] * len;
        ctx.lineTo(x, y);
        if (R() > 0.5) dir = dirs[Math.floor(R() * 8)];
      }
      ctx.stroke();
      // vias
      if (R() > 0.35) {
        ctx.fillStyle = 'rgba(196,166,84,.8)';
        ctx.beginPath();
        ctx.arc(x, y, 2.4 + R() * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // copper pads / test points
    for (let i = 0; i < 60; i++) {
      const x = 30 + R() * (W - 60), y = 30 + R() * (H - 60);
      const kind = R();
      if (kind > 0.6) {
        ctx.fillStyle = 'rgba(214,178,90,.9)';
        ctx.beginPath();
        ctx.arc(x, y, 3 + R() * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,225,150,.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (kind > 0.3) {
        ctx.fillStyle = 'rgba(188,152,72,.75)';
        ctx.fillRect(x, y, 8 + R() * 18, 3 + R() * 4);
      }
    }

    // board outline / keep-out
    ctx.strokeStyle = 'rgba(180,220,200,.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, W - 36, H - 36);

    // silkscreen
    const silk = 'rgba(225,240,234,.72)';
    ctx.fillStyle = silk;
    ctx.font = '600 16px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('DJI  ACTION 4  MAINBOARD', 44, 60);
    ctx.font = '400 12px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = 'rgba(225,240,234,.4)';
    ctx.fillText('PN: 2023-04-A4  REV: C  ·  1.6mm  HDI', 44, 80);

    const labels = [
      ['IMU-01', 140, 240], ['WIFI 6', 720, 150], ['BT 5.0', 830, 205],
      ['SOC U1', 440, 320], ['LPDDR4X', 610, 340], ['PWR MGMT', 170, 470],
      ['USB 3.1', 760, 470], ['MIC IN', 320, 190], ['MOTOR', 890, 540],
      ['J1', 520, 520], ['C32', 660, 460], ['R14', 250, 340]
    ];
    labels.forEach(function (l) {
      ctx.fillStyle = silk;
      ctx.font = '600 12px "Cascadia Code", Consolas, monospace';
      ctx.fillText(l[0], l[1], l[2]);
      ctx.strokeStyle = 'rgba(225,240,234,.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l[1] - 14, l[2] - 4);
      ctx.lineTo(l[1] - 4, l[2] - 4);
      ctx.stroke();
    });

    // chip outlines
    [[400, 270, 150, 120], [600, 290, 110, 90], [120, 420, 120, 90], [720, 420, 140, 80]].forEach(function (b) {
      ctx.strokeStyle = 'rgba(225,240,234,.22)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(b[0], b[1], b[2], b[3]);
      // pin 1 dot
      ctx.fillStyle = 'rgba(225,240,234,.5)';
      ctx.beginPath();
      ctx.arc(b[0] + 10, b[1] + 10, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // screw hole keepouts
    [[46, 46], [W - 46, 46], [46, H - 46], [W - 46, H - 46]].forEach(function (p) {
      ctx.strokeStyle = 'rgba(225,240,234,.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#040806';
      ctx.beginPath();
      ctx.arc(p[0], p[1], 16, 0, Math.PI * 2);
      ctx.fill();
    });

    // fiducials
    [[330, 90], [700, 90], [330, 560], [900, 90]].forEach(function (p) {
      ctx.strokeStyle = 'rgba(255,230,160,.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p[0] - 12, p[1]); ctx.lineTo(p[0] + 12, p[1]);
      ctx.moveTo(p[0], p[1] - 12); ctx.lineTo(p[0], p[1] + 12);
      ctx.stroke();
    });

    // fine noise
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);

    return makeTexture(c);
  }

  /* ============================================================
     3. Battery label
     ============================================================ */
  function batteryLabelTexture() {
    const W = 768, H = 512;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#14171a');
    bg.addColorStop(0.5, '#1b1e22');
    bg.addColorStop(1, '#0d0f11');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // fine diagonal texture
    ctx.strokeStyle = 'rgba(255,255,255,.025)';
    ctx.lineWidth = 1;
    for (let i = -H; i < W; i += 7) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
    }

    // orange accent
    ctx.fillStyle = '#f59e2c';
    ctx.fillRect(0, 0, W, 14);
    ctx.fillStyle = 'rgba(245,158,44,.16)';
    ctx.fillRect(0, H - 70, W, 70);

    ctx.fillStyle = '#f4f6f7';
    ctx.textAlign = 'left';
    ctx.font = '800 78px "Segoe UI", Arial, sans-serif';
    ctx.fillText('DJI', 52, 118);
    ctx.font = '300 30px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#f59e2c';
    ctx.fillText('EXTREME', 54, 168);
    ctx.fillStyle = '#eef2f4';
    ctx.font = '600 27px "Segoe UI", Arial, sans-serif';
    ctx.fillText('BATTERY', 54, 205);

    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.moveTo(54, 230); ctx.lineTo(W - 54, 230); ctx.stroke();

    const mono = '"Cascadia Code", Consolas, monospace';
    ctx.fillStyle = '#f4f6f7';
    ctx.font = '600 46px ' + mono;
    ctx.fillText('1770 mAh', 54, 292);
    ctx.font = '400 24px ' + mono;
    ctx.fillStyle = 'rgba(235,242,246,.72)';
    ctx.fillText('6.8 Wh   ·   3.85 V   ·   Li-ion Polymer', 54, 330);
    ctx.fillText('MODEL: AB4-1770  /  MADE IN CHINA', 54, 366);

    // caution triangle
    ctx.strokeStyle = '#f59e2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W - 118, 300); ctx.lineTo(W - 72, 376); ctx.lineTo(W - 164, 376); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#f59e2c';
    ctx.font = '700 34px ' + mono;
    ctx.fillText('!', W - 122, 364);

    // barcode
    ctx.fillStyle = '#d8dee2';
    let bx = 54;
    const R = rng(1770);
    while (bx < W - 54) {
      const w = 2 + Math.floor(R() * 7);
      if (R() > 0.3) ctx.fillRect(bx, 408, w, 46);
      bx += w + 2 + Math.floor(R() * 5);
    }
    ctx.fillStyle = 'rgba(235,242,246,.5)';
    ctx.font = '400 16px ' + mono;
    ctx.fillText('A4-1770-2023-CN', 54, 478);
    ctx.textAlign = 'right';
    ctx.fillText('⚠ DO NOT PUNCTURE / DISASSEMBLE', W - 54, 478);

    // corner screws
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2;
    [[20, 20], [W - 20, 20], [20, H - 20], [W - 20, H - 20]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.stroke();
    });

    return makeTexture(c);
  }

  /* ============================================================
     4. Lens / optics
     ============================================================ */
  function knurlBumpTexture() {
    const W = 512, H = 64;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    const R = rng(99);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 6) {
      const g = ctx.createLinearGradient(x, 0, x + 6, 0);
      const v = 90 + Math.floor(R() * 40);
      g.addColorStop(0, 'rgb(' + v + ',' + v + ',' + v + ')');
      g.addColorStop(0.45, 'rgb(' + (v + 95) + ',' + (v + 95) + ',' + (v + 95) + ')');
      g.addColorStop(1, 'rgb(' + (v - 25) + ',' + (v - 25) + ',' + (v - 25) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 6, H);
    }
    return makeTexture(c, { srgb: false, repeat: [3, 1] });
  }

  function lensCoatingTexture() {
    const S = 512;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;

    // deep glass base
    const g = ctx.createRadialGradient(cx * 0.86, cy * 0.8, 10, cx, cy, S * 0.5);
    g.addColorStop(0, 'rgba(28,44,66,.42)');
    g.addColorStop(0.45, 'rgba(8,17,32,.82)');
    g.addColorStop(0.8, 'rgba(2,6,14,.96)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.49, 0, Math.PI * 2);
    ctx.fill();

    // iridescent interference arcs
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.475, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const hues = [265, 288, 305, 320, 172, 155, 190, 205];
    for (let i = 0; i < 46; i++) {
      const r = S * (0.1 + (i / 46) * 0.38);
      const hue = hues[i % hues.length] + Math.sin(i * 0.8) * 22;
      const a = 0.05 + 0.08 * Math.abs(Math.sin(i * 0.7));
      ctx.strokeStyle = 'hsla(' + hue + ',95%,62%,' + a.toFixed(3) + ')';
      ctx.lineWidth = 1 + (i % 4);
      ctx.beginPath();
      ctx.arc(cx + Math.sin(i) * 12, cy + Math.cos(i * 1.3) * 9, r, i * 0.7, i * 0.7 + Math.PI * 1.25);
      ctx.stroke();
    }

    // arc highlights
    for (let i = 0; i < 9; i++) {
      const r = S * (0.18 + i * 0.032);
      ctx.strokeStyle = 'rgba(150,235,255,' + (0.035 + i * 0.004).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * (1.02 + i * 0.05), Math.PI * (1.55 + i * 0.04));
      ctx.stroke();
    }
    ctx.restore();

    // specular hot spots
    function spot(x, y, r, col) {
      const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
      sg.addColorStop(0, col);
      sg.addColorStop(0.35, col.replace(/[\d.]+\)$/, '0.12)'));
      sg.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    spot(S * 0.31, S * 0.26, S * 0.16, 'rgba(240,255,255,.42)');
    spot(S * 0.7, S * 0.36, S * 0.1, 'rgba(255,220,190,.2)');
    spot(S * 0.42, S * 0.72, S * 0.12, 'rgba(120,220,255,.14)');

    // inner aperture hints
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * S * 0.1, cy + Math.sin(a) * S * 0.1);
      ctx.lineTo(cx + Math.cos(a + 0.5) * S * 0.29, cy + Math.sin(a + 0.5) * S * 0.29);
      ctx.stroke();
    }
    return makeTexture(c);
  }

  function apertureTexture() {
    const S = 512;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    ctx.clearRect(0, 0, S, S);

    const g = ctx.createRadialGradient(cx, cy, 6, cx, cy, S / 2);
    g.addColorStop(0, '#02030a');
    g.addColorStop(0.52, '#050a16');
    g.addColorStop(0.82, '#0b2030');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, S / 2, 0, Math.PI * 2); ctx.fill();

    // aperture blades
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 7; i++) {
      ctx.rotate((Math.PI * 2) / 7);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(S * 0.13, -S * 0.26);
      ctx.lineTo(S * 0.03, -S * 0.36);
      ctx.closePath();
      ctx.fillStyle = 'rgba(2,4,8,.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,140,170,.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // rim reflections
    ctx.strokeStyle = 'rgba(95,190,230,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,180,120,.16)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.25, Math.PI * 0.2, Math.PI * 0.95); ctx.stroke();
    return makeTexture(c);
  }

  function lensGlassTexture() {
    const S = 512;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(S * 0.36, S * 0.3, 4, S * 0.5, S * 0.5, S * 0.5);
    g.addColorStop(0, 'rgba(112,188,224,.5)');
    g.addColorStop(0.18, 'rgba(24,62,96,.55)');
    g.addColorStop(0.6, 'rgba(4,14,26,.9)');
    g.addColorStop(1, 'rgba(0,0,0,.98)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return makeTexture(c);
  }

  /* ============================================================
     5. Logos / labels / small details
     ============================================================ */
  function logoTexture() {
    const W = 512, H = 192;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f3f8ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Stylised lowercase dji wordmark (device silk print)
    ctx.font = '900 148px "Arial Black", Arial, sans-serif';
    ctx.fillText('dji', W / 2, H / 2 + 8);
    return makeTexture(c);
  }

  function actionLogoTexture() {
    const W = 1024, H = 112;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const font = '600 62px "Segoe UI", Arial, sans-serif';
    const textA = 'OSMO ACTION ';
    ctx.font = font;
    const wa = ctx.measureText(textA).width;
    const w4 = ctx.measureText('4').width;
    const spacing = 3;
    let x = (W - (wa + w4)) / 2;
    ctx.fillStyle = 'rgba(240,247,252,.9)';
    for (let i = 0; i < textA.length; i++) {
      const ch = textA[i];
      ctx.fillText(ch, x, H / 2 + 4);
      x += ctx.measureText(ch).width + (ch === ' ' ? 10 : spacing);
    }
    ctx.fillStyle = '#ff3b30';
    ctx.fillText('4', x, H / 2 + 4);
    return makeTexture(c);
  }

  function qsLabelTexture() {
    // vertical Q / S silk print for the side Quick-Switch key
    const W = 160, H = 256;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(240,248,255,.85)';
    ctx.font = '700 74px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Q', W / 2, H * 0.3);
    ctx.fillText('S', W / 2, H * 0.7);
    return makeTexture(c);
  }

  function micGrilleTexture() {
    const W = 128, H = 128;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0d0f';
    ctx.fillRect(0, 0, W, H);
    for (let y = 8; y < H; y += 10) {
      for (let x = 8; x < W; x += 10) {
        const g = ctx.createRadialGradient(x - 1, y - 1, 0.4, x, y, 3);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.7, 'rgba(2,3,4,1)');
        g.addColorStop(1, 'rgba(28,34,40,.55)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return makeTexture(c);
  }

  function screwTexture() {
    const S = 128;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    const g = ctx.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, S * 0.48);
    g.addColorStop(0, '#e8eef1');
    g.addColorStop(0.35, '#a4aeb4');
    g.addColorStop(0.7, '#5c666c');
    g.addColorStop(1, '#2c3337');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.46, 0, Math.PI * 2); ctx.fill();
    // slot
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.6);
    ctx.fillStyle = 'rgba(8,12,14,.9)';
    ctx.fillRect(-S * 0.3, -S * 0.035, S * 0.6, S * 0.07);
    ctx.fillStyle = 'rgba(255,255,255,.26)';
    ctx.fillRect(-S * 0.3, -S * 0.06, S * 0.6, S * 0.015);
    ctx.restore();
    // rim
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.44, 0, Math.PI * 2); ctx.stroke();
    return makeTexture(c);
  }

  /* ============================================================
     6. Generic noise / sprites / effects
     ============================================================ */
  function speckleTexture() {
    const S = 256;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = 185 + Math.random() * 55;
      d[i] = n; d[i + 1] = n; d[i + 2] = n; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // subtle large blotches
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(130,130,130,.16)');
      g.addColorStop(1, 'rgba(130,130,130,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    return makeTexture(c, { srgb: false, repeat: [3, 3] });
  }

  function particleTexture() {
    const S = 64;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(210,245,255,.8)');
    g.addColorStop(0.6, 'rgba(120,210,255,.18)');
    g.addColorStop(1, 'rgba(80,180,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return makeTexture(c);
  }

  function softGlowTexture() {
    const S = 256;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,.85)');
    g.addColorStop(0.22, 'rgba(255,255,255,.38)');
    g.addColorStop(0.55, 'rgba(255,255,255,.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return makeTexture(c);
  }

  function shadowTexture() {
    const S = 256;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.06, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,.72)');
    g.addColorStop(0.45, 'rgba(0,0,0,.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return makeTexture(c);
  }

  function floorGlowTexture() {
    const S = 512;
    const c = makeCanvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(120,235,255,.5)');
    g.addColorStop(0.18, 'rgba(74,190,224,.24)');
    g.addColorStop(0.42, 'rgba(30,110,140,.09)');
    g.addColorStop(0.7, 'rgba(10,40,60,.025)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // concentric tech rings
    ctx.strokeStyle = 'rgba(110,230,255,.28)';
    [0.2, 0.32, 0.48, 0.62].forEach(function (r, i) {
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S * r, 0, Math.PI * 2);
      ctx.stroke();
    });
    // tick ring
    ctx.strokeStyle = 'rgba(140,240,255,.35)';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r1 = S * 0.355, r2 = S * (i % 5 === 0 ? 0.39 : 0.372);
      ctx.lineWidth = i % 5 === 0 ? 1.6 : 0.8;
      ctx.beginPath();
      ctx.moveTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
      ctx.lineTo(S / 2 + Math.cos(a) * r2, S / 2 + Math.sin(a) * r2);
      ctx.stroke();
    }
    return makeTexture(c);
  }

  function brushedMetalTexture() {
    const W = 512, H = 512;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, '#3a3f44');
    base.addColorStop(0.5, '#23272b');
    base.addColorStop(1, '#15181b');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      const y = Math.random() * H;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.008 + Math.random() * 0.03).toFixed(3) + ')';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + (Math.random() - 0.5) * 2);
      ctx.stroke();
    }
    return makeTexture(c, { srgb: false, repeat: [2, 1] });
  }

  /* ---------- lazy texture registry ---------- */
  const cache = {};
  function lazy(name, fn) {
    return function () {
      if (!cache[name]) cache[name] = fn();
      return cache[name];
    };
  }

  window.DJI.textures = {
    screenRear: lazy('screenRear', screenRear),
    screenFront: lazy('screenFront', screenFront),
    pcb: lazy('pcb', pcbTexture),
    batteryLabel: lazy('batteryLabel', batteryLabelTexture),
    knurlBump: lazy('knurlBump', knurlBumpTexture),
    lensCoating: lazy('lensCoating', lensCoatingTexture),
    aperture: lazy('aperture', apertureTexture),
    lensGlass: lazy('lensGlass', lensGlassTexture),
    logo: lazy('logo', logoTexture),
    actionLogo: lazy('actionLogo', actionLogoTexture),
    qsLabel: lazy('qsLabel', qsLabelTexture),
    micGrille: lazy('micGrille', micGrilleTexture),
    screw: lazy('screw', screwTexture),
    speckle: lazy('speckle', speckleTexture),
    particle: lazy('particle', particleTexture),
    softGlow: lazy('softGlow', softGlowTexture),
    shadow: lazy('shadow', shadowTexture),
    floorGlow: lazy('floorGlow', floorGlowTexture),
    brushedMetal: lazy('brushedMetal', brushedMetalTexture)
  };
})();
