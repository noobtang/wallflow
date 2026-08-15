#!/usr/bin/env node
/**
 * 精选扩库脚本(#10 后续): 候选池 941 条 → 精选 200 条并入 manifest(100 → 300)。
 *
 * 流程: 白名单许可 + 横向 + 宽≥2000 + 与现有 manifest 去重 → 按来源均衡抽样 →
 *       基于文件名关键词自动生成中文元数据(标题/分类/标签) → 输出到
 *       data/manifest-expansion-200.json(待人工复核后并入 manifest.json)。
 *
 * ⚠️ 本脚本产出的是**机器生成草稿**: 标题/标签基于文件名关键词映射,质量不如人工精选;
 *    合并前应逐条核对(尤其 CC BY 条目核对署名与许可版本)。dry-run 只校验 schema。
 *
 * 用法: node scripts/build-expansion.mjs [--count 200] [--out ../data/manifest-expansion-200.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATES = path.join(ROOT, 'data', 'candidates.json');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');

const countArg = process.argv.find((a) => a.startsWith('--count='));
const outArg = process.argv.find((a) => a.startsWith('--out='));
const COUNT = countArg ? Number(countArg.split('=')[1]) : 200;
const OUT = outArg ? path.resolve(ROOT, outArg.split('=')[1]) : path.join(ROOT, 'data', 'manifest-expansion-200.json');

// 许可白名单(与 #3 ALLOWED_LICENSES 一致)
function allowed(lic) {
  if (!lic) return false;
  if (/^CC0/i.test(lic)) return true;
  if (/^CC BY/i.test(lic) && !/-SA/i.test(lic)) return true;
  if (/public domain|^PD/i.test(lic)) return true;
  return false;
}

function licenseShort(lic) {
  if (/^CC0/i.test(lic)) return 'CC0';
  if (/^CC BY/i.test(lic)) return 'CC BY';
  return 'PD';
}

function licenseUrlFor(lic) {
  const s = (lic ?? '').toLowerCase();
  if (s.includes('cc0')) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (s.includes('4.0')) return 'https://creativecommons.org/licenses/by/4.0/';
  if (s.includes('3.0')) return 'https://creativecommons.org/licenses/by/3.0/';
  if (s.includes('2.5')) return 'https://creativecommons.org/licenses/by/2.5/';
  if (s.includes('2.0')) return 'https://creativecommons.org/licenses/by/2.0/';
  if (s.includes('public domain')) return 'https://creativecommons.org/publicdomain/mark/1.0/';
  return 'https://creativecommons.org/publicdomain/mark/1.0/';
}

// ---- 关键词 → 中文(标题/分类/标签) ----
const KEYWORD_MAP = [
  // 星空/天文
  [/(aurora|northern.?lights|polar)/i, '极光', '星空', ['极光', '夜空', '极光']],
  [/(milky.?way|galaxy|galaxies)/i, '银河星系', '星空', ['银河', '星系', '深空']],
  [/(nebula|nebulae)/i, '星云', '星空', ['星云', '深空', '宇宙']],
  [/(star.?trail|startrail)/i, '星轨长曝', '星空', ['星轨', '长曝光', '夜空']],
  [/(stars|starry|night.?sky|constellation)/i, '璀璨星空', '星空', ['星空', '星辰', '夜空']],
  [/(moon|lunar|eclipse)/i, '月球天文', '星空', ['月亮', '天文', '夜空']],
  [/(solar|corona|sunspot|sunburst)/i, '太阳天文', '星空', ['太阳', '天文']],
  [/(iss|space.?station|earth.*space|orbit)/i, '太空视角地球', '星空', ['太空', '地球', '夜景']],
  [/(astronaut|launch|rocket)/i, '航天掠影', '星空', ['航天', '太空']],
  [/(deep.?space|cosmos|universe|cluster|observatory)/i, '深空宇宙', '星空', ['深空', '宇宙', '天文']],
  [/(mars|planet|planetary)/i, '行星地表', '星空', ['行星', '太空']],
  // 城市
  [/(skyline)/i, '城市天际线', '城市', ['城市', '天际线', '建筑']],
  [/(city|urban|downtown)/i, '城市夜景', '城市', ['城市', '夜景', '灯光']],
  [/(night.*(city|street|light)|neon)/i, '城市霓虹', '城市', ['城市', '霓虹', '夜景']],
  [/(skyscraper|tower|building|architecture)/i, '摩天楼宇', '城市', ['建筑', '城市', '摩天楼']],
  [/(bridge|harbor|harbour|\bport\b|waterfront)/i, '港湾大桥', '城市', ['城市', '港湾', '建筑']],
  [/(airport|aircraft|plane|aviation)/i, '航空掠影', '城市', ['航空', '飞机']],
  [/(railway|train|metro|subway)/i, '轨道交通', '城市', ['城市', '轨道', '交通']],
  // 自然/动物
  [/(whale|dolphin|seal|sea.?lion|shark|ray|turtle|jellyfish|fish|marine|reef|coral)/i, '海洋生灵', '自然', ['海洋生物', '海洋', '动物']],
  [/(\bbird|\bowl|\beagle|heron|\bduck|seagull|pelican|\bcrane|falcon|flamingo|penguin|kingfisher|hummingbird)/i, '飞鸟栖影', '自然', ['鸟类', '动物', '自然']],
  [/(deer|elk|moose|buffalo|bison|bear|wolf|fox|lion|tiger|leopard|zebra|giraffe|monkey|elephant)/i, '野生走兽', '自然', ['动物', '野生动物', '自然']],
  [/(insect|butterfly|dragonfly|bee|spider)/i, '微观生灵', '自然', ['昆虫', '微观', '自然']],
  [/(flower|blossom|tulip|rose|lotus|pollen)/i, '花影', '自然', ['花卉', '植物', '自然']],
  [/(forest|tree|wood|pine|sequoia)/i, '森林秘境', '自然', ['森林', '树木', '自然']],
  [/(wave|ocean|sea|coast|beach|shore|surf)/i, '海浪海岸', '自然', ['海洋', '海浪', '海岸']],
  [/(mountain|peak|summit|alps|himalaya|volcano|canyon|cliff|ridge)/i, '山峦叠嶂', '风景', ['山脉', '雪山', '风景']],
  [/(lake|river|waterfall|stream|pond)/i, '湖光水色', '风景', ['湖泊', '河流', '风景']],
  [/(desert|dune|sahara)/i, '沙漠之丘', '风景', ['沙漠', '沙丘', '风景']],
  [/(snow|ice|glacier|iceberg|frozen|winter)/i, '冰雪世界', '风景', ['冰雪', '雪山', '风景']],
  [/(sunset|sunrise|dusk|dawn|golden.?hour)/i, '晨昏光影', '风景', ['日落', '日出', '光影']],
  [/(rainbow|lightning|storm|cloud|fog|mist)/i, '天象奇观', '风景', ['天气', '云彩', '自然']],
  [/(field|meadow|grassland|prairie|valley|landscape)/i, '旷野风光', '风景', ['草原', '山谷', '风景']],
  [/(island|lagoon|fjord|peninsula)/i, '岛屿峡湾', '风景', ['海岛', '峡湾', '风景']],
  // 极简/艺术
  [/(abstract|minimal|texture|pattern)/i, '抽象纹理', '极简', ['极简', '抽象', '纹理']],
  [/(painting|artwork|watercolor|gouache|canvas|brush)/i, '艺术画作', '艺术', ['艺术', '绘画', '抽象']],
  [/(silhouette|monochrome|black.?and.?white|b&w)/i, '剪影黑白', '极简', ['极简', '剪影', '黑白']],
  [/(blur|bokeh)/i, '虚化光斑', '极简', ['极简', '光斑', '虚化']],
];

const DEFAULT = ['光影壁纸', '风景', ['风景', '光影']];

// 非壁纸内容负向过滤: 博物馆物件/图纸/告示牌/餐具等文件名特征 → 直接排除
// (避免把「博物馆盘子」「信息面板」「店铺招牌」这类内容混入精选)
const JUNK = [
  /museum/i, /plate|porcelain|pottery|vase|ceramic|bottle|bowl|jar/i,
  /panel|sign|signage|board|billboard|notice|placard/i,
  /dumpster|trash|bin|restaurant|storefront|shop|window|door/i,
  /skeleton|specimen|fossil|taxidermy|insect.?collection/i,
  /map|diagram|chart|drawing|sketch|illustration|painting_of|engraving/i,
  /book|page|letter|document|newspaper|magazine|poster/i,
  /statue|sculpture|monument|memorial|stained.?glass/i,
  /logo|emblem|coat.?of.?arms|flag|banner/i,
  /game.?board|chess|playing.?card|ticket/i,
  /stamp|coin|banknote|currency/i,
  /info|information|road|street.?view|google|photo.?request/i,
  /factory|industrial|machine|engine|equipment|warehouse/i,
  /event|conference|concert|festival|rally|protest|parade/i,
  /airport.?terminal|ticket.?booth|kiosk/i,
  /festival|expo|fair|showroom/i,
  /portrait|selfie|people|person|man_|woman_|group|family|child|children|baby|teen/i,
  /fashion|clothing|dress|shoes|hat|jewelry/i,
  /food|kitchen|recipe|meal|fruit.?bowl|vegetable|meat|cake/i,
  /car|automobile|truck|vehicle|motorcycle|bicycle|traffic|thunderbird|school|cathedral|church|temple|mosque/i,
  /aircraft|plane|helicopter|drone|missile|tank|ship.?hull/i,
];

function isJunk(fileTitle) {
  const lower = fileTitle.toLowerCase();
  return JUNK.some((re) => re.test(lower));
}

function mapKeywords(fileTitle) {
  const lower = fileTitle.toLowerCase();
  for (const [re, title, category, tags] of KEYWORD_MAP) {
    if (re.test(lower)) return { title, category, tags };
  }
  return { title: DEFAULT[0], category: DEFAULT[1], tags: DEFAULT[2] };
}

function buildEntry(c) {
  const { title, category, tags } = mapKeywords(c.fileTitle);
  return {
    sourceId: c.sourceId,
    title,
    imageUrl: c.imageUrl,
    category,
    tags,
    license: licenseShort(c.license),
    licenseUrl: licenseUrlFor(c.license),
    creator: c.creator || '未知',
    // creatorUrl 契约: /wiki/File: 前缀保持可读,仅编码文件名(集成测试断言此格式;
    // 候选池老数据可能把 File: 一起编码成 File%3A,这里统一修正)
    creatorUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(c.fileTitle)}`,
    width: c.width,
    height: c.height,
  };
}

async function main() {
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES, 'utf-8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const manifestIds = new Set(manifest.map((m) => m.sourceId));
  const manifestUrls = new Set(manifest.map((m) => m.imageUrl));

  const usable = candidates.filter(
    (c) =>
      allowed(c.license) &&
      c.width > c.height &&
      c.width >= 2000 &&
      c.width <= 20000 &&
      c.height <= 20000 &&
      !manifestIds.has(c.sourceId) &&
      !manifestUrls.has(c.imageUrl),
  );

  if (usable.length < COUNT) {
    console.error(`可用候选仅 ${usable.length} 条,不足 ${COUNT}(先跑 fetch-candidates.mjs 扩池)`);
    process.exitCode = 1;
    return;
  }

  // 相关度分层: 命中关键词(壁纸相关内容)且非杂物 → 优先;其余最后
  // 避免把「垃圾桶合页」「餐厅窗口」「博物馆盘子」这类非壁纸内容混入精选
  const matched = usable.filter((c) => !isJunk(c.fileTitle) && mapKeywords(c.fileTitle).title !== DEFAULT[0]);
  const fallback = usable.filter((c) => isJunk(c.fileTitle) || mapKeywords(c.fileTitle).title === DEFAULT[0]);

  /** 均衡抽样: 先按来源轮询,再按分类配额修正,避免某一分类(如星空)占满全部名额 */
  const pickBalanced = (pool, budget, acc, categoryCap) => {
    const bySource = {};
    for (const c of pool) (bySource[c.source] ??= []).push(c);
    const sourceNames = Object.keys(bySource);
    const idx = {};
    sourceNames.forEach((s) => (idx[s] = 0));
    const catCount = {};
    const countCat = (c) => mapKeywords(c.fileTitle).category;
    let progress = true;
    while (acc.length < budget && progress) {
      progress = false;
      for (const s of sourceNames) {
        if (acc.length >= budget) break;
        const list = bySource[s];
        while (idx[s] < list.length) {
          const c = list[idx[s]];
          idx[s] += 1;
          const cat = countCat(c);
          if (categoryCap && (catCount[cat] ?? 0) >= categoryCap) continue;
          acc.push(c);
          catCount[cat] = (catCount[cat] ?? 0) + 1;
          progress = true;
          break;
        }
      }
    }
  };

  const picked = [];
  // 分类配额: 6 个分类均分,避免单一分类(极光/星轨池大)占满
  const cap = Math.ceil(COUNT / 6);
  pickBalanced(matched, COUNT, picked, cap);
  if (picked.length < COUNT) {
    console.warn(`⚠️ 命中关键词的候选仅 ${picked.length} 条,不足 ${COUNT};用兜底条目补齐 ${COUNT - picked.length} 条(建议人工复核或扩池)`);
    pickBalanced(fallback, COUNT, picked, cap);
  }
  const final = picked.slice(0, COUNT);

  const out = final.map(buildEntry);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  const byLic = {};
  const byCat = {};
  out.forEach((e) => {
    byLic[e.license] = (byLic[e.license] ?? 0) + 1;
    byCat[e.category] = (byCat[e.category] ?? 0) + 1;
  });
  console.log(`✅ 生成 ${out.length} 条扩库草稿 → ${OUT}`);
  console.log(`许可: ${Object.entries(byLic).map(([k, v]) => `${k}×${v}`).join(' / ')}`);
  console.log(`分类: ${Object.entries(byCat).map(([k, v]) => `${k}×${v}`).join(' / ')}`);
  console.log('⚠️ 机器生成草稿: 合并 manifest 前请逐条核对标题/标签/署名');
}

main().catch((e) => {
  console.error('build-expansion 失败:', e);
  process.exit(1);
});
