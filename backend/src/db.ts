import pg from 'pg';
import type { AppConfig } from './config';
import './pg-types'; // int8 → number(见 pg-types.ts)

/**
 * 应用级连接池(#3)。查询一律走参数化查询(prepared statements)。
 * 100-300 条壁纸的 MVP 规模,10 连接足够。
 * 约定: 所有连接必须经此工厂创建(它 side-effect 加载 pg-types,保证 int8→number 一致)。
 */
export function createPool(config: Pick<AppConfig, 'DATABASE_URL'>): pg.Pool {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    // 服务器端长空闲连接回收(PG 默认 idle_session_timeout 无限制时避免挂死)
    idleTimeoutMillis: 30_000,
  });
}
