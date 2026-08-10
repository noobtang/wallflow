import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { buildServer } from '../../src/server';
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
    // #9 语义: DB 存对象 key,API 层经 getSignedUrl 生成签名直链(Mock → cos-mock.local)
    url: `wallpapers/${w.sourceId}.jpg`,
    thumbUrl: `wallpapers/${w.sourceId}_thumb.jpg`,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    creator: `Creator-${w.sourceId}`,
    creatorUrl: `https://example.com/creator-${w.sourceId}`,
    width: 1920,
    height: 1080,
    tags: w.tags,
    category: w.category,
    status: w.status ?? 'active',
  };
}

describe('内容 API(#7 路由)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
    app = await buildServer({ pool });
    repo = new WallpaperRepository(pool);

    // 24 条 active(风景 10 / 城市 7 / 星空 5 / 自然 2)+ 2 blocked + 1 pending_review
    const counts: Array<[string, number]> = [
      ['风景', 10],
      ['城市', 7],
      ['星空', 5],
      ['自然', 2],
    ];
    for (const [category, n] of counts) {
      for (let i = 0; i < n; i++) {
        await repo.upsert(
          seed({ sourceId: `feed-${category}-${i}`, title: `${category}壁纸${i}`, tags: [category, '通用'], category }),
        );
      }
    }
    await repo.upsert(seed({ sourceId: 'blocked-1', title: '被拦截', tags: ['风景'], category: '风景', status: 'blocked' }));
    await repo.upsert(
      seed({ sourceId: 'pending-1', title: '待审核', tags: ['星空'], category: '星空', status: 'pending_review' }),
    );

    // 相似推荐专用数据(独特标签,避免与上面数据交叉)
    await repo.upsert(seed({ sourceId: 'sim-a', title: '相似A', tags: ['α', 'β', 'γ'], category: '艺术' }));
    await repo.upsert(seed({ sourceId: 'sim-b', title: '相似B', tags: ['α', 'β'], category: '艺术' }));
    await repo.upsert(seed({ sourceId: 'sim-c', title: '相似C', tags: ['α'], category: '艺术' }));
    await repo.upsert(seed({ sourceId: 'sim-d', title: '无关D', tags: ['δ'], category: '艺术' }));
    await repo.upsert(seed({ sourceId: 'notags-1', title: '无标签', tags: [], category: '极简' }));
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('GET /wallpapers 默认 20 条 + nextCursor + 缓存头 + 全 active', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = res.json();
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).toBeTruthy();
    expect(body.items.every((x: { status?: string }) => x.status === undefined)).toBe(true);
    expect(body.items.every((x: { id: number }) => Number.isInteger(x.id))).toBe(true);
  });

  it('keyset 翻页无重复无遗漏(29 active 全取回)', async () => {
    const seen = new Set<number>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const url = cursor ? `/wallpapers?limit=5&cursor=${encodeURIComponent(cursor)}` : '/wallpapers?limit=5';
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const body: { items: Array<{ id: number }>; nextCursor: string | null } = res.json();
      for (const item of body.items) {
        expect(seen.has(item.id)).toBe(false); // 无重复
        seen.add(item.id);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    // 24 主数据 + 4 sim(艺术)+ 1 notags(极简)= 29
    expect(seen.size).toBe(29); // 无遗漏
  });

  it('?category=风景 只返回该分类', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers?category=风景' });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ category: string; title: string }>;
    expect(items).toHaveLength(10);
    expect(items.every((x) => x.category === '风景')).toBe(true);
    expect(items.some((x) => x.title.includes('被拦截'))).toBe(false);
  });

  it('同毫秒 created_at 边界: (created_at,id) 打平键保证翻页无重无漏', async () => {
    // 5 条完全相同 created_at(2026-01-01T00:00:00.000Z)→ 排序退化为 id DESC
    await pool.query(
      `INSERT INTO wallpapers (source, source_id, title, url, thumb_url, license, category, created_at)
       SELECT 'curated', 'same-ms-' || g, '同毫秒' || g,
              'https://x/' || g || '.jpg', 'https://x/' || g || '_t.jpg', 'CC0', '极简',
              '2026-01-01T00:00:00.000Z'::timestamptz
       FROM generate_series(1, 5) AS g`,
    );
    const seen = new Set<number>();
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const url = cursor ? `/wallpapers?category=极简&limit=2&cursor=${encodeURIComponent(cursor)}` : '/wallpapers?category=极简&limit=2';
      const body: { items: Array<{ id: number }>; nextCursor: string | null } = (await app.inject({ method: 'GET', url })).json();
      for (const item of body.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    // 极简分类: 5 同毫秒 + notags-1(无标签,新插入,created_at 更晚)
    expect(seen.size).toBe(6);
    // 清理本测试插入的行,避免污染后续 categories 断言(测试顺序解耦)
    await pool.query(`DELETE FROM wallpapers WHERE source_id LIKE 'same-ms-%'`);
  });

  it('非法参数: cursor/category/limit → 400', async () => {
    const badCursor = await app.inject({ method: 'GET', url: '/wallpapers?cursor=abc' });
    expect(badCursor.statusCode).toBe(400);
    expect(badCursor.json()).toMatchObject({ error: { code: 'HTTP_400' } });

    const badCategory = await app.inject({ method: 'GET', url: '/wallpapers?category=不存在' });
    expect(badCategory.statusCode).toBe(400);

    const badLimit = await app.inject({ method: 'GET', url: '/wallpapers?limit=999' });
    expect(badLimit.statusCode).toBe(400);

    // 构造超范围 ms(1e300)→ 400 而非 500(Invalid Date 防护)
    const hugeTs = Buffer.from('1e300,5').toString('base64url');
    const huge = await app.inject({ method: 'GET', url: `/wallpapers?cursor=${hugeTs}` });
    expect(huge.statusCode).toBe(400);
  });

  it('GET /wallpapers/:id 详情: 完整字段 + is_favorited=false + 缓存 300s + 不泄漏内部字段', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/wallpapers?category=风景&limit=1' });
    const { id } = listRes.json().items[0] as { id: number };
    const res = await app.inject({ method: 'GET', url: `/wallpapers/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.json()).toMatchObject({
      id,
      title: expect.any(String),
      fullUrl: expect.stringContaining('cos-mock.local'),
      thumbUrl: expect.stringContaining('_thumb.jpg'),
      license: 'CC0',
      licenseUrl: expect.stringContaining('creativecommons'),
      creator: expect.any(String),
      creatorUrl: expect.any(String),
      width: 1920,
      height: 1080,
      tags: expect.any(Array),
      category: '风景',
      is_favorited: false,
    });
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBeUndefined();
    expect(body.searchText).toBeUndefined();
    expect(body.sourceId).toBeUndefined();
  });

  it('is_favorited(#10): 匿名 false;登录并收藏后 → true;换用户不可见', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/auth/anon',
      payload: { device_id: '00000000-0000-4000-8000-00000000f001' },
    });
    expect(anon.statusCode).toBe(200);
    const token = anon.json().token as string;
    const headers = { authorization: `Bearer ${token}` };

    const listRes = await app.inject({ method: 'GET', url: '/wallpapers?category=风景&limit=1' });
    const { id } = listRes.json().items[0] as { id: number };

    const before = await app.inject({ method: 'GET', url: `/wallpapers/${id}`, headers });
    expect(before.json().is_favorited).toBe(false);

    const fav = await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: id }, headers });
    expect(fav.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/wallpapers/${id}`, headers });
    expect(after.json().is_favorited).toBe(true);

    const anonView = await app.inject({ method: 'GET', url: `/wallpapers/${id}` });
    expect(anonView.json().is_favorited).toBe(false);
  });

  it('详情 404: 未知 id / blocked;400: 非数字 id', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/wallpapers/999999' });
    expect(unknown.statusCode).toBe(404);

    const blockedRow = await repo.findBySourceAndSourceId('curated', 'blocked-1');
    expect(blockedRow).not.toBeNull();
    const blocked = await app.inject({ method: 'GET', url: `/wallpapers/${blockedRow!.id}` });
    expect(blocked.statusCode).toBe(404);

    const badId = await app.inject({ method: 'GET', url: '/wallpapers/abc' });
    expect(badId.statusCode).toBe(400);
  });

  it('相似推荐: 同标签 ≥1,排除自身,按重叠数降序;无标签 → 空', async () => {
    const simA = await repo.findBySourceAndSourceId('curated', 'sim-a');
    const simB = await repo.findBySourceAndSourceId('curated', 'sim-b');
    const simC = await repo.findBySourceAndSourceId('curated', 'sim-c');
    expect(simA && simB && simC).toBeTruthy();

    const res = await app.inject({ method: 'GET', url: `/wallpapers/${simA!.id}/similar` });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ title: string; id: number }>;
    expect(items.map((x) => x.title)).toEqual(['相似B', '相似C']); // 重叠 2 → 重叠 1
    expect(items.some((x) => x.id === simA!.id)).toBe(false); // 排除自身

    const notags = await repo.findBySourceAndSourceId('curated', 'notags-1');
    const empty = await app.inject({ method: 'GET', url: `/wallpapers/${notags!.id}/similar` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().items).toEqual([]);
  });

  it('相似 404: 未知 id', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers/999999/similar' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /categories: 带计数,只含 active 分类,按计数降序 + 缓存头', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const items = res.json().items as Array<{ name: string; count: number }>;
    const byName = Object.fromEntries(items.map((x) => [x.name, x.count]));
    expect(byName['风景']).toBe(10);
    expect(byName['城市']).toBe(7);
    expect(byName['星空']).toBe(5);
    expect(byName['自然']).toBe(2);
    expect(byName['艺术']).toBe(4); // sim-a/b/c/d
    expect(byName['极简']).toBe(1); // notags-1(同毫秒测试已自行清理)
    expect(byName['萌宠']).toBeUndefined(); // 无数据不出现
    expect(byName['动漫']).toBeUndefined();
    const counts = items.map((x) => x.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a)); // 降序
  });

  it('静态路由优先级: /wallpapers/search 不被 /wallpapers/:id 遮蔽(空 q 纯过滤命中全量)', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallpapers/search' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });
});
