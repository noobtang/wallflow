import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { buildServer } from '../../src/server';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

const JWT_SECRET = 'test-jwt-secret';
const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

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

describe('管理接口(#12 运维补全)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
    app = await buildServer({ pool, wechat: null, jwtSecret: JWT_SECRET, adminApiKey: ADMIN_KEY });
    repo = new WallpaperRepository(pool);
    await repo.upsert(seedWallpaper({ sourceId: 'adm-1', title: '管理测试1', category: '风景' }));
    await repo.upsert(seedWallpaper({ sourceId: 'adm-2', title: '管理测试2', category: '星空' }));
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const adminHeaders = { 'x-admin-key': ADMIN_KEY };

  it('未配置 ADMIN_API_KEY 的服务器 → 管理操作 503(不暴露)', async () => {
    // buildServer 默认从 config 读 ADMIN_API_KEY(vitest env 未设 → 空)
    const noKeyApp = await buildServer({ pool, wechat: null, jwtSecret: JWT_SECRET });
    try {
      const health = await noKeyApp.inject({ method: 'GET', url: '/admin/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ configured: false });
      const block = await noKeyApp.inject({
        method: 'POST',
        url: '/admin/wallpapers/1/block',
        headers: adminHeaders,
      });
      expect(block.statusCode).toBe(503);
    } finally {
      await noKeyApp.close();
    }
  });

  it('错误/缺失密钥 → 401;密钥比较恒定时间(长度不匹配也 401 不泄露)', async () => {
    const noKey = await app.inject({ method: 'GET', url: '/admin/health' });
    expect(noKey.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'GET', url: '/admin/health', headers: { 'x-admin-key': 'wrong' } });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({ method: 'GET', url: '/admin/health', headers: adminHeaders });
    expect(right.statusCode).toBe(200);
  });

  it('隔离内容: block → active 壁纸从信息流消失,详情 404;restore 恢复', async () => {
    const row = (await repo.findBySourceAndSourceId('curated', 'adm-1'))!;

    // block
    const block = await app.inject({ method: 'POST', url: `/admin/wallpapers/${row.id}/block`, headers: adminHeaders });
    expect(block.statusCode).toBe(200);
    expect(block.json()).toEqual({ id: row.id, status: 'blocked' });
    const detail = await app.inject({ method: 'GET', url: `/wallpapers/${row.id}` });
    expect(detail.statusCode).toBe(404); // 隔离 → 对外 404
    const feed = (await app.inject({ method: 'GET', url: '/wallpapers' })).json();
    expect(feed.items.map((x: { id: number }) => x.id)).not.toContain(row.id);

    // 重复 block → 404(已是隔离状态,幂等提示)
    const blockAgain = await app.inject({ method: 'POST', url: `/admin/wallpapers/${row.id}/block`, headers: adminHeaders });
    expect(blockAgain.statusCode).toBe(404);

    // restore → 恢复可见
    const restore = await app.inject({ method: 'POST', url: `/admin/wallpapers/${row.id}/restore`, headers: adminHeaders });
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toEqual({ id: row.id, status: 'active' });
    const detailAfter = await app.inject({ method: 'GET', url: `/wallpapers/${row.id}` });
    expect(detailAfter.statusCode).toBe(200);

    // 不存在的壁纸 → 404
    const missing = await app.inject({ method: 'POST', url: '/admin/wallpapers/999999/block', headers: adminHeaders });
    expect(missing.statusCode).toBe(404);
  });

  it('审举报: 上报 → 列表可见(含壁纸摘要)→ 处理后消失', async () => {
    // 匿名登录后举报(复用 actions 路由造数据)
    const login = await app.inject({
      method: 'POST',
      url: '/auth/anon',
      payload: { device_id: '00000000-0000-4000-8000-0000000000a1' },
    });
    const token = login.json().token as string;
    const row = (await repo.findBySourceAndSourceId('curated', 'adm-2'))!;
    const report = await app.inject({
      method: 'POST',
      url: '/reports',
      payload: { wallpaper_id: row.id, reason: '涉嫌侵权' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(report.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/admin/reports', headers: adminHeaders });
    expect(list.statusCode).toBe(200);
    const body: { items: Array<{ id: number; reason: string; wallpaper: { id: number; title: string } }>; nextId: number | null } = list.json();
    expect(body.items.length).toBeGreaterThan(0);
    const target = body.items.find((x) => x.wallpaper.id === row.id);
    expect(target?.reason).toBe('涉嫌侵权');
    expect(target?.wallpaper.title).toBe('管理测试2');

    // 处理后删除 → 幂等
    const del = await app.inject({ method: 'DELETE', url: `/admin/reports/${target!.id}`, headers: adminHeaders });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ resolved: true });
    const delAgain = await app.inject({ method: 'DELETE', url: `/admin/reports/${target!.id}`, headers: adminHeaders });
    expect(delAgain.statusCode).toBe(404);
  });

  it('暂停/恢复回填: flag 落库(多副本共享),health 面板可见', async () => {
    const pause = await app.inject({ method: 'POST', url: '/admin/backfill/pause', headers: adminHeaders });
    expect(pause.statusCode).toBe(200);
    expect(pause.json()).toEqual({ paused: true });
    const health = await app.inject({ method: 'GET', url: '/admin/health', headers: adminHeaders });
    expect(health.json()).toMatchObject({ configured: true, backfillPaused: true });

    const resume = await app.inject({ method: 'POST', url: '/admin/backfill/resume', headers: adminHeaders });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toEqual({ paused: false });
    const healthAfter = await app.inject({ method: 'GET', url: '/admin/health', headers: adminHeaders });
    expect(healthAfter.json()).toMatchObject({ backfillPaused: false });
  });

  it('运营统计 /admin/stats: 内容存量 + 7d 行为 + Top 壁纸 + 分类热度(2026-08-15)', async () => {
    const a = (await repo.findBySourceAndSourceId('curated', 'adm-1'))!;
    const b = (await repo.findBySourceAndSourceId('curated', 'adm-2'))!;
    // 直接插事件(避开 /events 的 created_at=now 限制;stat-* 前缀 8+ 字符)
    await pool.query(
      `INSERT INTO events (event_id, event_name, user_id, wallpaper_id, created_at) VALUES
       ('stats-dl-a1', 'download_success', 'u1', $1, now()),
       ('stats-dl-a2', 'download_success', 'u2', $1, now()),
       ('stats-fav-a', 'favorite_add', 'u3', $1, now()),
       ('stats-dl-b1', 'download_success', 'u1', $2, now())`,
      [a.id, b.id],
    );

    const res = await app.inject({ method: 'GET', url: '/admin/stats', headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.content.active).toBe(2);
    expect(s.activity7d.downloads).toBe(3);
    expect(s.activity7d.favorites).toBe(1);
    expect(s.activity7d.activeUsers).toBe(3); // u1/u2/u3
    expect(s.activity30d.downloads).toBe(3);
    // Top 壁纸: a 有 2 次下载 > b 的 1 次
    expect(s.topWallpapers[0].id).toBe(a.id);
    expect(s.topWallpapers[0].downloads).toBe(2);
    // 分类热度: 风景(a)下载 2 > 星空(b)下载 1
    const byCat = Object.fromEntries(s.categoryHeat.map((x: { category: string; downloads: number }) => [x.category, x.downloads]));
    expect(byCat['风景']).toBe(2);
    expect(byCat['星空']).toBe(1);
  });
});
