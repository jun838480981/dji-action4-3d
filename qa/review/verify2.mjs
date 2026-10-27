/* Follow-up verification: re-test doubtful checks with proper settling & normalized comparisons. */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('F:/LearnSpace/前端与Web/dsh大肥鱼/qq-bot/node_modules/playwright-core');
const project = 'F:/LearnSpace/前端与Web/dji-action4-3d';
const outDir = path.join(project, 'qa', 'review');
const url = pathToFileURL(path.join(project, 'index.html')).href;
const reference = fs.readFileSync(path.join(project, 'docs', 'dji-action4-reference.md'), 'utf8');
const norm = s => String(s).replace(/\s+/g, '');
const out = {};
const shot = async (p, name) => { await p.screenshot({ path: path.join(outDir, name) }); };

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

const waitPct = async (pg, target) => pg.waitForFunction(t => document.getElementById('explodePct').textContent === t, target, { timeout: 15000, polling: 100 });
const readSel = pg => pg.evaluate(() => window.DJI_APP.state.selected);

async function findBlank(pg) {
  return pg.evaluate(() => {
    const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, pts = [];
    for (let y = 110; y < H - 160; y += 32) {
      for (let x = 340; x < W - 360; x += 32) {
        const el = document.elementFromPoint(x, y);
        if (el && el.id === 'scene') pts.push({ x, y, d: Math.hypot(x - cx, y - cy) });
      }
    }
    pts.sort((a, b) => b.d - a.d);
    return pts.slice(0, 30);
  });
}
async function deselect(pg) {
  const pts = await findBlank(pg);
  for (const pt of pts) {
    await pg.mouse.click(pt.x, pt.y);
    await pg.waitForTimeout(200);
    if ((await readSel(pg)) === null) return true;
  }
  return false;
}
async function projectPoint(pg, id, which) {
  return pg.evaluate(arg => {
    const app = window.DJI_APP;
    const T = window.THREE_BUNDLE.THREE;
    const part = app.getModel().byId[arg.id];
    if (!part) return null;
    const v = new T.Vector3();
    if (arg.which === 'pivot') part.pivot.getWorldPosition(v);
    else if (arg.which === 'anchor') part.anchor.getWorldPosition(v);
    else v.copy(part.center).applyMatrix4(part.pivot.matrixWorld);
    v.project(app.getCamera());
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z };
  }, { id, which });
}

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(7200); // let boot + intro toast finish

  /* ---------- clean assembled screenshot + double-click list item ---------- */
  await shot(page, '16-1600x1000-assembled-clean.png');
  await page.click('.part-item[data-id="lens"]');
  await waitPct(page, '100%');
  await page.waitForTimeout(2000);
  const firstClick = await page.evaluate(() => ({ selected: window.DJI_APP.state.selected, exploded: window.DJI_APP.state.exploded }));
  await page.click('.part-item[data-id="lens"]');
  await page.waitForTimeout(900);
  const secondClick = await page.evaluate(() => ({ selected: window.DJI_APP.state.selected, exploded: window.DJI_APP.state.exploded }));
  out.sameItemTwice = { firstClick, secondClick };

  /* ---------- labels fully settled ---------- */
  await deselect(page);
  await page.waitForTimeout(2600);
  const labelSettled = await page.evaluate(() => {
    const T = window.THREE_BUNDLE.THREE;
    const app = window.DJI_APP;
    const camDir = new T.Vector3();
    app.getCamera().getWorldDirection(camDir);
    const labels = Array.from(document.querySelectorAll('.part-label')).map(el => {
      const part = app.getModel().byId[el.dataset.id];
      const v = new T.Vector3();
      part.anchor.getWorldPosition(v);
      v.project(app.getCamera());
      const sx = (v.x * 0.5 + 0.5) * innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.id,
        visible: el.classList.contains('is-visible'),
        proj: { x: Math.round(sx), y: Math.round(sy), z: +v.z.toFixed(2) },
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
        offscreenProj: sx < 0 || sx > innerWidth || sy < 0 || sy > innerHeight
      };
    });
    return {
      dom: labels.length,
      visible: labels.filter(l => l.visible).length,
      pct: document.getElementById('explodePct').textContent,
      selected: app.state.selected,
      labels
    };
  });
  out.labelsSettled = { dom: labelSettled.dom, visible: labelSettled.visible, pct: labelSettled.pct, hidden: labelSettled.labels.filter(l => !l.visible), selected: labelSettled.selected };
  await shot(page, '17-1600x1000-exploded-labels-clean.png');

  /* ---------- 3D canvas picking while assembled ---------- */
  await page.click('#btnExplode'); // assemble (currently exploded)
  await waitPct(page, '00%');
  await page.waitForTimeout(2400);
  await deselect(page);
  await page.waitForTimeout(600);
  const canvasPicking = [];
  for (const id of ['lens', 'frontScreen', 'frontCover', 'buttons', 'mount', 'batteryDoor', 'usbDoor']) {
    // ensure assembled
    if ((await page.evaluate(() => window.DJI_APP.state.exploded)) === true) {
      await page.click('#btnExplode');
      await waitPct(page, '00%');
      await page.waitForTimeout(2000);
    }
    await deselect(page);
    await page.waitForTimeout(500);
    const pt = await projectPoint(page, id, 'pivot');
    if (!pt) { canvasPicking.push({ id, hit: null, error: 'no point' }); continue; }
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(800);
    const hit = await readSel(page);
    canvasPicking.push({ id, point: { x: Math.round(pt.x), y: Math.round(pt.y) }, hit, exact: hit === id, any: !!hit });
    // reset selection for next round: assemble next iteration will deselect via setExploded(false)
  }
  out.canvasPicking = canvasPicking;
  // plain center click
  if (await page.evaluate(() => window.DJI_APP.state.exploded)) {
    await page.click('#btnExplode'); await waitPct(page, '00%'); await page.waitForTimeout(2000);
  }
  await deselect(page); await page.waitForTimeout(500);
  await page.mouse.click(800, 500);
  await page.waitForTimeout(800);
  out.centerClick = { hit: await readSel(page) };

  /* ---------- hover ---------- */
  if (await page.evaluate(() => window.DJI_APP.state.exploded)) {
    await page.click('#btnExplode'); await waitPct(page, '00%'); await page.waitForTimeout(2000);
  }
  await deselect(page); await page.waitForTimeout(500);
  const hoverResults = [];
  for (const id of ['lens', 'frontCover', 'mount', 'buttons']) {
    const pt = await projectPoint(page, id, 'pivot');
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(450);
    const h = await page.evaluate(() => ({
      visible: document.getElementById('hoverTag').classList.contains('is-visible'),
      name: document.getElementById('hoverName').textContent,
      cursor: document.getElementById('scene').style.cursor
    }));
    hoverResults.push({ id, point: { x: Math.round(pt.x), y: Math.round(pt.y) }, ...h });
  }
  out.hover = hoverResults;
  // screenshot with the last successful hover
  await shot(page, '18-hover-check.png');

  /* ---------- 定位所选 (move camera away first) ---------- */
  await page.click('.part-item[data-id="lens"]');
  await waitPct(page, '100%');
  await page.waitForTimeout(2200);
  const focusBtnState = await page.evaluate(() => document.getElementById('btnFocusSelected').disabled);
  const camBefore = await page.evaluate(() => window.DJI_APP.getCamera().position.toArray());
  // rotate/pan camera away by dragging
  await page.mouse.move(760, 520);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(760 + i * 30, 520 + i * 12); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const camAway = await page.evaluate(() => window.DJI_APP.getCamera().position.toArray());
  await page.click('#btnFocusSelected');
  await page.waitForTimeout(1900);
  const camFocus = await page.evaluate(() => window.DJI_APP.getCamera().position.toArray());
  const movedAway = Math.hypot(camAway[0] - camBefore[0], camAway[1] - camBefore[1], camAway[2] - camBefore[2]);
  const movedFocus = Math.hypot(camFocus[0] - camAway[0], camFocus[1] - camAway[1], camFocus[2] - camAway[2]);
  out.focusSelected = { disabled: focusBtnState, movedAway: +movedAway.toFixed(2), movedFocus: +movedFocus.toFixed(2) };
  await shot(page, '19-focus-selected.png');

  /* ---------- normalized parameter comparison ---------- */
  await page.click('.info-tab[data-tab="specs"]');
  await page.waitForTimeout(600);
  const specsRaw = await page.evaluate(() => document.getElementById('infoBody').innerText);
  await page.click('.info-tab[data-tab="detail"]');
  await page.waitForTimeout(400);
  const overviewRaw = await page.evaluate(() => document.getElementById('infoBody').innerText);
  const detailRaw = {};
  for (const id of ['lens', 'sensor', 'frontScreen', 'rearScreen', 'battery', 'batteryDoor', 'usbDoor', 'frontCover', 'buttons', 'mount', 'mainboard', 'cooling']) {
    await page.evaluate(pid => window.DJI_APP.selectPart(pid), id);
    await page.waitForTimeout(800);
    detailRaw[id] = await page.evaluate(() => document.getElementById('infoBody').innerText);
  }
  const pageAll = norm([specsRaw, overviewRaw, ...Object.values(detailRaw)].join('\n'));
  const docAll = norm(reference);
  const table = [
    ['镜头 Φ35', 'Φ35'], ['光圈 f/2.8', 'f/2.8'], ['视场角 155°', '155°'],
    ['前屏 1.4 英寸', '1.4英寸'], ['前屏 320×320', '320×320'],
    ['后屏 2.25 英寸', '2.25英寸'], ['后屏 640×360', '640×360'],
    ['电池 1770 mAh', '1770mAh'], ['电池 6.8 Wh', '6.8Wh'], ['电池 3.85 V', '3.85V'],
    ['尺寸 70.5×44.2×32.8 mm', '70.5×44.2×32.8mm'], ['重量 145 g', '145g'],
    ['防水 18 m', '18m'], ['续航 160 分钟', '160分钟'],
    ['充电 18 min 充至 80%', '18min充至80%'], ['充电 49 min 充满', '49min充满'],
    ['码流 130 Mbps', '130Mbps'], ['色彩 10-bit D-Log M', '10-bitD-LogM'],
    ['像素 3648×2736', '3648×2736'], ['前屏 323 ppi', '323ppi'], ['后屏 326 ppi', '326ppi'],
    ['亮度 750 nit', '750nit'], ['麦克风 3 个（前2+底部防风1）', '3个（前2+底部防风1）'],
    ['音频 48 kHz 16-bit AAC', '48kHz16-bitAAC'],
    ['存储 microSD ≤512 GB / exFAT / 无内置存储', 'microSD≤512GB'],
    ['无线 Wi-Fi 802.11 a/b/g/n/ac + BLE 5.0', '802.11a/b/g/n/ac'],
    ['温度 -20°C~45°C 使用 / 5°C~40°C 充电', '-20°C~45°C'],
    ['前盖圆角 R3', 'R3'], ['电池仓盖 41×28', '41×28'], ['USB-C 盖 17×13', '17×13'],
    ['磁吸面 46×26', '46×26'], ['视频 4K16:9 ≤120fps', '4K16:9≤120fps'],
    ['慢动作 1080p ≤240fps', '240fps'], ['对焦 0.4m ~ ∞', '0.4m~∞'],
    ['触控策略 前后屏不能同时触控', '前后屏不能同时触控']
  ];
  const docAliases = {
    '前屏 1.4 英寸': '1.4英寸', '后屏 2.25 英寸': '2.25英寸',
    '电池 1770 mAh': '1770mAh', '电池 6.8 Wh': '6.8Wh', '电池 3.85 V': '3.85V',
    '尺寸 70.5×44.2×32.8 mm': '70.5×44.2×32.8mm', '重量 145 g': '145g', '防水 18 m': '18m',
    '续航 160 分钟': '160min', '充电 18 min 充至 80%': '18min充至80%', '充电 49 min 充满': '49min充满',
    '码流 130 Mbps': '130Mbps', '色彩 10-bit D-Log M': '10-bitD-LogM', '像素 3648×2736': '3648×2736',
    '前屏 323 ppi': '323ppi', '后屏 326 ppi': '326ppi', '亮度 750 nit': '750nit',
    '麦克风 3 个（前2+底部防风1）': '3个（前2+底部防风1）', '音频 48 kHz 16-bit AAC': '48kHz16-bitAAC',
    '存储 microSD ≤512 GB / exFAT / 无内置存储': 'microSD≤512GB',
    '无线 Wi-Fi 802.11 a/b/g/n/ac + BLE 5.0': '802.11a/b/g/n/ac', '温度 -20°C~45°C 使用 / 5°C~40°C 充电': '-20℃~45℃',
    '前盖圆角 R3': 'R3', '电池仓盖 41×28': '41×28', 'USB-C 盖 17×13': '17×13', '磁吸面 46×26': '46×26',
    '视频 4K16:9 ≤120fps': '4K16:9≤120fps', '慢动作 1080p ≤240fps': '240fps', '对焦 0.4m ~ ∞': '0.4m~∞',
    '触控策略 前后屏不能同时触控': '前后屏不能同时触控'
  };
  const paramRows = table.map(([label, token]) => {
    const docToken = docAliases[label] || token;
    return { label, token, inPage: pageAll.includes(norm(token)), docToken, inDoc: docAll.includes(norm(docToken)) };
  });
  out.params = { mismatchPage: paramRows.filter(r => !r.inPage), mismatchDoc: paramRows.filter(r => !r.inDoc), rows: paramRows };
  out.hlg = { pageHasHLG: /HLG/.test(pageAll), docHasHLG: /HLG/.test(docAll) };
  out.specsTextExcerpt = specsRaw.slice(0, 2200);

  /* ---------- clean responsive screenshots ---------- */
  if (await page.evaluate(() => window.DJI_APP.state.exploded)) {
    await page.click('#btnExplode'); await waitPct(page, '00%'); await page.waitForTimeout(1800);
  }
  await deselect(page);
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.waitForTimeout(1800);
  await shot(page, '20-1100x780-assembled-clean.png');
  await page.click('#btnExplode');
  await waitPct(page, '100%');
  await page.waitForTimeout(2800);
  await shot(page, '21-1100x780-exploded-clean.png');
  await page.click('#btnExplode');
  await waitPct(page, '00%');
  await page.waitForTimeout(1800);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(1600);
  await shot(page, '22-1600x1000-assembled-after.png');

  /* ---------- mobile follow-up ---------- */
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mp.goto(url, { waitUntil: 'load', timeout: 30000 });
  await mp.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await mp.waitForTimeout(7200); // toast gone

  const mobileEntry = await mp.evaluate(() => {
    const guideBtn = document.getElementById('btnGuide');
    const cs = getComputedStyle(guideBtn);
    const visibleButtons = Array.from(document.querySelectorAll('button')).filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(b).display !== 'none' && getComputedStyle(b).visibility !== 'hidden';
    }).map(b => (b.id || '') + '|' + (b.textContent || '').trim().slice(0, 20));
    return {
      guideDisplay: cs.display,
      guideRect: (r => [r.left, r.top, r.width, r.height])(guideBtn.getBoundingClientRect()),
      visibleButtons,
      guideModalHidden: document.getElementById('guideModal').hidden,
      anyVisibleGuideText: visibleButtons.some(t => t.indexOf('操作指南') >= 0)
    };
  });
  out.mobileGuide = mobileEntry;
  await shot(mp, '23-mobile-390x844-clean.png');

  // mobile labels toggle: explode first, then toggle labels, count visible
  await mp.tap('#btnExplode');
  await waitPct(mp, '100%');
  await mp.waitForTimeout(1800);
  const labelsBefore = await mp.evaluate(() => ({
    on: window.DJI_APP.state.labelsOn,
    visible: document.querySelectorAll('.part-label.is-visible').length,
    display: getComputedStyle(document.querySelector('.part-label')).display
  }));
  await mp.tap('#btnLabels');
  await mp.waitForTimeout(700);
  const labelsAfter = await mp.evaluate(() => ({
    on: window.DJI_APP.state.labelsOn,
    visible: document.querySelectorAll('.part-label.is-visible').length,
    display: getComputedStyle(document.querySelector('.part-label')).display,
    pressed: document.getElementById('btnLabels').getAttribute('aria-pressed')
  }));
  out.mobileLabels = { before: labelsBefore, after: labelsAfter };
  await shot(mp, '24-mobile-exploded-label-toggle.png');

  // toast vs panel overlap: reload and open parts panel while intro toast is visible
  await mp.reload({ waitUntil: 'load' });
  await mp.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await mp.waitForTimeout(2300); // boot done, intro toast active
  await mp.tap('#btnMobileParts');
  await mp.waitForTimeout(600);
  const toastOverlap = await mp.evaluate(() => {
    const t = document.getElementById('toast');
    const p = document.getElementById('panelParts');
    const tr = t.getBoundingClientRect(), pr = p.getBoundingClientRect();
    const visible = t.classList.contains('is-visible');
    const overlap = visible && tr.left < pr.right && tr.right > pr.left && tr.top < pr.bottom && tr.bottom > pr.top;
    const area = overlap ? Math.max(0, Math.min(tr.right, pr.right) - Math.max(tr.left, pr.left)) * Math.max(0, Math.min(tr.bottom, pr.bottom) - Math.max(tr.top, pr.top)) : 0;
    return { toastVisible: visible, toastRect: [tr.left, tr.top, tr.right, tr.bottom].map(v => Math.round(v)), panelRect: [pr.left, pr.top, pr.right, pr.bottom].map(v => Math.round(v)), overlap, overlapArea: Math.round(area), toastZ: getComputedStyle(t).zIndex, panelZ: getComputedStyle(p).zIndex };
  });
  out.mobileToastOverlap = toastOverlap;
  await shot(mp, '25-mobile-toast-panel-overlap.png');
  await mp.close();
} catch (err) {
  out.error = String(err && err.stack ? err.stack : err);
} finally {
  await page.close().catch(() => {});
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'results-followup.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
