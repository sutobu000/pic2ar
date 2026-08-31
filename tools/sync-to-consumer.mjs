/**
 * One-way sync: pic2ar (canonical, public) -> 3d-factory/web-ar (consumer).
 *
 * pic2arを唯一のソース(canonical)とし、共有ソース(ビューア本体・配信サーバ・tools)を
 * consumer側web-arへ一方向にコピーする。逆流(consumer->canonical)は一切しない。
 *
 * 設計上の要点(5修正):
 *  1. sha256ガード: 書き込んだ実体を読み戻してsha256照合し、破損/不完全コピーを検出して
 *     bust(壊れたコピーを消して非ゼロ終了)する。バイナリはraw、テキストはLF正規化して照合。
 *  2. index.htmlのサイド固有文字列は同期で壊さない: 見出し等はsite.config.json、モデル表示名は
 *     models.local.jsonへ実行時に分離済み。よってindex.html自体はサイド非依存でそのまま同期できる。
 *  3. models.local.jsonは同期対象外(各サイドでgitignore・ローカル管理)。site.config.jsonも各サイドが
 *     commitする共有設定なので上書きしない。下のEXCLUDE(=非マニフェスト)で担保。
 *  4. 配信ポートはserve.py/serve.ps1が環境変数WEBAR_PORT(既定8420)を見る(このスクリプトは非関与)。
 *  5. consumerはfactories/3d-factory配下のサブディレクトリ。既定パスはその入れ子を解決して指す
 *     (WEBAR_CONSUMER_DIRで上書き可)。
 *
 * Usage:
 *   node tools/sync-to-consumer.mjs [--dry-run]
 *   WEBAR_CONSUMER_DIR=/path/to/web-ar node tools/sync-to-consumer.mjs
 *
 * Exit code: 0 on success (including no-op), non-zero if an integrity check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const canonicalDir = path.resolve(toolsDir, '..'); // pic2ar repo root

// consumer(web-ar)の場所。未指定なら入れ子(factories/3d-factory/web-ar)を解決した既定を使う。
// 公開リポの利用者はWEBAR_CONSUMER_DIRを設定して自分の消費側を指すこと。
const DEFAULT_CONSUMER = path.resolve(
  canonicalDir, '..', '..', 'factories', '3d-factory', 'web-ar',
);
const consumerDir = process.env.WEBAR_CONSUMER_DIR
  ? path.resolve(process.env.WEBAR_CONSUMER_DIR)
  : DEFAULT_CONSUMER;

const dryRun = process.argv.includes('--dry-run');

// canonical->consumerで同期する共有ソース(=両サイドで同一であるべきファイル)。
// ここに無いものは同期しない = サイド固有として保護される:
//   site.config.json / models.local.json / .gitignore / README.md / docs/ / LICENSE /
//   assets/*(model.*等の既定エイリアスや生成物はサイドごとに異なるため触らない)
const MANIFEST = [
  'index.html',
  'serve.py',
  'serve.ps1',
  'tools/generate.html',
  'tools/glb-to-usdz.mjs',
  'tools/lib.mjs',
  'tools/make-test-model.mjs',
  'tools/photo-to-model.mjs',
  'tools/usdz-arkit.py',
  'tools/verify.mjs',
  'tools/package.json',
  'tools/package-lock.json',
];

// バイナリはbyte厳密、テキストはLF正規化して扱う(CRLF/LF差だけの無意味な同期を避ける)
const BINARY_EXT = new Set(['.glb', '.usdz', '.gltf', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2']);
const isBinary = (rel) => BINARY_EXT.has(path.extname(rel).toLowerCase());

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const normalizeLF = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');

/** 同期する意図のバイト列を作る(テキストはLF正規化)。 */
function intendedBytes(rel, srcBuf) {
  return isBinary(rel) ? srcBuf : normalizeLF(srcBuf);
}

const results = { copied: [], skipped: [], missingSrc: [] };

for (const rel of MANIFEST) {
  const src = path.join(canonicalDir, rel);
  const dst = path.join(consumerDir, rel);

  if (!fs.existsSync(src)) {
    results.missingSrc.push(rel);
    continue;
  }

  const srcBuf = fs.readFileSync(src);
  const want = intendedBytes(rel, srcBuf);
  const wantHash = sha256(want);

  // 既存destが意図内容と一致するなら何もしない(冪等)
  if (fs.existsSync(dst)) {
    const curHash = sha256(intendedBytes(rel, fs.readFileSync(dst)));
    if (curHash === wantHash) {
      results.skipped.push(rel);
      continue;
    }
  }

  if (dryRun) {
    results.copied.push(rel);
    continue;
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });

  // テスト用フォールト注入: 指定relのとき書き込み直前に1バイト壊し、sha256ガードの発火を確認する。
  let toWrite = want;
  if (process.env.WEBAR_SYNC_FAULT === rel) {
    toWrite = Buffer.from(want);
    toWrite[0] = toWrite[0] ^ 0xff;
  }
  fs.writeFileSync(dst, toWrite);

  // sha256ガード: 書き込んだ実体を読み戻して照合。ズレていれば破損とみなしbustする。
  const gotHash = sha256(intendedBytes(rel, fs.readFileSync(dst)));
  if (gotHash !== wantHash) {
    fs.rmSync(dst, { force: true });
    console.error(`[BUST] integrity check failed for ${rel}`);
    console.error(`  expected sha256=${wantHash}`);
    console.error(`  got      sha256=${gotHash}`);
    console.error('  corrupted copy removed. aborting.');
    process.exit(2);
  }
  results.copied.push(rel);
}

// レポート
const mode = dryRun ? '(dry-run) ' : '';
console.log(`sync ${mode}canonical -> consumer`);
console.log(`  canonical: ${canonicalDir}`);
console.log(`  consumer : ${consumerDir}`);
console.log(`  ${dryRun ? 'would copy' : 'copied'}: ${results.copied.length}`);
for (const r of results.copied) console.log(`    ~ ${r}`);
console.log(`  unchanged: ${results.skipped.length}`);
if (results.missingSrc.length) {
  console.log(`  MISSING in canonical: ${results.missingSrc.length}`);
  for (const r of results.missingSrc) console.log(`    ! ${r}`);
}
if (!fs.existsSync(consumerDir)) {
  console.error(`\n[warn] consumer dir does not exist: ${consumerDir}`);
  console.error('       set WEBAR_CONSUMER_DIR to the web-ar path.');
}
