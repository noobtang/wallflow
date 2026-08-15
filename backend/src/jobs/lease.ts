import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * 任务租约(#12 Eng review: 回填任务持久化)。
 *
 * 背景: node-cron 等进程内调度是非持久的 —— 进程崩溃任务丢失、多副本(多实例)会重叠执行。
 * 解法: 用 DB 表 job_leases 做分布式租约:
 *   - 每个任务一行(name PK);owner = 实例唯一 ID(hostname:pid:uuid),expires_at = 过期时刻
 *   - 获取租约: 原子 UPDATE ... WHERE expires_at < now() OR owner = $me,影响 1 行即成功
 *     (行被过期占用者可强占;未过期且他人持有 → 失败)
 *   - 持约期间定期续约(heartbeat),任务结束释放(owner 匹配才删)
 *   - 进程崩溃: 租约自然过期,其他实例可接管 —— 持久调度,不丢任务、不重叠
 */
export interface JobLeaseOptions {
  /** 租约时长(ms),默认 10 分钟;任务运行时长超过需续约 */
  ttlMs?: number;
  /** 续约间隔(ms),默认 ttlMs / 3 */
  renewIntervalMs?: number;
}

export class JobLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobLeaseError';
  }
}

export class JobLease {
  readonly owner: string;
  private readonly name: string;
  private readonly pool: pg.Pool;
  private readonly ttlMs: number;
  private readonly renewIntervalMs: number;
  private acquired = false;
  private renewTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    pool: pg.Pool,
    name: string,
    options: JobLeaseOptions = {},
  ) {
    this.pool = pool;
    this.name = name;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.renewIntervalMs = options.renewIntervalMs ?? Math.floor(this.ttlMs / 3);
    // hostname:pid:uuid —— 多副本同机部署也唯一
    this.owner = `${process.env.HOSTNAME ?? 'host'}:${process.pid}:${randomUUID()}`;
  }

  /** 尝试获取租约;被他人持有(未过期)时返回 false,不阻塞 */
  async tryAcquire(): Promise<boolean> {
    if (this.acquired) return true;
    const { rowCount } = await this.pool.query(
      `INSERT INTO job_leases (name, owner, expires_at, updated_at)
       VALUES ($1, $2, now() + make_interval(secs => $3), now())
       ON CONFLICT (name) DO UPDATE
         SET owner = EXCLUDED.owner,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()
         WHERE job_leases.expires_at < now() OR job_leases.owner = EXCLUDED.owner
       RETURNING owner`,
      [this.name, this.owner, this.ttlMs / 1000],
    );
    if ((rowCount ?? 0) === 0) return false;
    this.acquired = true;
    this.startRenewLoop();
    return true;
  }

  /** 阻塞式获取: 轮询直到拿到(用于「必须执行一次」的调度,如回填);轮询间隔可配 */
  async acquire(options: { pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<void> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;
    for (;;) {
      if (await this.tryAcquire()) return;
      if (Date.now() > deadline) {
        throw new JobLeaseError(`任务 ${this.name} 获取租约超时(其他实例可能持有)`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  /** 续约: 仅 owner 匹配才续期(防止误续他人租约) */
  private async renew(): Promise<void> {
    await this.pool
      .query(
        `UPDATE job_leases SET expires_at = now() + make_interval(secs => $1), updated_at = now()
         WHERE name = $2 AND owner = $3`,
        [this.ttlMs / 1000, this.name, this.owner],
      )
      .catch((err: unknown) => {
        // 续约失败不中断任务;租约可能提前过期(其他实例接管),由任务幂等兜底
        console.error(`[lease:${this.name}] 续约失败: ${(err as Error).message}`);
      });
  }

  private startRenewLoop(): void {
    this.stopRenewLoop();
    this.renewTimer = setInterval(() => {
      void this.renew();
    }, this.renewIntervalMs);
    // 不阻止进程退出(续约是尽力而为;任务主体结束由 finally 释放)
    this.renewTimer.unref?.();
  }

  private stopRenewLoop(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  /** 释放租约: owner 匹配才删(他人已强占时不误删);重复释放安全 */
  async release(): Promise<void> {
    this.stopRenewLoop();
    if (!this.acquired) return;
    this.acquired = false;
    await this.pool
      .query('DELETE FROM job_leases WHERE name = $1 AND owner = $2', [this.name, this.owner])
      .catch(() => undefined);
  }

  /**
   * 便捷包装: 尝试获取租约,成功则执行任务并在 finally 释放。
   * 获取失败(他人持有)→ 返回 skipped:true,不执行。
   * 调用方(调度器)据此跳过本轮回填,不报错。
   */
  async runExclusive<T>(
    task: () => Promise<T>,
  ): Promise<{ skipped: boolean; result?: T }> {
    if (!(await this.tryAcquire())) return { skipped: true };
    try {
      const result = await task();
      return { skipped: false, result };
    } finally {
      await this.release();
    }
  }
}
