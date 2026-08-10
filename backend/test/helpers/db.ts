import path from 'node:path';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import '../../src/pg-types'; // int8 → number(与生产一致)

// node-pg-migrate v9 是 ESM 包;本工程为 CJS,运行时靠 Node ≥20.19 的 require(esm) 加载
// (package.json engines 已声明),避免改动态 import 保持助手同步风格。
type MigrateOptions = Parameters<typeof runner>[0];

/** 注意: 必须惰性读取(测试文件可在 import 前改写 process.env.DATABASE_URL) */
function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for DB tests');
  return url;
}

const QUIET_LOGGER: MigrateOptions['logger'] = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function migrateOptions(direction: 'up' | 'down', count: number): MigrateOptions {
  return {
    databaseUrl: databaseUrl(),
    dir: path.resolve(__dirname, '..', '..', 'migrations'),
    direction,
    count,
    migrationsTable: 'pgmigrations',
    logger: QUIET_LOGGER,
  };
}

/** 应用全部迁移(幂等: 已应用的跳过) */
export async function runMigrations(): Promise<void> {
  await runner(migrateOptions('up', Number.POSITIVE_INFINITY));
}

/** 回滚全部迁移 */
export async function runMigrationsDown(): Promise<void> {
  await runner(migrateOptions('down', Number.POSITIVE_INFINITY));
}

export async function createTestPool(): Promise<pg.Pool> {
  return new pg.Pool({ connectionString: databaseUrl() });
}

/** 清空业务表(有 FK 依赖,按逆序 + CASCADE) */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE events, reports, ad_unlocks, favorites, wallpapers RESTART IDENTITY CASCADE',
  );
}

/** 查询表清单(验证迁移产物) */
export async function listTables(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

/** 查询索引清单(验证迁移产物) */
export async function listIndexes(
  pool: pg.Pool,
): Promise<Array<{ indexname: string; indexdef: string }>> {
  const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY indexname`,
  );
  return rows.map((r) => ({ indexname: r.indexname, indexdef: r.indexdef }));
}
