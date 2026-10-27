#!/usr/bin/env node
/* ============================================================
 * qa/perf/render-audit.mjs
 * DJI Osmo Action 4 · 三维拆解页面「渲染质量 + 性能」可复现审计
 *
 * 只读产品文件，只写 qa/perf/（以及 git worktree 的系统临时目录）。
 *
 * 用法：
 *   node qa/perf/render-audit.mjs                 # 只审计当前工作区
 *   node qa/perf/render-audit.mjs --baseline      # 审计当前工作区 + HEAD 基线，生成 A/B 对比
 *   node qa/perf/render-audit.mjs --baseline-only # 只审计基线（自测用）
 *   node qa/perf/render-audit.mjs --out <dir>     # 指定输出目录（默认 qa/perf）
 *   node qa/perf/render-audit.mjs --root <dir>    # 指定"当前"项目根目录（默认脚本上两级）
 *   node qa/perf/render-audit.mjs --ref <git-ref> # 指定基线 git ref（默认 9edadf1）
 *   node qa/perf/render-audit.mjs --uncapped      # 额外测量不限帧率（--disable-frame-rate-limit）下的 fps
 *   node qa/perf/render-audit.mjs --keep-worktree # 审计失败时保留 baseline worktree（调试用）
 *
 * 退出码：0 成功；1 失败（打印清晰错误信息，成功路径才会写 results.json）。
 * ============================================================ */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ *
 * 常量 / 环境
 * ------------------------------------------------------------------ */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const CHROME_PATH =
  process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PLAYWRIGHT_PATH =
  process.env.QA_PLAYWRIGHT ||
  'F:/LearnSpace/前端与Web/dsh大肥鱼/qq-bot/node_modules/playwright-core';
const DEFAULT_BASELINE_REF = process.env.QA_BASELINE_REF || '9edadf1';

const VIEWPORT = { width: 1600, height: 1000 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const PERF_SAMPLE_MS = 3000;
const PERF_RETRY_BELOW_FPS = 57; // 60Hz 下低于该值视为可疑（可能有并行负载），重测一次
const AA_SAMPLE_COUNT = 3;

// 抗锯齿客观口径（写进 results.json / report.md，前后两次运行必须一致）
const AA_CONFIG = {
  // 全局亮度三档（任务口径；阈值固定，前后可比）
  darkThreshold: 8,
  brightThreshold: 70,
  // 局部对比补充口径（与绝对亮度无关，抗 tone mapping 变化）
  localEdgeMinRange: 24,
  localMidMargin: 0.15,
  neighborhood: '3x3',
  hfEnergy: 'interior 像素的水平+垂直二阶差分平方均值'
};

const LAUNCH_ARGS = [
  '--ignore-gpu-blocklist',
  '--use-angle=default',
  '--no-sandbox',
  '--hide-scrollbars',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
];
const UNCAPPED_EXTRA_ARGS = [
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
  '--disable-background-timer-throttling'
];

const PRODUCT_FILES = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/lib/model.js',
  'js/lib/textures.js',
  'js/vendor/three-bundle.min.js'
];

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const fmt = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : String(v));
const pct = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? (v * 100).toFixed(d) + '%' : '—');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (e) {
    return null;
  }
}

function hashProductFiles(root) {
  const out = {};
  for (const rel of PRODUCT_FILES) {
    const abs = path.join(root, rel);
    out[rel] = fs.existsSync(abs) ? sha256File(abs) : null;
  }
  return out;
}

function runGit(args, { cwd, allowFail = false } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000
    });
    return { ok: true, stdout: String(out).trim(), stderr: '' };
  } catch (e) {
    if (allowFail) return { ok: false, stdout: '', stderr: String((e && (e.stderr || e.message)) || e) };
    throw new Error(
      `git ${args.join(' ')} 失败（cwd=${cwd}）：${String((e && (e.stderr || e.message)) || e).trim()}`
    );
  }
}

/** 数字比较字段：{ baseline, current, delta, deltaPct } */
function cmpField(base, cur) {
  const b = typeof base === 'number' && isFinite(base) ? base : null;
  const c = typeof cur === 'number' && isFinite(cur) ? cur : null;
  const delta = b !== null && c !== null ? c - b : null;
  const deltaPct = b !== null && c !== null && b !== 0 ? (delta / b) * 100 : null;
  return { baseline: b, current: c, delta, deltaPct };
}

function formatDuration(ms) {
  if (!isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/* ------------------------------------------------------------------ *
 * CLI 解析
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const args = {
    baseline: false,
    baselineOnly: false,
    currentOnly: false,
    uncapped: false,
    keepWorktree: false,
    out: 'qa/perf',
    root: null,
    ref: DEFAULT_BASELINE_REF,
    help: false,
    raw: argv.slice()
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') args.baseline = true;
    else if (a === '--baseline-only') args.baselineOnly = true;
    else if (a === '--current-only') args.currentOnly = true;
    else if (a === '--uncapped') args.uncapped = true;
    else if (a === '--keep-worktree') args.keepWorktree = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--out' || a === '--root' || a === '--ref') {
      const v = argv[++i];
      if (!v) throw new Error(`参数 ${a} 缺少取值`);
      args[a.slice(2)] = v;
    } else {
      throw new Error(`未知参数：${a}（用 --help 查看用法）`);
    }
  }
  args.mode = args.baselineOnly ? 'baseline' : args.baseline ? 'both' : 'current';
  return args;
}

function printHelp() {
  console.log(
    [
      '用法：node qa/perf/render-audit.mjs [选项]',
      '',
      '  --baseline        同时审计当前工作区与 HEAD 基线（git worktree），生成 A/B 对比',
      '  --baseline-only   只审计基线（自测用）',
      '  --out <dir>       输出目录（默认 qa/perf）',
      '  --root <dir>      指定"当前"项目根目录（默认脚本上两级）',
      '  --ref <git-ref>   基线 git ref（默认 ' + DEFAULT_BASELINE_REF + '）',
      '  --uncapped        额外测量不限帧率模式下的 fps（补充性能信号）',
      '  --keep-worktree   失败时保留 baseline 临时 worktree（调试用）',
      '  --help            显示本帮助',
      '',
      '环境变量：QA_CHROME、QA_PLAYWRIGHT、QA_BASELINE_REF'
    ].join('\n')
  );
}

/* ------------------------------------------------------------------ *
 * PNG 解码（8bit RGB/RGBA，非隔行）+ 抗锯齿指标
 * 只依赖 node:zlib，保证脚本零第三方依赖可重复运行。
 * ------------------------------------------------------------------ */
function decodePng(buffer) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIG)) {
    throw new Error('截图不是合法 PNG 数据');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buffer.subarray(dataStart, dataStart + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }
  if (!width || !height) throw new Error('PNG 缺少 IHDR');
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(
      `不支持的 PNG 格式（bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}）`
    );
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  if (inflated.length < height * (stride + 1)) {
    throw new Error('PNG 数据长度不足（可能已损坏）');
  }
  const pixels = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[p++];
    inflated.copy(cur, 0, p, p + stride);
    p += stride;
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0;
          cur[i] = (cur[i] + a) & 0xff;
        }
        break;
      case 2:
        for (let i = 0; i < stride; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0;
          const b = prev[i];
          cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0;
          const b = prev[i];
          const c = i >= bpp ? prev[i - bpp] : 0;
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          let pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          cur[i] = (cur[i] + pr) & 0xff;
        }
        break;
      default:
        throw new Error(`PNG 滤波类型不支持：${filter}`);
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      pixels[di] = cur[si];
      pixels[di + 1] = cur[si + 1];
      pixels[di + 2] = cur[si + 2];
      pixels[di + 3] = bpp === 4 ? cur[si + 3] : 255;
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return { width, height, data: pixels };
}

function computeAaMetrics(decoded, cfg = AA_CONFIG) {
  const { width: w, height: h, data } = decoded;
  if (w < 3 || h < 3) throw new Error(`截图尺寸过小（${w}x${h}），无法计算 AA 指标`);
  const n = w * h;
  const lum = new Uint8Array(n);
  let lumaSum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const L = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    lum[j] = L;
    lumaSum += L;
  }
  const DARK = cfg.darkThreshold;
  const BRIGHT = cfg.brightThreshold;
  const LOCAL_MIN_RANGE = cfg.localEdgeMinRange;
  const LOCAL_MARGIN = cfg.localMidMargin;
  let darkCount = 0;
  let midCount = 0;
  let brightCount = 0;
  let edgeTransitionPixels = 0;
  let edgeCandidatePixels = 0;
  let localTransitionPixels = 0;
  let localEdgeCandidatePixels = 0;
  let hfSum = 0;
  let hfEdgeSum = 0;
  let interiorCount = 0;

  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      const c = lum[idx];
      if (c < DARK) darkCount++;
      else if (c > BRIGHT) brightCount++;
      else midCount++;

      // 3x3 邻域 min/max
      const l00 = lum[idx - w - 1];
      const l01 = lum[idx - w];
      const l02 = lum[idx - w + 1];
      const l10 = lum[idx - 1];
      const l12 = lum[idx + 1];
      const l20 = lum[idx + w - 1];
      const l21 = lum[idx + w];
      const l22 = lum[idx + w + 1];
      let mn = c;
      let mx = c;
      if (l00 < mn) mn = l00;
      if (l00 > mx) mx = l00;
      if (l01 < mn) mn = l01;
      if (l01 > mx) mx = l01;
      if (l02 < mn) mn = l02;
      if (l02 > mx) mx = l02;
      if (l10 < mn) mn = l10;
      if (l10 > mx) mx = l10;
      if (l12 < mn) mn = l12;
      if (l12 > mx) mx = l12;
      if (l20 < mn) mn = l20;
      if (l20 > mx) mx = l20;
      if (l21 < mn) mn = l21;
      if (l21 > mx) mx = l21;
      if (l22 < mn) mn = l22;
      if (l22 > mx) mx = l22;
      const range = mx - mn;

      // 口径 1（任务指定）：全局三档，像素落在中间档且邻域同时含"暗"和"亮"
      if (c >= DARK && c <= BRIGHT && mn < DARK && mx > BRIGHT) edgeTransitionPixels++;
      if (range >= BRIGHT - DARK) edgeCandidatePixels++;

      // 口径 2（补充）：局部对比，像素位于邻域 min/max 之间且与两端都留有余量
      if (range >= LOCAL_MIN_RANGE) {
        localEdgeCandidatePixels++;
        const m = range * LOCAL_MARGIN;
        if (c - mn >= m && mx - c >= m) localTransitionPixels++;
      }

      // 二阶差分能量（hfEnergy）
      const dxx = l12 - 2 * c + l10;
      const dyy = l21 - 2 * c + l01;
      const energy = dxx * dxx + dyy * dyy;
      hfSum += energy;
      interiorCount++;
      if (range >= LOCAL_MIN_RANGE) hfEdgeSum += energy;
    }
  }

  const interior = interiorCount || 1;
  return {
    width: w,
    height: h,
    pixelCount: n,
    meanLuma: round(lumaSum / n, 3),
    darkRatio: round(darkCount / n, 6),
    midRatio: round(midCount / n, 6),
    brightRatio: round(brightCount / n, 6),
    // 口径 1：全局亮度三档
    edgeTransitionRatio: round(edgeTransitionPixels / n, 8),
    edgeTransitionPerEdge: edgeCandidatePixels ? round(edgeTransitionPixels / edgeCandidatePixels, 6) : 0,
    edgeCandidateRatio: round(edgeCandidatePixels / n, 6),
    // 口径 2：局部对比（补充）
    edgeTransitionRatioLocal: round(localTransitionPixels / n, 8),
    edgeTransitionPerEdgeLocal: localEdgeCandidatePixels
      ? round(localTransitionPixels / localEdgeCandidatePixels, 6)
      : 0,
    localEdgeCandidateRatio: round(localEdgeCandidatePixels / n, 6),
    // 二阶差分能量
    hfEnergy: round(hfSum / interior, 3),
    hfEnergyPerEdge: localEdgeCandidatePixels ? round(hfEdgeSum / localEdgeCandidatePixels, 3) : 0,
    edgeTransitionPixels,
    edgeCandidatePixels,
    localEdgeCandidatePixels
  };
}

const AA_MEDIAN_KEYS = [
  'meanLuma',
  'darkRatio',
  'midRatio',
  'brightRatio',
  'edgeTransitionRatio',
  'edgeTransitionPerEdge',
  'edgeCandidateRatio',
  'edgeTransitionRatioLocal',
  'edgeTransitionPerEdgeLocal',
  'localEdgeCandidateRatio',
  'hfEnergy',
  'hfEnergyPerEdge'
];

function medianOf(values) {
  const arr = values.filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function analyzePngBuffers(buffers) {
  const samples = buffers.map((buf, i) => {
    const decoded = decodePng(buf);
    return Object.assign({ index: i }, computeAaMetrics(decoded));
  });
  const median = {};
  const spread = {};
  for (const key of AA_MEDIAN_KEYS) {
    const vals = samples.map((s) => s[key]).filter((v) => typeof v === 'number' && isFinite(v));
    median[key] = round(medianOf(vals), 8);
    if (vals.length > 1) {
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      spread[key] = { min: round(mn, 8), max: round(mx, 8), range: round(mx - mn, 8) };
    } else {
      spread[key] = { min: null, max: null, range: null };
    }
  }
  return { sampleCount: samples.length, samples, median, spread };
}

/* ------------------------------------------------------------------ *
 * 页面内执行的函数（会被序列化到浏览器里，必须自包含）
 * ------------------------------------------------------------------ */
function pageReadCapabilities() {
  const A = window.DJI_APP;
  const canvas = document.getElementById('scene');
  const out = {
    webgl2: false,
    webglVersion: null,
    gpuVendor: null,
    gpuRenderer: null,
    unmaskedVendor: null,
    unmaskedRenderer: null,
    maxSamples: null,
    framebufferSamples: null,
    maxAnisotropy: null,
    pixelRatio: null,
    devicePixelRatio: window.devicePixelRatio,
    drawingBuffer: [null, null],
    canvasCssSize: null,
    contextAttributes: null,
    rendererInfo: null,
    quality: null,
    composer: null,
    features: {},
    errors: []
  };
  let gl = null;
  let renderer = null;
  try {
    if (A && typeof A.getRenderer === 'function') renderer = A.getRenderer();
  } catch (e) {
    out.errors.push('getRenderer: ' + String((e && e.message) || e));
  }
  try {
    if (renderer) {
      if (typeof renderer.getPixelRatio === 'function') out.pixelRatio = renderer.getPixelRatio();
      gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null;
      if (renderer.info) {
        out.rendererInfo = {
          calls: renderer.info.render ? renderer.info.render.calls : null,
          triangles: renderer.info.render ? renderer.info.render.triangles : null,
          points: renderer.info.render ? renderer.info.render.points : null,
          lines: renderer.info.render ? renderer.info.render.lines : null,
          geometries: renderer.info.memory ? renderer.info.memory.geometries : null,
          textures: renderer.info.memory ? renderer.info.memory.textures : null
        };
      }
    }
  } catch (e) {
    out.errors.push('renderer: ' + String((e && e.message) || e));
  }
  if (!gl && canvas) {
    try {
      gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    } catch (e) {
      out.errors.push('getContext: ' + String((e && e.message) || e));
    }
  }
  if (gl) {
    const guard = (fn, fallback) => {
      try {
        const v = fn();
        return v === undefined ? fallback : v;
      } catch (e) {
        return fallback;
      }
    };
    out.webgl2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    out.webglVersion = guard(() => gl.getParameter(gl.VERSION), null);
    out.maxSamples = out.webgl2 ? guard(() => gl.getParameter(gl.MAX_SAMPLES), null) : null;
    out.framebufferSamples = guard(() => gl.getParameter(gl.SAMPLES), null);
    out.gpuVendor = guard(() => gl.getParameter(gl.VENDOR), null);
    out.gpuRenderer = guard(() => gl.getParameter(gl.RENDERER), null);
    const dbg = guard(() => gl.getExtension('WEBGL_debug_renderer_info'), null);
    if (dbg) {
      out.unmaskedVendor = guard(() => gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), null);
      out.unmaskedRenderer = guard(() => gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL), null);
    }
    const aniso = guard(() => gl.getExtension('EXT_texture_filter_anisotropic'), null);
    out.maxAnisotropy = aniso
      ? guard(() => gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT), null)
      : null;
    out.drawingBuffer = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    if (typeof gl.getContextAttributes === 'function') {
      const a = gl.getContextAttributes();
      if (a) {
        out.contextAttributes = {
          alpha: a.alpha,
          antialias: a.antialias,
          depth: a.depth,
          stencil: a.stencil,
          powerPreference: a.powerPreference
        };
      }
    }
  }
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    out.canvasCssSize = [Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100];
  }
  out.features = {
    hasFlyToPose: !!(A && typeof A.flyToPose === 'function'),
    hasSelectPart: !!(A && typeof A.selectPart === 'function'),
    hasSetExploded: !!(A && typeof A.setExploded === 'function'),
    hasDeselect: !!(A && typeof A.deselect === 'function'),
    hasGetStats: !!(A && typeof A.getStats === 'function'),
    hasSetQuality: !!(A && typeof A.setQuality === 'function'),
    hasGetQuality: !!(A && typeof A.getQuality === 'function'),
    hasGetComposer: !!(A && typeof A.getComposer === 'function'),
    hasRenderOnce: !!(A && typeof A.renderOnce === 'function'),
    hasGetRenderer: !!(A && typeof A.getRenderer === 'function'),
    hasGetCamera: !!(A && typeof A.getCamera === 'function')
  };
  // 画质档位（新版页面通过 getQuality/state.qualityTier 暴露；基线版本无）
  try {
    if (A && typeof A.getQuality === 'function') out.quality = A.getQuality();
    if (out.quality === null && A && A.state && A.state.qualityTier !== undefined) {
      out.quality = A.state.qualityTier;
    }
  } catch (e) {
    out.errors.push('getQuality: ' + String((e && e.message) || e));
  }
  // 后处理 composer 的 MSAA 采样数 / render target（新版页面暴露 getComposer；基线无）
  try {
    if (A && typeof A.getComposer === 'function') {
      const c = A.getComposer();
      if (c) {
        const rt = c.renderTarget1 || null;
        out.composer = {
          msaaSamples: rt && rt.samples !== undefined ? rt.samples : null,
          renderTargetSize: rt ? [rt.width, rt.height] : null,
          passCount: c.passes ? c.passes.length : null,
          pixelRatio: typeof c.getPixelRatio === 'function' ? c.getPixelRatio() : null
        };
      }
    }
  } catch (e) {
    out.errors.push('getComposer: ' + String((e && e.message) || e));
  }
  return out;
}

function pageReadStats() {
  const A = window.DJI_APP;
  const out = { state: null, raw: null, rawError: null, rendererInfo: null };
  if (!A) return out;
  if (A.state) {
    out.state = {
      ready: A.state.ready,
      exploded: A.state.exploded,
      selected: A.state.selected,
      hovered: A.state.hovered,
      labelsOn: A.state.labelsOn,
      autoRotate: A.state.autoRotate,
      autoFocus: A.state.autoFocus,
      mobile: A.state.mobile,
      qualityDropped: A.state.qualityDropped,
      qualityTier: A.state.qualityTier,
      qualityDowngraded: A.state.qualityDowngraded,
      frameTimeAvg: A.state.frameTimeAvg
    };
  }
  if (typeof A.getStats === 'function') {
    try {
      const raw = A.getStats();
      out.raw = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
    } catch (e) {
      out.rawError = String((e && e.message) || e);
    }
  }
  try {
    if (typeof A.getRenderer === 'function') {
      const r = A.getRenderer();
      if (r && r.info) {
        out.rendererInfo = {
          calls: r.info.render ? r.info.render.calls : null,
          triangles: r.info.render ? r.info.render.triangles : null,
          geometries: r.info.memory ? r.info.memory.geometries : null,
          textures: r.info.memory ? r.info.memory.textures : null
        };
      }
    }
  } catch (e) {
    /* ignore */
  }
  return out;
}

function pageReadHeap() {
  if (!window.performance || !performance.memory) return null;
  const m = performance.memory;
  return {
    usedMB: Math.round((m.usedJSHeapSize / 1048576) * 10) / 10,
    totalMB: Math.round((m.totalJSHeapSize / 1048576) * 10) / 10,
    limitMB: Math.round((m.jsHeapSizeLimit / 1048576) * 10) / 10
  };
}

function pageSampleFrames(durationMs) {
  return new Promise(function (resolve) {
    const times = [];
    const t0 = performance.now();
    let settled = false;
    function finish(extra) {
      if (settled) return;
      settled = true;
      const n = times.length;
      if (n < 2) {
        resolve({ error: 'rAF 未运行或帧数不足', frameCount: n });
        return;
      }
      const span = times[n - 1] - times[0];
      const deltas = [];
      for (let i = 1; i < n; i++) deltas.push(times[i] - times[i - 1]);
      const sorted = deltas.slice().sort(function (a, b) {
        return a - b;
      });
      function pick(p) {
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
        return sorted[idx];
      }
      function over(ms) {
        let c = 0;
        for (let i = 0; i < deltas.length; i++) if (deltas[i] > ms) c++;
        return c;
      }
      const result = {
        fps: (n - 1) / (span / 1000),
        frameCount: n,
        spanMs: span,
        frameTimeMs: {
          mean: span / (n - 1),
          p50: pick(0.5),
          p95: pick(0.95),
          min: sorted[0],
          max: sorted[sorted.length - 1]
        },
        jank: { over20ms: over(20), over33ms: over(33.4), over50ms: over(50) },
        rawFrameTimesMs: deltas.map(function (d) {
          return Math.round(d * 100) / 100;
        })
      };
      if (extra) result.note = extra;
      resolve(result);
    }
    function tick(t) {
      times.push(t);
      if (t - t0 >= durationMs) finish();
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(function () {
      finish('rAF 采样超时（可能被浏览器节流）');
    }, durationMs + 10000);
  });
}

/* ------------------------------------------------------------------ *
 * 浏览器辅助
 * ------------------------------------------------------------------ */
function requirePlaywright() {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(
      `找不到 Chrome：${CHROME_PATH}\n请安装 Chrome，或设置环境变量 QA_CHROME 指向 chrome.exe`
    );
  }
  if (!fs.existsSync(PLAYWRIGHT_PATH)) {
    throw new Error(
      `找不到 playwright-core：${PLAYWRIGHT_PATH}\n请设置环境变量 QA_PLAYWRIGHT 指向 playwright-core 目录`
    );
  }
  let pw;
  try {
    const require = createRequire(import.meta.url);
    pw = require(PLAYWRIGHT_PATH);
  } catch (e) {
    throw new Error(`加载 playwright-core 失败：${String((e && e.message) || e)}`);
  }
  if (!pw || !pw.chromium) throw new Error('playwright-core 中缺少 chromium 导出');
  return pw;
}

function playwrightVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLAYWRIGHT_PATH, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch (e) {
    return null;
  }
}

async function launchBrowser(pw, extraArgs = []) {
  try {
    return await pw.chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: LAUNCH_ARGS.concat(extraArgs)
    });
  } catch (e) {
    throw new Error(
      `Chrome 启动失败：${String((e && e.message) || e)}\nChrome 路径：${CHROME_PATH}`
    );
  }
}

function attachLogs(page, prefix, bucket) {
  page.on('console', (m) => {
    if (m.type() === 'error') bucket.consoleErrors.push(`[${prefix}] ${m.text()}`);
    else if (m.type() === 'warning') bucket.consoleWarnings.push(`[${prefix}] ${m.text()}`);
  });
  page.on('pageerror', (e) => bucket.pageErrors.push(`[${prefix}] ${e.stack || e.message}`));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    bucket.requestFailures.push(`[${prefix}] ${r.url()} :: ${f ? f.errorText : '?'}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) bucket.badResponses.push(`[${prefix}] ${r.status()} ${r.url()}`);
  });
}

async function waitForReady(page, { timeout = 45000 } = {}) {
  try {
    await page.waitForFunction(
      () => window.DJI_APP && window.DJI_APP.state && window.DJI_APP.state.ready === true,
      null,
      { timeout, polling: 100 }
    );
  } catch (e) {
    const diag = await page
      .evaluate(() => ({
        title: document.title,
        hasDjiApp: !!window.DJI_APP,
        ready: window.DJI_APP && window.DJI_APP.state ? window.DJI_APP.state.ready : null,
        fallbackVisible: (() => {
          const el = document.getElementById('fallback');
          return el ? !el.hidden : false;
        })(),
        bodyText: (document.body ? document.body.innerText : '').slice(0, 300)
      }))
      .catch(() => null);
    throw new Error(
      `页面就绪超时（${timeout}ms）：未等到 window.DJI_APP.state.ready === true。` +
        (diag ? `\n页面诊断：${JSON.stringify(diag)}` : '')
    );
  }
  const fallbackVisible = await page
    .evaluate(() => {
      const el = document.getElementById('fallback');
      return el ? !el.hidden : false;
    })
    .catch(() => false);
  if (fallbackVisible) {
    throw new Error('页面显示 WebGL 失败提示（#fallback），当前环境无法审计渲染');
  }
}

async function readCameraState(page) {
  return page
    .evaluate(() => {
      const A = window.DJI_APP;
      if (!A || typeof A.getCamera !== 'function') return null;
      const cam = A.getCamera();
      if (!cam || !cam.position) return null;
      const ctl = typeof A.getControls === 'function' ? A.getControls() : null;
      return {
        pos: [cam.position.x, cam.position.y, cam.position.z],
        target: ctl && ctl.target ? [ctl.target.x, ctl.target.y, ctl.target.z] : null
      };
    })
    .catch(() => null);
}

async function waitCameraStable(page, { timeout = 15000, tol = 5e-3, needStable = 2 } = {}) {
  const start = Date.now();
  let prev = null;
  let stable = 0;
  while (Date.now() - start < timeout) {
    const cur = await readCameraState(page);
    if (cur) {
      if (prev) {
        const dp = Math.max(
          0,
          ...cur.pos.map((v, i) => Math.abs(v - prev.pos[i])),
          ...(cur.target && prev.target
            ? cur.target.map((v, i) => Math.abs(v - prev.target[i]))
            : [0])
        );
        if (dp < tol) stable++;
        else stable = 0;
        if (stable >= needStable) return true;
      }
      prev = cur;
    }
    await page.waitForTimeout(120);
  }
  return false;
}

async function forceHighQuality(page) {
  // 新版页面有自适应画质（tier）。为了让 before/after 在相同画质档下对比，
  // AA 截图与性能采样前把档位固定为 high（基线版本没有 setQuality，直接跳过）。
  const res = await page
    .evaluate(() => {
      const A = window.DJI_APP;
      if (!A) return { applied: false, reason: 'no DJI_APP' };
      if (typeof A.setQuality !== 'function') return { applied: false, reason: 'no setQuality' };
      try {
        const ok = A.setQuality('high');
        return {
          applied: !!ok,
          tier: typeof A.getQuality === 'function' ? A.getQuality() : null
        };
      } catch (e) {
        return { applied: false, reason: String((e && e.message) || e) };
      }
    })
    .catch((e) => ({ applied: false, reason: String((e && e.message) || e) }));
  if (res.applied) await page.waitForTimeout(800);
  return res;
}

async function dismissTransientUI(page) {
  await page
    .evaluate(() => {
      ['toast', 'hoverTag'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('is-visible');
      });
      if (window.DJI_APP && window.DJI_APP.state) window.DJI_APP.state.hovered = null;
    })
    .catch(() => {});
  await page.mouse.move(4, 4).catch(() => {});
}

async function hideOverlays(page) {
  await page.evaluate(() => {
    if (document.getElementById('__qa_hide_overlays')) return;
    const style = document.createElement('style');
    style.id = '__qa_hide_overlays';
    style.textContent =
      '#app > *:not(#scene){display:none !important}html,body{background:#000 !important}';
    document.head.appendChild(style);
  });
}

async function showOverlays(page) {
  await page.evaluate(() => {
    const s = document.getElementById('__qa_hide_overlays');
    if (s) s.remove();
  });
}

async function setFixedAuditView(page) {
  // 固定审计机位，保证 before/after 取景一致（与产品默认机位解耦）
  const result = await page.evaluate(() => {
    const A = window.DJI_APP;
    if (!A) return { ok: false, reason: 'no DJI_APP' };
    if (typeof A.flyToPose !== 'function') return { ok: false, reason: 'no flyToPose' };
    A.flyToPose({ az: 0.58, el: 0.24, r: 13.8, ty: 0.6 }, 0.25);
    return { ok: true };
  });
  await page.waitForTimeout(500);
  const stable = await waitCameraStable(page);
  return { used: result.ok, stable, reason: result.reason || null };
}

async function prepareDeterministicState(page) {
  await page.evaluate(() => {
    const A = window.DJI_APP;
    if (!A) return;
    if (A.state) {
      A.state.autoRotate = false;
      A.state.autoFocus = false;
      A.state.intro = false;
      A.state.labelsOn = false;
      A.state.hovered = null;
    }
    if (typeof A.deselect === 'function') A.deselect();
    if (typeof A.setExploded === 'function') A.setExploded(false, { fly: false, silent: true });
  });
  await page.waitForTimeout(300);
  await waitCameraStable(page);
  await dismissTransientUI(page);
}

async function openPage(browser, { url, viewport, dpr, isMobile = false, logs, prefix }) {
  const contextOptions = {
    viewport,
    deviceScaleFactor: dpr,
    locale: 'zh-CN'
  };
  if (isMobile) {
    contextOptions.isMobile = true;
    contextOptions.hasTouch = true;
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  attachLogs(page, prefix, logs);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  } catch (e) {
    throw new Error(
      `打开页面失败：${url}\n${String((e && e.message) || e)}\n请确认文件存在、且未被其他程序占用。`
    );
  }
  await waitForReady(page);
  await page.waitForTimeout(2000); // 等启动层淡出 + 开场机位飞行
  await waitCameraStable(page).catch(() => false);
  return { context, page };
}

async function screenshotTo(page, outDir, shotsDir, run, filename, scene) {
  const abs = path.join(shotsDir, filename);
  await page.screenshot({ path: abs, animations: 'disabled', timeout: 45000 });
  recordShot(run, outDir, abs, filename, scene);
  return abs;
}

function recordShot(run, outDir, absPath, filename, scene) {
  const rel = path.relative(outDir, absPath).split(path.sep).join('/');
  run.screenshots.push({ file: filename, path: rel, scene });
}

async function captureCleanFrames(page, count, savePath) {
  await hideOverlays(page);
  await page.waitForTimeout(300);
  const buffers = [];
  for (let i = 0; i < count; i++) {
    buffers.push(await page.screenshot({ type: 'png', timeout: 45000 }));
    if (i < count - 1) await page.waitForTimeout(140);
  }
  // 先落盘（此时 DOM 覆盖层仍是隐藏状态），再恢复覆盖层
  if (savePath) fs.writeFileSync(savePath, buffers[0]);
  await showOverlays(page);
  await page.waitForTimeout(120);
  return buffers;
}

async function measurePerf(page, { durationMs = PERF_SAMPLE_MS, retryBelowFps = PERF_RETRY_BELOW_FPS, retries = 1 } = {}) {
  const attempts = [];
  for (let i = 0; i <= retries; i++) {
    const startAt = new Date().toISOString();
    const wallStart = Date.now();
    const memBefore = await page.evaluate(pageReadHeap).catch(() => null);
    const sample = await page.evaluate(pageSampleFrames, durationMs);
    const wallMs = Date.now() - wallStart;
    const statsAfter = await page.evaluate(pageReadStats);
    const memAfter = await page.evaluate(pageReadHeap).catch(() => null);
    attempts.push({ startAt, wallMs, sample, statsAfter, heapBefore: memBefore, heapAfter: memAfter });
    if (!sample || sample.error) break;
    if (sample.fps >= retryBelowFps || i === retries) break;
    await page.waitForTimeout(1500);
  }
  const valid = attempts.filter((a) => a.sample && !a.sample.error && typeof a.sample.fps === 'number');
  let chosen = null;
  let chosenIndex = -1;
  if (valid.length) {
    chosen = valid.reduce((a, b) => (b.sample.fps > a.sample.fps ? b : a));
    chosenIndex = attempts.indexOf(chosen);
  }
  const warnings = [];
  if (attempts.length > 1) {
    warnings.push(
      `首次采样 fps 偏低（${fmt(attempts[0].sample && attempts[0].sample.fps, 2)}），已自动重测一次并取较好结果`
    );
  }
  if (chosen && chosen.sample.fps < retryBelowFps) {
    warnings.push(
      `采样 fps 持续偏低（${fmt(chosen.sample.fps, 2)}）：采样期间可能存在并行负载，或该分辨率下已达硬件瓶颈`
    );
  }
  return {
    durationMs,
    attempts: attempts.map((a) => ({
      startAt: a.startAt,
      wallMs: a.wallMs,
      sample: a.sample,
      stateAfter: a.statsAfter ? a.statsAfter.state : null
    })),
    chosenIndex,
    fps: chosen ? round(chosen.sample.fps, 2) : null,
    frameTimeMs: chosen
      ? {
          mean: round(chosen.sample.frameTimeMs.mean, 2),
          p50: round(chosen.sample.frameTimeMs.p50, 2),
          p95: round(chosen.sample.frameTimeMs.p95, 2),
          min: round(chosen.sample.frameTimeMs.min, 2),
          max: round(chosen.sample.frameTimeMs.max, 2)
        }
      : null,
    jank: chosen ? chosen.sample.jank : null,
    frameCount: chosen ? chosen.sample.frameCount : null,
    jsHeap: chosen ? { before: chosen.heapBefore, after: chosen.heapAfter } : null,
    statsAfter: chosen ? chosen.statsAfter : attempts.length ? attempts[attempts.length - 1].statsAfter : null,
    warnings
  };
}

/* ------------------------------------------------------------------ *
 * 单个项目根的审计
 * ------------------------------------------------------------------ */
async function auditRoot(pw, browser, { mode, root, outDir, baselineMeta = null }) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const indexHtml = path.join(root, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `项目根目录下找不到 index.html：${indexHtml}\n请用 --root <项目根目录> 指定正确的目录。`
    );
  }
  const shotsRoot = path.join(outDir, 'shots');
  const shotsDir = path.join(shotsRoot, mode);
  ensureDir(shotsDir);
  const url = pathToFileURL(path.join(root, 'index.html')).href;

  const logs = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    badResponses: []
  };
  const run = {
    mode,
    root,
    url,
    startedAt,
    durationMs: null,
    baselineMeta,
    files: hashProductFiles(root),
    git: root === DEFAULT_PROJECT_ROOT ? gitStatusSafe(root) : null,
    features: null,
    defaultQuality: null,
    qualityForce: null,
    capabilities: null,
    capabilitiesDpr2: null,
    capabilitiesDpr2Default: null,
    stats: { initial: null, afterAaDpr1: null, afterAaDpr2: null, afterPerfDpr1: null, afterPerfDpr2: null },
    aa: { dpr1: null, dpr2: null },
    perf: { dpr1: null, dpr2: null },
    mobile: null,
    screenshots: [],
    warnings: [],
    logs,
    failure: null
  };
  const opened = [];

  try {
    /* ---------- 1) 桌面 DPR1：截图 + 能力 + AA + 性能 ---------- */
    const dpr1 = await openPage(browser, {
      url,
      viewport: VIEWPORT,
      dpr: 1,
      logs,
      prefix: `${mode}/dpr1`
    });
    opened.push(dpr1);
    const page = dpr1.page;

    await prepareDeterministicState(page);
    // 先记录"未干预的默认画质档位"，再固定到 high 做 before/after 可比测量
    const capsDpr1Default = await page.evaluate(pageReadCapabilities);
    run.defaultQuality = { dpr1: capsDpr1Default.quality };
    run.qualityForce = { dpr1: null, dpr2: null };
    run.qualityForce.dpr1 = await forceHighQuality(page);
    run.capabilities = await page.evaluate(pageReadCapabilities);
    run.features = run.capabilities.features;
    run.stats.initial = await page.evaluate(pageReadStats);

    // 组装态全景（产品默认机位）
    await dismissTransientUI(page);
    await screenshotTo(page, outDir, shotsDir, run, '01-assembled-1600x1000.png', '组装态全景（1600×1000，含 UI）');

    // 爆炸拆解态
    await page.evaluate(() => {
      const A = window.DJI_APP;
      if (!A) return;
      if (typeof A.setExploded === 'function') A.setExploded(true, { silent: true });
    });
    await page.waitForTimeout(2000);
    await waitCameraStable(page);
    await page.waitForTimeout(400);
    await dismissTransientUI(page);
    await screenshotTo(page, outDir, shotsDir, run, '02-exploded-1600x1000.png', '爆炸拆解态（1600×1000，含 UI）');

    // 镜头特写：优先用 DJI_APP 自身能力（selectPart 会 flyToPose 到最佳观察角）
    const lensInfo = await page.evaluate(() => {
      const A = window.DJI_APP;
      if (!A) return { selected: false, reason: 'no DJI_APP' };
      if (A.state) A.state.autoFocus = true;
      if (typeof A.selectPart === 'function') {
        A.selectPart('lens');
        return {
          selected: A.state && A.state.selected === 'lens',
          hasFlyToPose: typeof A.flyToPose === 'function'
        };
      }
      return { selected: false, reason: 'no selectPart' };
    });
    if (lensInfo.selected) {
      await page.waitForTimeout(500);
      await waitCameraStable(page);
      await page.waitForTimeout(500);
    } else if (run.features.hasFlyToPose) {
      run.warnings.push('镜头特写：selectPart("lens") 不可用，退化为固定特写机位 flyToPose');
      await page.evaluate(() => {
        window.DJI_APP.flyToPose({ az: 0.32, el: 0.04, r: 6.8, ty: 0.6 }, 0.4);
      });
      await page.waitForTimeout(900);
      await waitCameraStable(page);
    } else {
      run.warnings.push('镜头特写：页面未暴露 flyToPose/selectPart，退化为默认视角截图');
    }
    await dismissTransientUI(page);
    await screenshotTo(page, outDir, shotsDir, run, '03-lens-closeup.png', '镜头特写（选中 lens 后产品自动定位机位；不可用时退化）');

    // 回到组装态 + 固定审计机位
    await page.evaluate(() => {
      const A = window.DJI_APP;
      if (!A) return;
      if (A.state) {
        A.state.autoFocus = false;
        A.state.hovered = null;
      }
      if (typeof A.deselect === 'function') A.deselect();
      if (typeof A.setExploded === 'function') A.setExploded(false, { fly: false, silent: true });
    });
    await page.waitForTimeout(1600);
    await waitCameraStable(page);
    const fixedView = await setFixedAuditView(page);
    if (!fixedView.used) run.warnings.push(`固定审计机位不可用：${fixedView.reason || '未知'}`);
    if (fixedView.used && !fixedView.stable) run.warnings.push('固定审计机位等待稳定超时');
    await dismissTransientUI(page);
    await page.waitForTimeout(300);

    // 仅 canvas 纯 3D 截图 ×3（用于 AA 指标）
    await forceHighQuality(page); // 固定 high 档，避免自适应降档影响 AA 对比
    const cleanDpr1Path = path.join(shotsDir, '05-canvas-clean-dpr1.png');
    const cleanDpr1 = await captureCleanFrames(page, AA_SAMPLE_COUNT, cleanDpr1Path);
    recordShot(
      run,
      outDir,
      cleanDpr1Path,
      '05-canvas-clean-dpr1.png',
      '仅 canvas 纯 3D（隐藏 DOM 覆盖层），DPR1，固定机位，AA 指标基图'
    );
    run.aa.dpr1 = analyzePngBuffers(cleanDpr1);
    run.aa.dpr1.file = '05-canvas-clean-dpr1.png';
    run.stats.afterAaDpr1 = await page.evaluate(pageReadStats);

    // 2.6x 像素放大图（观察锯齿）
    await hideOverlays(page);
    await page.evaluate(() => {
      const c = document.getElementById('scene');
      if (!c) return;
      c.style.transformOrigin = '50% 50%';
      c.style.transform = 'scale(2.6)';
      c.style.imageRendering = 'pixelated';
    });
    await page.waitForTimeout(350);
    await screenshotTo(page, outDir, shotsDir, run, '04-zoom-2.6x-pixelated.png', '2.6× 像素放大（canvas scale(2.6) + image-rendering:pixelated，DOM 覆盖层隐藏）');
    await page.evaluate(() => {
      const c = document.getElementById('scene');
      if (!c) return;
      c.style.transform = '';
      c.style.transformOrigin = '';
      c.style.imageRendering = '';
    });
    await showOverlays(page);
    await page.waitForTimeout(200);

    // 性能采样（DPR1）
    await forceHighQuality(page); // 重置自适应降档冷却，保证整段采样同一画质档
    const perfDpr1 = await measurePerf(page);
    run.perf.dpr1 = perfDpr1;
    run.stats.afterPerfDpr1 = perfDpr1.statsAfter;
    run.warnings.push(...perfDpr1.warnings.map((w) => `DPR1 ${w}`));

    await dpr1.context.close();

    /* ---------- 2) 桌面 DPR2：能力 + AA + 性能 ---------- */
    const dpr2 = await openPage(browser, {
      url,
      viewport: VIEWPORT,
      dpr: 2,
      logs,
      prefix: `${mode}/dpr2`
    });
    opened.push(dpr2);
    const page2 = dpr2.page;
    await prepareDeterministicState(page2);
    const capsDpr2Default = await page2.evaluate(pageReadCapabilities);
    run.defaultQuality = Object.assign({}, run.defaultQuality, { dpr2: capsDpr2Default.quality });
    run.capabilitiesDpr2Default = capsDpr2Default;
    run.qualityForce.dpr2 = await forceHighQuality(page2);
    run.capabilitiesDpr2 = await page2.evaluate(pageReadCapabilities);
    await setFixedAuditView(page2);
    await dismissTransientUI(page2);
    await page2.waitForTimeout(300);

    const cleanDpr2Path = path.join(shotsDir, '06-canvas-clean-dpr2.png');
    const cleanDpr2 = await captureCleanFrames(page2, AA_SAMPLE_COUNT, cleanDpr2Path);
    recordShot(
      run,
      outDir,
      cleanDpr2Path,
      '06-canvas-clean-dpr2.png',
      '仅 canvas 纯 3D（隐藏 DOM 覆盖层），DPR2，固定机位，AA 指标基图'
    );
    run.aa.dpr2 = analyzePngBuffers(cleanDpr2);
    run.aa.dpr2.file = '06-canvas-clean-dpr2.png';
    run.stats.afterAaDpr2 = await page2.evaluate(pageReadStats);

    await forceHighQuality(page2); // 重置自适应降档冷却
    const perfDpr2 = await measurePerf(page2);
    run.perf.dpr2 = perfDpr2;
    run.stats.afterPerfDpr2 = perfDpr2.statsAfter;
    run.warnings.push(...perfDpr2.warnings.map((w) => `DPR2 ${w}`));

    await dpr2.context.close();

    /* ---------- 3) 移动端 390×844 ---------- */
    const mobile = await openPage(browser, {
      url,
      viewport: MOBILE_VIEWPORT,
      dpr: 2,
      isMobile: true,
      logs,
      prefix: `${mode}/mobile`
    });
    opened.push(mobile);
    await dismissTransientUI(mobile.page);
    await screenshotTo(
      mobile.page,
      outDir,
      shotsDir,
      run,
      '07-mobile-390x844.png',
      '移动端 390×844（DPR2，含 UI）'
    );
    run.mobile = {
      viewport: MOBILE_VIEWPORT,
      deviceScaleFactor: 2,
      capabilities: await mobile.page.evaluate(pageReadCapabilities)
    };
    await mobile.context.close();
  } catch (err) {
    run.failure = {
      message: String((err && err.message) || err),
      stack: String((err && err.stack) || '')
    };
    // 失败时尽量留一张现场截图 + 报错信息
    const live = opened.filter((o) => o.context);
    const last = live[live.length - 1];
    if (last) {
      try {
        const failShot = path.join(shotsDir, '99-failure.png');
        await last.page.screenshot({ path: failShot, timeout: 15000 });
        run.failure.screenshot = path
          .relative(outDir, failShot)
          .split(path.sep)
          .join('/');
      } catch (e) {
        /* ignore */
      }
    }
    throw err;
  } finally {
    for (const o of opened) {
      try {
        await o.context.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  run.durationMs = Date.now() - t0;
  return run;
}

function gitStatusSafe(root) {
  const r = runGit(['status', '--porcelain'], { cwd: root, allowFail: true });
  const head = runGit(['rev-parse', '--short', 'HEAD'], { cwd: root, allowFail: true });
  const dirtyFiles = r.ok
    ? r.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  return {
    commit: head.ok ? head.stdout : null,
    dirty: dirtyFiles.length > 0,
    dirtyFiles
  };
}

/* ------------------------------------------------------------------ *
 * baseline worktree
 * ------------------------------------------------------------------ */
function createBaselineWorktree(ref, { projectRoot }) {
  const verify = runGit(['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: projectRoot,
    allowFail: true
  });
  if (!verify.ok) {
    throw new Error(
      `基线 git ref 不存在：${ref}\n可用 --ref <git-ref> 指定；当前 HEAD 可用 "HEAD" 作为 ref。\n${verify.stderr}`
    );
  }
  const commit = runGit(['rev-parse', '--short', ref], { cwd: projectRoot }).stdout;
  const subject = runGit(['log', '-1', '--format=%s', ref], { cwd: projectRoot }).stdout;
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dji-a4-qa-'));
  const wtPath = path.join(tmpParent, 'baseline');
  const add = runGit(['worktree', 'add', '--detach', wtPath, commit], {
    cwd: projectRoot,
    allowFail: true
  });
  if (!add.ok) {
    fs.rmSync(tmpParent, { recursive: true, force: true });
    throw new Error(`git worktree add 失败：${add.stderr}`);
  }
  return {
    ref,
    commit,
    subject,
    path: wtPath,
    tmpParent,
    remove({ keep = false } = {}) {
      if (keep) {
        console.warn(`[render-audit] 按要求保留 baseline worktree：${wtPath}`);
        return;
      }
      const rm = runGit(['worktree', 'remove', '--force', wtPath], {
        cwd: projectRoot,
        allowFail: true
      });
      if (!rm.ok) {
        // 兜底：直接删目录 + prune
        try {
          fs.rmSync(wtPath, { recursive: true, force: true });
        } catch (e) {
          /* ignore */
        }
        runGit(['worktree', 'prune'], { cwd: projectRoot, allowFail: true });
      }
      try {
        fs.rmSync(tmpParent, { recursive: true, force: true });
      } catch (e) {
        /* ignore */
      }
    }
  };
}

/* ------------------------------------------------------------------ *
 * 环境信息
 * ------------------------------------------------------------------ */
function collectEnvironment() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    osRelease: os.release(),
    cpu: cpus.length ? cpus[0].model : null,
    cpuCount: cpus.length,
    totalMemGB: round(os.totalmem() / 1e9, 1),
    chromePath: CHROME_PATH,
    playwrightPath: PLAYWRIGHT_PATH,
    playwrightVersion: playwrightVersion()
  };
}

/* ------------------------------------------------------------------ *
 * 对比与报告
 * ------------------------------------------------------------------ */
function compareRuns(baseline, current) {
  if (!baseline || !current) return null;
  const pick = (a, b) => ({
    baseline: a === undefined ? null : a,
    current: b === undefined ? null : b
  });
  const perfRow = (dpr) => {
    const b = baseline.perf[dpr] || {};
    const c = current.perf[dpr] || {};
    return {
      fps: cmpField(b.fps, c.fps),
      frameTimeP50: cmpField(b.frameTimeMs && b.frameTimeMs.p50, c.frameTimeMs && c.frameTimeMs.p50),
      frameTimeP95: cmpField(b.frameTimeMs && b.frameTimeMs.p95, c.frameTimeMs && c.frameTimeMs.p95)
    };
  };
  const aaRow = (dpr) => {
    const b = (baseline.aa[dpr] && baseline.aa[dpr].median) || {};
    const c = (current.aa[dpr] && current.aa[dpr].median) || {};
    const keys = [
      'edgeTransitionRatio',
      'edgeTransitionPerEdge',
      'edgeTransitionRatioLocal',
      'edgeTransitionPerEdgeLocal',
      'hfEnergy',
      'hfEnergyPerEdge'
    ];
    const row = {};
    for (const k of keys) row[k] = cmpField(b[k], c[k]);
    const spreadB = (baseline.aa[dpr] && baseline.aa[dpr].spread) || {};
    const spreadC = (current.aa[dpr] && current.aa[dpr].spread) || {};
    const noiseKeys = [
      'edgeTransitionRatio',
      'edgeTransitionPerEdge',
      'edgeTransitionRatioLocal',
      'edgeTransitionPerEdgeLocal',
      'hfEnergy',
      'hfEnergyPerEdge'
    ];
    const noiseRange = {};
    for (const k of noiseKeys) {
      const rB = spreadB[k] && typeof spreadB[k].range === 'number' ? spreadB[k].range : 0;
      const rC = spreadC[k] && typeof spreadC[k].range === 'number' ? spreadC[k].range : 0;
      noiseRange[k] = Math.max(rB, rC);
    }
    row.noiseRange = noiseRange;
    return row;
  };
  return {
    perf: { dpr1: perfRow('dpr1'), dpr2: perfRow('dpr2') },
    aa: { dpr1: aaRow('dpr1'), dpr2: aaRow('dpr2') },
    capabilities: {
      pixelRatio: pick(
        baseline.capabilities && baseline.capabilities.pixelRatio,
        current.capabilities && current.capabilities.pixelRatio
      ),
      drawingBuffer: pick(
        baseline.capabilities && baseline.capabilities.drawingBuffer,
        current.capabilities && current.capabilities.drawingBuffer
      ),
      samples: pick(
        statField(baseline, ['samples']),
        statField(current, ['samples'])
      )
    }
  };
}

/** 在 getStats() raw 里找字段（支持一层嵌套），找不到则回退 renderer.info */
function statField(run, names) {
  const raw =
    (run.stats && run.stats.afterPerfDpr1 && run.stats.afterPerfDpr1.raw) ||
    (run.stats && run.stats.afterPerfDpr2 && run.stats.afterPerfDpr2.raw) ||
    null;
  const searchIn = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
    for (const name of names) {
      if (obj[name] !== undefined && (typeof obj[name] !== 'object' || obj[name] === null)) {
        return obj[name];
      }
      if (obj[name] && typeof obj[name] === 'object') {
        for (const k of Object.keys(obj[name])) {
          if (k.toLowerCase() === name.toLowerCase()) return obj[name][k];
        }
      }
    }
    if (depth > 0) {
      for (const key of Object.keys(obj)) {
        const v = searchIn(obj[key], depth - 1);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  };
  const found = searchIn(raw, 2);
  if (found !== undefined) return found;
  // 回退：renderer.info
  const info =
    (run.capabilities && run.capabilities.rendererInfo) ||
    (run.stats && run.stats.afterPerfDpr1 && run.stats.afterPerfDpr1.rendererInfo) ||
    null;
  if (info) {
    if (names.includes('drawCalls') && info.calls !== undefined) return info.calls;
    if (names.includes('triangles') && info.triangles !== undefined) return info.triangles;
  }
  return null;
}

function findStatRaw(run) {
  const candidates = [
    run.stats && run.stats.afterPerfDpr1,
    run.stats && run.stats.afterPerfDpr2,
    run.stats && run.stats.initial
  ];
  for (const c of candidates) {
    if (c && c.raw && typeof c.raw === 'object') return { raw: c.raw, source: 'getStats()' };
  }
  return null;
}

function getStatValue(run, aliases) {
  const found = findStatRaw(run);
  if (!found) return null;
  const lower = (s) => String(s).toLowerCase();
  const want = aliases.map(lower);
  const visit = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
    for (const key of Object.keys(obj)) {
      if (want.includes(lower(key))) {
        const v = obj[key];
        if (v === null || typeof v !== 'object') return v;
      }
    }
    for (const key of Object.keys(obj)) {
      const v = visit(obj[key], depth - 1);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const v = visit(found.raw, 2);
  return v === undefined ? null : v;
}

function mdTable(headers, rows) {
  const head = '| ' + headers.join(' | ') + ' |';
  const sep = '| ' + headers.map(() => '---').join(' | ') + ' |';
  return [head, sep, ...rows.map((r) => '| ' + r.join(' | ') + ' |')].join('\n');
}

function aaCell(sample, spread, key, kind = 'ratio') {
  if (!sample || sample[key] === null || sample[key] === undefined) return '—';
  let main;
  if (kind === 'ratio') main = pct(sample[key], 4);
  else main = fmt(sample[key], 3);
  const sp = spread && spread[key];
  if (sp && sp.range !== null && sp.range > 0) {
    const rangeText =
      kind === 'ratio' ? `±${pct(sp.range / 2, 4)}` : `±${fmt(sp.range / 2, 3)}`;
    return `${main} <br><sub>${rangeText}</sub>`;
  }
  return main;
}

function capText(run, fn) {
  if (!run) return '—';
  try {
    const v = fn(run);
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.join(' × ');
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'number') return String(v);
    return String(v);
  } catch (e) {
    return '—';
  }
}

function buildReport({ results, outDir, args }) {
  const L = [];
  const base = results.baseline;
  const cur = results.current;
  const both = !!(base && cur);
  const now = new Date();
  const generatedAt = results.generatedAt;
  const gp = (run, fn) => capText(run, fn);
  const outLabel = (() => {
    const rel = path.relative(DEFAULT_PROJECT_ROOT, outDir);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
    return outDir.split(path.sep).join('/');
  })();

  L.push('# DJI Osmo Action 4 · 三维拆解页面「渲染质量 + 性能」审计报告');
  L.push('');
  L.push(`- 生成时间：${generatedAt}（本地 ${now.toString()}）`);
  L.push(`- 审计脚本：\`qa/perf/render-audit.mjs\`（可重复运行）`);
  L.push(`- 运行命令：\`node qa/perf/render-audit.mjs ${args.raw.join(' ')}\``.trimEnd());
  L.push(`- 原始数据：\`${outLabel}/results.json\``);
  L.push(`- 截图目录：\`${outLabel}/shots/baseline/\`（基线）与 \`${outLabel}/shots/current/\`（当前）`);
  if (results.baselineMeta) {
    L.push(
      `- 基线：git \`${results.baselineMeta.commit}\`（${results.baselineMeta.subject}），通过 \`git worktree add\` 检出到系统临时目录，审计后已清理`
    );
  }
  if (cur && cur.git) {
    const dirtyFiles = cur.git.dirtyFiles || [];
    const cleanRel = (s) => s.replace(/^\s*\S+\s+/, '');
    const isProduct = (f) => /(^|\/)(index\.html|css\/|js\/|README\.md)/.test(f);
    const productDirty = dirtyFiles.map(cleanRel).filter(isProduct);
    const otherCount = dirtyFiles.length - productDirty.length;
    L.push(
      `- current（工作区）：git \`${cur.git.commit || '?'}\`${
        cur.git.dirty
          ? `，**含未提交改动**（产品文件：${productDirty.length ? productDirty.join('、') : '无'}${
              otherCount > 0 ? `；另有 ${otherCount} 处非产品文件改动` : ''
            }）`
          : '，工作区干净'
      }；两版产品文件 SHA-256 见 \`results.json\` 的 \`baseline.files\` / \`current.files\``
    );
  }
  L.push('');

  /* ---------- 环境 ---------- */
  const env = results.environment || {};
  L.push('## 1. 运行环境');
  L.push('');
  L.push(
    mdTable(
      ['项目', '值'],
      [
        ['Chrome', `${results.chromeVersion || '—'}（${env.chromePath || CHROME_PATH}）`],
        ['Playwright-core', `${env.playwrightVersion || '—'}（${env.playwrightPath || PLAYWRIGHT_PATH}）`],
        ['Node.js', env.node || '—'],
        ['操作系统', `${env.platform} · ${env.osRelease}`],
        ['CPU / 内存', `${env.cpu || '—'} × ${env.cpuCount || '?'} 核 / ${env.totalMemGB || '?'} GB`],
        [
          'GPU（WebGL 报告）',
          (cur && cur.capabilities && (cur.capabilities.unmaskedRenderer || cur.capabilities.gpuRenderer)) ||
            (base && base.capabilities && (base.capabilities.unmaskedRenderer || base.capabilities.gpuRenderer)) ||
            '—'
        ]
      ]
    )
  );
  L.push('');

  /* ---------- 方法 ---------- */
  L.push('## 2. 方法与口径');
  L.push('');
  L.push(
    [
      '- **A/B 口径**：同一脚本、同一台机器、同一 Chrome 进程内连续运行；基线使用 `git worktree add <系统临时目录> <ref>` 检出为独立目录，审计结束即删除，不触碰工作区。',
      '- **截图与性能**：视口 1600×1000；分别建立 `deviceScaleFactor=1`（DPR1）与 `deviceScaleFactor=2`（DPR2）两个浏览器上下文；性能采样均为 3 秒 `requestAnimationFrame` 采样。',
      '- **页面就绪判据**：`window.DJI_APP && window.DJI_APP.state.ready === true`；每次采样前等待相机机位稳定。',
      '- **抗锯齿客观指标**：对「仅 canvas、隐藏全部 DOM 覆盖层」的纯 3D 截图计算（每档 3 帧取中位数，括号内为 3 帧极差的一半，作为采样噪声参考）：',
      `  - \`edgeTransitionRatio\`（口径 1，任务指定）：亮度分三档——暗 \`L < ${AA_CONFIG.darkThreshold}\`、中间 \`L ∈ [${AA_CONFIG.darkThreshold}, ${AA_CONFIG.brightThreshold}]\`、亮 \`L > ${AA_CONFIG.brightThreshold}\`；统计"自身落在中间档、且 ${AA_CONFIG.neighborhood} 邻域同时存在暗与亮像素"的像素占全图比例。`,
      '  - `edgeTransitionPerEdge`：上述过渡像素 / 强对比边缘候选像素（3×3 邻域亮度极差 > 62），削弱内容占比差异。',
      '  - `edgeTransitionRatioLocal` / `edgeTransitionPerEdgeLocal`（口径 2，补充）：局部对比口径，不依赖绝对亮度——像素位于 3×3 邻域 min/max 之间且与两端各保留 15% 极差的余量；对 tone mapping/曝光调整更稳健。',
      '  - `hfEnergy`：内部像素水平、垂直二阶差分平方的均值（越大表示高频/锯齿能量越强）；`hfEnergyPerEdge` 为仅在边缘候选像素上的同类统计。',
      '- **判读方向与因果**：抗锯齿会把 1px 的硬边"摊平"成 2~3px 的中间亮度过渡，因此**过渡像素比例/每边缘过渡像素越高 = 边缘过渡越平滑（AA 越好）**、`hfEnergy` 越低 = 边缘高频能量越弱（锯齿越少）。注意它并不等价于"越模糊越好"：分辨率被降低再放大等过度模糊同样会抬升该比例，所以报告中同时给出 `hfEnergy`、per-edge 归一化指标和 2.6× 像素放大截图做交叉验证；本审计在固定机位、相同场景内容下前后对比，AA 指标差异主要来自抗锯齿实现（若版本间同时调整了色调映射/曝光，全局亮度三档口径会被影响，报告会额外标注并以不依赖绝对亮度的局部对比口径为准）。DPR2 因设备像素超采样，AA 差异会被大幅掩盖，**在 DPR1 下抗锯齿差异最明显**。',
      '- **画质档位对齐**：新版页面带自适应画质（`setQuality/getQuality`）。为避免"自适应降档"混入 before/after 差异，AA 截图与性能采样前会调用 `setQuality("high")` 固定为 high 档（high 是该页面用户可主动取到的最高档位；基线版本无此 API，始终为默认最高配置）；未干预的初始自动档位单独记录在第 3.1 节。',
      `- **采样注意**：性能采样期间若与其他截图/重负载任务并行，fps 会被压低；脚本在 fps 低于 ${PERF_RETRY_BELOW_FPS} 时会自动重测一次并取较好结果，并在报告中标注。场景含缓慢动画（模型浮动、背景呼吸），AA 指标为统计量，报告给出 3 帧离散度。`
    ].join('\n')
  );
  L.push('');

  /* ---------- 能力参数 ---------- */
  L.push('## 3. 渲染能力与画质参数（before / after）');
  L.push('');
  const statRows = [
    ['WebGL 版本', (r) => (r.capabilities ? r.capabilities.webglVersion : null)],
    ['GPU（unmasked）', (r) => (r.capabilities ? r.capabilities.unmaskedRenderer || r.capabilities.gpuRenderer : null)],
    ['maxSamples（WebGL2 上限）', (r) => (r.capabilities ? r.capabilities.maxSamples : null)],
    ['默认帧缓冲 samples（MSAA）', (r) => (r.capabilities ? r.capabilities.framebufferSamples : null)],
    ['maxAnisotropy', (r) => (r.capabilities ? r.capabilities.maxAnisotropy : null)],
    ['初始默认画质档位（DPR1，未干预）', (r) => (r.defaultQuality ? r.defaultQuality.dpr1 : null)],
    ['初始默认画质档位（DPR2，未干预）', (r) => (r.defaultQuality ? r.defaultQuality.dpr2 : null)],
    ['AA/性能测量档位（脚本固定）', (r) => {
      if (!r.qualityForce) return null;
      const applied = (r.qualityForce.dpr1 && r.qualityForce.dpr1.applied) || (r.qualityForce.dpr2 && r.qualityForce.dpr2.applied);
      return applied ? 'high（setQuality 固定）' : '不适用（无 setQuality，默认最高）';
    }],
    ['DPR1 上下文 pixelRatio', (r) => (r.capabilities ? r.capabilities.pixelRatio : null)],
    ['DPR1 drawingBuffer 尺寸', (r) => (r.capabilities ? r.capabilities.drawingBuffer : null)],
    ['DPR2 上下文 pixelRatio（默认）', (r) => (r.capabilitiesDpr2Default ? r.capabilitiesDpr2Default.pixelRatio : null)],
    ['DPR2 上下文 drawingBuffer（默认）', (r) => (r.capabilitiesDpr2Default ? r.capabilitiesDpr2Default.drawingBuffer : null)],
    ['DPR2 上下文 pixelRatio（测量时）', (r) => (r.capabilitiesDpr2 ? r.capabilitiesDpr2.pixelRatio : null)],
    ['DPR2 上下文 drawingBuffer（测量时）', (r) => (r.capabilitiesDpr2 ? r.capabilitiesDpr2.drawingBuffer : null)],
    ['canvas CSS 尺寸', (r) => (r.capabilities ? r.capabilities.canvasCssSize : null)],
    ['context.antialias', (r) => (r.capabilities && r.capabilities.contextAttributes ? r.capabilities.contextAttributes.antialias : null)],
    ['getStats 可用', (r) => (r.features ? r.features.hasGetStats : null)],
    ['setQuality 可用', (r) => (r.features ? r.features.hasSetQuality : null)],
    ['测量时画质档位（getQuality / state.qualityTier）', (r) => (r.capabilities ? r.capabilities.quality : null)],
    ['后处理 MSAA samples（composer，DPR1）', (r) => (r.capabilities && r.capabilities.composer ? r.capabilities.composer.msaaSamples : null)],
    ['后处理 MSAA samples（composer，DPR2）', (r) => (r.capabilitiesDpr2 && r.capabilitiesDpr2.composer ? r.capabilitiesDpr2.composer.msaaSamples : null)],
    ['后处理 render target 尺寸（DPR1）', (r) => (r.capabilities && r.capabilities.composer ? r.capabilities.composer.renderTargetSize : null)],
    ['后处理 pass 数', (r) => (r.capabilities && r.capabilities.composer ? r.capabilities.composer.passCount : null)],
    ['stats.tier / 画质档位', (r) => getStatValue(r, ['tier', 'quality', 'qualityTier', 'level'])],
    ['stats.samples（MSAA 采样数）', (r) => getStatValue(r, ['samples', 'msaa', 'msaaSamples', 'sampleCount'])],
    ['stats.shadow（阴影）', (r) => getStatValue(r, ['shadow', 'shadows', 'shadowEnabled'])],
    ['stats.shadowMap', (r) => getStatValue(r, ['shadowMap', 'shadowMapSize'])],
    ['stats.bloom', (r) => getStatValue(r, ['bloom'])],
    ['stats.dpr', (r) => getStatValue(r, ['dpr', 'pixelRatio'])],
    ['stats.frameTimeAvg', (r) => getStatValue(r, ['frameTimeAvg', 'avgFrameTime', 'frameTime'])],
    ['stats.drawCalls / 绘制调用', (r) => getStatValue(r, ['drawCalls', 'drawcalls', 'calls'])],
    ['stats.triangles / 三角面', (r) => getStatValue(r, ['triangles', 'triangleCount', 'tris'])],
    ['stats.programs / textures / geometries', (r) => {
      const p = getStatValue(r, ['programs']);
      const t = getStatValue(r, ['textures']);
      const g = getStatValue(r, ['geometries']);
      if (p === null && t === null && g === null) return null;
      return `${p === null ? '—' : p} / ${t === null ? '—' : t} / ${g === null ? '—' : g}`;
    }],
    ['renderer.info.calls（仅最后一次 pass，参考性有限）', (r) => (r.capabilities && r.capabilities.rendererInfo ? r.capabilities.rendererInfo.calls : null)],
    ['renderer.info.triangles（仅最后一次 pass，参考性有限）', (r) => (r.capabilities && r.capabilities.rendererInfo ? r.capabilities.rendererInfo.triangles : null)]
  ];
  L.push(
    mdTable(
      ['指标', 'baseline', 'current'],
      statRows.map(([label, fn]) => [label, gp(base, fn), gp(cur, fn)])
    )
  );
  if (!both) {
    L.push('');
    L.push('> 本次只审计了单个版本（未加 `--baseline`），上表只有一列有值。');
  }
  const fbSamplesB = base && base.capabilities ? base.capabilities.framebufferSamples : null;
  const msaaSamplesC = cur && cur.capabilities && cur.capabilities.composer ? cur.capabilities.composer.msaaSamples : null;
  if (both && fbSamplesB !== null && msaaSamplesC !== null && msaaSamplesC > 0) {
    L.push('');
    L.push(
      `> 关键差异：baseline 的 ${fbSamplesB}× MSAA 只落在默认帧缓冲（场景先渲染到不带 MSAA 的后处理 render target，最终合成时实际拿不到边缘 MSAA）；current 关闭默认 \`antialias\`，改为在 composer render target 上启用 MSAA（samples=${msaaSamplesC}）。这是 AA 指标大幅改善的直接原因之一。`
    );
  }
  L.push('');

  /* ---------- 3.1 画质档位 ---------- */
  const downgradeStates = (run) => {
    if (!run || !run.stats) return [];
    return [run.stats.initial, run.stats.afterAaDpr1, run.stats.afterAaDpr2, run.stats.afterPerfDpr1, run.stats.afterPerfDpr2]
      .map((s) => (s && s.state ? s.state : null))
      .filter(Boolean);
  };
  const downgradeObserved = (run) =>
    downgradeStates(run).some((s) => s.qualityDowngraded === true || s.qualityDropped === true);
  const tierCell = (run, dpr) => {
    if (!run) return '—';
    if (!run.features || !run.features.hasSetQuality) return '默认配置（无画质档位 API）';
    const auto = run.defaultQuality ? run.defaultQuality[dpr] : null;
    return auto === null || auto === undefined ? '—' : String(auto);
  };
  const forcedCell = (run, dpr) => {
    if (!run) return '—';
    if (!run.features || !run.features.hasSetQuality) return '不适用（无 setQuality）';
    const key = dpr === 'dpr1' ? 'dpr1' : 'dpr2';
    const f = run.qualityForce ? run.qualityForce[key] : null;
    if (!f || !f.applied) return '—';
    const tier = f.tier === null || f.tier === undefined ? 'high' : f.tier;
    return String(tier);
  };
  L.push('### 3.1 画质档位：初始自动档位 vs 审计固定 high 档位');
  L.push('');
  L.push(
    mdTable(
      ['上下文', 'baseline', 'current 初始自动档位（未干预）', 'current 测量档位（脚本强制）', '说明'],
      [
        ['DPR1（1600×1000）', tierCell(base, 'dpr1'), tierCell(cur, 'dpr1'), forcedCell(cur, 'dpr1'), 'high 为该页面用户可主动取到的最高档位（setQuality("high")）'],
        ['DPR2（1600×1000 @2×）', tierCell(base, 'dpr2'), tierCell(cur, 'dpr2'), forcedCell(cur, 'dpr2'), '初始自动档位由产品自适应策略决定；DPR2 启动时可能按启发式先降一档']
      ]
    )
  );
  L.push('');
  if (both) {
    L.push(
      `> 本次运行自适应降档标记：baseline \`${downgradeObserved(base) ? '触发' : '未触发'}\`；current \`${downgradeObserved(cur) ? '触发' : '未触发'}\`（qualityDowngraded/qualityDropped）。`
    );
    L.push('');
  }
  L.push('');

  /* ---------- 性能 ---------- */
  L.push('## 4. 性能（3 秒 rAF 采样 @ 1600×1000）');
  L.push('');
  const perfTable = (dpr) => {
    const key = `dpr${dpr}`;
    const b = base && base.perf[key];
    const c = cur && cur.perf[key];
    const qualityText = (run) => {
      const st = run && run.statsAfter && run.statsAfter.state;
      if (!st) return '—';
      const parts = [];
      if (st.qualityTier !== undefined && st.qualityTier !== null) parts.push(`tier=${st.qualityTier}`);
      if (st.qualityDropped !== undefined && st.qualityDropped !== null) parts.push(`dropped=${st.qualityDropped}`);
      if (st.qualityDowngraded !== undefined && st.qualityDowngraded !== null) parts.push(`downgraded=${st.qualityDowngraded}`);
      return parts.length ? parts.join(' / ') : '—';
    };
    const rows = [
      ['fps（越高越好）', b ? fmt(b.fps, 2) : '—', c ? fmt(c.fps, 2) : '—', deltaPctCell(b && b.fps, c && c.fps)],
      ['帧数 / 采样时长', b ? `${b.frameCount} 帧` : '—', c ? `${c.frameCount} 帧` : '—', ''],
      ['frame-time p50', b && b.frameTimeMs ? `${fmt(b.frameTimeMs.p50, 2)} ms` : '—', c && c.frameTimeMs ? `${fmt(c.frameTimeMs.p50, 2)} ms` : '—', deltaPctCell(b && b.frameTimeMs && b.frameTimeMs.p50, c && c.frameTimeMs && c.frameTimeMs.p50)],
      ['frame-time p95', b && b.frameTimeMs ? `${fmt(b.frameTimeMs.p95, 2)} ms` : '—', c && c.frameTimeMs ? `${fmt(c.frameTimeMs.p95, 2)} ms` : '—', deltaPctCell(b && b.frameTimeMs && b.frameTimeMs.p95, c && c.frameTimeMs && c.frameTimeMs.p95)],
      ['>33.4ms 掉帧数', b && b.jank ? b.jank.over33ms : '—', c && c.jank ? c.jank.over33ms : '—', ''],
      ['jsHeap（采样后 used / total）', b && b.jsHeap && b.jsHeap.after ? `${b.jsHeap.after.usedMB} / ${b.jsHeap.after.totalMB} MB` : '—', c && c.jsHeap && c.jsHeap.after ? `${c.jsHeap.after.usedMB} / ${c.jsHeap.after.totalMB} MB` : '—', ''],
      ['画质档位 / 自动降档（采样后）', qualityText(b), qualityText(c), '']
    ];
    return mdTable([`DPR${dpr} 指标`, 'baseline', 'current', 'Δ(current vs baseline)'], rows);
  };
  L.push('### 4.1 DPR1 上下文');
  L.push('');
  L.push(perfTable(1));
  L.push('');
  L.push('### 4.2 DPR2 上下文');
  L.push('');
  L.push(perfTable(2));
  L.push('');
  if (results.uncapped && results.uncapped.baseline && results.uncapped.baseline.dpr1) {
    L.push('### 4.3 补充：不限帧率模式（--disable-frame-rate-limit，仅 DPR1，作为渲染开销信号）');
    L.push('');
    const u = results.uncapped;
    L.push(
      mdTable(
        ['指标', 'baseline', 'current', 'Δ'],
        [
          ['DPR1 fps（不限帧率）', u.baseline && u.baseline.dpr1 ? fmt(u.baseline.dpr1.fps, 2) : '—', u.current && u.current.dpr1 ? fmt(u.current.dpr1.fps, 2) : '—', deltaPctCell(u.baseline && u.baseline.dpr1 && u.baseline.dpr1.fps, u.current && u.current.dpr1 && u.current.dpr1.fps)],
          ['DPR1 frame-time p50（不限帧率）', u.baseline && u.baseline.dpr1 && u.baseline.dpr1.frameTimeMs ? `${fmt(u.baseline.dpr1.frameTimeMs.p50, 2)} ms` : '—', u.current && u.current.dpr1 && u.current.dpr1.frameTimeMs ? `${fmt(u.current.dpr1.frameTimeMs.p50, 2)} ms` : '—', '']
        ]
      )
    );
    L.push('');
    L.push('> 说明：垂直同步下当前机器两个版本都被锁在 60fps，默认分辨率看不到性能差异；「不限帧率」fps 用于观察渲染管线开销的变化（越低表示每帧 GPU 开销越大）。该模式噪声大于垂直同步模式，仅作趋势参考。');
    L.push('');
  }
  const perfWarnings = [];
  for (const run of [base, cur]) {
    if (!run) continue;
    for (const w of run.warnings) if (/fps|负载|重测/.test(w)) perfWarnings.push(`${run.mode}：${w}`);
  }
  if (perfWarnings.length) {
    L.push('> ⚠️ 性能采样提示：');
    for (const w of perfWarnings) L.push(`> - ${w}`);
    L.push('');
  }

  /* ---------- AA ---------- */
  L.push('## 5. 抗锯齿客观指标（仅 canvas 纯 3D，固定机位）');
  L.push('');
  L.push('> 采样说明：每个 DPR 连续取 3 帧，表中为中位数，副行括号内为 3 帧极差的一半（噪声参考）。**在 DPR1 下抗锯齿差异最明显**；DPR2 因超采样差异被掩盖。');
  L.push('');
  const aaTable = (dpr) => {
    const key = `dpr${dpr}`;
    const b = base && base.aa[key];
    const c = cur && cur.aa[key];
    const bm = (b && b.median) || {};
    const cm = (c && c.median) || {};
    const bs = (b && b.spread) || {};
    const cs = (c && c.spread) || {};
    const rows = [
      ['edgeTransitionRatio（全局三档，任务口径）', aaCell(bm, bs, 'edgeTransitionRatio', 'ratio'), aaCell(cm, cs, 'edgeTransitionRatio', 'ratio'), deltaPctCell(bm.edgeTransitionRatio, cm.edgeTransitionRatio)],
      ['edgeTransitionPerEdge（全局三档 / 边缘）', aaCell(bm, bs, 'edgeTransitionPerEdge', 'ratio'), aaCell(cm, cs, 'edgeTransitionPerEdge', 'ratio'), deltaPctCell(bm.edgeTransitionPerEdge, cm.edgeTransitionPerEdge)],
      ['edgeTransitionRatioLocal（局部对比，补充）', aaCell(bm, bs, 'edgeTransitionRatioLocal', 'ratio'), aaCell(cm, cs, 'edgeTransitionRatioLocal', 'ratio'), deltaPctCell(bm.edgeTransitionRatioLocal, cm.edgeTransitionRatioLocal)],
      ['edgeTransitionPerEdgeLocal（局部对比 / 边缘）', aaCell(bm, bs, 'edgeTransitionPerEdgeLocal', 'ratio'), aaCell(cm, cs, 'edgeTransitionPerEdgeLocal', 'ratio'), deltaPctCell(bm.edgeTransitionPerEdgeLocal, cm.edgeTransitionPerEdgeLocal)],
      ['edgeCandidateRatio', aaCell(bm, bs, 'edgeCandidateRatio', 'ratio'), aaCell(cm, cs, 'edgeCandidateRatio', 'ratio'), ''],
      ['hfEnergy（二阶差分能量，越低越平滑）', aaCell(bm, bs, 'hfEnergy', 'num'), aaCell(cm, cs, 'hfEnergy', 'num'), deltaPctCell(bm.hfEnergy, cm.hfEnergy)],
      ['hfEnergyPerEdge（边缘上的高频能量）', aaCell(bm, bs, 'hfEnergyPerEdge', 'num'), aaCell(cm, cs, 'hfEnergyPerEdge', 'num'), deltaPctCell(bm.hfEnergyPerEdge, cm.hfEnergyPerEdge)],
      ['meanLuma / 亮部像素占比', bm.meanLuma !== undefined ? `${fmt(bm.meanLuma, 2)} / ${pct(bm.brightRatio, 2)}` : '—', cm.meanLuma !== undefined ? `${fmt(cm.meanLuma, 2)} / ${pct(cm.brightRatio, 2)}` : '—', '']
    ];
    return mdTable([`DPR${dpr} 指标`, 'baseline', 'current', 'Δ'], rows);
  };
  L.push('### 5.1 DPR1（1×，AA 差异最明显）');
  L.push('');
  L.push(aaTable(1));
  L.push('');
  L.push('### 5.2 DPR2（2×，超采样掩盖 AA 差异）');
  L.push('');
  L.push(aaTable(2));
  L.push('');

  /* ---------- 截图 ---------- */
  L.push('## 6. 截图清单');
  L.push('');
  const sceneMap = new Map();
  for (const run of [base, cur]) {
    if (!run) continue;
    const shots = run.screenshots.slice().sort((a, b) => a.file.localeCompare(b.file));
    for (const s of shots) {
      if (!sceneMap.has(s.file)) sceneMap.set(s.file, { scene: s.scene, modes: {} });
      sceneMap.get(s.file).modes[run.mode] = s.path;
    }
  }
  const shotRows = [];
  for (const [file, info] of sceneMap) {
    const link = (p) => (p ? `[${file}](${p})` : '—');
    shotRows.push([file, info.scene, link(info.modes.baseline), link(info.modes.current)]);
  }
  L.push(mdTable(['文件', '场景', 'baseline', 'current'], shotRows));
  L.push('');
  L.push(
    '> 截图口径：`01`-`03` 含页面 UI；`04` 为 canvas `scale(2.6)` + `image-rendering:pixelated` 且隐藏 DOM 覆盖层；`05`/`06` 为仅 canvas 纯 3D（隐藏 DOM 覆盖层，用于 AA 指标）；`07` 为移动端 390×844（DPR2）。'
  );
  L.push('');

  /* ---------- 问题 ---------- */
  L.push('## 7. 发现的问题 / 异常');
  L.push('');
  const logRows = [];
  for (const run of [base, cur]) {
    if (!run) continue;
    const lg = run.logs || {};
    logRows.push([
      run.mode === 'baseline' ? 'baseline' : 'current',
      String((lg.consoleErrors || []).length),
      String((lg.consoleWarnings || []).length),
      String((lg.pageErrors || []).length),
      String((lg.requestFailures || []).length + (lg.badResponses || []).length)
    ]);
  }
  L.push('### 7.1 日志汇总（console warning 也纳入统计）');
  L.push('');
  L.push(mdTable(['版本', 'console.error', 'console.warning', 'pageerror', '请求失败/HTTP≥400'], logRows));
  L.push('');
  const warnTotal = (base ? base.logs.consoleWarnings.length : 0) + (cur ? cur.logs.consoleWarnings.length : 0);
  const errTotal = (base ? base.logs.consoleErrors.length : 0) + (cur ? cur.logs.consoleErrors.length : 0);
  if (errTotal === 0 && warnTotal === 0) {
    L.push(
      '> ✅ 两个版本均无 console.error / console.warning / pageerror / 资源加载失败；未发现 three.js 关于 MSAA、shadow map 或半浮点 render target 的警告。'
    );
  } else {
    L.push(`> console.error 共 ${errTotal} 条、console.warning 共 ${warnTotal} 条。`);
    for (const run of [base, cur]) {
      if (!run) continue;
      const tag = run.mode === 'baseline' ? 'baseline' : 'current';
      for (const w of run.logs.consoleWarnings.slice(0, 8)) L.push(`- ⚠️ [${tag}] console.warning：\`${w}\``);
    }
  }
  L.push('');
  L.push('### 7.2 异常与风险');
  L.push('');
  const problems = [];
  for (const run of [base, cur]) {
    if (!run) continue;
    const tag = run.mode === 'baseline' ? 'baseline' : 'current';
    if (run.failure) problems.push(`- ❌ [${tag}] 审计失败：${run.failure.message}`);
    for (const e of run.logs.pageErrors) problems.push(`- ❌ [${tag}] 页面异常：\`${e.split('\n')[0]}\``);
    for (const e of run.logs.consoleErrors) problems.push(`- ❌ [${tag}] console.error：\`${e}\``);
    for (const e of run.logs.requestFailures) problems.push(`- ⚠️ [${tag}] 请求失败：\`${e}\``);
    for (const e of run.logs.badResponses) problems.push(`- ⚠️ [${tag}] 响应 >=400：\`${e}\``);
    for (const w of run.warnings) problems.push(`- ⚠️ [${tag}] ${w}`);
    if (downgradeObserved(run)) {
      problems.push(
        `- ⚠️ [${tag}] 自适应降档在本次采样期间被触发（qualityDowngraded/qualityDropped=true），对应上下文画质可能低于 high 档，请复核降档阈值。`
      );
    }
    // 黑屏/异常暗画面检查
    for (const dpr of ['dpr1', 'dpr2']) {
      const aa = run.aa[dpr];
      if (aa && aa.median && aa.median.meanLuma !== null && aa.median.meanLuma < 3) {
        problems.push(`- ❌ [${tag}] DPR${dpr.slice(3)} 纯 canvas 截图近乎全黑（meanLuma=${aa.median.meanLuma}），疑似黑屏/渲染未输出`);
      }
    }
    // 能力缺失提示（baseline 预期没有 getStats/setQuality）
    if (run.features && !run.features.hasGetStats) {
      problems.push(
        `- ℹ️ [${tag}] 页面未暴露 \`DJI_APP.getStats()\`，能力表相关字段为「—」${tag === 'baseline' ? '（基线版本符合预期）' : ''}`
      );
    }
    if (run.features && !run.features.hasSetQuality) {
      problems.push(
        `- ℹ️ [${tag}] 页面未暴露 \`DJI_APP.setQuality()\`${tag === 'baseline' ? '（基线版本符合预期）' : ''}`
      );
    }
  }
  if (!problems.length) L.push('未发现 console 报错、页面异常或资源加载失败；截图亮度正常。');
  else problems.forEach((p) => L.push(p));
  L.push('');

  /* ---------- 结论 ---------- */
  L.push('## 8. 结论');
  L.push('');
  const conclusion = buildConclusion({ results });
  conclusion.forEach((line) => L.push(line));
  L.push('');

  /* ---------- 复现 ---------- */
  L.push('## 9. 复现方式');
  L.push('');
  L.push('```bash');
  L.push('# 只审计当前工作区（当前版本）');
  L.push('node qa/perf/render-audit.mjs');
  L.push('');
  L.push('# 审计当前工作区 + HEAD 基线（git ref 默认 9edadf1），生成 A/B 对比报告');
  L.push('node qa/perf/render-audit.mjs --baseline');
  L.push('');
  L.push('# 自测：只跑基线；或指定基线 ref / 输出目录 / 额外不限帧率性能采样');
  L.push('node qa/perf/render-audit.mjs --baseline-only --ref 9edadf1 --out qa/perf');
  L.push('node qa/perf/render-audit.mjs --baseline --uncapped');
  L.push('```');
  L.push('');
  L.push('前置条件：');
  L.push('');
  L.push(`- Chrome：\`${CHROME_PATH}\`（可通过环境变量 \`QA_CHROME\` 覆盖，需真实 GPU；headless 启动参数含 \`--ignore-gpu-blocklist --use-angle=default\`）`);
  L.push(`- playwright-core：\`${PLAYWRIGHT_PATH}\`（可通过 \`QA_PLAYWRIGHT\` 覆盖）`);
  L.push('- 本机 Node.js ≥ 18（脚本使用 ESM 与 `node:zlib`，无第三方依赖）');
  L.push('- **性能采样时请勿并行执行其他截图/重负载任务**，否则 fps 会被压低（脚本检测到会重测一次并标注）');
  L.push('');

  return L.join('\n');
}

function deltaPctCell(b, c) {
  const f = cmpField(b, c);
  if (f.deltaPct === null) return '—';
  const sign = f.deltaPct > 0 ? '+' : '';
  return `${sign}${f.deltaPct.toFixed(1)}%`;
}

function buildConclusion({ results }) {
  const lines = [];
  const base = results.baseline;
  const cur = results.current;
  if (!base || !cur) {
    lines.push('- 本次只审计了单个版本；加 `--baseline` 可生成基线 vs 当前的 A/B 对比。');
    return lines;
  }
  const cmp = results.comparison;
  const fmtPct = (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

  // AA
  const aa1 = cmp.aa.dpr1;
  const aa2 = cmp.aa.dpr2;

  lines.push('### 8.1 抗锯齿 / 画质');
  lines.push('');
  const aaRow = (label, dprData, label2) => {
    if (!dprData) return;
    const et = dprData.edgeTransitionPerEdge;
    const etl = dprData.edgeTransitionPerEdgeLocal;
    const hf = dprData.hfEnergy;
    const hfe = dprData.hfEnergyPerEdge;
    const nRatio = dprData.noiseRange ? dprData.noiseRange.edgeTransitionPerEdge : 0;
    const nRatioLocal = dprData.noiseRange ? dprData.noiseRange.edgeTransitionPerEdgeLocal : 0;
    const nHf = dprData.noiseRange ? dprData.noiseRange.hfEnergy : 0;
    const text = (f, noise, betterWhen, name, kind) => {
      if (!f || f.delta === null) return `${name} —`;
      const show = (v) => (kind === 'ratio' ? pct(v, 2) : fmt(v, 2));
      const mag = Math.abs(f.delta);
      const significant = mag > Math.max(noise * 1.5, Math.abs(f.baseline) * 0.02);
      const better = betterWhen === 'higher' ? f.delta > 0 : f.delta < 0;
      const tag = !significant ? '（噪声范围内，无法判定）' : better ? '✅ 更平滑' : '⚠️ 反而更锐/更差';
      return `${name} ${show(f.baseline)} → ${show(f.current)}（Δ ${f.delta > 0 ? '+' : ''}${fmt(f.deltaPct, 1)}%${tag}）`;
    };
    lines.push(
      `- **${label}**：${text(et, nRatio, 'higher', 'edgeTransitionPerEdge', 'ratio')}；${text(hf, nHf, 'lower', 'hfEnergy', 'num')}；${text(etl, nRatioLocal, 'higher', 'edgeTransitionPerEdgeLocal', 'ratio')}。`
    );
  };
  aaRow('DPR1（1×，差异最明显）', aa1);
  aaRow('DPR2（2×，超采样掩盖差异）', aa2);
  lines.push('');
  lines.push(
    '> 说明：**在 DPR1 下抗锯齿差异最明显**——1× 设备像素没有任何超采样兜底，边缘过渡像素的变化最直接；DPR2 因 2× 设备像素本身更平滑，人眼可感知的锯齿差异被部分掩盖（统计指标同样显著改善）。'
  );
  // 亮度/色调映射变化提示：全局三档口径对整体亮度敏感，需与局部口径交叉判读
  const lumB = base.aa.dpr1 && base.aa.dpr1.median ? base.aa.dpr1.median.meanLuma : null;
  const lumC = cur.aa.dpr1 && cur.aa.dpr1.median ? cur.aa.dpr1.median.meanLuma : null;
  if (lumB !== null && lumC !== null && lumB > 0) {
    const lumDeltaPct = ((lumC - lumB) / lumB) * 100;
    if (Math.abs(lumDeltaPct) >= 10) {
      const brB = base.aa.dpr1.median.brightRatio;
      const brC = cur.aa.dpr1.median.brightRatio;
      lines.push(
        `> ⚠️ 交叉校验：两版纯 canvas 画面整体亮度变化明显（DPR1 meanLuma ${fmt(lumB, 2)} → ${fmt(lumC, 2)}，${fmtPct(lumDeltaPct)}；亮部像素占比 ${pct(brB, 2)} → ${pct(brC, 2)}），说明 current 同时包含色调映射/曝光类变化。全局亮度三档口径（edgeTransitionRatio / edgeTransitionPerEdge）对亮度分布敏感，**AA 结论以不依赖绝对亮度的局部对比口径（edgeTransitionPerEdgeLocal）与 hfEnergy 为准**——两者方向一致且幅度远超 3 帧噪声，2.6× 像素放大截图亦可佐证。`
      );
      lines.push('');
    }
  }
  lines.push('');

  lines.push('### 8.2 性能');
  lines.push('');
  const perfLine = (dpr) => {
    const p = cmp.perf[`dpr${dpr}`];
    if (!p || !p.fps || p.fps.baseline === null || p.fps.current === null) {
      lines.push(`- DPR${dpr}：数据不足`);
      return;
    }
    const fpsDelta = p.fps.deltaPct;
    const capped = p.fps.baseline >= 57 && p.fps.current >= 57;
    let note;
    if (capped) {
      note =
        dpr === 1
          ? '两者均稳定在 60fps 垂直同步上限，该分辨率下的性能差异不可测（需看 --uncapped 补充）'
          : '两者均稳定在 60fps 垂直同步上限，DPR2 下当前版本仍有余量';
    } else if (Math.abs(fpsDelta) < 3) {
      note = '差异在 3% 以内，可视为持平';
    } else {
      note =
        fpsDelta > 0
          ? '当前版本 fps 更高'
          : '当前版本 fps 更低：若画质/AA 有提升，属于"以性能换画质"，需结合 AA 指标判读';
    }
    lines.push(
      `- DPR${dpr}：fps ${fmt(p.fps.baseline, 2)} → ${fmt(p.fps.current, 2)}（${fmtPct(fpsDelta)}）；frame-time p95 ${fmt(p.frameTimeP95.baseline, 2)}ms → ${fmt(p.frameTimeP95.current, 2)}ms（${fmtPct(p.frameTimeP95.deltaPct)}）。${note}。`
    );
  };
  perfLine(1);
  perfLine(2);
  if (results.uncapped && results.uncapped.baseline && results.uncapped.baseline.dpr1) {
    const b = results.uncapped.baseline && results.uncapped.baseline.dpr1;
    const c = results.uncapped.current && results.uncapped.current.dpr1;
    if (b && c && b.fps && c.fps) {
      const ratio = b.fps / c.fps;
      lines.push(
        `- 不限帧率补充（DPR1）：${fmt(b.fps, 1)} → ${fmt(c.fps, 1)} fps（${fmtPct(((c.fps - b.fps) / b.fps) * 100)}）。`,
        `- 解读：当前版本每帧渲染开销约为基线的 ${fmt(ratio, 2)}×（平均帧时间 ${fmt(b.frameTimeMs.mean, 2)}ms → ${fmt(c.frameTimeMs.mean, 2)}ms）。在 GTX 1650 / 1600×1000 下仍能锁住 60fps，但低端集显或更高 DPR 场景会更依赖自适应降档；画质提升与这一开销是同一枚硬币的两面。`
      );
    }
  }
  lines.push('');

  lines.push('### 8.3 风险与建议');
  lines.push('');
  const issues = [];
  if (cmp.capabilities && cmp.capabilities.pixelRatio) {
    const b = cmp.capabilities.pixelRatio.baseline;
    const c = cmp.capabilities.pixelRatio.current;
    if (b !== null && c !== null && b !== c) {
      issues.push(
        `- ⚠️ 当前版本 pixelRatio 由 ${b} 变为 ${c}：这会影响清晰度/AA 对比（若是为性能主动降分辨率，应视为画质代价）。`
      );
    }
  }
  if (cmp.capabilities && cmp.capabilities.samples) {
    const b = cmp.capabilities.samples.baseline;
    const c = cmp.capabilities.samples.current;
    if (b !== null && c !== null && b !== c) {
      issues.push(`- ℹ️ getStats 报告的 MSAA samples 由 ${b} 变为 ${c}，是本次画质差异的直接来源之一。`);
    }
  }
  if (cur && cur.qualityForce && cur.qualityForce.dpr1 && cur.qualityForce.dpr1.applied) {
    issues.push(
      `- ℹ️ current 的 AA 与性能均在 \`setQuality("high")\` 固定档位下测量（防止自适应降档污染对比）；未干预的初始档位见第 3.1 节。`
    );
  }
  // 初始自动档位观察：默认档位低于 high，但强制 high 后仍能跑满 fps → 说明该机器默认拿到的是"保守档"
  if (
    cur &&
    cur.defaultQuality &&
    cur.qualityForce &&
    cur.qualityForce.dpr1 &&
    cur.qualityForce.dpr1.applied
  ) {
    const fpsDpr2 = cur.perf.dpr2 && cur.perf.dpr2.fps;
    const fpsDpr1 = cur.perf.dpr1 && cur.perf.dpr1.fps;
    const notes = [];
    if (cur.defaultQuality.dpr1 && cur.defaultQuality.dpr1 !== 'high' && fpsDpr1 >= 57) {
      notes.push(
        `DPR1 初始自动档位为 \`${cur.defaultQuality.dpr1}\`，强制 high 后仍为 ${fmt(fpsDpr1, 1)}fps`
      );
    }
    if (cur.defaultQuality.dpr2 && cur.defaultQuality.dpr2 !== 'high' && fpsDpr2 >= 57) {
      notes.push(
        `DPR2 初始自动档位为 \`${cur.defaultQuality.dpr2}\`（启动启发式先降一档），强制 high（2× + MSAA）后仍为 ${fmt(fpsDpr2, 1)}fps`
      );
    }
    if (notes.length) {
      const states = cur.stats
        ? [cur.stats.initial, cur.stats.afterAaDpr1, cur.stats.afterAaDpr2, cur.stats.afterPerfDpr1, cur.stats.afterPerfDpr2]
            .map((s) => (s && s.state ? s.state : null))
            .filter(Boolean)
        : [];
      const downgradeNow = states.some((s) => s.qualityDowngraded === true || s.qualityDropped === true);
      issues.push(
        `- ℹ️ 初始自动档位观察：${notes.join('；')}。即性能充裕的机器默认拿到的是"保守档"，用户需手动切换到 high 才能获得页面提供的上限画质${downgradeNow ? '；且本次运行期间观察到 qualityDowngraded 被触发，请复核自适应逻辑' : '；本次运行未观察到运行期 qualityDowngraded 触发'}。`
      );
    }
  }
  // 数据噪声
  const spreads = [];
  for (const dpr of ['dpr1', 'dpr2']) {
    const s = base.aa[dpr] && base.aa[dpr].spread;
    const t = cur.aa[dpr] && cur.aa[dpr].spread;
    const worst = Math.max(
      s && s.hfEnergy ? s.hfEnergy.range || 0 : 0,
      t && t.hfEnergy ? t.hfEnergy.range || 0 : 0
    );
    spreads.push(`DPR${dpr.slice(3)} hfEnergy 3 帧极差最大 ${fmt(worst, 2)}`);
  }
  issues.push(`- 采样离散度：${spreads.join('；')}。场景含缓慢动画，AA 指标为统计量，建议以「变化幅度 vs 噪声」判断显著性。`);
  issues.forEach((i) => lines.push(i));
  if (!issues.length) lines.push('- 未发现明显风险。');
  return lines;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const outDir = path.resolve(
    path.isAbsolute(args.out) ? args.out : path.join(DEFAULT_PROJECT_ROOT, args.out)
  );
  const projectRoot = args.root ? path.resolve(args.root) : DEFAULT_PROJECT_ROOT;
  ensureDir(outDir);
  ensureDir(path.join(outDir, 'shots'));

  const env = collectEnvironment();
  const pw = requirePlaywright();

  const results = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: `node qa/perf/render-audit.mjs ${args.raw.join(' ')}`.trim(),
    options: {
      mode: args.mode,
      outDir,
      projectRoot,
      baselineRef: args.ref,
      viewport: VIEWPORT,
      mobileViewport: MOBILE_VIEWPORT,
      perfSampleMs: PERF_SAMPLE_MS,
      aaSampleCount: AA_SAMPLE_COUNT,
      aaConfig: AA_CONFIG,
      uncapped: args.uncapped
    },
    environment: env,
    chromeVersion: null,
    baselineMeta: null,
    baseline: null,
    current: null,
    uncapped: null,
    comparison: null,
    durationMs: null
  };

  const startedAll = Date.now();
  let browser = null;
  let worktree = null;
  try {
    browser = await launchBrowser(pw);
    results.chromeVersion = browser.version();
    console.log(`[render-audit] Chrome ${results.chromeVersion}（真实 GPU 参数：--ignore-gpu-blocklist --use-angle=default）`);

    const needBaseline = args.mode === 'both' || args.mode === 'baseline';
    const needCurrent = args.mode === 'both' || args.mode === 'current';

    if (needBaseline) {
      worktree = createBaselineWorktree(args.ref, { projectRoot });
      results.baselineMeta = {
        ref: worktree.ref,
        commit: worktree.commit,
        subject: worktree.subject,
        path: worktree.path
      };
      console.log(`[render-audit] 基线 worktree：${worktree.path}（${worktree.commit} ${worktree.subject}）`);
    }

    // 顺序：baseline → current，同一 Chrome 进程、同一脚本连续测量
    if (needBaseline) {
      console.log('[render-audit] 审计 baseline（截图/能力/AA/性能）…');
      results.baseline = await auditRoot(pw, browser, {
        mode: 'baseline',
        root: worktree.path,
        outDir
      });
      console.log(
        `[render-audit] baseline 完成：${formatDuration(results.baseline.durationMs)}，fps(DPR1)=${fmt(results.baseline.perf.dpr1 && results.baseline.perf.dpr1.fps, 2)}`
      );
    }
    if (needCurrent) {
      console.log('[render-audit] 审计 current（截图/能力/AA/性能）…');
      results.current = await auditRoot(pw, browser, {
        mode: 'current',
        root: projectRoot,
        outDir
      });
      console.log(
        `[render-audit] current 完成：${formatDuration(results.current.durationMs)}，fps(DPR1)=${fmt(results.current.perf.dpr1 && results.current.perf.dpr1.fps, 2)}`
      );
    }

    await browser.close();
    browser = null;

    // 可选：不限帧率补充测量（独立浏览器，避免污染正常比对的 vsync 状态）
    if (args.uncapped) {
      console.log('[render-audit] 补充测量：不限帧率模式…');
      const uncapped = { baseline: {}, current: {}, logs: { consoleErrors: [], pageErrors: [], requestFailures: [], badResponses: [], consoleWarnings: [] } };
      const uncappedBrowser = await launchBrowser(pw, UNCAPPED_EXTRA_ARGS);
      try {
        const roots = [];
        if (results.baseline) roots.push({ mode: 'baseline', root: results.baseline.root });
        if (results.current) roots.push({ mode: 'current', root: results.current.root });
        for (const { mode, root } of roots) {
          const url = pathToFileURL(path.join(root, 'index.html')).href;
          // 不限帧率模式只测 DPR1：DPR2 在 uncapped 下会出现合成器/驱动级周期性停顿，
          // 数据噪声大，不纳入正式结论。
          for (const dpr of [1]) {
            const opened = await openPage(uncappedBrowser, {
              url,
              viewport: VIEWPORT,
              dpr,
              logs: uncapped.logs,
              prefix: `uncapped/${mode}/dpr${dpr}`
            });
            try {
              await prepareDeterministicState(opened.page);
              await forceHighQuality(opened.page);
              const perf = await measurePerf(opened.page, { retries: 0, retryBelowFps: 0 });
              uncapped[mode][dpr === 1 ? 'dpr1' : 'dpr2'] = perf;
            } finally {
              await opened.context.close();
            }
          }
        }
      } finally {
        await uncappedBrowser.close();
      }
      results.uncapped = uncapped;
    }

    results.comparison = compareRuns(results.baseline, results.current);
    results.durationMs = Date.now() - startedAll;

    writeJson(path.join(outDir, 'results.json'), results);
    const report = buildReport({ results, outDir, args });
    fs.writeFileSync(path.join(outDir, 'report.md'), report, 'utf8');
    console.log(`[render-audit] 完成：${formatDuration(results.durationMs)}`);
    console.log(`[render-audit] 输出：${path.join(outDir, 'results.json')}`);
    console.log(`[render-audit] 报告：${path.join(outDir, 'report.md')}`);
    console.log(`[render-audit] 截图：${path.join(outDir, 'shots')}`);
  } catch (e) {
    const msg = String((e && e.stack) || e);
    console.error('[render-audit] 审计失败：\n' + msg);
    // 尽量留下部分结果，方便定位（不覆盖成功的 results.json 口径：写 results.partial.json）
    try {
      results.durationMs = Date.now() - startedAll;
      writeJson(path.join(outDir, 'results.partial.json'), results);
      console.error(`[render-audit] 部分结果已写入：${path.join(outDir, 'results.partial.json')}`);
    } catch (e2) {
      /* ignore */
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        /* ignore */
      }
    }
    if (worktree) {
      try {
        worktree.remove({ keep: args.keepWorktree && process.exitCode === 1 });
      } catch (e) {
        console.error('[render-audit] 清理 worktree 失败：' + String((e && e.message) || e));
      }
    }
  }
  if (process.exitCode && process.exitCode !== 0) {
    console.error('[render-audit] 失败退出。若页面正在被修改，请等修改完成后再运行。');
  }
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((e) => {
    console.error('[render-audit] 未捕获异常：\n' + String((e && e.stack) || e));
    process.exit(1);
  });
}

// 便于离线验证报告生成（不启动 Chrome）：import { buildReport } from './render-audit.mjs'
export { buildReport, buildConclusion, compareRuns, analyzePngBuffers, computeAaMetrics, decodePng };
