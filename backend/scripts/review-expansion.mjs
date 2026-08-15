#!/usr/bin/env node
/**
 * 扩库草稿人工复核(2026-08-15 逐条过目修正)。
 *
 * 背景: build-expansion.mjs 生成的 200 条机器草稿存在系统性误判 ——
 *   - 地名/船名撞"极光"(Aurora 城市/县、曙光号巡洋舰)被标成极光
 *   - 学校/法院/教堂/餐厅/垃圾箱/博物馆标本/人物照/工程现场/沉船混入
 *   - 同一场景刷屏重复(极光×9、泽西城×10、草甸×8、巡洋舰×5、同画家抽象画×30+)
 *   - 标题/分类张冠李戴(鸟→昆虫、油画→风景、火山→山脉、鱼→旷野)
 *
 * 本脚本 = 逐条人工核对的结果:
 *   - DROP: 非壁纸内容/重复刷屏,直接剔除
 *   - KEEP + 修正: 保留条目给出手写标题/分类/标签(覆盖机器结果)
 *   - 补足: 剔除后不足 200 条,从候选池挑选内容可靠、命名保守的条目补齐
 *
 * 用法: node scripts/review-expansion.mjs
 * 输出: data/manifest-expansion-200.json(修正后)+ 汇总统计。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');
const CANDIDATES = path.join(ROOT, 'data', 'candidates.json');
const OUT = path.join(ROOT, 'data', 'manifest-expansion-200.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
const old100 = manifest.slice(0, 100);
const draft = manifest.slice(100); // 200 条草稿(与 build-expansion 输出一致)
const candidates = JSON.parse(fs.readFileSync(CANDIDATES, 'utf-8'));

// ============================================================
// 逐条决策表(序号 = 草稿中的顺序 1-200)
// DROP: 剔除(非壁纸/重复)
// KEEP: [标题, 分类, [标签...]] 覆盖机器生成的标题/分类/标签
// ============================================================
const DECISIONS = [
  ['KEEP', '抽象水彩 · 蓝调', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // Aurora, Nebraska 市景(地名撞名)
  ['KEEP', '屋檐麻雀', '自然', ['鸟类', '动物', '自然']],
  ['KEEP', '绿树成荫', '自然', ['森林', '树木', '自然']],
  ['KEEP', '百慕大海岸航拍', '风景', ['海岸', '航拍', '岛屿']],
  ['DROP'], // 鱼标本特写(与 #61 重复)
  ['KEEP', '泽西城天际线', '城市', ['城市', '天际线', '纽约']],
  ['KEEP', '维多利亚港摩天楼', '城市', ['城市', '摩天楼', '香港']],
  ['KEEP', '拜伦湾星轨', '星空', ['星轨', '长曝光', '夜空']],
  ['DROP'], // 油污清理现场
  ['KEEP', '抽象水彩 · 色彩交织', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '极光掠影', '星空', ['极光', '夜空', '极光']],
  ['KEEP', '加那利鸽', '自然', ['鸟类', '动物', '自然']],
  ['DROP'], // 宇航员档案照(人物)
  ['DROP'], // 鱼标本特写
  ['KEEP', '泽西城天际线 · 暮色', '城市', ['城市', '天际线', '暮色']],
  ['KEEP', '魁北克城天际线', '城市', ['城市', '天际线', '建筑']],
  ['KEEP', '日落火山口', '风景', ['火山', '日落', '地貌']],
  ['DROP'], // 观鸟活动照(人物)
  ['KEEP', '抽象水彩 · 表现', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '极光之舞', '星空', ['极光', '夜空', '极光']],
  ['DROP'], // 加拉塔塔内部
  ['KEEP', '空间站机械臂', '星空', ['太空', '空间站', '科技']],
  ['DROP'], // 鱿鱼标本
  ['KEEP', '托莱多天际线', '城市', ['城市', '天际线', '西班牙']],
  ['DROP'], // 与 #17 重复
  ['DROP'], // 与 #18 重复
  ['DROP'], // 人物照(小观鸟者)
  ['KEEP', '抽象水彩 · 交织', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 极光重复
  ['DROP'], // 人物照(人像)
  ['KEEP', '日食奇观', '星空', ['日食', '太阳', '天文']],
  ['KEEP', '企鹅群栖', '自然', ['动物', '企鹅', '南极']],
  ['DROP'], // 与 #17 重复
  ['DROP'], // 与 #18 重复
  ['DROP'], // 海狗档案照
  ['KEEP', '抽象油画 · 流淌', '艺术', ['艺术', '油画', '抽象']],
  ['DROP'], // 极光重复
  ['DROP'], // 街道照
  ['KEEP', '盗贼神仙鱼', '自然', ['海洋生物', '鱼类', '珊瑚']],
  ['KEEP', '蒙特利尔夜色', '城市', ['城市', '夜景', '蒙特利尔']],
  ['DROP'], // 与 #18 重复
  ['KEEP', '灌木丛中的黑熊', '自然', ['动物', '熊', '野生动物']],
  ['DROP'], // 抽象画重复(同画家)
  ['DROP'], // 极光重复
  ['DROP'], // 法院建筑
  ['KEEP', '蝠鲼', '自然', ['海洋生物', '蝠鲼', '海洋']],
  ['KEEP', '泽西城天际线 · 冬', '城市', ['城市', '天际线', '纽约']],
  ['DROP'], // 与 #18 重复
  ['DROP'], // 人物照(护林员)
  ['KEEP', '抽象水彩 · 混合', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 极光重复
  ['DROP'], // 焦木梁(建筑残骸)
  ['KEEP', '海葵与鱼', '自然', ['海洋生物', '珊瑚礁', '海洋']],
  ['DROP'], // 与 #48 重复
  ['KEEP', '星轨旋涡', '星空', ['星轨', '长曝光', '夜空']],
  ['KEEP', '山猫蛛', '自然', ['蜘蛛', '微观', '自然']],
  ['KEEP', '抽象水彩 · 印象', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 极光重复
  ['DROP'], // 观景塔
  ['DROP'], // 与 #6 重复(同种鱼)
  ['DROP'], // 与 #48 重复
  ['KEEP', '冰湖观星', '风景', ['冰湖', '夜景', '星空']],
  ['DROP'], // 河道工程
  ['KEEP', '抽象水彩 · 线条', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 极光重复
  ['DROP'], // 信号塔
  ['DROP'], // 鱼标本
  ['DROP'], // 与 #48 重复
  ['KEEP', '旋转星轨', '星空', ['星轨', '长曝光', '夜空']],
  ['DROP'], // 河道工程
  ['KEEP', '抽象水彩 · 条纹', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '曙光女神油画', '艺术', ['艺术', '油画', '古典']],
  ['DROP'], // 土丘(景观工地)
  ['DROP'], // 人物照(学者)
  ['DROP'], // 与 #48 重复
  ['KEEP', '彗星星轨', '星空', ['彗星', '星轨', '深空']],
  ['DROP'], // 河道工程
  ['KEEP', '抽象水彩 · 色线', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '安大略极光', '星空', ['极光', '夜空', '加拿大']],
  ['KEEP', '公园小桥', '风景', ['公园', '桥梁', '风景']],
  ['KEEP', '海底礁石', '自然', ['海洋生物', '珊瑚礁', '海洋']],
  ['KEEP', '曼哈顿天际线 · 渡轮', '城市', ['城市', '天际线', '曼哈顿']],
  ['DROP'], // 铁路道口
  ['DROP'], // 鸟巢特写
  ['KEEP', '抽象水彩 · 色块', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '挪威北角极光', '星空', ['极光', '挪威', '夜空']],
  ['KEEP', '阿纳卡帕岛灯塔', '风景', ['岛屿', '灯塔', '海岸']],
  ['KEEP', '宿务天际线', '城市', ['城市', '天际线', '菲律宾']],
  ['KEEP', '二十分钟星轨', '星空', ['星轨', '长曝光', '夜空']],
  ['DROP'], // 儿童画活动照
  ['KEEP', '抽象水彩 · 红黑', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '卡特亚克河极光', '星空', ['极光', '河流', '瑞典']],
  ['KEEP', '圣克鲁斯岛海岸', '风景', ['海岸', '岛屿', '太平洋']],
  ['KEEP', '曼哈顿天际线 · 联合城', '城市', ['城市', '天际线', '曼哈顿']],
  ['KEEP', '南半球星轨', '星空', ['星轨', '夜空', '南半球']],
  ['DROP'], // 人物照(公园管理员)
  ['KEEP', '抽象水彩 · 黄红', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 曙光号巡洋舰
  ['KEEP', '象海豹休憩', '自然', ['动物', '海豹', '海岸']],
  ['DROP'], // 与 #95 重复
  ['DROP'], // 与 #96 重复
  ['KEEP', '橡树啄木鸟', '自然', ['鸟类', '啄木鸟', '自然']],
  ['KEEP', '抽象水彩 · 暖色', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 曙光号巡洋舰
  ['DROP'], // 海狮与相机(动物+工具)
  ['DROP'], // 与 #95 重复
  ['KEEP', '星轨堆栈', '星空', ['星轨', '长曝光', '夜空']],
  ['DROP'], // 青蛙(濒危物种监测照)
  ['KEEP', '抽象水彩 · 红流', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 曙光号巡洋舰
  ['KEEP', '蓝鲸航拍', '自然', ['鲸鱼', '蓝鲸', '海洋']],
  ['KEEP', '俄克拉荷马城天际线', '城市', ['城市', '天际线', '美国']],
  ['DROP'], // 与 #108 重复
  ['DROP'], // 适应笼(工程)
  ['KEEP', '抽象水彩 · 紫黄', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 曙光号巡洋舰
  ['KEEP', '圣克鲁斯岛岩洞', '风景', ['海岸', '岛屿', '岩洞']],
  ['KEEP', '曼哈顿 · 帝国大厦', '城市', ['城市', '摩天楼', '纽约']],
  ['KEEP', '繁星流转', '星空', ['星空', '星辰', '夜空']],
  ['DROP'], // 鸟巢特写
  ['KEEP', '抽象水彩 · 边缘', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 曙光号巡洋舰
  ['DROP'], // 皮划艇
  ['KEEP', '蒙特利尔皇家山眺望', '城市', ['城市', '天际线', '蒙特利尔']],
  ['KEEP', '星轨 · 流彩', '星空', ['星轨', '夜空', '星辰']],
  ['DROP'], // 鸟巢特写
  ['KEEP', '抽象水彩 · 绿黄', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '明尼阿波利斯极光', '星空', ['极光', '太阳风暴', '夜空']],
  ['DROP'], // 沉船
  ['KEEP', '危地马拉城天际线', '城市', ['城市', '天际线', '中美洲']],
  ['KEEP', '洛克特草甸', '风景', ['草甸', '山谷', '风景']],
  ['DROP'], // 活动照
  ['KEEP', '抽象纹理 · 肌理', '极简', ['极简', '抽象', '纹理']],
  ['DROP'], // 鱼标本
  ['KEEP', '泽西城天际线 · 夏日', '城市', ['城市', '天际线', '纽约']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '阿拉斯加岛礁', '风景', ['岛屿', '海岸', '阿拉斯加']],
  ['KEEP', '抽象纹理 · 灰调', '极简', ['极简', '抽象', '纹理']],
  ['KEEP', '泽西城天际线 · 2023', '城市', ['城市', '天际线', '纽约']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '阿库坦岛', '风景', ['岛屿', '火山', '阿拉斯加']],
  ['KEEP', '抽象水彩 · 层叠', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '泽西城滨水落日', '城市', ['城市', '天际线', '落日']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '阿留申岛链', '风景', ['岛屿', '海岸', '阿拉斯加']],
  ['KEEP', '抽象水彩 · 低地', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '泽西城暮色', '城市', ['城市', '天际线', '暮色']],
  ['DROP'], // 与 #132 重复
  ['DROP'], // 营地照
  ['KEEP', '抽象油画 · 滴彩', '艺术', ['艺术', '油画', '抽象']],
  ['KEEP', '泽西城滨水夜景', '城市', ['城市', '夜景', '滨水']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '抽象油画 · 深蓝', '艺术', ['艺术', '油画', '抽象']],
  ['KEEP', '泽西城暮色 · 双塔', '城市', ['城市', '天际线', '暮色']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '抽象水彩 · 书写', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '阿姆斯特丹天际线', '城市', ['城市', '天际线', '荷兰']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '抽象水彩 · 哲思', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 与 #132 重复
  ['KEEP', '抽象水彩 · 哲思四', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '抽象水彩 · 哲思五', '艺术', ['艺术', '水彩', '抽象']],
  ['KEEP', '抽象油画 · 表现', '艺术', ['艺术', '油画', '抽象']],
  ['KEEP', '抽象水彩 · 符号', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 地名撞名(曙光县)
  ['DROP'], // 教堂/地名
  ['DROP'], // 海螺标本
  ['DROP'], // 江户时代盘子(工艺品)
  ['DROP'], // 垃圾箱合页
  ['DROP'], // 餐厅窗户
  ['DROP'], // NASA 教育展板
  ['DROP'], // 深海鱼标本
  ['DROP'], // 学校建筑(3张重复,全删)
  ['KEEP', '曼哈顿 · 埃利斯岛', '城市', ['城市', '天际线', '曼哈顿']],
  ['DROP'], // 野花微距
  ['DROP'], // 内容不明(监测照)
  ['KEEP', '抽象水彩 · 符号六', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 教堂(地名撞名)
  ['DROP'], // 摩天轮缆绳特写
  ['KEEP', '塔特拉山口', '风景', ['山脉', '山口', '波兰']],
  ['KEEP', '古典油画 · 湖景', '艺术', ['艺术', '油画', '古典']],
  ['DROP'], // 放映会(人物)
  ['DROP'], // 鱼标本
  ['DROP'], // 学校建筑
  ['KEEP', '曼哈顿 · 威霍肯', '城市', ['城市', '天际线', '曼哈顿']],
  ['DROP'], // 人物照(Unsplash 人像)
  ['DROP'], // 活动照(保育活动)
  ['KEEP', '抽象水彩 · 小品三', '艺术', ['艺术', '水彩', '抽象']],
  ['DROP'], // 猫照(睡猫)
  ['DROP'], // 教堂建筑
  ['DROP'], // 瓷砖装饰
  ['DROP'], // 植物特写
  ['DROP'], // 放映会(人物)
  ['DROP'], // 鱼标本
  ['DROP'], // 学校建筑
  ['KEEP', '曼哈顿 · 80 年代', '城市', ['城市', '天际线', '曼哈顿']],
  ['KEEP', '星轨 · 流动', '星空', ['星轨', '长曝光', '夜空']],
  ['DROP'], // 水泵(工程)
  ['KEEP', '抽象水彩 · 小品一', '艺术', ['艺术', '水彩', '抽象']],
];

// ============================================================
// 逐条应用决策
// ============================================================
const kept = [];
const dropped = [];
for (let i = 0; i < DECISIONS.length; i++) {
  const d = DECISIONS[i];
  const entry = draft[i];
  if (!entry) {
    console.error(`决策表与草稿数量不匹配: 第 ${i + 1} 条草稿缺失`);
    process.exit(1);
  }
  if (d[0] === 'DROP') {
    dropped.push(entry.sourceId);
    continue;
  }
  const [, title, category, tags] = d;
  const creator = (entry.creator || '未知')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  kept.push({
    ...entry,
    title,
    category,
    tags,
    sourceId: entry.sourceId,
    imageUrl: entry.imageUrl,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    creator,
    creatorUrl: entry.creatorUrl,
    width: entry.width,
    height: entry.height,
  });
}

// sourceId 撞名修复: 两个不同文件可能规范化出同一 sourceId(如 Jersey_City_Skyline_Jan_2006
// 与 Jersey_City_Skyline_-_Jan_2006)。sourceId 同时用作离线资产文件名, 撞名会互相覆盖,
// 给后出现的加 -2/-3 后缀使其唯一。
const seenIds = new Set();
kept.forEach((e) => {
  let id = e.sourceId;
  let n = 2;
  while (seenIds.has(id)) {
    id = `${e.sourceId}-${n}`;
    n++;
  }
  seenIds.add(id);
  e.sourceId = id;
});

console.log(`草稿 200 条: 保留 ${kept.length} / 剔除 ${dropped.length}`);

// ============================================================
// 补足到 200: 从候选池选内容可靠、命名保守的条目
// ============================================================
const usedIds = new Set([
  ...old100.map((e) => e.sourceId),
  ...kept.map((e) => e.sourceId),
  ...dropped,
]);
const usedUrls = new Set([
  ...old100.map((e) => e.imageUrl),
  ...kept.map((e) => e.imageUrl),
]);

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
  return 'https://creativecommons.org/publicdomain/mark/1.0/';
}

// ---- 补足阶段的杂物负向过滤(与 build-expansion 一致,防学校/汽车/人物/地图混入) ----
const JUNK = [
  /museum|plate|porcelain|pottery|vase|ceramic|bottle|bowl|jar/i,
  /panel|signage|billboard|notice|placard/i,
  /dumpster|trash|bin|restaurant|storefront|shop|window|door/i,
  /skeleton|specimen|fossil|taxidermy/i,
  /map|diagram|chart|drawing|illustration|engraving/i,
  /book|page|document|newspaper|magazine|poster/i,
  /statue|sculpture|monument|memorial/i,
  /logo|emblem|flag|banner/i,
  /game.?board|chess|playing.?card|ticket/i,
  /stamp|coin|banknote|currency/i,
  /info|information|street|google/i,
  /factory|industrial|machine|engine|equipment|warehouse/i,
  /event|conference|concert|festival|rally|protest|parade/i,
  /kiosk|\bexpo\b|showroom/i,
  /portrait|selfie|people|person|man_|woman_|group|family|child|children|baby|teen|watching|tourist|girl|boy|scholar|student|volunteer/i,
  /fashion|clothing|dress|shoes|\bhat\b|jewelry/i,
  /food|kitchen|recipe|meal|vegetable|meat|cake/i,
  /\bcar\b|automobile|truck|vehicle|motorcycle|bicycle|traffic|thunderbird/i,
  /aircraft|plane|helicopter|drone|missile|tank/i,
  /school|church|temple|mosque|cemetery/i,
  /kayak|paddle|boater|fisher|officer|researcher|scientist|ranger/i,
  /clean.?up|survey|camp|field.?day|screening|ceremony|project/i,
  /boundary|annotated|labeled|labelled/i,
  /\.(webm|mp4|ogv|ogg|mov|avi|svg)$/i,
];
function isJunk(fileTitle) {
  return JUNK.some((re) => re.test(fileTitle));
}

/**
 * 主题映射(补足条目使用)。
 * 原则: ①抽象画/绘画类规则最优先(防含 landscape 等词的画作被误归风景);
 *       ②aurora 必须伴随强极光信号,裸 aurora 极可能是地名(奥罗拉省/曙光市/曙光号船);
 *       ③动物(海洋生物/鸟/兽)在风景地貌之前,防鱼/海豹被归海岸。
 */
const AURORA_PLACE = /aurora\s*(,|_|-|\s)+(barangay|dingalan|town|city|village|county|museum|zoo|\d|nebraska|illinois|wisconsin|ohio|colorado|canada|park|hall|ship|museum|school)/i;
const STRONG_AURORA = /(aurora\s*(borealis|australis|polar|lights|sky|night|as|from|over|above|near|seen)|antarctic\s*aurora|northern\s*lights|polar\s*light)/i;

const THEME = [
  [/(abstract|watercolor|gouache|acrylic|painting|art\s*print|texture|pattern)/i, '抽象艺术', '艺术', ['抽象', '艺术']],
  [STRONG_AURORA, '极光夜色', '星空', ['极光', '夜空']],
  [/(nebula|orion|galaxy|milky|deep.?space|hubble|webb|jwst|cosmos|universe)/i, '深空星云', '星空', ['星云', '深空', '宇宙']],
  [/(carina\s*nebula|cosmic\s*cliffs)/i, '船底座星云', '星空', ['星云', '深空', '宇宙']],
  [/(star.?trail|startrail|circumpolar|milky.?way)/i, '星轨长曝', '星空', ['星轨', '长曝光']],
  [/(moon|eclipse|solar)/i, '日月天文', '星空', ['月亮', '太阳', '天文']],
  [/(iss|earth.*orbit|astronaut.*space|space.?walk)/i, '太空视角', '星空', ['太空', '空间站', '地球']],
  [/(whale|dolphin|seal|sea.?lion|ray|shark|fish|reef|coral|anemone|squid|octopus|urchin|slug|herring|salmon|trout|bass|tuna|starfish|sea\s*star|brittle\s*star|bat\s*star)/i, '海洋生灵', '自然', ['海洋生物', '海洋']],
  [/(bird|owl|eagle|heron|duck|penguin|flamingo|plover|woodpecker|sparrow|bunting|grauammer|goldammer|meise|fink|kauz|eule|adler|spatz|drossel|schwan|gans|goose|geese)/i, '飞鸟', '自然', ['鸟类', '动物']],
  [/(bear|deer|elk|fox|wolf|bison|buffalo|mammal|reh|hirsch|fuchs|otter|marder|fledermaus|eidechse|frosch|kröte|molch|hase|kaninchen)/i, '野生动物', '自然', ['动物', '野生动物']],
  [/(skyline|skyscraper|downtown|cityscape)/i, '城市天际线', '城市', ['城市', '天际线']],
  [/((skyline|skyscraper|downtown|cityscape|city|tower|bridge|harbor|harbour|bay).{0,40}(sunset|sunrise|dusk|dawn|twilight)|(sunset|sunrise|dusk|dawn|twilight).{0,40}(skyline|skyscraper|downtown|cityscape|city|tower|bridge|harbor|harbour|bay))/i, '晨昏天际线', '城市', ['城市', '黄昏']],
  [  /(island|coast|beach|shore|ocean|wave|lighthouse|fjord)/i, '海岛海岸', '风景', ['海岛', '海岸']],
  [/(mountain|peak|volcano|canyon|alps|sierra|cliff|valley|summit)/i, '山岳地貌', '风景', ['山脉', '地貌']],
  [/\b(lake|river|waterfall|glacier|snow|ice|frozen)\b|iceberg/i, '湖川冰雪', '风景', ['湖泊', '雪山', '河流']],
  [/(spinne|spider)/i, '蛛网微距', '自然', ['蜘蛛', '微距', '自然']],
  [/(forest|tree|wood)/i, '森林树影', '自然', ['森林', '树木']],
  [/(meadow|prairie|grassland|dune|desert|field|steppe)/i, '原野荒漠', '风景', ['原野', '草原', '荒漠']],
  [/(minimal|monochrome|silhouette|bokeh|blur)/i, '极简光影', '极简', ['极简', '光影']],
];
const THEME_DEFAULT = null; // 补足条目不采用兜底命名(宁可少收,不留错名)
function themeFor(fileTitle) {
  if (AURORA_PLACE.test(fileTitle)) return null;
  for (const [re, title, cat, tags] of THEME) {
    if (re.test(fileTitle)) return { title, cat, tags };
  }
  return THEME_DEFAULT;
}

const pool = candidates.filter(
  (c) =>
    allowed(c.license) &&
    c.width > c.height &&
    c.width >= 2000 &&
    c.width <= 20000 &&
    c.height <= 20000 &&
    !usedIds.has(c.sourceId) &&
    !usedUrls.has(c.imageUrl),
);

const need = 200 - kept.length;
const added = [];
// 分类配额: 避免单一分类占满(星空 200 里最多 ~70)
const CAT_CAP = { 星空: 70, 城市: 80, 风景: 60, 自然: 50, 艺术: 55, 极简: 25 };
const catCount = {};
kept.forEach((e) => (catCount[e.category] = (catCount[e.category] ?? 0) + 1));
const creatorCount = {}; // 同作者去重计数(防高产画家占满艺术类)
kept.forEach((e) => {
  const k = (e.creator || '未知').slice(0, 60);
  creatorCount[k] = (creatorCount[k] ?? 0) + 1;
});
// 文件名前缀去重: 同前缀(去掉末尾数字序号)最多 2 条,防同一场景刷屏
const prefixCount = {};
[...kept].forEach((e) => {
  const base = (e.imageUrl.split('/').pop() || '').replace(/[\d_]+(?=\.[a-z]+$)/i, '');
  prefixCount[base] = (prefixCount[base] ?? 0) + 1;
});

for (const c of pool) {
  if (added.length >= need) break;
  if (usedIds.has(c.sourceId)) continue; // 候选池同 sourceId 撞名(如 png/tiff 双格式),只收第一条
  if (isJunk(c.fileTitle)) continue; // 学校/汽车/人物/地图等杂物不收
  const themed = themeFor(c.fileTitle);
  if (!themed) continue; // 兜底/地名撞名/无可靠主题 → 不收
  if ((catCount[themed.cat] ?? 0) >= (CAT_CAP[themed.cat] ?? 200)) continue;
  // 文件名前缀去重: 去掉末尾序号(如 _12345 / (123) / 2)与扩展名,同场景最多 2 张
  const base = (c.fileTitle || '')
    .replace(/\.[a-z0-9]+$/i, '') // 去掉扩展名 .jpg/.png 等
    .replace(/[_\s]+\(?\d+\)?$/i, '') // 去掉末尾 (1234567)
    .replace(/[_\s]+\d+$/, '') // 去掉末尾 _123 / 03
    .toLowerCase();
  if ((prefixCount[base] ?? 0) >= 2) continue; // 防刷屏
  // 同作者去重: 高产画家(如 Fons Heijnsbroek)单作者最多 10 条,防一个作者占满艺术类
  const creator = (c.creator || '未知')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 60);
  if ((creatorCount[creator] ?? 0) >= 10) continue;
  added.push({
    sourceId: c.sourceId,
    title: themed.title,
    imageUrl: c.imageUrl,
    category: themed.cat,
    tags: themed.tags,
    license: licenseShort(c.license),
    licenseUrl: licenseUrlFor(c.license),
    creator,
    creatorUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(c.fileTitle)}`,
    width: c.width,
    height: c.height,
  });
  usedIds.add(c.sourceId);
  catCount[themed.cat] = (catCount[themed.cat] ?? 0) + 1;
  prefixCount[base] = (prefixCount[base] ?? 0) + 1;
  creatorCount[creator] = (creatorCount[creator] ?? 0) + 1;
}

if (kept.length + added.length < 200) {
  console.warn(`⚠️ 补足后仅 ${kept.length + added.length} 条(目标 200);候选池已用尽可命名条目`);
}

const final = [...kept, ...added];
fs.writeFileSync(OUT, JSON.stringify(final, null, 2) + '\n');

const byLic = {};
const byCat = {};
final.forEach((e) => {
  byLic[e.license] = (byLic[e.license] ?? 0) + 1;
  byCat[e.category] = (byCat[e.category] ?? 0) + 1;
});
console.log(`✅ 修正后 ${final.length} 条 → ${OUT}`);
console.log(`许可: ${Object.entries(byLic).map(([k, v]) => `${k}×${v}`).join(' / ')}`);
console.log(`分类: ${Object.entries(byCat).map(([k, v]) => `${k}×${v}`).join(' / ')}`);
console.log(`剔除 ${dropped.length} 条(非壁纸/重复), 保留修正 ${kept.length} 条, 补足 ${added.length} 条`);
