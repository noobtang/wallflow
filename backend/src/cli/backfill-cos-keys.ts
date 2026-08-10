import { loadConfig } from '../config';
import { createPool } from '../db';

/**
 * #9 存量数据规整: 历史导入把完整 mock URL(如 https://cos-mock.local/wallpapers/xxx.jpg)
 * 存进了 url/thumb_url。DB 语义统一为「对象 key」(规格 #8),本脚本把形如
 * {scheme}://{host}/{key} 的值规整为 {key}。幂等: 已是 key 的行(不以 http 开头)不受影响。
 * 用法: npm run backfill:cos-keys
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    const { rowCount } = await pool.query(
      `UPDATE wallpapers
       SET url = regexp_replace(url, '^https?://[^/]+/', ''),
           thumb_url = regexp_replace(thumb_url, '^https?://[^/]+/', '')
       WHERE url LIKE 'http%' OR thumb_url LIKE 'http%'`,
    );
    console.log(`✅ backfill:cos-keys: ${rowCount} 行 url/thumb_url 已规整为对象 key`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('backfill 失败:', err);
  process.exit(1);
});
