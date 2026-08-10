import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  fromNormalizedWallpaper,
  WallpaperRepository,
} from '../../src/repositories/wallpaper.repository';
import type { NormalizedWallpaper } from '../../src/sources/source.interface';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

const BASE_INPUT = {
  source: 'curated',
  sourceId: 'cc-test-001',
  title: '测试壁纸',
  url: 'https://example.com/full.jpg',
  thumbUrl: 'https://example.com/thumb.jpg',
  license: 'CC0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  creator: 'Tester',
  creatorUrl: 'https://example.com/creator',
  width: 1920,
  height: 1080,
  tags: ['风景', '测试'],
  category: '风景',
};

describe('WallpaperRepository(#3)', () => {
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    repo = new WallpaperRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  it('upsert 插入新行,字段完整映射(含 camelCase)', async () => {
    const row = await repo.upsert(BASE_INPUT);

    expect(row.id).toBeGreaterThan(0);
    expect(row.source).toBe('curated');
    expect(row.sourceId).toBe('cc-test-001');
    expect(row.title).toBe('测试壁纸');
    expect(row.url).toBe('https://example.com/full.jpg');
    expect(row.thumbUrl).toBe('https://example.com/thumb.jpg');
    expect(row.license).toBe('CC0');
    expect(row.category).toBe('风景');
    expect(row.tags).toEqual(['风景', '测试']);
    expect(row.status).toBe('active');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('upsert 同 (source, source_id) 重复 → 更新而非新增(幂等)', async () => {
    await repo.upsert(BASE_INPUT);
    const updated = await repo.upsert({
      ...BASE_INPUT,
      title: '测试壁纸 v2',
      width: 2560,
      category: '极简',
    });

    const all = await pool.query('SELECT count(*)::int AS n FROM wallpapers');
    expect(all.rows[0].n).toBe(1); // 无重复行
    expect(updated.title).toBe('测试壁纸 v2');
    expect(updated.width).toBe(2560);
    expect(updated.category).toBe('极简');
  });

  it('findById / findBySourceAndSourceId 命中与未命中', async () => {
    const inserted = await repo.upsert(BASE_INPUT);

    const byId = await repo.findById(inserted.id);
    expect(byId?.sourceId).toBe('cc-test-001');

    const byKey = await repo.findBySourceAndSourceId('curated', 'cc-test-001');
    expect(byKey?.id).toBe(inserted.id);

    expect(await repo.findById(999_999)).toBeNull();
    expect(await repo.findBySourceAndSourceId('curated', 'nope')).toBeNull();
  });

  it('listByCategory: 只返回 active + 指定分类,keyset 分页', async () => {
    // 3 张风景 + 1 张极简 + 1 张 blocked
    for (let i = 1; i <= 3; i++) {
      await repo.upsert({ ...BASE_INPUT, sourceId: `cc-scene-${i}`, title: `风景${i}` });
    }
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-minimal-1', title: '极简1', category: '极简' });
    await repo.upsert({
      ...BASE_INPUT,
      sourceId: 'cc-blocked-1',
      title: '被屏蔽',
      status: 'blocked',
    });

    const page1 = await repo.listByCategory('风景', { limit: 2 });
    expect(page1).toHaveLength(2);
    expect(page1.every((r) => r.category === '风景' && r.status === 'active')).toBe(true);

    // keyset 第二页
    const lastId = page1[page1.length - 1].id;
    const page2 = await repo.listByCategory('风景', { limit: 2, cursor: lastId });
    expect(page2).toHaveLength(1);
    expect(page2[0].id).toBeLessThan(lastId);
  });

  it('listActive: 全量 feed,排除 blocked,分页稳定', async () => {
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-a' });
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-b', status: 'blocked' });
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-c' });

    const page1 = await repo.listActive({ limit: 10 });
    expect(page1.map((r) => r.sourceId).sort()).toEqual(['cc-a', 'cc-c']); // blocked 被排除
  });

  it('countByCategory: 按分类聚合计数(仅 active)', async () => {
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-1', category: '风景' });
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-2', category: '风景' });
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-3', category: '星空' });
    await repo.upsert({ ...BASE_INPUT, sourceId: 'cc-4', category: '风景', status: 'blocked' });

    const counts = await repo.countByCategory();
    expect(counts).toEqual({ 风景: 2, 星空: 1 });
  });

  it('fromNormalizedWallpaper: CuratedImport 输出 → 入库输入映射', () => {
    const normalized: NormalizedWallpaper = {
      source: 'curated',
      sourceId: 'cc-test-002',
      title: '银河星空长卷',
      license: 'PD',
      licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
      creator: 'NASA',
      creatorUrl: 'https://commons.wikimedia.org/wiki/File:Milky_way1.jpg',
      width: 4000,
      height: 3000,
      tags: ['星空', '银河'],
      category: '星空',
      imageUrl: 'https://example.com/original.jpg',
    };

    const input = fromNormalizedWallpaper(normalized);
    expect(input).toMatchObject({
      source: 'curated',
      sourceId: 'cc-test-002',
      url: 'https://example.com/original.jpg',
      thumbUrl: 'https://example.com/original.jpg', // 缩略图未生成前回退原图
      category: '星空',
      tags: ['星空', '银河'],
    });
    expect(input.searchText).toContain('银河星空长卷');
    expect(input.searchText).toContain('星空');
  });
});
