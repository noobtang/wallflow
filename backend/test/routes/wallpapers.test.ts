import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { buildSearchText } from '../../src/search/segmenter';
import { buildServer } from '../../src/server';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

describe('GET /wallpapers/search(#6 路由)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool); // 路由测试独立建数据,避免被其他测试文件残留污染
    app = await buildServer({ pool });

    const repo = new WallpaperRepository(pool);
    await repo.upsert({
      source: 'curated',
      sourceId: 'route-1',
      title: '银河星空',
      url: 'wallpapers/route-1.jpg',
      thumbUrl: 'wallpapers/route-1_thumb.jpg',
      license: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      creator: 'T',
      creatorUrl: 'https://example.com',
      width: 1920,
      height: 1080,
      tags: ['星空'],
      category: '星空',
      searchText: buildSearchText('银河星空', ['星空'], '星空'),
    });
    await repo.upsert({
      source: 'curated',
      sourceId: 'route-2',
      title: '山间湖泊',
      url: 'wallpapers/route-2.jpg',
      thumbUrl: 'wallpapers/route-2_thumb.jpg',
      license: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      creator: 'T',
      creatorUrl: 'https://example.com',
      width: 1920,
      height: 1080,
      tags: ['风景'],
      category: '风景',
      searchText: buildSearchText('山间湖泊', ['风景'], '风景'),
    });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('q 搜索 → 200,items 为统一对外形状(不泄漏内部字段)+ nextCursor', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers/search?q=星空' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0]).toMatchObject({
      id: expect.any(Number),
      title: '银河星空',
      fullUrl: expect.stringContaining('route-1'),
      license: 'CC0',
      category: '星空',
    });
    // 不泄漏内部字段
    expect(body.items[0].status).toBeUndefined();
    expect(body.items[0].searchText).toBeUndefined();
    expect(body.items[0].sourceId).toBeUndefined();
    expect(body.nextCursor).toBeNull(); // 数据不足一页 → 无下一页
  });

  it('无 q → 纯过滤,返回全部 active', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers/search?category=风景' });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('山间湖泊');
  });

  it('非法 category → 400 统一错误形状', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers/search?category=不存在的分类' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'HTTP_400' } });
  });

  it('q 含特殊字符(tsquery 语法/引号)→ 200 而非 500(plainto_tsquery 容错)', async () => {
    for (const raw of ["q=don't", 'q=%26', 'q=%7C', 'q=%28x%29', "q=%27"]) {
      const res = await app.inject({ method: 'GET', url: `/wallpapers/search?${raw}` });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().items)).toBe(true);
    }
  });

  it('HTTP 层翻页: nextCursor 往返,分页无重复', async () => {
    // 造 5 条命中「城市」的数据(route 库当前 2 条,补 3 条使总命中 > limit 4)
    const repo = new WallpaperRepository(pool);
    for (let i = 0; i < 3; i++) {
      await repo.upsert({
        source: 'curated',
        sourceId: `route-city-${i}`,
        title: `城市夜景${i}`,
        url: `wallpapers/route-city-${i}.jpg`,
        thumbUrl: `wallpapers/route-city-${i}_thumb.jpg`,
        license: 'CC0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        creator: 'T',
        creatorUrl: 'https://example.com',
        width: 1920,
        height: 1080,
        tags: ['城市'],
        category: '城市',
        searchText: buildSearchText(`城市夜景${i}`, ['城市'], '城市'),
      });
    }
    const seen = new Set<number>();
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const base = `/wallpapers/search?q=${encodeURIComponent('城市')}&limit=2`;
      const url: string = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const body: { items: Array<{ id: number }>; nextCursor: string | null } = res.json();
      for (const item of body.items) {
        expect(seen.has(item.id)).toBe(false); // 页间无重复
        seen.add(item.id);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // 至少翻完一页以上
  });

  it('非法 cursor/limit → 400', async () => {
    const badCursor = await app.inject({ method: 'GET', url: '/wallpapers/search?cursor=abc' });
    expect(badCursor.statusCode).toBe(400);

    const badLimit = await app.inject({ method: 'GET', url: '/wallpapers/search?limit=999' });
    expect(badLimit.statusCode).toBe(400);
  });

  it('空 q 按纯过滤(前端清空输入不报错)', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers/search?q=%20%20' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);
  });

  it('未知路由 → 404 统一错误形状(#7 后 /wallpapers/:id 已注册,/nope 会命中 :id 参数路由)', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
