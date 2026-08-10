/**
 * 时间戳截断到毫秒(#7 内容 API)。
 *
 * 背景: 信息流 keyset 分页用 (created_at, id) 复合游标,而 JS Date 只有毫秒精度;
 * 若 created_at 保留 µs 精度,游标「小于/等于」比较会漏掉同一毫秒内连续插入的行
 * (与 #6 修复的 ts_rank float4 文本往返丢精度同类问题)。将写入默认值与存量数据
 * 统一截断到 ms,保证 created_at 在 DB 与 JS Date 之间无损往返。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE wallpapers
       SET created_at = date_trunc('milliseconds', created_at),
           updated_at = date_trunc('milliseconds', updated_at);
    ALTER TABLE wallpapers
      ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
    ALTER TABLE wallpapers
      ALTER COLUMN updated_at SET DEFAULT date_trunc('milliseconds', now());
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE wallpapers
      ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE wallpapers
      ALTER COLUMN updated_at SET DEFAULT now();
  `);
};
