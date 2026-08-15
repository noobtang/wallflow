import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildServer } from '../../src/server';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

describe('公开写接口限流(2026-08-15 E 运维小项)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
    // 显式小限额: 60s 窗口内最多 3 次 POST
    app = await buildServer({ pool, wechat: null, rateLimit: { windowMs: 60000, max: 3 } });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('POST /events 超过限额 → 429 RATE_LIMITED + Retry-After;GET 不限', async () => {
    const post = (eventId: string) =>
      app.inject({
        method: 'POST',
        url: '/events',
        payload: { event_name: 'download_click', event_id: eventId, wallpaper_id: 1 },
      });

    // 前 3 次正常(匿名可选鉴权,无需 token)
    for (let i = 0; i < 3; i++) {
      const res = await post(`rl-test-${i}-xxxxxxxx`);
      expect(res.statusCode).toBe(200);
    }
    // 第 4 次 → 429
    const limited = await post('rl-test-4-xxxxxxxx');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // 读接口不受影响
    const feed = await app.inject({ method: 'GET', url: '/wallpapers' });
    expect(feed.statusCode).toBe(200);
  });

  it('X-Forwarded-For 头按来源 IP 分别计数(生产 nginx 后各用户独立配额)', async () => {
    const limitedApp = await buildServer({
      pool,
      wechat: null,
      rateLimit: { windowMs: 60000, max: 2 },
    });
    try {
      const post = (ip: string, eventId: string) =>
        limitedApp.inject({
          method: 'POST',
          url: '/events',
          headers: { 'x-forwarded-for': ip },
          payload: { event_name: 'download_click', event_id: eventId, wallpaper_id: 1 },
        });
      // IP A 用掉配额
      await post('203.0.113.1', 'rl-ip-a-1-xxxxxxxx');
      await post('203.0.113.1', 'rl-ip-a-2-xxxxxxxx');
      expect((await post('203.0.113.1', 'rl-ip-a-3-xxxxxxxx')).statusCode).toBe(429);
      // IP B 独立配额,不受 A 影响
      expect((await post('203.0.113.2', 'rl-ip-b-1-xxxxxxxx')).statusCode).toBe(200);
    } finally {
      await limitedApp.close();
    }
  });

  it('rateLimit: null 关闭限流(测试/内部环境不受限)', async () => {
    const openApp = await buildServer({ pool, wechat: null, rateLimit: null });
    try {
      const posts = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          openApp.inject({
            method: 'POST',
            url: '/events',
            payload: { event_name: 'download_click', event_id: `rl-off-${i}-xxxxxxxx`, wallpaper_id: 1 },
          }),
        ),
      );
      expect(posts.every((r) => r.statusCode === 200)).toBe(true);
    } finally {
      await openApp.close();
    }
  });
});
