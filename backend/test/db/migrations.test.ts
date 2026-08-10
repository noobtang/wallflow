import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  createTestPool,
  listIndexes,
  listTables,
  runMigrations,
  runMigrationsDown,
} from '../helpers/db';

/**
 * 迁移测试与 repository 测试共享 DATABASE_URL(vitest 串行执行,见 vitest.config.ts
 * fileParallelism: false)。db:down 用例回滚后,由 afterAll 重新 up 恢复,保证
 * 后续串行执行的 repository 测试有表可用。
 */
const EXPECTED_TABLES = ['ad_unlocks', 'events', 'favorites', 'reports', 'wallpapers'];
const EXPECTED_INDEXES = [
  'idx_events_name_created',
  'idx_wallpapers_category_created',
  'idx_wallpapers_search',
  'idx_wallpapers_tags',
];

describe('数据库迁移(#3)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
  });

  it('db:up 创建全部 5 张表(验收 1)', async () => {
    const tables = await listTables(pool);
    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t);
    }
    expect(tables).toContain('pgmigrations'); // 迁移记录表
  });

  it('索引存在,含 GIN 搜索/标签索引与复合索引(验收 2)', async () => {
    const indexes = await listIndexes(pool);
    const names = indexes.map((i) => i.indexname);
    for (const ix of EXPECTED_INDEXES) {
      expect(names).toContain(ix);
    }
    const searchIdx = indexes.find((i) => i.indexname === 'idx_wallpapers_search');
    expect(searchIdx?.indexdef).toContain('USING gin');
    expect(searchIdx?.indexdef).toContain('to_tsvector');
    const tagsIdx = indexes.find((i) => i.indexname === 'idx_wallpapers_tags');
    expect(tagsIdx?.indexdef).toContain('USING gin');
    const categoryIdx = indexes.find((i) => i.indexname === 'idx_wallpapers_category_created');
    expect(categoryIdx?.indexdef).toContain('DESC');
  });

  it('db:up 幂等: 重复执行不报错、不重复建表', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
    const tables = await listTables(pool);
    expect(tables.filter((t) => t === 'wallpapers')).toHaveLength(1);
  });

  it('UNIQUE (source, source_id) 生效: 重复插入报 23505(验收 4)', async () => {
    await pool.query(
      `INSERT INTO wallpapers (source, source_id, url, thumb_url, license)
       VALUES ('curated', 'dup-001', 'https://example.com/a.jpg', 'https://example.com/a_t.jpg', 'CC0')`,
    );
    await expect(
      pool.query(
        `INSERT INTO wallpapers (source, source_id, url, thumb_url, license)
         VALUES ('curated', 'dup-001', 'https://example.com/b.jpg', 'https://example.com/b_t.jpg', 'CC0')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('UNIQUE event_id 生效: 重复埋点事件被去重(23505)', async () => {
    await pool.query(
      `INSERT INTO events (event_name, event_id) VALUES ('search_click', 'evt-dup-001')`,
    );
    await expect(
      pool.query(
        `INSERT INTO events (event_name, event_id) VALUES ('search_click', 'evt-dup-001')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('db:down 可回滚: 表全部删除(验收 3)', async () => {
    await runMigrationsDown();
    const tables = await listTables(pool);
    expect(tables).not.toContain('wallpapers');
    expect(tables).not.toContain('favorites');
  });

  // 本文件最后: 回滚后恢复迁移,保证串行执行的 repository 测试有表可用
  afterAll(async () => {
    try {
      await runMigrations();
    } catch (err) {
      // 恢复失败时给出明确提示,避免后续测试报出令人困惑的错误
      console.error('[migrations.test] 回滚后重建失败,后续 DB 测试可能受影响:', err);
      throw err;
    } finally {
      await pool?.end();
    }
  });
});
