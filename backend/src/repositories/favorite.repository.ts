import type pg from 'pg';
import { mapRow, ROW_COLUMNS, type WallpaperRow } from './wallpaper.repository';


/** 我的收藏 keyset 游标(favorites.created_at, wallpaper_id) */
export interface FavoriteCursor {
  createdAtMs: number;
  id: number;
}

/**
 * 收藏(#10,规格 #7)。favorites 表 PK (user_id, wallpaper_id) 天然幂等:
 * ON CONFLICT DO NOTHING → 重复收藏第二次不报错(验收 3)。
 * user_id 为 HMAC 哈希后的内部 ID(规格 07: 不存 openid/device_id 明文)。
 */
export class FavoriteRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** 幂等收藏(不存在则插入,已存在 no-op) */
  async add(userId: string, wallpaperId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO favorites (user_id, wallpaper_id) VALUES ($1, $2)
       ON CONFLICT (user_id, wallpaper_id) DO NOTHING`,
      [userId, wallpaperId],
    );
  }

  /** 取消收藏;返回是否确实删除了记录(不存在 → false,幂等) */
  async remove(userId: string, wallpaperId: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM favorites WHERE user_id = $1 AND wallpaper_id = $2`,
      [userId, wallpaperId],
    );
    return (rowCount ?? 0) > 0;
  }

  async isFavorited(userId: string, wallpaperId: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM favorites WHERE user_id = $1 AND wallpaper_id = $2 LIMIT 1`,
      [userId, wallpaperId],
    );
    return rows.length > 0;
  }

  /**
   * 我的收藏(分页): join wallpapers,只返回 active;keyset (f.created_at, w.id)。
   * 返回 favoritedAt(收藏时间,真正的排序键)—— 游标必须用它而非壁纸 created_at,
   * 否则收藏晚于壁纸创建时翻页恒漏(与 #7 同源但位置不同的精度/键错位问题)。
   * 精度前提: favorites.created_at 已截断 ms(迁移 1787100000000)。
   */
  async listByUser(
    userId: string,
    options: { limit: number; cursor?: FavoriteCursor | null },
  ): Promise<Array<{ wallpaper: WallpaperRow; favoritedAt: Date }>> {
    const { limit, cursor = null } = options;
    // ROW_COLUMNS 含 created_at/updated_at,join favorites 后两表都有 → 全部加 w. 前缀消歧义
    const joinColumns = ROW_COLUMNS.split(',')
      .map((c) => `w.${c.trim()}`)
      .join(', ');
    const { rows } = await this.pool.query(
      `SELECT ${joinColumns}, f.created_at AS "favoritedAt" FROM favorites f
       JOIN wallpapers w ON w.id = f.wallpaper_id
       WHERE f.user_id = $1
         AND w.status = 'active'
         AND ($2::timestamptz IS NULL
              OR (f.created_at, w.id) < ($2::timestamptz, $3::bigint))
       ORDER BY f.created_at DESC, w.id DESC
       LIMIT $4`,
      [userId, cursor ? new Date(cursor.createdAtMs) : null, cursor?.id ?? null, limit],
    );
    return rows.map((row) => ({ wallpaper: mapRow(row), favoritedAt: row.favoritedAt }));
  }
}
