import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { cleanupEvents } from '../../src/jobs/events-cleanup';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

describe('埋点事件保留清理(2026-08-15 E 运维小项)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function countAll(): Promise<number> {
    const { rows } = await pool.query('SELECT count(*)::int AS c FROM events');
    return rows[0].c;
  }

  it('只删除超过保留期的行;保留期内的原样保留;幂等可重跑', async () => {
    await pool.query(
      `INSERT INTO events (event_id, event_name, created_at) VALUES
       ('cleanup-old-1-xx', 'download_click', now() - interval '30 days'),
       ('cleanup-old-2-xx', 'download_click', now() - interval '10 days'),
       ('cleanup-new-1-xx', 'download_click', now() - interval '1 day')`,
    );
    expect(await countAll()).toBe(3);

    // 保留 7 天 → 删除 30/10 天前的两条,保留 1 天前的
    const { deleted } = await cleanupEvents(pool, { olderThanDays: 7 });
    expect(deleted).toBe(2);
    expect(await countAll()).toBe(1);

    // 幂等: 再跑无新增删除
    const again = await cleanupEvents(pool, { olderThanDays: 7 });
    expect(again.deleted).toBe(0);

    // 保留 0.5 天(olderThanDays 传 1)→ 剩下 1 条(1 天前)也被清
    const all = await cleanupEvents(pool, { olderThanDays: 1 });
    expect(all.deleted).toBe(1);
    expect(await countAll()).toBe(0);
  });

  it('空表 → deleted 0 不报错', async () => {
    const r = await cleanupEvents(pool, { olderThanDays: 90 });
    expect(r.deleted).toBe(0);
  });
});
