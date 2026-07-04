/**
 * One command from a photo to viewer-ready assets:
 *   photo -> TRELLIS local API (:7960) -> assets/<name>.glb -> assets/<name>.usdz
 *
 * Usage:
 *   node photo-to-model.mjs <photo.(jpg|png)> <name> [options]
 *
 * Options:
 *   --host <url>      TRELLIS API (default http://127.0.0.1:7960)
 *   --seed <n>        default 1
 *   --steps <n>       sampling steps for both stages (default 12)
 *   --texture <px>    texture size (default 1024)
 *
 * Prerequisites: TRELLIS API server running (see docs/trellis-setup.md),
 * `npm install` done in tools/, and `uv` on PATH for the usdz stage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, glbBase64ToUsdz, assetsDir } from './lib.mjs';

const flags = { '--host': 'http://127.0.0.1:7960', '--seed': '1', '--steps': '12', '--texture': '1024' };
const positional = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] in flags) flags[argv[i]] = argv[++i];
  else positional.push(argv[i]);
}
const [input, name] = positional;
const { '--host': host, '--seed': seed, '--steps': steps, '--texture': texture } = flags;

if (!input || !name || !fs.existsSync(input)) {
  console.error('usage: node photo-to-model.mjs <photo.(jpg|png)> <name> [--host url] [--seed n] [--steps n] [--texture px]');
  process.exit(2);
}
if (!/^[\w-]+$/.test(name)) {
  console.error(`invalid name "${name}" (use letters, digits, - and _ only; it becomes the file/URL id)`);
  process.exit(2);
}

// サーバ生存確認を先に行い、生成専用のエラーと切り分ける
try {
  await fetch(`${host}/ping`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`TRELLIS API not reachable at ${host} — start the server first (docs/trellis-setup.md)`);
  process.exit(1);
}

console.log(`[gen] ${path.basename(input)} -> ${name} (seed=${seed} steps=${steps} texture=${texture})`);
const t0 = Date.now();

// v40はファイル添付経路にバグがあるため、image_base64フィールドで渡す
const form = new FormData();
form.set('image_base64', fs.readFileSync(input).toString('base64'));
form.set('seed', seed);
form.set('ss_sampling_steps', steps);
form.set('ss_guidance_strength', '7.5');
form.set('slat_sampling_steps', steps);
form.set('slat_guidance_strength', '3.0');
form.set('mesh_simplify_ratio', '0.95');
form.set('texture_size', texture);
form.set('output_format', 'glb');

const res = await fetch(`${host}/generate_no_preview`, {
  method: 'POST',
  body: form,
  signal: AbortSignal.timeout(30 * 60 * 1000)
});
if (!res.ok) {
  console.error(`generation failed: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
const info = await res.json();
if (info.status !== 'COMPLETE') {
  console.error(`generation did not complete: ${JSON.stringify(info)}`);
  process.exit(1);
}
console.log(`[gen] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const glbRes = await fetch(`${host}/download/model`, { signal: AbortSignal.timeout(120000) });
const glb = Buffer.from(await glbRes.arrayBuffer());
if (!glbRes.ok || glb.subarray(0, 4).toString() !== 'glTF') {
  console.error(`glb download failed: HTTP ${glbRes.status} size=${glb.length}`);
  process.exit(1);
}
fs.mkdirSync(assetsDir, { recursive: true });
const glbPath = path.join(assetsDir, `${name}.glb`);
fs.writeFileSync(glbPath, glb);
console.log(`[glb]  ${glbPath} (${glb.length.toLocaleString()} bytes)`);

const usdzPath = path.join(assetsDir, `${name}.usdz`);
await withPage(async (page) => {
  const size = await glbBase64ToUsdz(page, glb.toString('base64'), usdzPath);
  console.log(`[usdz] ${usdzPath} (${size.toLocaleString()} bytes)`);
});

console.log(`\nready: serve the viewer and open #m=${name}`);
console.log('  powershell -ExecutionPolicy Bypass -File ..\\serve.ps1');
