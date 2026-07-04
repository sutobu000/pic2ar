/**
 * End-to-end verification of the web-ar module:
 *   1. boots serve.py on :8420 (background child process)
 *   2. asserts /, /assets/model.glb, /assets/model.usdz respond 200 with
 *      Content-Length matching the files on disk
 *   3. opens the page in headless Chromium and waits until model-viewer has
 *      actually loaded the glb (CDN + glb parsing check), takes a screenshot
 *   4. stops the server (no process is left running)
 *
 * Usage: node verify.mjs [screenshot.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const webarDir = path.resolve(toolsDir, '..');
const BASE = 'http://localhost:8420';
const shotPath = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'web-ar-verify.png'));

let failed = false;

const server = spawn('python', [path.join(webarDir, 'serve.py')], { stdio: 'ignore' });
try {
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/`, { method: 'HEAD' });
      if (r.ok) { up = true; break; }
    } catch { /* サーバ起動待ちのリトライ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error('server did not come up on :8420');

  for (const rel of ['/', '/assets/model.glb', '/assets/model.usdz']) {
    const r = await fetch(BASE + rel, { method: 'HEAD' });
    const len = r.headers.get('content-length');
    const type = r.headers.get('content-type');
    let note = '';
    if (rel.startsWith('/assets/')) {
      const disk = String(fs.statSync(path.join(webarDir, rel.slice(1))).size);
      note = ` disk=${disk}`;
      if (len !== disk) failed = true;
    }
    if (!r.ok) failed = true;
    console.log(`${r.status} ${rel}  content-length=${len}${note}  content-type=${type}`);
  }

  const { browser, flavor } = await launchBrowser();
  console.log(`[browser] ${flavor}`);
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.on('pageerror', (e) => { failed = true; console.error('[pageerror]', e.message); });
    const glbResp = page.waitForResponse((r) => r.url().endsWith('/assets/model.glb'), { timeout: 30000 });
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => customElements.get('model-viewer') !== undefined, undefined, { timeout: 30000 });
    console.log('[page] model-viewer custom element registered (pinned CDN loaded)');
    console.log(`[page] glb fetch status: ${(await glbResp).status()}`);
    await page.waitForFunction(() => document.getElementById('viewer')?.loaded === true, undefined, { timeout: 60000 });
    console.log('[page] model-viewer .loaded === true (glb parsed, displayable)');
    // 初回描画が済んでからスクリーンショットを撮る(真っ黒防止の描画安定待ち)
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath });
    console.log(`[page] screenshot: ${shotPath}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}

if (failed) {
  console.error('VERIFY FAILED');
  process.exitCode = 1;
} else {
  console.log('VERIFY OK');
}
