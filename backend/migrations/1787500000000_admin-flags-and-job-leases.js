/**
 * 运维补全(#12 后续): 管理员状态 + 持久化任务调度基础设施。
 * - system_flags: 键值表,存运维开关(如 backfill_paused)。多副本共享,替代进程内存。
 * - job_leases: 任务租约表,防多副本重叠执行(node-cron 非持久调度 → DB 租约兜底)。
 *   语义: 每行 = 一个已注册任务名;owner=当前持租约实例(hostname+pid),expires_at=过期时间。
 *   获取租约 = 原子 UPDATE ... WHERE expires_at < now() OR owner = $me,行影响数 1 即成功。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('system_flags', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('job_leases', {
    name: { type: 'text', primaryKey: true },
    owner: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('job_leases');
  pgm.dropTable('system_flags');
};
