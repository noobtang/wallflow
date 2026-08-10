import { loadConfig } from '../config';
import { createPool } from '../db';
import { buildSearchText } from '../search/segmenter';

/**
 * 重建存量 search_text(#6): 读取全部壁纸,用 jieba 预分词重新生成 search_text
 * (标题+标签+分类+同义词)。幂等,可重复执行;用于 #4 导入接入分词前已入库的数据。
 * 用法: npm run backfill:search [--status active]
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  // 用法: npm run backfill:search [--status=active](默认全量,幂等可重复执行)
  const onlyActive = process.argv.includes('--status=active');

  try {
    const { rows } = await pool.query<{ id: number; title: string | null; tags: string[] | null; category: string | null }>(
      `SELECT id, title, tags, category FROM wallpapers ${onlyActive ? "WHERE status = 'active'" : ''}`,
    );
    console.log(`共 ${rows.length} 条待重建`);

    let updated = 0;
    for (const row of rows) {
      const searchText = buildSearchText(row.title ?? '', row.tags ?? [], row.category);
      await pool.query('UPDATE wallpapers SET search_text = $2 WHERE id = $1', [row.id, searchText]);
      updated += 1;
      if (updated % 50 === 0) console.log(`  ...已更新 ${updated}/${rows.length}`);
    }
    console.log(`✅ backfill 完成: ${updated}/${rows.length} 条 search_text 已重建`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('backfill 失败:', err);
  process.exit(1);
});
