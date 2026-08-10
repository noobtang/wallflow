/**
 * 初始 Schema(#3): 壁纸元数据缓存 + 收藏 + 激励视频解锁 + 举报 + 埋点。
 * 对齐 ENG-PLAN.md「数据库 Schema」节。
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ===== 壁纸元数据(内容管道 #4 写入,只读 API 查询) =====
  pgm.createTable('wallpapers', {
    id: 'bigserial',
    source: { type: 'text', notNull: true },
    source_id: { type: 'text', notNull: true },
    title: 'text',
    url: { type: 'text', notNull: true },
    thumb_url: { type: 'text', notNull: true },
    license: { type: 'text', notNull: true },
    license_url: 'text',
    creator: 'text',
    creator_url: 'text',
    width: 'integer',
    height: 'integer',
    tags: { type: 'text[]' },
    search_text: 'text',
    category: 'text',
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('wallpapers', 'wallpapers_pkey', { primaryKey: 'id' });
  // 导入幂等键(#4 upsert)
  pgm.addConstraint('wallpapers', 'wallpapers_source_source_id_key', {
    unique: ['source', 'source_id'],
  });
  // 分类 + 时间 复合索引(信息流/分类页)
  pgm.createIndex(
    'wallpapers',
    ['category', { name: 'created_at', sort: 'DESC' }],
    { name: 'idx_wallpapers_category_created' },
  );
  // 中文搜索(预分词 search_text,simple 分词器;jieba 在 #6 接入)
  pgm.sql(
    "CREATE INDEX idx_wallpapers_search ON wallpapers USING GIN (to_tsvector('simple', search_text));",
  );
  // 标签过滤(相似推荐 #6)
  pgm.createIndex('wallpapers', 'tags', { name: 'idx_wallpapers_tags', method: 'gin' });

  // ===== 收藏 =====
  pgm.createTable('favorites', {
    user_id: { type: 'text', notNull: true },
    wallpaper_id: { type: 'bigint', notNull: true, references: 'wallpapers' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('favorites', 'favorites_pkey', {
    primaryKey: ['user_id', 'wallpaper_id'],
  });

  // ===== 激励视频解锁记录(#7,防重放) =====
  pgm.createTable('ad_unlocks', {
    id: 'bigserial',
    user_id: { type: 'text', notNull: true },
    wallpaper_id: { type: 'bigint', notNull: true, references: 'wallpapers' },
    unlock_key: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('ad_unlocks', 'ad_unlocks_pkey', { primaryKey: 'id' });
  pgm.addConstraint('ad_unlocks', 'ad_unlocks_user_wallpaper_key', {
    unique: ['user_id', 'wallpaper_id'],
  });

  // ===== 举报(每用户每图最多一次) =====
  pgm.createTable('reports', {
    id: 'bigserial',
    user_id: { type: 'text', notNull: true },
    wallpaper_id: { type: 'bigint', notNull: true, references: 'wallpapers' },
    reason: 'text',
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('reports', 'reports_pkey', { primaryKey: 'id' });
  pgm.addConstraint('reports', 'reports_user_wallpaper_key', {
    unique: ['user_id', 'wallpaper_id'],
  });

  // ===== 埋点事件(客户端 event_id 去重) =====
  pgm.createTable('events', {
    id: 'bigserial',
    event_name: { type: 'text', notNull: true },
    event_id: { type: 'text', notNull: true },
    user_id: 'text',
    wallpaper_id: 'bigint',
    extra: 'jsonb',
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('events', 'events_pkey', { primaryKey: 'id' });
  pgm.addConstraint('events', 'events_event_id_key', { unique: 'event_id' });
  pgm.createIndex('events', ['event_name', 'created_at'], { name: 'idx_events_name_created' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // 有 FK 引用 wallpapers,需逆序删除
  pgm.dropTable('events');
  pgm.dropTable('reports');
  pgm.dropTable('ad_unlocks');
  pgm.dropTable('favorites');
  pgm.dropTable('wallpapers');
};
