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
    url: `wallpapers/${w.sourceId}.jpg`,
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

describe('用户行为(#8 剩余: 解锁/举报/埋点)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
    app = await buildServer({ pool, wechat: null, jwtSecret: JWT_SECRET });
    repo = new WallpaperRepository(pool);
    await repo.upsert(seedWallpaper({ sourceId: 'act-1', title: '行为测试1', category: '风景' }));
    await repo.upsert(seedWallpaper({ sourceId: 'act-2', title: '行为测试2', category: '星空' }));
    // blocked 壁纸不可解锁/举报(与收藏一致)
    await repo.upsert(seedWallpaper({ sourceId: 'act-blocked', title: '被封', category: '风景', status: 'blocked' }));
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function anonToken(deviceId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/anon',
      payload: { device_id: deviceId },
    });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  }

  it('未登录访问 /unlock 与 /reports → 401;/events 匿名可上报', async () => {
    const u = await app.inject({ method: 'POST', url: '/unlock', payload: { wallpaper_id: 1 } });
    expect(u.statusCode).toBe(401);
    const r = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 1, reason: '低俗' },
    });
    expect(r.statusCode).toBe(401);
    const e = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { event_name: 'preview_click', event_id: 'anon-evt-0001' },
    });
    expect(e.statusCode).toBe(200); // 埋点允许匿名
  });

  it('解锁: 成功 unlocked:true;重复幂等 unlocked:false;不存在/blocked 壁纸 → 404', async () => {
    const token = await anonToken('00000000-0000-4000-8000-000000000011');
    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({ method: 'POST', url: '/unlock', payload: { wallpaper_id: 1 }, headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ unlocked: true });
    const second = await app.inject({ method: 'POST', url: '/unlock', payload: { wallpaper_id: 1 }, headers });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ unlocked: false }); // 幂等,不重复入库
    const missing = await app.inject({ method: 'POST', url: '/unlock', payload: { wallpaper_id: 999999 }, headers });
    expect(missing.statusCode).toBe(404);
    const blockedRow = await repo.findBySourceAndSourceId('curated', 'act-blocked');
    const blocked = await app.inject({ method: 'POST', url: '/unlock', payload: { wallpaper_id: blockedRow!.id }, headers });
    expect(blocked.statusCode).toBe(404);
  });

  it('举报: reported:true;重复幂等;reason 长度校验(空/超 200 → 400);404 壁纸', async () => {
    const token = await anonToken('00000000-0000-4000-8000-000000000022');
    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 2, reason: '侵权图片' },
      headers,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ reported: true });
    const second = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 2, reason: '换个理由' },
      headers,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ reported: false }); // 每用户每图一次,幂等
    const emptyReason = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 2, reason: '' },
      headers,
    });
    expect(emptyReason.statusCode).toBe(400);
    const longReason = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 2, reason: 'x'.repeat(201) },
      headers,
    });
    expect(longReason.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 999999, reason: '违规' },
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('埋点: 重复 event_id 幂等(仅 1 行入库);extra jsonb 往返;非法 event_id/event_name → 400', async () => {
    const payload = {
      event_name: 'download_success',
      event_id: 'evt-dup-0001',
      wallpaper_id: 1,
      extra: { from: 'detail', duration_ms: 320 },
    };
    const first = await app.inject({ method: 'POST', url: '/events', payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ recorded: true });
    const second = await app.inject({ method: 'POST', url: '/events', payload });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ recorded: false }); // event_id 幂等
    const { rows } = await pool.query<{ event_id: string; extra: { from: string } }>(
      `SELECT event_id, extra FROM events WHERE event_id = $1`,
      ['evt-dup-0001'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].extra.from).toBe('detail'); // jsonb 往返
    const shortId = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { event_name: 'x', event_id: 'short' },
    });
    expect(shortId.statusCode).toBe(400);
    const badName = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { event_name: '', event_id: 'evt-bad-name-0001' },
    });
    expect(badName.statusCode).toBe(400);
  });

  it('全链路: 登录(openid 哈希身份)→ 解锁 → 举报 均 200,库中 user_id 为 64-hex 哈希', async () => {
    // wechat=null 的 buildServer 下用 anon 身份走同一 UserActionRepository 路径
    const token = await anonToken('00000000-0000-4000-8000-0000000000ff');
    const headers = { authorization: `Bearer ${token}` };
    const unlock = await app.inject({ method: 'POST', url: '/unlock', payload: { wallpaper_id: 2 }, headers });
    expect(unlock.statusCode).toBe(200);
    const report = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: 1, reason: '色情' },
      headers,
    });
    expect(report.statusCode).toBe(200);
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM reports ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0].user_id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].user_id).not.toContain('00000000-0000-4000-8000-0000000000ff');
  });
});
