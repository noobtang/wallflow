import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { AdminRepository } from '../../src/repositories/admin.repository';
import { BACKFILL_PAUSED_FLAG } from '../../src/routes/admin';
import { createTestPool, runMigrations } from '../helpers/db';
import { JobLease } from '../../src/jobs/lease';
import { JobScheduler } from '../../src/jobs/scheduler';

describe('任务租约(#12 回填持久化)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    // 清掉上轮遗留租约,保证测试确定性
    await pool.query('DELETE FROM job_leases');
    await pool.query('DELETE FROM system_flags');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('互斥: 两个实例争抢同一任务,只有一个成功;释放后可再获取', async () => {
    const a = new JobLease(pool, 'job:mutex');
    const b = new JobLease(pool, 'job:mutex');
    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(false); // a 持有,互斥
    await a.release();
    expect(await b.tryAcquire()).toBe(true); // 释放后可获取
    await b.release();
    // 重复释放安全
    await a.release();
  });

  it('过期接管: 租约过期后其他实例可强占(进程崩溃场景)', async () => {
    // ttl 很短(200ms),不续约 → 过期
    const a = new JobLease(pool, 'job:expiry', { ttlMs: 200, renewIntervalMs: 100_000 });
    expect(await a.tryAcquire()).toBe(true);
    await new Promise((r) => setTimeout(r, 350));
    const b = new JobLease(pool, 'job:expiry');
    expect(await b.tryAcquire()).toBe(true); // a 的租约已过期,b 强占
    await b.release();
    await a.release();
  });

  it('runExclusive: 持约执行,任务抛错也释放租约(下轮可重试)', async () => {
    const lease = new JobLease(pool, 'job:error');
    let calls = 0;
    await expect(
      lease.runExclusive(async () => {
        calls += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // 抛错后租约已释放 → 另一个实例可获取
    const second = new JobLease(pool, 'job:error');
    expect(await second.tryAcquire()).toBe(true);
    await second.release();
    expect(calls).toBe(1);
  });
});

describe('JobScheduler(暂停开关 + 租约)', () => {
  let pool: pg.Pool;
  let admin: AdminRepository;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    admin = new AdminRepository(pool);
    await pool.query('DELETE FROM job_leases');
    await pool.query('DELETE FROM system_flags');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('未暂停且无人持有 → 执行并返回结果', async () => {
    const scheduler = new JobScheduler(pool, admin);
    const outcome = await scheduler.runOnce({
      name: 'job:scheduler-run',
      run: async () => ({ ok: true, at: Date.now() }),
    });
    expect(outcome.skipped).toBe(false);
    if (!outcome.skipped) expect(outcome.result).toMatchObject({ ok: true });
  });

  it('管理员暂停 → 跳过(不执行任务)', async () => {
    await admin.setFlag(BACKFILL_PAUSED_FLAG, true);
    const scheduler = new JobScheduler(pool, admin);
    let ran = false;
    const outcome = await scheduler.runOnce({
      name: 'job:scheduler-paused',
      run: async () => {
        ran = true;
        return { ok: true };
      },
    });
    expect(outcome).toEqual({ skipped: true, reason: 'paused' });
    expect(ran).toBe(false);
    await admin.setFlag(BACKFILL_PAUSED_FLAG, false);
  });

  it('他人持有租约 → 跳过(多副本不重叠)', async () => {
    const holder = new JobLease(pool, 'job:scheduler-locked');
    expect(await holder.tryAcquire()).toBe(true);
    const scheduler = new JobScheduler(pool, admin);
    let ran = false;
    const outcome = await scheduler.runOnce({
      name: 'job:scheduler-locked',
      run: async () => {
        ran = true;
        return { ok: true };
      },
    });
    expect(outcome).toEqual({ skipped: true, reason: 'locked' });
    expect(ran).toBe(false);
    await holder.release();
  });
});
