/**
 * Shared helpers for the glb/usdz tooling:
 * - a tiny static server rooted at tools/ so the headless page can import
 *   three.js from node_modules with correct module MIME types
 * - a Chromium launcher with fallbacks (bundled -> Chrome -> Edge)
 * - a helper that runs window.glbToUSDZ inside the page and writes the result
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const toolsDir = path.dirname(fileURLToPath(import.meta.url));
export const assetsDir = path.resolve(toolsDir, '..', 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const fp = path.normalize(path.join(toolsDir, urlPath === '/' ? 'generate.html' : urlPath));
      // tools/配下の外へ出るパスは拒否する(念のためのパストラバーサル対策)
      if (!fp.startsWith(toolsDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(fp, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found: ' + urlPath);
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export async function launchBrowser() {
  // playwright同梱chromiumが未ダウンロードでも、この機のChrome/Edgeで完走できるよう順に試す
  const attempts = [
    { name: 'bundled chromium', opts: {} },
    { name: 'system chrome', opts: { channel: 'chrome' } },
    { name: 'system msedge', opts: { channel: 'msedge' } }
  ];
  const errors = [];
  for (const a of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, ...a.opts });
      return { browser, flavor: a.name };
    } catch (e) {
      errors.push(`${a.name}: ${String(e.message).split('\n')[0]}`);
    }
  }
  throw new Error(
    'No Chromium-family browser could be launched:\n' + errors.join('\n') +
    '\nFix: npx playwright install chromium'
  );
}

/** Boots server + headless page (generate.html), runs fn(page), cleans up. */
export async function withPage(fn) {
  const server = await startServer();
  const { port } = server.address();
  const { browser, flavor } = await launchBrowser();
  console.log(`[browser] ${flavor}`);
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('[page:error]', m.text()); });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`http://127.0.0.1:${port}/generate.html`);
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });
    return await fn(page);
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * Converts base64 glb -> usdz inside the page and writes it to outPath.
 * Two stages:
 *   1. three.js USDZExporter (in the page) -> usdz containing ASCII .usda layers
 *   2. usd-core (Pixar) -> repackage as ARKit-compliant usdz with one binary
 *      .usdc layer + compliance check
 * 背景: AR Quick Lookの要件(および本モジュールの検収条件)は「.usdcエントリを含む
 * 正しいusdz」。three.js単体は.usdaしか書けないため、usd-coreで最終形へ変換する。
 */
export async function glbBase64ToUsdz(page, glbBase64, outPath) {
  const usdzB64 = await page.evaluate((b64) => window.glbToUSDZ(b64), glbBase64);
  const tmpPath = outPath + '.three.tmp.usdz';
  fs.writeFileSync(tmpPath, Buffer.from(usdzB64, 'base64'));
  try {
    execFileSync(
      'uv',
      ['run', '--no-project', '--with', 'usd-core', 'python',
       path.join(toolsDir, 'usdz-arkit.py'), tmpPath, outPath],
      { stdio: 'inherit' }
    );
  } catch (e) {
    throw new Error(
      'usd-core post-process failed. Requires `uv` on PATH (or run manually: ' +
      `pip install usd-core; python usdz-arkit.py "${tmpPath}" "${outPath}"). ` + e.message
    );
  } finally {
    if (fs.existsSync(outPath)) fs.rmSync(tmpPath, { force: true });
  }
  return fs.statSync(outPath).size;
}
