import type pg from 'pg';
import { AdminRepository } from '../repositories/admin.repository';
import { BACKFILL_PAUSED_FLAG } from '../routes/admin';
import { JobLease } from './lease';

export interface ScheduledJob<T> {
  /** 任务名(也是 job_leases 主键;全局唯一) */
  name: string;
  /** 任务主体;必须幂等(崩溃重跑不产生重复副作用) */
  run: (pool: pg.Pool) => Promise<T>;
}

/**
 * 调度器(#12 回填任务持久化)。
 *
 * 设计(配合外部 cron/systemd 定时触发):
 *   - 每个任务由 cron/systemd 周期性调用一次 runOnce —— 进程崩溃/机器重启由外部调度器
 *     重新拉起,不再依赖进程内 node-cron 的存活性(非持久调度的根因)
 *   - runOnce 内部: 检查暂停开关 → JobLease 获取租约 → 执行任务(幂等)→ 释放
 *   - 多副本部署时: 同一时刻只有一个实例持有租约,其余返回 skipped —— 防重叠
 *   - 暂停开关(ADMIN /admin/backfill/pause): 管理员可临时停掉回填,不中断正在运行的批次
 */
export class JobScheduler {
  constructor(
    private readonly pool: pg.Pool,
    private readonly admin: AdminRepository,
  ) {}

  /**
   * 执行一次任务(由 cron/systemd 触发)。返回值供外部日志/监控:
   *   - skipped: 其他实例持有租约 或 管理员暂停
   *   - result:  任务返回(仅本轮持有租约的实例有)
   *   - error:   任务抛错(租约仍会释放,下轮重试;外部调度器决定是否告警)
   */
  async runOnce<T>(job: ScheduledJob<T>): Promise<{ skipped: true; reason: 'paused' | 'locked' } | { skipped: false; result: T }> {
    // 1) 暂停开关优先(不进 DB 写路径,纯读)
    const paused = await this.admin.getFlag(BACKFILL_PAUSED_FLAG, false);
    if (paused) return { skipped: true, reason: 'paused' };

    // 2) 租约: 拿不到 = 其他副本正在跑,本轮跳过
    const lease = new JobLease(this.pool, job.name);
    if (!(await lease.tryAcquire())) return { skipped: true, reason: 'locked' };

    try {
      const result = await job.run(this.pool);
      return { skipped: false, result };
    } finally {
      await lease.release();
    }
  }
}
