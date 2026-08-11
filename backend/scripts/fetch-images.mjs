#!/usr/bin/env node
/**
 * 一次性开发工具: 把 manifest 的远程图片下载并压缩为「克隆即用」资产。
 *
 * 背景(#10 联调): 用户机器(尤其国内)可能连不上 upload.wikimedia.org,
 * 且原图直链 429 限流。本脚本:
 *   1) 走 Special:FilePath?width=2560 通道(稳定 200)逐张下载
 *   2) sharp 压缩至最长边 2560、JPEG q82,存 data/images/{sourceId}.jpg
 *   3) 更新 data/manifest.json: 每条加 localFile(相对 backend CWD 的 ../data/images/...)
 * 之后 `npm run import` 走本地文件,零网络;import.job 的 localFile 分支
 * 用 path.resolve(localFile) 相对 CWD(backend/)解析,故用 ../data/images/...。
 *
 * 幂等: 已存在且非空的目标文件跳过下载(可断点重跑)。
 * 用法: node scripts/fetch-images.mjs [--width 2560]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');
const OUT_DIR = path.join(ROOT, 'data', 'images');

const widthArg = process.argv.find((a) => a.startsWith('--width='));
const WIDTH = widthArg ? Number(widthArg.split('=')[1]) : 2560;
const MIN_INTERVAL_MS = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 429/5xx 尊重 Retry-After,否则指数退避;最多 maxRetries 次 */
async function downloadWithRetry(url, ua, maxRetries = 5) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': ua },
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      lastErr = err;
      await sleep(4000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error(`空响应 ${url}`);
      return buf;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} ${url}`);
      const retryAfter = Number(res.headers.get('retry-after'));
      // Retry-After 可能给 600s(10 分钟),钳制到 20s,避免单条目卡死整批
      const retryAfterMs = retryAfter ? Math.min(retryAfter * 1000, 20_000) : 0;
      const delay = Math.max(retryAfterMs, 5000 * 2 ** attempt);
      console.error(`[retry] ${url.split('/').pop()} HTTP ${res.status}, ${Math.round(delay / 1000)}s 后重试(${attempt + 1}/${maxRetries})`);
      await sleep(delay);
      continue;
    }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  throw lastErr ?? new Error(`下载失败 ${url}`);
}

/** Special:FilePath 是官方建议的稳定通道(data/README 实测) */
function fallbackUrl(imageUrl) {
  const u = new URL(imageUrl);
  if (u.hostname !== 'upload.wikimedia.org') return undefined;
  const filename = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  if (!filename) return undefined;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${WIDTH}`;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ua = 'wallflow-assets/0.1 (curated manifest; github.com/noobtang/wallflow)';

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < manifest.length; i++) {
    const e = manifest[i];
    const outFile = path.join(OUT_DIR, `${e.sourceId}.jpg`);
    const rel = `../data/images/${e.sourceId}.jpg`;

    // 已存在且非空 → 跳过(断点重跑)
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1024) {
      if (!e.localFile) e.localFile = rel;
      ok += 1;
      console.log(`[skip]  ${e.sourceId} (已有资产)`);
      continue;
    }

    const fb = fallbackUrl(e.imageUrl);
    try {
      const buf = await downloadWithRetry(fb ?? e.imageUrl, ua);
      // 压缩: 最长边 WIDTH,JPEG q82(壁纸原图入库体积控制)
      await sharp(buf)
        .resize({ width: WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toFile(outFile);
      e.localFile = rel;
      ok += 1;
      const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
      console.log(`[ok]    ${e.sourceId} (${sizeKb}KB)`);
    } catch (err) {
      failed += 1;
      console.error(`[fail]  ${e.sourceId}: ${err.message}`);
    }
    await sleep(MIN_INTERVAL_MS);
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n完成: ${ok} 条有资产 / ${failed} 条失败(localFile 已写入 manifest)`);
  const totalBytes = fs
    .readdirSync(OUT_DIR)
    .reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`data/images 总大小: ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('fetch-images 失败:', err);
  process.exit(1);
});
