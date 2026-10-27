import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('F:/LearnSpace/前端与Web/dsh大肥鱼/qq-bot/node_modules/playwright-core');
const project = 'F:/LearnSpace/前端与Web/dji-action4-3d';
const url = pathToFileURL(path.join(project, 'index.html')).href;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist']
});

async function probe(label, opts) {
  const p = await browser.newPage(opts);
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  const data = await p.evaluate(() => {
    const bar = document.querySelector('.topbar-actions');
    const kids = Array.from(bar.children).map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { n: i + 1, id: el.id, cls: el.className, display: cs.display, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    });
    const mq = window.matchMedia('(max-width:430px)').matches;
    const mq960 = window.matchMedia('(max-width:960px)').matches;
    return {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      visualViewportWidth: window.visualViewport ? window.visualViewport.width : null,
      docClientWidth: document.documentElement.clientWidth,
      mq430: mq, mq960: mq960,
      kids,
      topbarActionsRect: (r => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)])(bar.getBoundingClientRect()),
      dpr: window.devicePixelRatio,
      isMobileUA: /Mobile|Android|iPhone/.test(navigator.userAgent),
      ua: navigator.userAgent.slice(0, 80)
    };
  });
  data.label = label;
  await p.close();
  return data;
}

const results = [];
results.push(await probe('mobile-first-390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }));

// now a desktop page then a mobile page (like the verification scripts)
const d = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await d.goto(url, { waitUntil: 'load' });
await d.waitForFunction(() => window.DJI_APP && window.DJI_APP.state.ready === true, null, { timeout: 30000 });
await d.waitForTimeout(2000);
results.push(await probe('mobile-after-desktop-390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }));
results.push(await probe('mobile-390-no-isMobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }));
results.push(await probe('mobile-430', { viewport: { width: 430, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }));
await d.close();
await browser.close();
fs.writeFileSync(path.join(project, 'qa', 'review', 'probe-mobile-guide.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
