import type pg from 'pg';

/**
 * 埋点事件保留策略(2026-08-15 E 运维小项): 删除超过保留期的 events 行。
 * - events 表无限增长(客户端每次行为一行)→ 定期清理,默认保留 90 天
 * - 幂等、可重复跑;建议 cron 每周执行(见 deploy/README)
 * - 索引: 命中 idx_events_name_created(event_name, created_at) 前缀删除
 */
export async function cleanupEvents(
  pool: pg.Pool,
  options: { olderThanDays: number },
): Promise<{ deleted: number }> {
  const result = await pool.query(
    `DELETE FROM events WHERE created_at < now() - ($1::int * interval '1 day')`,
    [options.olderThanDays],
  );
  return { deleted: result.rowCount ?? 0 };
}
