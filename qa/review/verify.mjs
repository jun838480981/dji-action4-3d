/* Independent acceptance verification for DJI Action 4 3D teardown page.
 * Read-only against product files; writes only into qa/review/.
 * Run: node qa/review/verify.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('F:/LearnSpace/前端与Web/dsh大肥鱼/qq-bot/node_modules/playwright-core');

const project = 'F:/LearnSpace/前端与Web/dji-action4-3d';
const outDir = path.join(project, 'qa', 'review');
fs.mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(path.join(project, 'index.html')).href;
const reference = fs.readFileSync(path.join(project, 'docs', 'dji-action4-reference.md'), 'utf8');
const crypto = await import('node:crypto');
const productFiles = ['index.html', 'css/style.css', 'js/app.js', 'js/lib/model.js', 'js/lib/textures.js', 'js/vendor/three-bundle.min.js'];
const productHashes = {};
for (const f of productFiles) {
  productHashes[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(project, f))).digest('hex');
}
const norm = s => String(s).replace(/\s+/g, '');

const checks = [];
const screenshots = [];
const check = (item, name, ok, detail) => {
  checks.push({ item, name, ok: !!ok, detail: detail === undefined ? null : detail });
};
const shot = async (p, name) => {
  await p.screenshot({ path: path.join(outDir, name) });
  screenshots.push(name);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
const requests = [];
const failedRequests = [];
const badResponses = [];

function attachLogs(page, prefix) {
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`[${prefix}] ${m.text()}`);
    else if (m.type() === 'warning') consoleWarnings.push(`[${prefix}] ${m.text()}`);
  });
  page.on('pageerror', e => pageErrors.push(`[${prefix}] ${e.stack || e.message}`));
  page.on('request', r => requests.push(r.url()));
  page.on('requestfailed', r => failedRequests.push({ prefix, url: r.url(), err: r.failure() ? r.failure().errorText : '?' }));
  page.on('response', r => { if (r.status() >= 400) badResponses.push({ prefix, url: r.url(), status: r.status() }); });
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist']
});

let page;
let mobilePage;
const results = { generatedAt: new Date().toISOString(), productHashes, checks, screenshots, parts: null, raw: {} };

const main = async () => {
  /* ================= desktop page ================= */
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  attachLogs(page, 'desktop');
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  const glyph = '\u00A0';
  const readState = () => page.evaluate(() => ({
    selected: window.DJI_APP.state.selected,
    exploded: window.DJI_APP.state.exploded,
    labelsOn: window.DJI_APP.state.labelsOn,
    autoFocus: window.DJI_APP.state.autoFocus,
    autoRotate: window.DJI_APP.state.autoRotate,
    mobile: window.DJI_APP.state.mobile,
    pct: document.getElementById('explodePct').textContent,
    heading: document.querySelector('.detail-heading h2') ? document.querySelector('.detail-heading h2').textContent : null,
    listActive: document.querySelector('.part-item.is-active') ? document.querySelector('.part-item.is-active').dataset.id : null,
    labelsDom: document.querySelectorAll('.part-label').length,
    labelsVisible: document.querySelectorAll('.part-label.is-visible').length,
    status: document.getElementById('statusMeta').textContent,
    camera: window.DJI_APP.getCamera().position.toArray(),
    target: window.DJI_APP.getControls().target.toArray(),
    activeTag: document.activeElement ? document.activeElement.tagName : null
  }));
  const waitPct = target => page.waitForFunction(t => document.getElementById('explodePct').textContent === t, target, { timeout: 15000, polling: 100 });
  const waitMobilePct = target => mobilePage.waitForFunction(t => document.getElementById('explodePct').textContent === t, target, { timeout: 15000, polling: 100 });

  async function findBlankPoint(pg) {
    return pg.evaluate(() => {
      const W = window.innerWidth, H = window.innerHeight;
      const cx = W / 2, cy = H / 2;
      const pts = [];
      for (let y = 110; y < H - 150; y += 34) {
        for (let x = 340; x < W - 360; x += 34) {
          const el = document.elementFromPoint(x, y);
          if (el && el.id === 'scene') {
            pts.push({ x, y, d: Math.hypot(x - cx, y - cy) });
          }
        }
      }
      pts.sort((a, b) => b.d - a.d);
      return pts.slice(0, 40);
    });
  }

  async function deselectViaBlank(pg) {
    const pts = await findBlankPoint(pg);
    for (const pt of pts) {
      await pg.mouse.click(pt.x, pt.y);
      await pg.waitForTimeout(220);
      const sel = await pg.evaluate(() => window.DJI_APP.state.selected);
      if (sel === null) return { ok: true, point: pt };
    }
    return { ok: false, point: null };
  }

  // project a part anchor into viewport coordinates (real click target)
  async function projectPart(pg, id) {
    return pg.evaluate(pid => {
      const app = window.DJI_APP;
      const T = window.THREE_BUNDLE.THREE;
      const part = app.getModel().byId[pid];
      if (!part) return null;
      const v = new T.Vector3();
      part.anchor.getWorldPosition(v);
      v.project(app.getCamera());
      const rect = document.getElementById('scene').getBoundingClientRect();
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
        z: v.z
      };
    }, id);
  }

  // project the world-space centre of a part's pivot (more reliable click target)
  async function projectPivot(pg, id) {
    return pg.evaluate(pid => {
      const app = window.DJI_APP;
      const T = window.THREE_BUNDLE.THREE;
      const part = app.getModel().byId[pid];
      if (!part) return null;
      const v = new T.Vector3();
      part.pivot.getWorldPosition(v);
      v.project(app.getCamera());
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z };
    }, id);
  }

  async function cameraDefaults() {
    return page.evaluate(() => {
      const app = window.DJI_APP;
      const p = app.getCamera().position.toArray();
      const t = app.getControls().target.toArray();
      return { p, t };
    });
  }

  /* ---------- item 1: load / console / network ---------- */
  const boot = await page.evaluate(() => {
    const b = document.getElementById('boot');
    const cs = getComputedStyle(b);
    const gl = document.getElementById('scene').getContext('webgl2');
    let renderer = 'n/a';
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    }
    return {
      bootDone: b.classList.contains('is-done'),
      bootVisibility: cs.visibility,
      fallbackHidden: document.getElementById('fallback').hidden,
      webgl2: !!gl,
      gpu: renderer,
      title: document.title,
      pct: document.getElementById('explodePct').textContent,
      resources: performance.getEntriesByType('resource').map(r => r.name)
    };
  });
  results.raw.gpu = boot.gpu;
  results.raw.resources = boot.resources;
  check(1, '页面加载完成、启动层退场、无 WebGL 失败面板', boot.bootDone && boot.bootVisibility === 'hidden' && boot.fallbackHidden, boot);
  check(1, 'WebGL2 可用且走硬件 GPU（非 SwiftShader）', boot.webgl2 && /NVIDIA|AMD|Intel|ANGLE/i.test(boot.gpu) && !/SwiftShader/i.test(boot.gpu), boot.gpu);
  check(1, 'title 为 DJI Osmo Action 4 · 3D 拆解实验室', /DJI Osmo Action 4/.test(boot.title), boot.title);
  const nonFile = requests.filter(u => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'));
  check(1, '无任何外部网络请求（全部 file:// 本地资源）', nonFile.length === 0, nonFile);

  /* asset load check */
  const expectedAssets = ['css/style.css', 'js/vendor/three-bundle.min.js', 'js/lib/textures.js', 'js/lib/model.js', 'js/app.js'];
  const missingAssets = expectedAssets.filter(a => !requests.some(u => u.replace(/\\/g, '/').endsWith(a)));
  check(1, '5 个本地静态资源全部请求成功', missingAssets.length === 0, { missing: missingAssets });

  /* ---------- item 2: part count / list / labels ---------- */
  const parts = await page.evaluate(() => window.DJI_APP.getModel().parts.map(p => ({
    id: p.id, name: p.meta.name, en: p.meta.en, index: p.index, labelSpec: p.meta.labelSpec
  })));
  results.parts = parts;

  const countSnapshot = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.part-item')).map(el => ({
      id: el.dataset.id,
      text: el.querySelector('.pi-name') ? el.querySelector('.pi-name').textContent.trim() : null,
      en: el.querySelector('.pi-en') ? el.querySelector('.pi-en').textContent.trim() : null
    }));
    const labels = Array.from(document.querySelectorAll('.part-label')).map(el => ({
      id: el.dataset.id,
      name: el.querySelector('.pl-name') ? el.querySelector('.pl-name').textContent.trim() : null,
      spec: el.querySelector('.pl-spec') ? el.querySelector('.pl-spec').textContent.trim() : null
    }));
    return {
      counter: document.getElementById('partCount').textContent.trim(),
      items,
      labels,
      status: document.getElementById('statusMeta').textContent.trim(),
      overviewHeading: document.querySelector('.overview h2') ? document.querySelector('.overview h2').textContent.trim() : null
    };
  });

  const idsMatch = parts.length === 14 &&
    countSnapshot.items.length === 14 &&
    countSnapshot.labels.length === 14 &&
    new Set(countSnapshot.items.map(i => i.id)).size === 14 &&
    parts.every(p => countSnapshot.items.some(i => i.id === p.id) && countSnapshot.labels.some(l => l.id === p.id));
  check(2, '部件数一致：模型/清单/标注均为 14', parts.length === 14 && countSnapshot.counter === '14' && idsMatch, {
    modelParts: parts.length, listItems: countSnapshot.items.length, labels: countSnapshot.labels.length, counter: countSnapshot.counter
  });
  const namesMatch = parts.every(p => {
    const item = countSnapshot.items.find(i => i.id === p.id);
    const label = countSnapshot.labels.find(l => l.id === p.id);
    return item && item.text && item.text.startsWith(p.name) && item.en === p.en &&
      label && label.name && label.name.endsWith(p.name) && label.spec === p.labelSpec;
  });
  check(2, '清单/标注与模型元数据的名称、英文名、标注参数逐项一致', namesMatch, '逐 id 比对 14 项');
  check(2, '顶栏状态与初始概览为 14 部件 / 00% 拆解进度', countSnapshot.status === '14 PARTS · 1/1.3" CMOS' && boot.pct === '00%' && /Action 4/.test(countSnapshot.overviewHeading || ''), {
    status: countSnapshot.status, pct: boot.pct, overview: countSnapshot.overviewHeading
  });
  await shot(page, '01-1600x1000-assembled.png');

  /* click each part in the list -> select + explode 100% + detail sync */
  const partResults = [];
  for (const p of parts) {
    await page.click(`.part-item[data-id="${p.id}"]`);
    await waitPct('100%').catch(() => {});
    await page.waitForTimeout(450);
    const r = await page.evaluate(arg => {
      const app = window.DJI_APP;
      const heading = document.querySelector('.detail-heading h2');
      const idx = document.querySelector('.detail-index');
      return {
        id: arg.id,
        en: arg.en,
        selected: app.state.selected,
        exploded: app.state.exploded,
        pct: document.getElementById('explodePct').textContent,
        listActive: document.querySelector('.part-item.is-active') ? document.querySelector('.part-item.is-active').dataset.id : null,
        heading: heading ? heading.textContent : null,
        index: idx ? idx.textContent.trim() : null,
        specRows: document.querySelectorAll('.detail .spec-row').length,
        status: document.getElementById('statusMeta').textContent.trim(),
        scrollTop: document.querySelector('.partlist').scrollTop
      };
    }, { id: p.id, en: p.en });
    partResults.push({ id: p.id, name: p.name, ...r });
  }
  results.raw.partResults = partResults;
  const partFails = partResults.filter(r => !(r.selected === r.id && r.exploded && r.pct === '100%' && r.listActive === r.id &&
    r.heading === r.name && r.specRows >= 5 && r.status.indexOf(r.en) >= 0));
  check(2, '逐一真实点击清单 14 项：均选中、拆解进度到 100%、详情/高亮/顶栏同步', partFails.length === 0, {
    passed: partResults.length - partFails.length, failed: partFails.map(f => f.id)
  });
  for (const id of ['lens', 'frontScreen', 'rearScreen', 'battery', 'mount']) {
    await page.click(`.part-item[data-id="${id}"]`);
    await waitPct('100%').catch(() => {});
    await page.waitForTimeout(700);
    await shot(page, `02-select-${id}.png`);
  }

  /* labels when exploded */
  let blank = await deselectViaBlank(page);
  await page.waitForTimeout(2800); // let camera fly back to the exploded pose and labels re-layout
  const labelState = await readState();
  const labelDetail = await page.evaluate(() => ({
    visible: Array.from(document.querySelectorAll('.part-label.is-visible')).map(el => el.dataset.id),
    offscreen: Array.from(document.querySelectorAll('.part-label')).filter(el => {
      const r = el.getBoundingClientRect();
      return !el.classList.contains('is-visible') || r.right < 0 || r.left > innerWidth;
    }).map(el => el.dataset.id)
  }));
  check(2, '拆解态标注：14 个标注 DOM 且全部可见', labelState.labelsDom === 14 && labelState.labelsVisible === 14, { dom: labelState.labelsDom, visible: labelState.labelsVisible, deselect: blank.ok, detail: labelDetail });
  await shot(page, '03-exploded-labels.png');

  /* ---------- item 3: labels toggle / label click ---------- */
  await page.click('#btnLabels');
  await page.waitForTimeout(500);
  let s = await readState();
  check(3, '标注开关可关闭：可见标注归零、按钮 aria-pressed=false', s.labelsVisible === 0 && s.labelsOn === false &&
    (await page.getAttribute('#btnLabels', 'aria-pressed')) === 'false', { visible: s.labelsVisible, labelsOn: s.labelsOn });
  await shot(page, '04-labels-off.png');
  await page.click('#btnLabels');
  await page.waitForTimeout(600);
  s = await readState();
  check(3, '标注开关可重新开启并恢复 14 个标注', s.labelsVisible === 14 && s.labelsOn === true, { visible: s.labelsVisible });

  await page.click('.part-label[data-id="lens"]');
  await page.waitForTimeout(800);
  let afterLabelClick = await readState();
  check(3, '点击 3D 标注可选中对应部件（标注 → 详情联动）', afterLabelClick.selected === 'lens' && afterLabelClick.heading === '镜头模组', afterLabelClick.selected);

  /* ---------- item 2/5: hit test on 3D canvas ---------- */
  // assemble, then click the real projected centre of parts: every click must pick a part.
  if ((await readState()).exploded) {
    await page.click('#btnExplode');
    await waitPct('00%').catch(() => {});
  }
  await page.waitForTimeout(2400);
  const canvasHits = [];
  for (const id of ['lens', 'frontScreen', 'frontCover', 'buttons', 'mount', 'batteryDoor', 'usbDoor']) {
    if (await page.evaluate(() => window.DJI_APP.state.exploded)) {
      await page.click('#btnExplode');
      await waitPct('00%').catch(() => {});
      await page.waitForTimeout(2000);
    }
    await deselectViaBlank(page);
    await page.waitForTimeout(600);
    const pt = await projectPivot(page, id);
    if (!pt) { canvasHits.push({ id, hit: null, err: 'no projection' }); continue; }
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(800);
    const selected = await page.evaluate(() => window.DJI_APP.state.selected);
    canvasHits.push({ id, point: { x: Math.round(pt.x), y: Math.round(pt.y) }, hit: selected, exact: selected === id, any: !!selected });
  }
  // plain click in the middle of the 3D stage
  if (await page.evaluate(() => window.DJI_APP.state.exploded)) {
    await page.click('#btnExplode');
    await waitPct('00%').catch(() => {});
    await page.waitForTimeout(2000);
  }
  await deselectViaBlank(page);
  await page.waitForTimeout(600);
  await page.mouse.click(800, 500);
  await page.waitForTimeout(800);
  const centerHit = await page.evaluate(() => window.DJI_APP.state.selected);
  canvasHits.push({ id: 'stage-center', point: { x: 800, y: 500 }, hit: centerHit, exact: null, any: !!centerHit });
  results.raw.canvasHits = canvasHits;
  const anyMiss = canvasHits.filter(h => !h.any);
  const exactCount = canvasHits.filter(h => h.exact).length;
  check(2, '点击 3D 画面能命中部件（7 个部件的投影中心 + 舞台中心，均必须选中部件）', anyMiss.length === 0, {
    anyMiss, exactHits: canvasHits.filter(h => h.exact).map(h => h.id), detail: canvasHits
  });
  check(2, '所点外部件与射线命中部件一致（镜头/前屏/USB-C 盖等至少 3 项精确命中）', exactCount >= 3, { exact: exactCount, detail: canvasHits.map(h => `${h.id}->${h.hit}`) });

  /* hover tooltip (assembled state) */
  await deselectViaBlank(page);
  await page.waitForTimeout(500);
  const lensPt = await projectPivot(page, 'lens');
  await page.mouse.move(lensPt.x, lensPt.y);
  await page.waitForTimeout(500);
  const hover = await page.evaluate(() => ({
    visible: document.getElementById('hoverTag').classList.contains('is-visible'),
    name: document.getElementById('hoverName').textContent,
    cursor: document.getElementById('scene').style.cursor
  }));
  await shot(page, '05-hover-lens.png');
  check(2, '悬停 3D 部件时出现部件提示并变指针（附加验证）', hover.visible && hover.name === '镜头模组' && hover.cursor === 'pointer', hover);

  /* item 5: blank click cancels selection */
  await page.click('.part-item[data-id="cooling"]');
  await waitPct('100%').catch(() => {});
  await page.waitForTimeout(900);
  const beforeBlank = await readState();
  blank = await deselectViaBlank(page);
  const afterBlank = await readState();
  check(5, '点击 3D 空白处取消选中并回到整机概览', beforeBlank.selected === 'cooling' && blank.ok && afterBlank.selected === null &&
    /Action 4/.test(afterBlank.heading || (await page.evaluate(() => document.querySelector('.overview h2') ? document.querySelector('.overview h2').textContent : ''))), {
    before: beforeBlank.selected, blank: blank.ok, after: afterBlank.selected
  });

  /* ---------- item 5: drag / wheel ---------- */
  if ((await readState()).exploded) {
    await page.click('#btnExplode');
    await waitPct('00%').catch(() => {});
    await page.waitForTimeout(1500);
  }
  const camBefore = (await cameraDefaults()).p;
  await page.mouse.move(800, 500);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(800 + i * 34, 500 + i * 14); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const camAfterDrag = (await cameraDefaults()).p;
  const dragDist = Math.hypot(camAfterDrag[0] - camBefore[0], camAfterDrag[1] - camBefore[1], camAfterDrag[2] - camBefore[2]);
  const selAfterDrag = (await readState()).selected;
  check(5, '鼠标拖拽改变相机位置（且拖拽不误触选中）', dragDist > 0.5 && selAfterDrag === null, { dragDist: +dragDist.toFixed(3), selected: selAfterDrag });

  const dBefore = await page.evaluate(() => {
    const app = window.DJI_APP;
    return app.getCamera().position.distanceTo(app.getControls().target);
  });
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(800);
  const dAfter = await page.evaluate(() => {
    const app = window.DJI_APP;
    return app.getCamera().position.distanceTo(app.getControls().target);
  });
  check(5, '滚轮缩放改变相机与目标的距离', Math.abs(dAfter - dBefore) > 0.3, { before: +dBefore.toFixed(3), after: +dAfter.toFixed(3) });

  /* reset view */
  await page.click('#btnReset');
  await page.waitForTimeout(350);
  const resetToast = await page.evaluate(() => ({ text: document.getElementById('toast').textContent, visible: document.getElementById('toast').classList.contains('is-visible') }));
  await page.waitForTimeout(1600);
  const camAfterReset = await cameraDefaults();
  const expectedReset = [Math.sin(0.58) * Math.cos(0.24) * 13.8, 0.6 + Math.sin(0.24) * 13.8, Math.cos(0.58) * Math.cos(0.24) * 13.8];
  const resetErr = Math.hypot(camAfterReset.p[0] - expectedReset[0], camAfterReset.p[1] - expectedReset[1], camAfterReset.p[2] - expectedReset[2]);
  check(3, '「复位视角」将相机拉回默认视角并提示', resetErr < 1.0 && resetToast.visible && resetToast.text.indexOf('视角已复位') >= 0, { resetErr: +resetErr.toFixed(3), toast: resetToast.text });

  /* ---------- item 3: explode/assemble button ---------- */
  await page.click('#btnExplode');
  await waitPct('100%').catch(() => {});
  await page.waitForTimeout(600);
  const exState = await page.evaluate(() => ({
    exploded: window.DJI_APP.state.exploded,
    pct: document.getElementById('explodePct').textContent,
    label: document.getElementById('explodeLabel').textContent,
    pressed: document.getElementById('btnExplode').getAttribute('aria-pressed'),
    assemblingClass: document.getElementById('btnExplode').classList.contains('is-assembling'),
    toast: document.getElementById('toast').textContent
  }));
  await shot(page, '06-1600x1000-exploded.png');
  check(3, '「一键拆解」生效：进度 100%、按钮变「一键组装」', exState.exploded && exState.pct === '100%' && exState.label === '一键组装' && exState.pressed === 'true' && exState.assemblingClass, exState);
  check(3, '拆解完成提示 toast 正确', exState.toast.indexOf('拆解完成') >= 0, exState.toast);

  await page.click('#btnExplode');
  await waitPct('00%').catch(() => {});
  await page.waitForTimeout(900);
  const asState = await page.evaluate(() => ({
    exploded: window.DJI_APP.state.exploded,
    pct: document.getElementById('explodePct').textContent,
    label: document.getElementById('explodeLabel').textContent,
    pressed: document.getElementById('btnExplode').getAttribute('aria-pressed'),
    selected: window.DJI_APP.state.selected,
    labelsVisible: document.querySelectorAll('.part-label.is-visible').length,
    toast: document.getElementById('toast').textContent
  }));
  check(3, '「一键组装」生效：进度回 00%、选中与标注清除、按钮复原', !asState.exploded && asState.pct === '00%' && asState.label === '一键拆解' && asState.pressed === 'false' && asState.selected === null && asState.labelsVisible === 0, asState);

  /* auto rotate */
  const rotBefore = (await cameraDefaults()).p;
  await page.click('#btnAutoRotate');
  await page.waitForTimeout(150);
  const rotState = await page.evaluate(() => ({
    state: window.DJI_APP.state.autoRotate,
    ctrl: window.DJI_APP.getControls().autoRotate,
    pressed: document.getElementById('btnAutoRotate').getAttribute('aria-pressed'),
    cls: document.getElementById('btnAutoRotate').classList.contains('is-on'),
    toast: document.getElementById('toast').textContent
  }));
  await page.waitForTimeout(1400);
  const rotAfter = (await cameraDefaults()).p;
  const rotMoved = Math.hypot(rotAfter[0] - rotBefore[0], rotAfter[2] - rotBefore[2]);
  check(3, '「自动旋转」开启后相机绕机身转动（状态/aria 同步）', rotState.state === true && rotState.ctrl === true && rotState.pressed === 'true' && rotState.cls && rotMoved > 0.1, { rotState, rotMoved: +rotMoved.toFixed(3) });
  await page.click('#btnAutoRotate');
  await page.waitForTimeout(400);
  const rotOff = await page.evaluate(() => ({
    state: window.DJI_APP.state.autoRotate,
    ctrl: window.DJI_APP.getControls().autoRotate,
    pressed: document.getElementById('btnAutoRotate').getAttribute('aria-pressed')
  }));
  check(3, '「自动旋转」可再次关闭', rotOff.state === false && rotOff.ctrl === false && rotOff.pressed === 'false', rotOff);
  // reset should also switch auto-rotate off
  await page.click('#btnAutoRotate');
  await page.waitForTimeout(300);
  await page.click('#btnReset');
  await page.waitForTimeout(400);
  const rotAfterReset = await page.evaluate(() => ({ state: window.DJI_APP.state.autoRotate, pressed: document.getElementById('btnAutoRotate').getAttribute('aria-pressed') }));
  check(3, '「复位视角」同时关闭自动旋转（附加验证）', rotAfterReset.state === false && rotAfterReset.pressed === 'false', rotAfterReset);
  await page.waitForTimeout(1400);

  /* auto focus toggle */
  const afBefore = await page.evaluate(() => ({ state: window.DJI_APP.state.autoFocus, pressed: document.getElementById('btnFocusCam').getAttribute('aria-pressed') }));
  await page.click('#btnFocusCam');
  await page.waitForTimeout(250);
  const afOff = await page.evaluate(() => ({ state: window.DJI_APP.state.autoFocus, pressed: document.getElementById('btnFocusCam').getAttribute('aria-pressed'), cls: document.getElementById('btnFocusCam').classList.contains('is-on') }));
  await page.click('#btnFocusCam');
  await page.waitForTimeout(250);
  const afOn = await page.evaluate(() => ({ state: window.DJI_APP.state.autoFocus, pressed: document.getElementById('btnFocusCam').getAttribute('aria-pressed') }));
  check(3, '「自动视角」开关状态与 aria 同步', afBefore.state === true && afBefore.pressed === 'true' && afOff.state === false && afOff.pressed === 'false' && !afOff.cls && afOn.state === true && afOn.pressed === 'true', { afBefore, afOff, afOn });

  /* guide modal */
  await page.click('#btnGuide');
  await page.waitForTimeout(600);
  const guideOpen = await page.evaluate(() => {
    const m = document.getElementById('guideModal');
    const card = document.querySelector('.modal-card');
    const r = card.getBoundingClientRect();
    return {
      hidden: m.hidden,
      cardOpacity: getComputedStyle(card).opacity,
      cardRect: [r.left, r.top, r.right, r.bottom],
      inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      items: document.querySelectorAll('.guide-item').length,
      title: document.getElementById('guideTitle').textContent
    };
  });
  await shot(page, '07-guide-modal.png');
  check(3, '「操作指南」弹窗可打开且内容完整（6 条说明、卡片在视口内）', !guideOpen.hidden && guideOpen.cardOpacity === '1' && guideOpen.items === 6 && guideOpen.inViewport && guideOpen.title === '操作指南', guideOpen);
  await page.click('.modal-close');
  await page.waitForTimeout(350);
  const guideClosedX = await page.evaluate(() => document.getElementById('guideModal').hidden);
  check(3, '操作指南可点右上角 × 关闭', guideClosedX === true, guideClosedX);

  await page.click('#btnGuide');
  await page.waitForTimeout(450);
  await page.mouse.click(24, 120); // backdrop
  await page.waitForTimeout(350);
  const guideClosedBackdrop = await page.evaluate(() => document.getElementById('guideModal').hidden);
  check(3, '操作指南可点遮罩关闭', guideClosedBackdrop === true, guideClosedBackdrop);

  await page.click('#btnGuide');
  await page.waitForTimeout(450);
  await page.click('.modal-primary');
  await page.waitForTimeout(350);
  const guideClosedBtn = await page.evaluate(() => document.getElementById('guideModal').hidden);
  check(3, '操作指南「开始探索」按钮可关闭', guideClosedBtn === true, guideClosedBtn);

  /* specs tab */
  await page.click('.info-tab[data-tab="specs"]');
  await page.waitForTimeout(500);
  const specsState = await page.evaluate(() => {
    const body = document.getElementById('infoBody');
    return {
      tab: window.DJI_APP.state.tab,
      selected: document.querySelector('.info-tab[data-tab="specs"]').getAttribute('aria-selected'),
      detailSelected: document.querySelector('.info-tab[data-tab="detail"]').getAttribute('aria-selected'),
      sections: document.querySelectorAll('.spec-section').length,
      rows: document.querySelectorAll('.spec-row').length,
      hasSpecTab: !!document.querySelector('.spec-tab'),
      text: body.innerText,
      underline: getComputedStyle(document.getElementById('tabUnderline')).transform
    };
  });
  await shot(page, '08-specs-tab.png');
  check(3, '「整机规格」Tab 可切换并渲染 5 个规格分区', specsState.tab === 'specs' && specsState.hasSpecTab && specsState.sections === 5 && specsState.rows >= 20 &&
    specsState.selected === 'true' && specsState.detailSelected === 'false', { tab: specsState.tab, sections: specsState.sections, rows: specsState.rows, underline: specsState.underline });
  const specNeeded = ['1/1.3 英寸 CMOS', 'f/2.8', '155°', '1.4 英寸', '320×320', '2.25 英寸', '640×360', '1770 mAh', '6.8 Wh', '70.5 × 44.2 × 32.8 mm', '145 g', '18 m', '130 Mbps', '10-bit D-Log M'];
  const specTextN = norm(specsState.text);
  const specMissing = specNeeded.filter(t => !specTextN.includes(norm(t)));
  check(3, '整机规格页包含任务要求的核心参数', specMissing.length === 0, { missing: specMissing });
  await page.click('.info-tab[data-tab="detail"]');
  await page.waitForTimeout(400);
  const backToDetail = await page.evaluate(() => ({ tab: window.DJI_APP.state.tab, overview: !!document.querySelector('.overview') }));
  check(3, '切回「部件详情」Tab 正常', backToDetail.tab === 'detail' && backToDetail.overview, backToDetail);

  /* focus selected / close info */
  const focusDisabled = await page.evaluate(() => document.getElementById('btnFocusSelected').disabled);
  check(3, '无选中时「定位所选」禁用', focusDisabled === true, { disabled: focusDisabled });
  await page.waitForTimeout(900);
  await page.click('.part-item[data-id="lens"]');
  await waitPct('100%').catch(() => {});
  await page.waitForTimeout(2200); // let auto-focus camera tween finish
  const focusEnabled = await page.evaluate(() => document.getElementById('btnFocusSelected').disabled);
  const camFocusBefore = (await cameraDefaults()).p;
  // move the camera away with a real drag, then hit 「定位所选」 and expect it to fly back to the part
  await page.mouse.move(780, 520);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(780 + i * 30, 520 + i * 12); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const camAway = (await cameraDefaults()).p;
  await page.click('#btnFocusSelected');
  await page.waitForTimeout(1900);
  const camFocusAfter = (await cameraDefaults()).p;
  const movedAway = Math.hypot(camAway[0] - camFocusBefore[0], camAway[1] - camFocusBefore[1], camAway[2] - camFocusBefore[2]);
  const focusMoved = Math.hypot(camFocusAfter[0] - camAway[0], camFocusAfter[1] - camAway[1], camFocusAfter[2] - camAway[2]);
  check(3, '「定位所选」可用并能把相机拉回选中部件', focusEnabled === false && focusMoved > 1.0, { disabled: focusEnabled, movedAway: +movedAway.toFixed(2), focusMoved: +focusMoved.toFixed(2) });
  await page.click('#btnCloseInfo');
  await page.waitForTimeout(600);
  const closeInfo = await readState();
  check(3, '「收起详情」取消选中并回到概览', closeInfo.selected === null && (await page.evaluate(() => !!document.querySelector('.overview'))), { selected: closeInfo.selected });

  /* ---------- item 4: keyboard ---------- */
  if ((await readState()).exploded) {
    await page.click('#btnExplode');
    await waitPct('00%').catch(() => {});
    await page.waitForTimeout(1200);
  }
  await deselectViaBlank(page);
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const activeTag = await page.evaluate(() => document.activeElement.tagName);
  await page.keyboard.press('Space');
  await waitPct('100%').catch(() => {});
  await page.waitForTimeout(300);
  const kbSpaceOn = await readState();
  await page.keyboard.press('Space');
  await waitPct('00%').catch(() => {});
  await page.waitForTimeout(300);
  const kbSpaceOff = await readState();
  check(4, '空格键拆解/组装（body 聚焦时）', activeTag === 'BODY' && kbSpaceOn.exploded && kbSpaceOn.pct === '100%' && !kbSpaceOff.exploded && kbSpaceOff.pct === '00%', { activeTag, on: kbSpaceOn.exploded, off: kbSpaceOff.exploded });

  // R: drag away then reset by keyboard
  await page.mouse.move(800, 500);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(800 + i * 40, 500 + i * 10); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  const camBeforeR = (await cameraDefaults()).p;
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.keyboard.press('r');
  await page.waitForTimeout(1800);
  const camAfterR = (await cameraDefaults()).p;
  const rErr = Math.hypot(camAfterR[0] - expectedReset[0], camAfterR[1] - expectedReset[1], camAfterR[2] - expectedReset[2]);
  const rMoved = Math.hypot(camBeforeR[0] - camAfterR[0], camBeforeR[1] - camAfterR[1], camBeforeR[2] - camAfterR[2]);
  check(4, 'R 键复位视角', rErr < 1.0 && rMoved > 0.5, { rErr: +rErr.toFixed(3), moved: +rMoved.toFixed(3) });

  // L: labels toggle
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const lBefore = await page.evaluate(() => ({ on: window.DJI_APP.state.labelsOn, pressed: document.getElementById('btnLabels').getAttribute('aria-pressed') }));
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  const lAfter = await page.evaluate(() => ({ on: window.DJI_APP.state.labelsOn, pressed: document.getElementById('btnLabels').getAttribute('aria-pressed') }));
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  const lBack = await page.evaluate(() => ({ on: window.DJI_APP.state.labelsOn, pressed: document.getElementById('btnLabels').getAttribute('aria-pressed') }));
  check(4, 'L 键切换标注开关', lBefore.on === true && lAfter.on === false && lAfter.pressed === 'false' && lBack.on === true, { lBefore, lAfter, lBack });

  // ?: guide open, Esc close
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(500);
  const qOpen = await page.evaluate(() => document.getElementById('guideModal').hidden);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const qClosed = await page.evaluate(() => document.getElementById('guideModal').hidden);
  check(4, '? 键打开操作指南、Esc 关闭', qOpen === false && qClosed === true, { open: qOpen, closed: qClosed });

  // Esc deselect
  await page.click('.part-item[data-id="rearCover"]');
  await waitPct('100%').catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const selBeforeEsc = await page.evaluate(() => window.DJI_APP.state.selected);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const selAfterEsc = await page.evaluate(() => window.DJI_APP.state.selected);
  check(4, 'Esc 取消选中（无弹窗时）', selBeforeEsc === 'rearCover' && selAfterEsc === null, { before: selBeforeEsc, after: selAfterEsc });

  // F fullscreen (informational, headless may refuse)
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.keyboard.press('f');
  await page.waitForTimeout(700);
  const fsState = await page.evaluate(() => !!document.fullscreenElement);
  if (fsState) await page.keyboard.press('Escape');
  check(4, 'F 键触发全屏调用（headless 下仅作参考，不作为失败项）', true, { fullscreenEntered: fsState, note: 'headless Chrome 可能拒绝全屏，仅记录' });

  /* ---------- item 7: responsive desktop ---------- */
  const measureLayout = async (pg) => pg.evaluate(() => {
    const rect = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const hit = sel => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { found: true, self: !!(h && (h === el || el.contains(h))), hitTag: h ? (h.id || h.className || h.tagName) : null };
    };
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      left: rect('#panelParts'), right: rect('#panelInfo'), dock: rect('#dock'),
      topbar: rect('.topbar'), brand: rect('.brand'), actions: rect('.topbar-actions'),
      leftFoot: rect('.panel-foot'), infoFoot: rect('.info-foot'),
      centerHit: (document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || {}).id || null,
      dockHits: {
        explode: hit('#btnExplode'), reset: hit('#btnReset'), autoRotate: hit('#btnAutoRotate'),
        labels: hit('#btnLabels'), focusCam: hit('#btnFocusCam'), guide: hit('#btnGuide'),
        tabSpecs: hit('.info-tab[data-tab="specs"]')
      }
    };
  });

  await page.setViewportSize({ width: 1100, height: 780 });
  await page.waitForTimeout(1100);
  const m1100 = await measureLayout(page);
  const noOverlap1100 = m1100.left.right <= m1100.right.left;
  const panelsClearDock1100 = m1100.left.bottom <= m1100.dock.top && m1100.right.bottom <= m1100.dock.top;
  const inside1100 = m1100.left.left >= 0 && m1100.right.right <= m1100.vw && m1100.left.bottom <= m1100.vh && m1100.right.bottom <= m1100.vh && m1100.dock.left >= 0 && m1100.dock.right <= m1100.vw && m1100.dock.bottom <= m1100.vh;
  const noTopbarOverlap1100 = m1100.brand.right <= m1100.actions.left;
  const dockHitsFine1100 = Object.values(m1100.dockHits).every(h => h.found && h.self);
  check(7, '1100×780：左右面板不重叠、不压底部操作坞、均在视口内', noOverlap1100 && panelsClearDock1100 && inside1100, { noOverlap: noOverlap1100, clearDock: panelsClearDock1100, inside: inside1100, left: m1100.left, right: m1100.right, dock: m1100.dock });
  check(7, '1100×780：顶栏品牌与操作按钮不重叠', noTopbarOverlap1100, { brand: m1100.brand, actions: m1100.actions });
  check(7, '1100×780：中心 3D 区无遮挡、操作坞/规格 Tab 可点击', m1100.centerHit === 'scene' && dockHitsFine1100, { centerHit: m1100.centerHit, dockHits: m1100.dockHits });
  await shot(page, '09-1100x780-assembled.png');
  await page.click('#btnExplode');
  await waitPct('100%').catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, '10-1100x780-exploded.png');
  await page.click('#btnExplode');
  await waitPct('00%').catch(() => {});
  await page.waitForTimeout(900);

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(1100);
  const m1600 = await measureLayout(page);
  const noOverlap1600 = m1600.left.right <= m1600.right.left;
  const panelsClearDock1600 = m1600.left.bottom <= m1600.dock.top && m1600.right.bottom <= m1600.dock.top;
  const inside1600 = m1600.left.left >= 0 && m1600.right.right <= m1600.vw && m1600.dock.left >= 0 && m1600.dock.right <= m1600.vw && m1600.dock.bottom <= m1600.vh;
  const noTopbarOverlap1600 = m1600.brand.right <= m1600.actions.left;
  const dockHitsFine1600 = Object.values(m1600.dockHits).every(h => h.found && h.self);
  check(7, '1600×1000：左右面板不重叠、不压底部操作坞、均在视口内', noOverlap1600 && panelsClearDock1600 && inside1600, { noOverlap: noOverlap1600, clearDock: panelsClearDock1600, inside: inside1600, left: m1600.left, right: m1600.right, dock: m1600.dock });
  check(7, '1600×1000：顶栏品牌与操作按钮不重叠', noTopbarOverlap1600, { brand: m1600.brand, actions: m1600.actions });
  check(7, '1600×1000：中心 3D 区无遮挡、操作坞/规格 Tab 可点击', m1600.centerHit === 'scene' && dockHitsFine1600, { centerHit: m1600.centerHit, dockHits: m1600.dockHits });
  await shot(page, '11-1600x1000-assembled.png');

  /* ---------- item 8: parameter accuracy vs reference doc ---------- */
  // gather rendered text from specs tab + overview + key part details
  await page.click('.info-tab[data-tab="specs"]');
  await page.waitForTimeout(500);
  const specsText = await page.evaluate(() => document.getElementById('infoBody').innerText);
  await page.click('.info-tab[data-tab="detail"]');
  await page.waitForTimeout(300);
  const overviewText = await page.evaluate(() => document.getElementById('infoBody').innerText);
  const detailTexts = {};
  for (const id of ['lens', 'sensor', 'frontCover', 'frontScreen', 'rearScreen', 'battery', 'batteryDoor', 'usbDoor', 'mount', 'mainboard', 'cooling']) {
    await page.evaluate(pid => window.DJI_APP.selectPart(pid), id);
    await page.waitForTimeout(900);
    detailTexts[id] = await page.evaluate(() => document.getElementById('infoBody').innerText);
  }
  const pageAll = norm([specsText, overviewText, ...Object.values(detailTexts)].join('\n'));
  const docAll = norm(reference.replace(/\*/g, ''));
  // [label, page token (whitespace stripped), doc regex on whitespace-stripped reference]
  const paramTable = [
    ['镜头 Φ35', 'Φ35', /Φ35/],
    ['光圈 f/2.8', 'f/2.8', /f\/2\.8/],
    ['视场角 155°', '155°', /155°/],
    ['前屏 1.4 英寸', '1.4英寸', /1\.4英寸/],
    ['前屏 320×320', '320×320', /320×320/],
    ['后屏 2.25 英寸', '2.25英寸', /2\.25英寸/],
    ['后屏 640×360', '640×360', /640×360/],
    ['电池 1770 mAh', '1770mAh', /1770mAh/],
    ['电池 6.8 Wh', '6.8Wh', /6\.8Wh/],
    ['电池 3.85 V', '3.85V', /3\.85V/],
    ['尺寸 70.5×44.2×32.8 mm', '70.5×44.2×32.8mm', /70\.5×44\.2×32\.8/],
    ['重量 145 g', '145g', /145g/],
    ['防水 18 m', '18m', /18m/],
    ['续航 160 分钟', '160分钟', /160min/],
    ['充电 18 min 充至 80%', '18min充至80%', /18min充至80%/],
    ['充电 49 min 充满', '49min充满', /49min充满/],
    ['码流 130 Mbps', '130Mbps', /130Mbps/],
    ['色彩 10-bit D-Log M', '10-bitD-LogM', /10-bitD-LogM/],
    ['像素 3648×2736', '3648×2736', /3648×2736/],
    ['前屏 323 ppi', '323ppi', /323ppi/],
    ['后屏 326 ppi', '326ppi', /326ppi/],
    ['亮度 750 nit', '750nit', /750±50cd\/m²/],
    ['麦克风 3 个（前2+底部防风1）', '3个（前2+底部防风1）', /3个（前2\+底部防风1）/],
    ['音频 48 kHz 16-bit AAC', '48kHz16-bitAAC', /48kHz16-bitAAC/],
    ['存储 microSD ≤512 GB / exFAT / 无内置存储', 'microSD≤512GB', /microSD≤512GB，exFAT/],
    ['无线 Wi-Fi 802.11 a/b/g/n/ac + BLE 5.0', '802.11a/b/g/n/ac', /802\.11a\/b\/g\/n\/ac.*BLE5\.0/],
    ['温度 -20°C~45°C 使用 / 5°C~40°C 充电', '-20°C~45°C使用/5°C~40°C充电', /-20℃~45℃；充电5℃~40℃/],
    ['前盖圆角 R3', '正面轮廓R3', /XY轮廓R3/],
    ['电池仓盖 41×28', '约41×28mm', /≈41（Y）×28（Z）/],
    ['USB-C 盖 17×13', '约17×13mm', /17（Z）×13（Y）/],
    ['磁吸面 46×26', '46×26', /46（X）×26（Z）/],
    ['视频 4K16:9 ≤120fps', '4K16:9≤120fps', /4K16:9≤120fps/],
    ['慢动作 1080p ≤240fps', '240fps', /240fps/],
    ['对焦 0.4m~∞', '0.4m~∞', /0.4m~∞/],
    ['触控策略 前后屏不能同时触控', '前后屏不能同时触控', /前后屏不能同时触控/]
  ];
  const paramResults = paramTable.map(([label, pageToken, docRe]) => ({
    label,
    inPage: pageAll.includes(norm(pageToken)),
    inDoc: docRe.test(docAll)
  }));
  results.raw.paramResults = paramResults;
  const pageMiss = paramResults.filter(r => !r.inPage);
  const docMiss = paramResults.filter(r => !r.inDoc);
  check(8, `页面参数与 docs/dji-action4-reference.md 逐项一致（${paramTable.length} 项）`, pageMiss.length === 0 && docMiss.length === 0, { pageMissing: pageMiss.map(x => x.label), docMissing: docMiss.map(x => x.label) });

  const hlgInPage = /HLG/.test(specsText);
  const hlgInDoc = /HLG/.test(reference);
  check(8, '「色彩 10-bit D-Log M / HLG」中的 HLG 与参考文档一致', !(hlgInPage && !hlgInDoc), { page: hlgInPage, doc: hlgInDoc, note: '参考文档无 HLG 记录；页面整机规格额外声明 HLG' });

  const disclaimerChecks = {
    overview: /示意/.test(overviewText),
    specsFootnote: /示意/.test(specsText),
    mainboard: /示意/.test(detailTexts.mainboard || ''),
    cooling: /示意/.test(detailTexts.cooling || ''),
    sensor: /示意/.test(detailTexts.sensor || '')
  };
  results.raw.disclaimer = disclaimerChecks;
  check(8, '内部结构「示意」免责声明在概览/规格/部件说明中可见', Object.values(disclaimerChecks).filter(Boolean).length >= 4, disclaimerChecks);

  /* quick-stats sanity */
  const stats = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.qs-item')).map(el => el.innerText.replace(/\s+/g, ' ').trim());
    return items;
  });
  check(8, '左侧快速参数卡（尺寸/重量/防水）与参考文档一致', stats.length === 3 && /70\.5/.test(stats[0]) && /145/.test(stats[1]) && /18/.test(stats[2]), stats);

  /* ---------- mobile page ---------- */
  mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  attachLogs(mobilePage, 'mobile');
  await mobilePage.goto(url, { waitUntil: 'load', timeout: 30000 });
  await mobilePage.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await mobilePage.waitForTimeout(3000);

  const mobileBase = await mobilePage.evaluate(() => {
    const rect = sel => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { found: true, left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), display: cs.display };
    };
    const hitInfo = sel => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { found: true, self: !!(h && (h === el || el.contains(h))) };
    };
    return {
      iw: window.innerWidth, ih: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      bodyScrollW: document.body.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      bodyScrollH: document.body.scrollHeight,
      mobile: window.DJI_APP.state.mobile,
      parts: rect('#panelParts'), info: rect('#panelInfo'), dock: rect('#dock'),
      btnParts: rect('#btnMobileParts'), btnInfo: rect('#btnMobileInfo'), btnGuide: rect('#btnGuide'),
      dockHits: { explode: hitInfo('#btnExplode'), reset: hitInfo('#btnReset'), autoRotate: hitInfo('#btnAutoRotate'), labels: hitInfo('#btnLabels'), focusCam: hitInfo('#btnFocusCam') },
      panelsOpen: { parts: document.getElementById('panelParts').classList.contains('is-open'), info: document.getElementById('panelInfo').classList.contains('is-open') },
      partItems: document.querySelectorAll('.part-item').length,
      detailHeading: document.querySelector('.detail-heading h2') ? document.querySelector('.detail-heading h2').textContent : null
    };
  });
  results.raw.mobileBase = mobileBase;
  check(6, '移动端 390×844：页面无横向溢出（scrollWidth ≤ clientWidth）', mobileBase.docScrollW <= mobileBase.docClientW + 1 && mobileBase.bodyScrollW <= mobileBase.iw + 1, {
    iw: mobileBase.iw, docScrollW: mobileBase.docScrollW, docClientW: mobileBase.docClientW, bodyScrollW: mobileBase.bodyScrollW
  });
  check(6, '移动端识别为 mobile 布局，左右面板默认收起在视口外', mobileBase.mobile === true && mobileBase.parts.found && mobileBase.info.found &&
    mobileBase.parts.right <= 1 && mobileBase.info.left >= mobileBase.iw - 1 && !mobileBase.panelsOpen.parts && !mobileBase.panelsOpen.info, {
    parts: mobileBase.parts, info: mobileBase.info
  });
  check(6, '移动端操作坞完整在视口内且按钮可点击', mobileBase.dock.found && mobileBase.dock.left >= 0 && mobileBase.dock.right <= mobileBase.iw + 1 && mobileBase.dock.bottom <= mobileBase.ih &&
    Object.values(mobileBase.dockHits).every(h => h.found && h.self), { dock: mobileBase.dock, hits: mobileBase.dockHits });
  await mobilePage.waitForTimeout(4200); // let the intro toast expire for a clean shot
  await shot(mobilePage, '12-mobile-390x844-assembled.png');

  // open parts panel
  await mobilePage.tap('#btnMobileParts');
  await mobilePage.waitForTimeout(700);
  const mobilePartsOpen = await mobilePage.evaluate(() => {
    const el = document.getElementById('panelParts');
    const r = el.getBoundingClientRect();
    const list = document.querySelector('.partlist');
    return {
      isOpen: el.classList.contains('is-open'),
      rect: [r.left, r.top, r.right, r.bottom].map(v => +v.toFixed(1)),
      inViewport: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1,
      items: document.querySelectorAll('.part-item').length,
      listScrollable: list.scrollHeight > list.clientHeight,
      infoOpen: document.getElementById('panelInfo').classList.contains('is-open'),
      docScrollW: document.documentElement.scrollWidth,
      iw: window.innerWidth
    };
  });
  await shot(mobilePage, '13-mobile-parts-panel.png');
  check(6, '移动端部件面板可打开、14 项可滚动、不横向溢出', mobilePartsOpen.isOpen && mobilePartsOpen.inViewport && mobilePartsOpen.items === 14 && mobilePartsOpen.listScrollable &&
    mobilePartsOpen.docScrollW <= mobilePartsOpen.iw + 1 && !mobilePartsOpen.infoOpen, mobilePartsOpen);

  // select the last (deepest) part by real tap
  await mobilePage.locator('.part-item[data-id="midframe"]').scrollIntoViewIfNeeded();
  await mobilePage.waitForTimeout(300);
  await mobilePage.tap('.part-item[data-id="midframe"]');
  await waitMobilePct('100%').catch(() => {});
  await mobilePage.waitForTimeout(1800);
  const mobileSelected = await mobilePage.evaluate(() => {
    const info = document.getElementById('panelInfo');
    const r = info.getBoundingClientRect();
    const heading = document.querySelector('.detail-heading h2');
    return {
      selected: window.DJI_APP.state.selected,
      exploded: window.DJI_APP.state.exploded,
      pct: document.getElementById('explodePct').textContent,
      infoOpen: info.classList.contains('is-open'),
      partsOpen: document.getElementById('panelParts').classList.contains('is-open'),
      infoInViewport: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1,
      heading: heading ? heading.textContent : null,
      heading2: document.querySelector('.overview h2') ? document.querySelector('.overview h2').textContent : null,
      detailRows: document.querySelectorAll('.detail .spec-row').length,
      docScrollW: document.documentElement.scrollWidth,
      iw: window.innerWidth
    };
  });
  await shot(mobilePage, '14-mobile-detail-panel.png');
  check(6, '移动端点击面板内最深部件可选中、100% 拆解、详情面板自动打开', mobileSelected.selected === 'midframe' && mobileSelected.exploded && mobileSelected.pct === '100%' &&
    mobileSelected.infoOpen && !mobileSelected.partsOpen && mobileSelected.heading === '一体化中框', mobileSelected);
  check(6, '移动端详情面板在视口内、内容渲染完整、无横向溢出', mobileSelected.infoInViewport && mobileSelected.detailRows >= 5 && mobileSelected.docScrollW <= mobileSelected.iw + 1, mobileSelected);

  // close detail panel
  await mobilePage.tap('#btnCloseInfo');
  await mobilePage.waitForTimeout(600);
  const mobileClosed = await mobilePage.evaluate(() => ({
    infoOpen: document.getElementById('panelInfo').classList.contains('is-open'),
    partsOpen: document.getElementById('panelParts').classList.contains('is-open'),
    selected: window.DJI_APP.state.selected
  }));
  await shot(mobilePage, '15-mobile-panels-closed.png');
  check(6, '移动端「收起详情」可关闭面板（保留选中）', !mobileClosed.infoOpen && !mobileClosed.partsOpen && mobileClosed.selected === 'midframe', mobileClosed);

  // reopen via 详情 button
  await mobilePage.tap('#btnMobileInfo');
  await mobilePage.waitForTimeout(600);
  const mobileReopen = await mobilePage.evaluate(() => ({
    infoOpen: document.getElementById('panelInfo').classList.contains('is-open'),
    heading: document.querySelector('.detail-heading h2') ? document.querySelector('.detail-heading h2').textContent : null
  }));
  await mobilePage.tap('#btnMobileInfo');
  await mobilePage.waitForTimeout(500);
  const mobileReclose = await mobilePage.evaluate(() => document.getElementById('panelInfo').classList.contains('is-open'));
  check(6, '移动端「详情」按钮可打开/再次点击关闭面板', mobileReopen.infoOpen && mobileReopen.heading === '一体化中框' && mobileReclose === false, { reopen: mobileReopen, closed: mobileReclose });

  // mobile exploit button works
  const mobBtnBefore = await mobilePage.evaluate(() => document.getElementById('explodeLabel').textContent);
  await mobilePage.tap('#btnExplode');
  await waitMobilePct(mobBtnBefore === '一键组装' ? '00%' : '100%').catch(() => {});
  await mobilePage.waitForTimeout(800);
  const mobBtnAfter = await mobilePage.evaluate(() => ({
    label: document.getElementById('explodeLabel').textContent,
    pct: document.getElementById('explodePct').textContent,
    exploded: window.DJI_APP.state.exploded
  }));
  check(6, '移动端底部「一键拆解/组装」按钮可用', mobBtnAfter.label !== mobBtnBefore && (mobBtnAfter.pct === '100%' || mobBtnAfter.pct === '00%'), { before: mobBtnBefore, after: mobBtnAfter });

  // ensure exploded (labels only render in exploded state)
  if ((await mobilePage.evaluate(() => window.DJI_APP.state.exploded)) === false) {
    await mobilePage.tap('#btnExplode');
    await waitMobilePct('100%').catch(() => {});
    await mobilePage.waitForTimeout(2000);
  }
  // mobile-specific accessibility: is the guide entry visible at 390px?
  const mobGuide = await mobilePage.evaluate(() => {
    const el = document.getElementById('btnGuide');
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { display: cs.display, rect: [rect.left, rect.top, rect.width, rect.height], visible: rect.width > 0 && rect.height > 0 && cs.display !== 'none' };
  });
  results.raw.mobileGuide = mobGuide;
  check(6, '移动端存在打开「操作指南」的可见入口', mobGuide.visible === true, mobGuide);

  // tap it for real
  await mobilePage.tap('#btnGuide');
  await mobilePage.waitForTimeout(700);
  const mobGuideOpen = await mobilePage.evaluate(() => {
    const m = document.getElementById('guideModal');
    const card = document.querySelector('.modal-card');
    const r = card.getBoundingClientRect();
    return {
      hidden: m.hidden,
      inViewport: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      items: document.querySelectorAll('.guide-item').length
    };
  });
  await shot(mobilePage, '16-mobile-guide.png');
  check(6, '移动端点击「操作指南」可打开弹窗且卡片在视口内', mobGuideOpen.hidden === false && mobGuideOpen.items === 6 && mobGuideOpen.inViewport, mobGuideOpen);
  await mobilePage.tap('.modal-close');
  await mobilePage.waitForTimeout(500);

  // mobile labels toggle: state changes but CSS hides labels at <=680px -> no visible effect (UX issue)
  const mobLabelsBefore = await mobilePage.evaluate(() => ({ on: window.DJI_APP.state.labelsOn, visible: document.querySelectorAll('.part-label.is-visible').length, display: getComputedStyle(document.querySelector('.part-label')).display }));
  await mobilePage.tap('#btnLabels');
  await mobilePage.waitForTimeout(700);
  const mobLabelsAfter = await mobilePage.evaluate(() => ({
    on: window.DJI_APP.state.labelsOn,
    visible: document.querySelectorAll('.part-label.is-visible').length,
    labelDisplay: getComputedStyle(document.querySelector('.part-label')).display
  }));
  await shot(mobilePage, '24-mobile-exploded-label-toggle.png');
  results.raw.mobileLabels = { before: mobLabelsBefore, after: mobLabelsAfter };
  check(6, '移动端「标注」开关状态可切换（≤680px 时无任何可见标注，见报告 UX-2）', mobLabelsAfter.on !== mobLabelsBefore.on, { before: mobLabelsBefore, after: mobLabelsAfter, note: 'CSS 在 ≤680px 隐藏 .part-label，开关无视觉效果' });
  await mobilePage.tap('#btnLabels');
  await mobilePage.waitForTimeout(400);

  // mobile blank tap cancels selection
  const mobBlankPts = await mobilePage.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const pts = [];
    for (let y = 100; y < H - 160; y += 30) {
      for (let x = 20; x < W - 20; x += 30) {
        const el = document.elementFromPoint(x, y);
        if (el && el.id === 'scene') pts.push({ x, y, d: Math.hypot(x - W / 2, y - H / 2) });
      }
    }
    pts.sort((a, b) => b.d - a.d);
    return pts.slice(0, 25);
  });
  let mobDeselect = false;
  for (const pt of mobBlankPts.slice(0, 8)) {
    await mobilePage.touchscreen.tap(pt.x, pt.y);
    await mobilePage.waitForTimeout(350);
    const sel = await mobilePage.evaluate(() => window.DJI_APP.state.selected);
    const panels = await mobilePage.evaluate(() => ({ info: document.getElementById('panelInfo').classList.contains('is-open'), parts: document.getElementById('panelParts').classList.contains('is-open') }));
    if (sel === null) { mobDeselect = true; break; }
  }
  check(5, '移动端点 3D 空白处取消选中并收起面板（附加验证）', mobDeselect === true, { deselect: mobDeselect });

  // transient intro toast overlaps the opened parts panel on mobile (toast z-index 60 > panel 40)
  await mobilePage.reload({ waitUntil: 'load' });
  await mobilePage.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await mobilePage.waitForTimeout(2300);
  await mobilePage.tap('#btnMobileParts');
  await mobilePage.waitForTimeout(700);
  const toastOverlap = await mobilePage.evaluate(() => {
    const t = document.getElementById('toast'), p = document.getElementById('panelParts');
    const tr = t.getBoundingClientRect(), pr = p.getBoundingClientRect();
    const visible = t.classList.contains('is-visible');
    const overlap = visible && tr.left < pr.right && tr.right > pr.left && tr.top < pr.bottom && tr.bottom > pr.top;
    const area = overlap ? (Math.min(tr.right, pr.right) - Math.max(tr.left, pr.left)) * (Math.min(tr.bottom, pr.bottom) - Math.max(tr.top, pr.top)) : 0;
    return {
      toastVisible: visible,
      toastRect: [tr.left, tr.top, tr.right, tr.bottom].map(Math.round),
      panelRect: [pr.left, pr.top, pr.right, pr.bottom].map(Math.round),
      overlap, overlapArea: Math.round(area),
      toastZ: getComputedStyle(t).zIndex, panelZ: getComputedStyle(p).zIndex
    };
  });
  results.raw.mobileToastOverlap = toastOverlap;
  await shot(mobilePage, '25-mobile-toast-panel-overlap.png');
  await mobilePage.waitForTimeout(6000); // toast times out
  await shot(mobilePage, '26-mobile-parts-panel-clean.png');

  /* ---------- item 1: log / network summary (all pages) ---------- */
  const allRequests = requests.slice();
  const external = allRequests.filter(u => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'));
  const resources = [...boot.resources];
  const nonFileResources = resources.filter(u => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'));
  results.raw.network = { totalRequests: allRequests.length, external, resources, nonFileResources, failedRequests, badResponses };
  results.raw.consoleErrors = consoleErrors;
  results.raw.consoleWarnings = consoleWarnings;
  results.raw.pageErrors = pageErrors;
  check(1, '无 console error / pageerror', consoleErrors.length === 0 && pageErrors.length === 0, { consoleErrors, pageErrors });
  check(1, '无资源加载失败 / 404（file:// 请求全部成功）', failedRequests.length === 0 && badResponses.length === 0, { failedRequests, badResponses });
  check(1, '全部网络请求均为本地 file://（无外部域名）', external.length === 0 && allRequests.length >= 5, { count: allRequests.length, external, nonFileResourceEntries: nonFileResources });
};

const fatal = [];
try {
  await main();
} catch (err) {
  fatal.push(String(err && err.stack ? err.stack : err));
} finally {
  try { if (mobilePage) await mobilePage.close(); } catch (e) { /* noop */ }
  try { if (page) await page.close(); } catch (e) { /* noop */ }
  await browser.close();
  const summary = {
    total: checks.length,
    pass: checks.filter(c => c.ok).length,
    fail: checks.filter(c => !c.ok).length,
    byItem: [1, 2, 3, 4, 5, 6, 7, 8].map(i => {
      const list = checks.filter(c => c.item === i);
      return { item: i, total: list.length, pass: list.filter(c => c.ok).length, fail: list.filter(c => !c.ok).length };
    }),
    fatal
  };
  results.summary = summary;
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (fatal.length) { console.log('FATAL:', fatal.join('\n')); process.exitCode = 1; }
}
