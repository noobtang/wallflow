#!/usr/bin/env node
/**
 * 慢速补跑 v2 — 多轮模式:
 * 每轮对缺资产的条目逐个下载(间隔 30s, 单条最多 3 次重试、退避上限 60s),
 * 失败的进入下一轮; 循环直到全部成功或连续 2 轮无进展。
 * 用法: node scripts/fetch-images-retry.mjs [--rounds N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');
const OUT_DIR = path.join(ROOT, 'data', 'images');
const WIDTH = 2560;
const MIN_INTERVAL_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadWithRetry(url, ua, maxRetries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      lastErr = err;
      await sleep(30000);
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
      const retryAfterMs = retryAfter ? Math.min(retryAfter * 1000, 60_000) : 0;
      const delay = Math.max(retryAfterMs, 30000);
      console.error(`[retry] ${url.split('/').pop().slice(0, 60)} HTTP ${res.status}, ${Math.round(delay / 1000)}s 后重试(${attempt + 1}/${maxRetries})`);
      await sleep(delay);
      continue;
    }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  throw lastErr ?? new Error(`下载失败 ${url}`);
}

function fallbackUrl(imageUrl) {
  const u = new URL(imageUrl);
  if (u.hostname !== 'upload.wikimedia.org') return undefined;
  const filename = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  if (!filename) return undefined;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${WIDTH}`;
}

function missingEntries(manifest) {
  return manifest.filter((e) => {
    const f = path.join(OUT_DIR, `${e.sourceId}.jpg`);
    return !fs.existsSync(f) || fs.statSync(f).size <= 1024;
  });
}

async function main() {
  const roundsArg = process.argv.find((a) => a.startsWith('--rounds='));
  const maxRounds = roundsArg ? Number(roundsArg.split('=')[1]) : 6;
  const ua = 'wallflow-assets/0.3 (curated manifest; github.com/noobtang/wallflow)';
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let lastMissingCount = Infinity;
  for (let round = 1; round <= maxRounds; round++) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
    const todo = missingEntries(manifest);
    if (todo.length === 0) { console.log('✅ 全部资产就绪'); return; }
    // 连续两轮无进展 → 说明是长限流窗口, 停下来等待人工介入
    if (todo.length >= lastMissingCount && round > 1) {
      console.log(`第 ${round} 轮仍缺 ${todo.length} 条(无进展), 停止本轮。之后可重跑: node scripts/fetch-images-retry.mjs`);
      process.exitCode = 1;
      return;
    }
    lastMissingCount = todo.length;
    console.log(`\n=== 第 ${round}/${maxRounds} 轮: ${todo.length} 条 ===`);

    let ok = 0;
    for (const e of todo) {
      const outFile = path.join(OUT_DIR, `${e.sourceId}.jpg`);
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1024) { ok += 1; continue; }
      const fb = fallbackUrl(e.imageUrl);
      try {
        const buf = await downloadWithRetry(fb ?? e.imageUrl, ua);
        await sharp(buf).resize({ width: WIDTH, withoutEnlargement: true }).jpeg({ quality: 82, progressive: true }).toFile(outFile);
        e.localFile = `../data/images/${e.sourceId}.jpg`;
        ok += 1;
        console.log(`[ok]    ${e.sourceId} (${Math.round(fs.statSync(outFile).size / 1024)}KB)`);
      } catch (err) {
        console.error(`[fail]  ${e.sourceId}: ${err.message.slice(0, 70)}`);
      }
      await sleep(MIN_INTERVAL_MS);
    }
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`第 ${round} 轮完成: ${ok} ok`);
  }
  const remain = missingEntries(JSON.parse(fs.readFileSync(MANIFEST, 'utf-8')));
  console.log(`\n最终仍缺 ${remain.length} 条:`);
  remain.forEach((e) => console.log('  -', e.sourceId));
  process.exitCode = remain.length ? 1 : 0;
}

main().catch((err) => { console.error('补跑失败:', err); process.exit(1); });
