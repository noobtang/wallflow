import { loadConfig } from '../config';
import { createPool } from '../db';
import { cleanupEvents } from '../jobs/events-cleanup';

/**
 * 埋点事件清理 CLI(2026-08-15 E 运维小项)。
 * 用法: npm run cleanup:events [-- --days 90]
 *   - --days N: 保留 N 天(默认 90),超过 N 天的 events 全部删除
 * 建议 cron 每周执行(示例见 deploy/README §8)。
 */
async function main(): Promise<void> {
  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const olderThanDays = daysArg ? Number(daysArg.split('=')[1]) : 90;
  if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
    console.error('--days 必须是正整数(如 --days=90)');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const pool = createPool(config);
  try {
    const { deleted } = await cleanupEvents(pool, { olderThanDays });
    console.log(`✅ events 清理完成: 删除 ${deleted} 条(保留 ${olderThanDays} 天)`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('cleanup-events 失败:', err);
  process.exit(1);
});
