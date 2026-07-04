/**
 * Generates a textured test model (torus knot, ~30 cm) as assets/model.glb,
 * then round-trips it through GLTFLoader -> USDZExporter to produce
 * assets/model.usdz.
 *
 * 背景: 生成エンジンを立てる前でもビューアとusdz変換の疎通を試せるよう、
 * テスト用モデルをプログラム生成している(権利的にも完全フリー)。本物のglbが
 * できたらassets/へ置き、photo-to-model.mjs / glb-to-usdz.mjsの経路を使う。
 */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, glbBase64ToUsdz, assetsDir } from './lib.mjs';

const glbPath = path.join(assetsDir, 'model.glb');
const usdzPath = path.join(assetsDir, 'model.usdz');

fs.mkdirSync(assetsDir, { recursive: true });

await withPage(async (page) => {
  const glbB64 = await page.evaluate(() => window.makeGLB());
  fs.writeFileSync(glbPath, Buffer.from(glbB64, 'base64'));
  console.log(`[glb]  ${glbPath} (${fs.statSync(glbPath).size.toLocaleString()} bytes)`);

  // ディスクへ書いたglbを読み直して変換する(実運用のglb差し替えと同じ経路を通すため)
  const fromDisk = fs.readFileSync(glbPath).toString('base64');
  const size = await glbBase64ToUsdz(page, fromDisk, usdzPath);
  console.log(`[usdz] ${usdzPath} (${size.toLocaleString()} bytes)`);
});

console.log('done');
