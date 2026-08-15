#!/usr/bin/env node
/**
 * 每周候选图清单(2026-08-15,分析/扩库辅助): 汇总 data/candidates.json 中
 * 「尚未入选 manifest」的候选,输出人类可读的挑选清单 + 存储成本估算。
 *
 * 用法:
 *   node scripts/weekly-candidates.mjs [--top N] [--min-width W] [--out <path>]
 *
 * 工作流(与 data/README「取材来源」一致):
 *   1. 先跑 node scripts/fetch-candidates.mjs(抓新候选,追加去重到 candidates.json)
 *   2. 跑本脚本生成报告 → 人工按清单挑 N 张 → build-expansion.mjs 草稿 → review → 并入 manifest
 *
 * 存储成本估算: 按「宽 × 高 × 3 字节/像素(JPEG q82 压缩后经验值,data/images 实测)」估算单张
 * 压缩后大小;列出估算合计与条数,供挑图时控制磁盘/带宽预算。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, dedupeCandidates, readCandidatesFile } from './candidates-lib.mjs';

const MANIFEST = path.join(ROOT, 'data', 'manifest.json');

function parseArgs(argv) {
  const out = { top: 30, minWidth: 2000, out: path.join(ROOT, 'data', 'weekly-candidates.md') };
  const find = (flag, fallback) => {
    const a = argv.find((x) => x.startsWith(`${flag}=`));
    return a ? a.split('=')[1] : fallback;
  };
  out.top = Number(find('--top', '30'));
  out.minWidth = Number(find('--min-width', '2000'));
  const outArg = argv.find((x) => x.startsWith('--out='));
  if (outArg) out.out = path.resolve(outArg.split('=')[1]);
  return out;
}

/** 已入选 manifest 的 sourceId 集合(按 cc- 前缀规范化比较) */
function loadManifestIds() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
    // manifest.json 是裸数组(300 条);兼容 { wallpapers: [] } 形状
    const arr = Array.isArray(m) ? m : (m.wallpapers ?? []);
    return new Set(arr.map((w) => String(w.sourceId).toLowerCase()));
  } catch {
    return new Set();
  }
}

/** 估算单张压缩后大小(MB): 像素 × 3 字节经验值 → MB */
function estSizeMb(w, h) {
  return (w * h * 3) / 1024 / 1024;
}

function fmtMb(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb.toFixed(1)}MB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = dedupeCandidates(readCandidatesFile());
  const manifestIds = loadManifestIds();

  // 排除已入选 + 低于最小宽度的;按尺寸估算降序(大图优先展示,便于挑「值钱」的)
  const fresh = candidates
    .filter((c) => !manifestIds.has(String(c.sourceId).toLowerCase()))
    .filter((c) => c.width >= args.minWidth)
    .sort((a, b) => estSizeMb(b.width, b.height) - estSizeMb(a.width, a.height));

  const top = fresh.slice(0, args.top);
  const totalMb = fresh.reduce((s, c) => s + estSizeMb(c.width, c.height), 0);
  const byLic = {};
  fresh.forEach((c) => (byLic[c.license] = (byLic[c.license] ?? 0) + 1));
  const bySource = {};
  fresh.forEach((c) => (bySource[c.source ?? '?'] = (bySource[c.source ?? '?'] ?? 0) + 1));

  const lines = [];
  lines.push(`# 每周候选图清单(生成时间 ${new Date().toISOString().slice(0, 10)})`);
  lines.push('');
  lines.push(`- 候选池总数: **${candidates.length}** 条(data/candidates.json)`);
  lines.push(`- 尚未入选 manifest(宽 ≥ ${args.minWidth}px): **${fresh.length}** 条`);
  lines.push(`- 估算压缩后总大小(全选): **${fmtMb(totalMb)}**(按像素×3B 经验值,实际以 sharp 压缩为准)`);
  lines.push(`- 许可分布: ${Object.entries(byLic).map(([k, v]) => `${k}×${v}`).join(' / ')}`);
  lines.push(`- 来源分布: ${Object.entries(bySource).map(([k, v]) => `${k}×${v}`).join(' / ')}`);
  lines.push('');
  lines.push('> 挑选建议: 优先大图(值钱)+ 补当前分类缺口(自然/星空/城市/极简/艺术);');
  lines.push('> CC BY 条目注意核对署名与许可版本;选好后跑 `build-expansion.mjs` 生成草稿 → 人工核对 → 并入 manifest。');
  lines.push('');
  lines.push('| # | 尺寸(宽×高) | 估算大小 | 许可 | 标题(文件名) | 来源页 |');
  lines.push('|---|------------|---------|------|-------------|--------|');
  top.forEach((c, i) => {
    lines.push(
      `| ${i + 1} | ${c.width}×${c.height} | ${fmtMb(estSizeMb(c.width, c.height))} | ${c.license} | ${c.fileTitle} | [查看](${c.descriptionUrl}) |`,
    );
  });
  lines.push('');

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, lines.join('\n'));
  console.log(`候选池 ${candidates.length} 条,尚未入选 ${fresh.length} 条(估算合计 ${fmtMb(totalMb)})`);
  console.log(`报告 → ${args.out}(前 ${args.top} 条)`);
}

main().catch((e) => {
  console.error('weekly-candidates 失败:', e);
  process.exit(1);
});
