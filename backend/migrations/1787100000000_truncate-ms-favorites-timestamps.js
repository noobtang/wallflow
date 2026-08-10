/**
 * favorites.created_at 截断到毫秒(#10 收藏列表 keyset 分页)。
 * 与 #7 的 wallpapers 时间戳迁移同理: keyset 游标 (created_at, wallpaper_id) 需要
 * created_at 与 JS Date(ms)无损往返,否则同毫秒连续收藏会被游标比较漏掉。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE favorites SET created_at = date_trunc('milliseconds', created_at);
    ALTER TABLE favorites
      ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', now());
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE favorites
      ALTER COLUMN created_at SET DEFAULT now();
  `);
};
