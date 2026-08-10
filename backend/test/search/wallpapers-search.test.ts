import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { buildSearchText } from '../../src/search/segmenter';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

interface SeedInput {
  sourceId: string;
  title: string;
  tags: string[];
  category: string;
  status?: string;
}

function seed(w: SeedInput) {
  return {
    source: 'curated',
    sourceId: w.sourceId,
    title: w.title,
    url: `https://cos-mock.local/wallpapers/${w.sourceId}.jpg`,
    thumbUrl: `https://cos-mock.local/wallpapers/${w.sourceId}_thumb.jpg`,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    creator: 'Tester',
    creatorUrl: 'https://example.com/creator',
    width: 1920,
    height: 1080,
    tags: w.tags,
    category: w.category,
    searchText: buildSearchText(w.title, w.tags, w.category),
    status: w.status ?? 'active',
  };
}

describe('搜索(#6)', () => {
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    repo = new WallpaperRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    await repo.upsert(seed({ sourceId: 'galaxy-1', title: '银河星空长卷', tags: ['星空', '银河', '宇宙', '深空'], category: '星空' }));
    await repo.upsert(seed({ sourceId: 'lake-1', title: '山间湖泊晨曦', tags: ['风景', '山', '湖泊'], category: '风景' }));
    await repo.upsert(seed({ sourceId: 'minimal-1', title: '极简线条艺术', tags: ['极简', '艺术'], category: '极简' }));
    await repo.upsert(seed({ sourceId: 'city-1', title: '城市天际线', tags: ['城市', '夜景'], category: '城市', status: 'blocked' }));
    await repo.upsert(seed({ sourceId: 'night-1', title: '星空下的城市', tags: ['城市', '星空'], category: '城市' }));
  });

  it('搜「风景」命中风景分类图(验收 1,标签/分类命中)', async () => {
    const { items } = await repo.search({ query: buildSearchText('风景', [], '') });
    expect(items.map((r) => r.sourceId)).toContain('lake-1');
  });

  it('搜英文同义词 landscape 命中风景图(同义词扩展)', async () => {
    const { items } = await repo.search({ query: 'landscape' });
    expect(items.map((r) => r.sourceId)).toContain('lake-1');
  });

  it('相关度排序: AND 精确匹配 + ts_rank 排序(验收 2)', async () => {
    // plainto_tsquery AND 语义: 「星空 银河」要求同时命中两词 → 只返回 galaxy-1
    const precise = await repo.search({ query: '星空 银河', limit: 10 });
    expect(precise.items.map((r) => r.sourceId)).toEqual(['galaxy-1']);

    // 单词查询两个都命中;ts_rank + id DESC 排序 → 两次查询顺序确定(不抖动)
    const first = (await repo.search({ query: '星空', limit: 10 })).items.map((r) => r.sourceId);
    const second = (await repo.search({ query: '星空', limit: 10 })).items.map((r) => r.sourceId);
    expect(first).toContain('galaxy-1');
    expect(first).toContain('night-1');
    expect(second).toEqual(first);
  });

  it('无结果 → 空数组(非 500)(验收 3)', async () => {
    const { items } = await repo.search({ query: '不存在关键词xyz' });
    expect(items).toEqual([]);
  });

  it('keyset 分页无重复无遗漏(验收 4,纯过滤 → rank=0 id 游标)', async () => {
    for (let i = 0; i < 23; i++) {
      await repo.upsert(seed({ sourceId: `page-${String(i).padStart(2, '0')}`, title: `分页壁纸${i}`, tags: ['风景'], category: '风景' }));
    }
    const seen: number[] = [];
    let cursor: { rank: number; id: number } | null = null;
    for (;;) {
      const { items } = await repo.search({ query: null, category: '风景', limit: 10, cursor });
      if (items.length === 0) break;
      seen.push(...items.map((r) => r.id));
      expect(new Set(items.map((r) => r.id)).size).toBe(items.length); // 页内无重复
      cursor = { rank: 0, id: items[items.length - 1].id };
    }
    // 总条数 = 23 分页 + lake-1(风景)
    expect(seen.length).toBe(24);
    expect(new Set(seen).size).toBe(seen.length); // 全局无重复
  });

  it('复合游标(q + rank): rank 排序下翻页无重复无遗漏(P1 回归)', async () => {
    // beforeEach 的 galaxy-1/night-1 也命中「星空」(共 8 条);词频相同 → rank 打平,
    // 翻页退化为 rank 等值 + id 游标 — 正好回归 float 等值精度修复
    const docs = [
      { sourceId: 'rk-1', title: '星空', tags: ['星空'], category: '星空' },
      { sourceId: 'rk-2', title: '星空 城市', tags: ['星空', '城市'], category: '城市' },
      { sourceId: 'rk-3', title: '星空 城市 夜景', tags: ['星空', '城市'], category: '城市' },
      { sourceId: 'rk-4', title: '星空 城市 夜景 灯火', tags: ['星空'], category: '城市' },
      { sourceId: 'rk-5', title: '星空 银河 宇宙', tags: ['星空', '银河'], category: '星空' },
      { sourceId: 'rk-6', title: '星空 长卷 极光 流星', tags: ['星空'], category: '星空' },
    ];
    for (const d of docs) await repo.upsert(seed(d));

    const seen: number[] = [];
    let cursor: { rank: number; id: number } | null = null;
    for (let pageNo = 0; pageNo < 5; pageNo++) {
      const { items, lastRank } = await repo.search({ query: '星空', limit: 2, cursor });
      if (items.length === 0) break;
      seen.push(...items.map((r) => r.id));
      expect(new Set(items.map((r) => r.id)).size).toBe(items.length);
      cursor = { rank: lastRank, id: items[items.length - 1].id };
    }
    expect(seen.length).toBe(8); // 6 rk + galaxy-1 + night-1
    expect(new Set(seen).size).toBe(8); // 无重复无遗漏(含 rank 等值边界)
  });

  it('category 过滤: 只返回该分类(active)', async () => {
    const { items } = await repo.search({ query: null, category: '城市', limit: 10 });
    expect(items.every((r) => r.category === '城市' && r.status === 'active')).toBe(true);
    expect(items.map((r) => r.sourceId)).toContain('night-1');
    expect(items.map((r) => r.sourceId)).not.toContain('city-1'); // blocked 排除
  });

  it('tag 过滤: tags @> 命中', async () => {
    const { items } = await repo.search({ query: null, tag: '银河', limit: 10 });
    expect(items.map((r) => r.sourceId)).toEqual(['galaxy-1']);
  });

  it('q + category 组合过滤', async () => {
    const { items } = await repo.search({ query: '星空', category: '城市', limit: 10 });
    expect(items.map((r) => r.sourceId)).toEqual(['night-1']);
  });

  it('blocked 条目永不出现在搜索结果', async () => {
    const { items } = await repo.search({ query: null, category: '城市', limit: 10 });
    expect(items.some((r) => r.status === 'blocked')).toBe(false);
  });
});
