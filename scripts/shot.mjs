// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [actions-js]
import { chromium } from 'playwright-core';
const [url, out, w = '1440', h = '900', actions = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const isMobile = Number(w) < 1000;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: isMobile ? 2 : 1, hasTouch: isMobile, isMobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
if (actions) {
  const fn = new Function('page', `return (async () => { ${actions} })()`);
  await fn(page);
}
await page.screenshot({ path: out });
console.log(logs.slice(-30).join('\n'));
await browser.close();
