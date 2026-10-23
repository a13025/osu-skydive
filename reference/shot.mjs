// 本地测试脚本：用无头 Chromium (SwiftShader) 渲染 dist/index.html，输出截图与控制台日志
// 用法: node reference/shot.mjs "<alt>:<dragX>x<dragY>:<name>,..."
import { chromium } from '/tmp/pw/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5179, r));

const specs = (process.argv[2] || '2700:0x0:a').split(',').map((s) => {
  const [alt, drag, name] = s.split(':');
  const [dx, dy] = (drag || '0x0').split('x').map(Number);
  return { alt: Number(alt), dx, dy, name: name || `alt${alt}` };
});

const browser = await chromium.launch({
  executablePath: '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1120, height: 630 } });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/React DevTools/.test(t)) logs.push(`[${m.type()}] ${t.slice(0, 500)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5179/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skyScene, null, { timeout: 60000 });
await page.waitForTimeout(2500);

for (const s of specs) {
  await page.evaluate((alt) => window.__skyScene.jumpTo(alt), s.alt);
  if (s.dx || s.dy) {
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(640 + s.dx, 360 + s.dy, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `reference/shot_${s.name}.png`, timeout: 120000, animations: 'disabled' });
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 90));
  console.log(`shot_${s.name} :: ${txt}`);
  // 拖回去
  if (s.dx || s.dy) {
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(640 - s.dx, 360 - s.dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
}
console.log('--- console ---');
console.log(logs.slice(0, 30).join('\n') || '(no console output)');
await browser.close();
server.close();
