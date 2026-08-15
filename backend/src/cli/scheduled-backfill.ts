import { loadConfig } from '../config';
import { createPool } from '../db';
import { AdminRepository } from '../repositories/admin.repository';
import { buildSearchText } from '../search/segmenter';
import { JobScheduler } from '../jobs/scheduler';

/**
 * 定时回填入口(#12 回填任务持久化)。
 * 用法: npm run backfill:scheduled
 * 由 cron/systemd 周期性调用;内部经暂停开关 + DB 租约防多副本重叠。
 * 任务主体 = 重建全部壁纸 search_text(幂等,可重复执行)。
 */
const BACKFILL_SEARCH_JOB = 'backfill:search_text';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    const scheduler = new JobScheduler(pool, new AdminRepository(pool));
    const outcome = await scheduler.runOnce({
      name: BACKFILL_SEARCH_JOB,
      run: async (p) => {
        const { rows } = await p.query<{
          id: number;
          title: string | null;
          tags: string[] | null;
          category: string | null;
        }>(`SELECT id, title, tags, category FROM wallpapers`);
        let updated = 0;
        for (const row of rows) {
          const searchText = buildSearchText(row.title ?? '', row.tags ?? [], row.category);
          await p.query('UPDATE wallpapers SET search_text = $2 WHERE id = $1', [row.id, searchText]);
          updated += 1;
        }
        return { total: rows.length, updated };
      },
    });

    if (outcome.skipped) {
      const reason = outcome.reason === 'paused' ? '管理员暂停回填' : '其他副本持有租约';
      console.log(`⏭ 跳过本轮回填(${reason})`);
      return;
    }
    console.log(`✅ 回填完成: ${outcome.result.updated}/${outcome.result.total} 条 search_text 已重建`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('回填失败:', err);
  process.exit(1);
});
