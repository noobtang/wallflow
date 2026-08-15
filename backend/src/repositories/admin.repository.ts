import type pg from 'pg';
import { mapRow, ROW_COLUMNS, type WallpaperRow } from './wallpaper.repository';

/** 举报审阅行(admin): 举报 + 被举报壁纸摘要 + 举报人哈希 ID(不暴露明文身份) */
export interface ReportReviewRow {
  id: number;
  userId: string;
  reason: string | null;
  createdAt: Date;
  wallpaper: WallpaperRow;
}

export interface ReportPage {
  items: ReportReviewRow[];
  nextId: number | null;
}

/**
 * 管理员数据访问(#12 运维补全): 隔离内容(block/restore)、审举报、运维开关。
 * - 不暴露任何明文身份(openid/device_id 仅存 HMAC 哈希,举报人也是哈希)
 * - 举报审阅按 reports.id 倒序 keyset 分页;resolve 即删除该举报记录(幂等)
 */
export class AdminRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** 隔离内容: status='blocked' → 退出所有对外 API(信息流/搜索/详情/收藏列表) */
  async blockWallpaper(id: number): Promise<WallpaperRow | null> {
    const { rows } = await this.pool.query(
      `UPDATE wallpapers SET status = 'blocked', updated_at = now()
       WHERE id = $1 AND status <> 'blocked'
       RETURNING ${ROW_COLUMNS}`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /** 恢复内容: status='active'(误隔离/审举报通过后恢复) */
  async restoreWallpaper(id: number): Promise<WallpaperRow | null> {
    const { rows } = await this.pool.query(
      `UPDATE wallpapers SET status = 'active', updated_at = now()
       WHERE id = $1 AND status <> 'active'
       RETURNING ${ROW_COLUMNS}`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /** 举报列表(keyset: reports.id 倒序);nextId 供翻页 */
  async listReports(options: { limit: number; cursor?: number | null }): Promise<ReportPage> {
    const { limit, cursor = null } = options;
    const joinColumns = ROW_COLUMNS.split(',')
      .map((c) => `w.${c.trim()}`)
      .join(', ');
    const { rows } = await this.pool.query(
      // 注意: ROW_COLUMNS 含 w.id,与 r.id 重名会互相覆盖(结果行取最后一个) → r.id 显式别名
      `SELECT r.id AS "reportId", r.user_id AS "userId", r.reason, r.created_at AS "createdAt",
              ${joinColumns}
       FROM reports r
       JOIN wallpapers w ON w.id = r.wallpaper_id
       WHERE ($1::bigint IS NULL OR r.id < $1)
       ORDER BY r.id DESC
       LIMIT $2`,
      [cursor, limit],
    );
    const items = rows.map((row) => ({
      id: row.reportId,
      userId: row.userId,
      reason: row.reason ?? null,
      createdAt: row.createdAt,
      wallpaper: mapRow(row),
    }));
    const last = items[items.length - 1];
    return { items, nextId: items.length === limit && last ? last.id : null };
  }

  /** 处理举报(下架或驳回后移除记录): 删除该举报,幂等(不存在返回 false) */
  async resolveReport(id: number): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM reports WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  /** 举报计数(未处理数,告警/面板用) */
  async countOpenReports(): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(*)::int AS count FROM reports');
    return rows[0]?.count ?? 0;
  }

  // ---- 运维开关(system_flags) ----

  /** 读取开关;不存在 → 默认值 */
  async getFlag<T>(key: string, defaultValue: T): Promise<T> {
    const { rows } = await this.pool.query(
      'SELECT value FROM system_flags WHERE key = $1',
      [key],
    );
    if (rows.length === 0) return defaultValue;
    return rows[0].value as T;
  }

  /** 写入开关(upsert) */
  async setFlag<T>(key: string, value: T): Promise<void> {
    await this.pool.query(
      `INSERT INTO system_flags (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}
