#!/usr/bin/env node
/**
 * 取材脚本 CLI: 从 Wikimedia Commons 白名单来源抓取候选壁纸元数据(#10 扩库)。
 * 核心逻辑在 candidates-lib.mjs(与 weekly-candidates.mjs 共用)。
 *
 * 输出到 data/candidates.json(供人工审查/精选后并入 manifest):
 *   { sourceId, fileTitle, imageUrl, descriptionUrl, license, licenseUrl,
 *     creator, width, height, categories[] }
 *
 * 用法: node scripts/fetch-candidates.mjs [--source <名称>] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  SOURCES,
  dedupeCandidates,
  fetchSource,
  readCandidatesFile,
  sleep,
} from './candidates-lib.mjs';

const OUT = path.join(ROOT, 'data', 'candidates.json');

async function main() {
  const srcArg = process.argv.find((a) => a.startsWith('--source='));
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const sources = srcArg ? SOURCES.filter((s) => s.name === srcArg.split('=')[1]) : SOURCES;
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;

  // 追加模式: 读入已有候选(跨次运行合并),按 imageUrl 去重
  const all = readCandidatesFile();
  const seen = new Set(all.map((x) => x.imageUrl));

  for (const src of sources) {
    process.stdout.write(`抓取 [${src.name}] (${src.title ?? src.query})...`);
    const items = await fetchSource(src, limit);
    const fresh = items.filter((x) => !seen.has(x.imageUrl));
    fresh.forEach((x) => seen.add(x.imageUrl));
    all.push(...fresh.map((x) => ({ ...x, source: src.name })));
    console.log(` ${items.length} 条通过白名单+横向+2K 过滤(新增 ${fresh.length})`);
    await sleep(1500);
  }

  const uniq = dedupeCandidates(all);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(uniq, null, 2) + '\n');
  const byLic = {};
  uniq.forEach((x) => (byLic[x.license] = (byLic[x.license] ?? 0) + 1));
  console.log(`\n总计 ${uniq.length} 条候选 → ${OUT}`);
  console.log('许可分布:', Object.entries(byLic).map(([k, v]) => `${k}×${v}`).join(' / '));
}

main().catch((e) => {
  console.error('fetch-candidates 失败:', e);
  process.exit(1);
});
