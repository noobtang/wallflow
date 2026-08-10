import pg from 'pg';

/**
 * node-postgres 默认把 int8/bigint(含 BIGSERIAL id)解析为 string(防 2^53 溢出)。
 * WallFlow 的 id 均为自增小整数(百万级内),安全地转回 number 以方便业务使用。
 * 需在使用 pg 前 side-effect import(见 db.ts / 测试 helper)。
 * 注意: 该解析器是进程级全局副作用 — 所有连接必须经 src/db.ts 的 createPool 创建,
 * 不要直接 new pg.Pool,否则 id 会回到 string。
 */
pg.types.setTypeParser(20, (value: string) => Number(value));
