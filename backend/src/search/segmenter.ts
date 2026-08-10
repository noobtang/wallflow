import fs from 'node:fs';
import path from 'node:path';
import { Jieba } from '@node-rs/jieba';

/**
 * 中文分词(#5 搜索规格)。入库时对 title/tags/category 做 jieba 分词生成 search_text
 * (空格分隔,供 to_tsvector('simple') 切词),查询侧同样分词后走 FTS。
 *
 * @node-rs/jieba 用法注意(实测): 必须先 loadDict(完整词典的 Buffer)加载词典,
 * 否则默认小词典会按单字切分(银河→银/河/星/空)。
 */

/** 词典路径(需在 src 与 dist 两种布局下都能解析: 上溯两层到 backend/node_modules) */
const DICT_PATH = path.join(__dirname, '..', '..', 'node_modules', '@node-rs/jieba', 'dict.txt');

let segmenter: Jieba | null = null;

function getSegmenter(): Jieba {
  if (!segmenter) {
    if (!fs.existsSync(DICT_PATH)) {
      throw new Error(`jieba 词典缺失: ${DICT_PATH}(@node-rs/jieba 安装不完整,请重新 npm install)`);
    }
    const j = new Jieba();
    j.loadDict(fs.readFileSync(DICT_PATH));
    segmenter = j;
  }
  return segmenter;
}

/** 常见中文停用词(去虚词,避免 tsquery AND 语义被无意义 token 拖死) */
const STOPWORDS = new Set([
  '的', '了', '和', '与', '或', '是', '在', '有', '我', '你', '他', '她', '它',
  '这', '那', '之', '于', '也', '都', '很', '就', '并', '及', '吗', '呢', '吧',
  '啊', '从', '到', '对', '被', '把', '让', '向', '为', '以', '上', '下', '中',
]);

/** 简单同义词表(#5 规格): 分类词 → 英文同义词,入库时附加进 search_text */
export const SYNONYMS: Record<string, string[]> = {
  风景: ['landscape', 'nature', 'scenery', 'mountain', 'lake'],
  自然: ['nature', 'wildlife', 'scenery'],
  星空: ['stars', 'galaxy', 'night', 'sky', 'universe', 'astronomy'],
  极简: ['minimal', 'minimalism', 'clean', 'simple'],
  城市: ['city', 'urban', 'skyline'],
  萌宠: ['pet', 'cute', 'animal'],
  动漫: ['anime', 'cartoon', 'illustration'],
  艺术: ['art', 'abstract', 'creative'],
};

/** jieba 分词 + 清洗(去空白/纯标点/单 ASCII 字母/停用词) */
export function segment(text: string): string[] {
  const out: string[] = [];
  for (const raw of getSegmenter().cut(text)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^[\p{P}\p{Z}\s]+$/u.test(t)) continue; // 纯标点/空白
    if (/^[a-zA-Z]$/.test(t)) continue; // 单 ASCII 字母
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

function dedupe(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

/**
 * 入库 search_text: 标题分词 + 标签(已是关键词,原样) + 分类原词 + 分类同义词。
 * 空格分隔 → to_tsvector('simple') 逐个切词索引。
 */
export function buildSearchText(title: string, tags: string[], category?: string | null): string {
  const tokens = [...segment(title), ...tags];
  if (category) {
    tokens.push(category, ...(SYNONYMS[category] ?? []));
  }
  return dedupe(tokens).join(' ');
}

/** 查询侧分词: 返回空格分隔 token 串;无有效 token 时返回空串(调用方视为纯过滤) */
export function tokenizeQuery(q: string): string {
  return dedupe(segment(q)).join(' ');
}
