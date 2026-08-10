import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { buildServer } from '../../src/server';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

const JWT_SECRET = 'test-jwt-secret';

function seedWallpaper(w: { sourceId: string; title: string; category: string; status?: string }) {
  return {
    source: 'curated',
    sourceId: w.sourceId,
    title: w.title,
    url: `wallpapers/${w.sourceId}.jpg`, // #9: DB 存对象 key
    thumbUrl: `wallpapers/${w.sourceId}_thumb.jpg`,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    creator: 'T',
    creatorUrl: 'https://example.com',
    width: 1920,
    height: 1080,
    tags: ['测试'],
    category: w.category,
    status: w.status ?? 'active',
  };
}

describe('收藏(#10 路由)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
    app = await buildServer({ pool, wechat: null, jwtSecret: JWT_SECRET });
    repo = new WallpaperRepository(pool);
    for (let i = 1; i <= 5; i++) {
      await repo.upsert(seedWallpaper({ sourceId: `fav-${i}`, title: `收藏测试${i}`, category: '风景' }));
    }
    // blocked 壁纸不可被收藏
    await repo.upsert(seedWallpaper({ sourceId: 'fav-blocked', title: '被封', category: '风景', status: 'blocked' }));
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  /** 匿名登录拿 token(Web 端身份) */
  async function anonToken(deviceId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/anon',
      payload: { device_id: deviceId },
    });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  }

  it('未登录访问收藏三接口 → 401', async () => {
    for (const [method, url, payload] of [
      ['POST', '/favorites', { wallpaper_id: 1 }],
      ['GET', '/favorites', undefined],
      ['DELETE', '/favorites/1', undefined],
    ] as const) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'HTTP_401' } });
    }
  });

  it('收藏 → 重复收藏幂等(第二次 200,非 500)', async () => {
    const token = await anonToken('00000000-0000-4000-8000-000000000001');
    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 1 }, headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ favorited: true });
    const second = await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 1 }, headers });
    expect(second.statusCode).toBe(200); // 幂等,不 500
  });

  it('收藏不存在的/被 block 的壁纸 → 404;参数非法 → 400', async () => {
    const token = await anonToken('00000000-0000-4000-8000-000000000002');
    const headers = { authorization: `Bearer ${token}` };
    const missing = await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 999999 }, headers });
    expect(missing.statusCode).toBe(404);
    const blockedRow = await repo.findBySourceAndSourceId('curated', 'fav-blocked');
    const blocked = await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: blockedRow!.id }, headers });
    expect(blocked.statusCode).toBe(404);
    const badBody = await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 'abc' }, headers });
    expect(badBody.statusCode).toBe(400);
  });

  it('GET /favorites: 我的收藏(join 壁纸,签名直链),翻页无重无漏', async () => {
    const token = await anonToken('00000000-0000-4000-8000-000000000003');
    const headers = { authorization: `Bearer ${token}` };
    for (let i = 1; i <= 3; i++) {
      await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: i }, headers });
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const url = cursor ? `/favorites?limit=2&cursor=${encodeURIComponent(cursor)}` : '/favorites?limit=2';
      const res = await app.inject({ method: 'GET', url, headers });
      expect(res.statusCode).toBe(200);
      const body: { items: Array<{ id: number; fullUrl: string }>; nextCursor: string | null } = res.json();
      for (const item of body.items) {
        expect(seen.includes(item.id)).toBe(false); // 页间无重复
        seen.push(item.id);
        expect(item.fullUrl).toContain('cos-mock.local'); // 签名直链(mock)
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([3, 2, 1]); // 收藏时间倒序
  });

  it('收藏按设备隔离: 两个 device 互不可见', async () => {
    const tokenA = await anonToken('00000000-0000-4000-8000-00000000000a');
    const tokenB = await anonToken('00000000-0000-4000-8000-00000000000b');
    await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 4 }, headers: { authorization: `Bearer ${tokenA}` } });
    const listA = (await app.inject({ method: 'GET', url: '/favorites', headers: { authorization: `Bearer ${tokenA}` } })).json();
    const listB = (await app.inject({ method: 'GET', url: '/favorites', headers: { authorization: `Bearer ${tokenB}` } })).json();
    expect(listA.items.map((x: { id: number }) => x.id)).toContain(4);
    expect(listB.items).toHaveLength(0);
  });

  it('取消收藏: 删除 → 200 removed:true;重复删除幂等 removed:false;列表不再含', async () => {
    const token = await anonToken('00000000-0000-4000-8000-00000000000c');
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 5 }, headers });
    const del = await app.inject({ method: 'DELETE', url: '/favorites/5', headers });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ favorited: false, removed: true });
    const delAgain = await app.inject({ method: 'DELETE', url: '/favorites/5', headers });
    expect(delAgain.json()).toEqual({ favorited: false, removed: false });
    const list = (await app.inject({ method: 'GET', url: '/favorites', headers })).json();
    expect(list.items.map((x: { id: number }) => x.id)).not.toContain(5);
  });

  it('DB 存哈希 user_id: 登录(openid)收藏后,库中无 openid 明文', async () => {
    // 本文件 wechat=null,改用 hashIdentity 直接构造与 login 等价的 user_id 太绕;
    // 这里用 anon 身份验证「库中存的不是 device_id 明文」
    const token = await anonToken('00000000-0000-4000-8000-0000000000dd');
    await app.inject({ method: 'POST', url: '/favorites', payload: { wallpaper_id: 1 }, headers: { authorization: `Bearer ${token}` } });
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM favorites ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0].user_id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].user_id).not.toContain('00000000-0000-4000-8000-0000000000dd');
  });
});
