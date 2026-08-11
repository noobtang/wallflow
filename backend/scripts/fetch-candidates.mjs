#!/usr/bin/env node
/**
 * 取材脚本: 从 Wikimedia Commons 白名单来源抓取候选壁纸元数据(#10 扩库)。
 *
 * 输出到 data/candidates.json(供人工审查/精选后并入 manifest):
 *   { sourceId, fileTitle, imageUrl, descriptionUrl, license, licenseUrl,
 *     creator, width, height, categories[] }
 *
 * 来源策略(2026-08-11 实测):
 *   - 政府图库分类(PD 占比极高): PD NASA / USFWS / NOAA 等
 *   - 结构化数据搜索(haswbstatement:P275= 精确许可): CC0 / CC BY 4.0
 * 过滤: 许可 ∈ 白名单(CC0/CC BY/Public domain)、横向(w>h)、宽 ≥ 2000。
 * 限流: 每请求间隔 1.5s + 429 指数退避(尊重 Retry-After,上限 60s)。
 *
 * 用法: node scripts/fetch-candidates.mjs [--source <名称>] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'candidates.json');

const UA = 'wallflow/0.1 (curated manifest; github.com/noobtang/wallflow)';

// 来源定义: 分类成员 或 结构化搜索
const SOURCES = [
  { name: 'nasa', type: 'category', title: 'PD NASA' },
  { name: 'usfws', type: 'category', title: 'Images from the United States Fish and Wildlife Service' },
  { name: 'noaa', type: 'category', title: 'Images from NOAA' },
  { name: 'cc0', type: 'search', query: 'filetype:bitmap haswbstatement:P275=Q6938433' },
  { name: 'ccby4', type: 'search', query: 'filetype:bitmap haswbstatement:P275=Q50829104' },
  { name: 'usgs', type: 'category', title: 'Images from the United States Geological Survey' },
  // #10 扩库补缺口: 城市天际线 / 极简抽象
  { name: 'skyline', type: 'search', query: 'skyline city haswbstatement:P275=Q50829104' },
  { name: 'skylinecc0', type: 'search', query: 'skyline city haswbstatement:P275=Q6938433' },
  { name: 'minimalq', type: 'category', title: 'Quality minimalist photos' },
  { name: 'minimalf', type: 'category', title: 'Featured minimalist photos' },
  // #10 扩库补缺口: CC0 极简/星轨/抽象/纹理(壁纸风格)
  { name: 'minimalcc0', type: 'search', query: 'minimal landscape haswbstatement:P275=Q6938433' },
  { name: 'startscc0', type: 'search', query: 'star trail haswbstatement:P275=Q6938433' },
  { name: 'auroracc0', type: 'search', query: 'aurora haswbstatement:P275=Q6938433' },
  { name: 'abstractcc0', type: 'search', query: 'abstract texture haswbstatement:P275=Q6938433' },
];

// 许可白名单(#3): CC0 / CC BY(非 SA)/ Public domain
function isWhitelisted(lic) {
  if (!lic) return false;
  const s = lic.trim();
  if (/^CC0/i.test(s)) return true;
  if (/^CC BY/i.test(s) && !/-SA/i.test(s)) return true;
  if (/public domain|^PD/i.test(s)) return true;
  return false;
}

function licenseUrlFor(lic) {
  const s = (lic ?? '').toLowerCase();
  if (s.includes('cc0')) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (s.includes('cc by') && s.includes('4.0')) return 'https://creativecommons.org/licenses/by/4.0/';
  if (s.includes('cc by') && s.includes('3.0')) return 'https://creativecommons.org/licenses/by/3.0/';
  if (s.includes('cc by') && s.includes('2.0')) return 'https://creativecommons.org/licenses/by/2.0/';
  if (s.includes('public domain') || s.startsWith('pd')) return 'https://creativecommons.org/publicdomain/mark/1.0/';
  return '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Math.min(retryAfter ? retryAfter * 1000 : 8000 * 2 ** attempt, 60000);
        console.error(`  [retry] HTTP ${res.status}, ${Math.round(wait / 1000)}s...`);
        await sleep(wait);
        continue;
      }
      console.error(`  HTTP ${res.status} ${res.statusText}`);
      return null;
    } catch {
      await sleep(6000 * 2 ** attempt);
    }
  }
  return null;
}

async function fetchSource(src, limit) {
  const params = {
    action: 'query',
    generator: src.type === 'category' ? 'categorymembers' : 'search',
    gsrsearch: src.query,
    gcmtitle: src.title ? 'Category:' + src.title : undefined,
    gcmtype: 'file',
    gsrnamespace: '6',
    gsrlimit: String(limit),
    gcmlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    format: 'json',
  };
  Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

  const out = [];
  let cont = null;
  let rounds = 0;
  while (rounds < 4) {
    if (cont) Object.assign(params, cont);
    const j = await apiGet(params);
    if (!j?.query?.pages) break;
    const pages = Object.values(j.query.pages);
    for (const p of pages) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const em = ii.extmetadata ?? {};
      const lic = em.LicenseShortName?.value ?? '';
      if (!isWhitelisted(lic)) continue;
      if (!(ii.width > ii.height)) continue;
      if (ii.width < 2000) continue;
      // schema 上限(manifest.schema.ts): 超宽全景不入候选,避免后续导入校验失败
      if (ii.width > 20000 || ii.height > 20000) continue;
      // 去 utm 参数
      const url = ii.url.split('?')[0];
      const fileName = p.title.replace(/^File:/, '');
      const sourceId = 'cc-' + fileName
        .replace(/\.[A-Za-z0-9]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9\u00e0-\u024f]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 110);
      out.push({
        sourceId,
        fileTitle: fileName,
        imageUrl: url,
        // creatorUrl 契约: /wiki/File: 前缀保持可读, 仅编码文件名部分(集成测试断言此格式)
        descriptionUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
        license: lic,
        licenseUrl: licenseUrlFor(lic),
        creator: (em.Artist?.value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
        width: ii.width,
        height: ii.height,
        categories: (em.Categories?.value ?? '').split('|').slice(0, 8),
      });
    }
    cont = j.continue ?? null;
    if (!cont) break;
    rounds++;
    await sleep(1500);
  }
  return out;
}

async function main() {
  const srcArg = process.argv.find((a) => a.startsWith('--source='));
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const sources = srcArg ? SOURCES.filter((s) => s.name === srcArg.split('=')[1]) : SOURCES;
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;

  // 追加模式: 读入已有候选(跨次运行合并),按 imageUrl 去重
  let all = [];
  try {
    all = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
    if (!Array.isArray(all)) all = [];
  } catch {
    all = [];
  }
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

  // 全量去重(imageUrl 相同),按源稳定排序
  const uniq = all
    .filter((x, i, arr) => arr.findIndex((y) => y.imageUrl === x.imageUrl) === i)
    .sort((a, b) => (a.source ?? '').localeCompare(b.source ?? ''));

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
