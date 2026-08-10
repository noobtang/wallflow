import { randomBytes } from 'node:crypto';
import type pg from 'pg';

/**
 * 用户行为落库(#8 剩余,规格 #7): 解锁 / 举报 / 埋点事件。
 * 全部幂等: 依赖表级 UNIQUE 约束 + ON CONFLICT DO NOTHING,重复调用不报错、不重复入库。
 */
export class UserActionRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** MVP 全免费解锁: 记录 (user, wallpaper) + 随机 unlock_key 防重放;重复解锁幂等(不新增行) */
  async unlock(userId: string, wallpaperId: number): Promise<{ unlocked: boolean }> {
    const unlockKey = randomBytes(16).toString('hex');
    const { rowCount } = await this.pool.query(
      `INSERT INTO ad_unlocks (user_id, wallpaper_id, unlock_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, wallpaper_id) DO NOTHING`,
      [userId, wallpaperId, unlockKey],
    );
    return { unlocked: (rowCount ?? 0) > 0 };
  }

  /** 举报: 每用户每图一次(UNIQUE(user_id, wallpaper_id));重复举报幂等 */
  async report(userId: string, wallpaperId: number, reason: string): Promise<{ reported: boolean }> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO reports (user_id, wallpaper_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, wallpaper_id) DO NOTHING`,
      [userId, wallpaperId, reason],
    );
    return { reported: (rowCount ?? 0) > 0 };
  }

  /** 埋点(#10 漏斗数据入口): event_id UNIQUE 幂等(重复上报不重复入库);可匿名;extra 为 jsonb */
  async trackEvent(input: {
    eventId: string;
    eventName: string;
    userId?: string | null;
    wallpaperId?: number | null;
    extra?: Record<string, unknown> | null;
  }): Promise<{ recorded: boolean }> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO events (event_id, event_name, user_id, wallpaper_id, extra)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        input.eventId,
        input.eventName,
        input.userId ?? null,
        input.wallpaperId ?? null,
        input.extra ? JSON.stringify(input.extra) : null,
      ],
    );
    return { recorded: (rowCount ?? 0) > 0 };
  }
}
