/**
 * Converts a .glb to .usdz fully locally (three.js USDZExporter running in
 * headless Chromium via Playwright).
 *
 * Usage:   node glb-to-usdz.mjs [input.glb] [output.usdz]
 * Default: ../assets/model.glb -> ../assets/model.usdz
 *
 * 注意: Draco/KTX2圧縮されたglbは追加のデコーダ設定が必要なため未対応。
 */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, glbBase64ToUsdz, assetsDir } from './lib.mjs';

const input = path.resolve(process.argv[2] ?? path.join(assetsDir, 'model.glb'));
const output = path.resolve(process.argv[3] ?? path.join(assetsDir, 'model.usdz'));

if (!fs.existsSync(input)) {
  console.error(`input glb not found: ${input}`);
  process.exit(1);
}

const glbB64 = fs.readFileSync(input).toString('base64');
await withPage(async (page) => {
  const size = await glbBase64ToUsdz(page, glbB64, output);
  console.log(`[usdz] ${output} (${size.toLocaleString()} bytes)`);
});

console.log('done');
