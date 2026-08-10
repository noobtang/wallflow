import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { AuthContext } from '../plugins/auth';
import { UserActionRepository } from '../repositories/user-action.repository';
import { WallpaperRepository } from '../repositories/wallpaper.repository';
import { badRequest, notFound } from './wallpapers';

const wallpaperIdSchema = z.object({ wallpaper_id: z.coerce.number().int().positive() });
const reportBodySchema = z.object({
  wallpaper_id: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1).max(200),
});
const eventBodySchema = z.object({
  event_name: z.string().trim().min(1).max(64),
  event_id: z.string().trim().min(8).max(64),
  wallpaper_id: z.coerce.number().int().positive().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/** 解锁/举报引用了 wallpapers 外键,先校验存在且 active(404),避免 FK 违例变 500 */
async function assertActiveWallpaper(repo: WallpaperRepository, id: number): Promise<void> {
  const row = await repo.findById(id);
  if (!row || row.status !== 'active') throw notFound('壁纸不存在');
}

/**
 * 用户行为(#8 剩余,规格 #7): 解锁 / 举报 / 埋点。
 * - POST /unlock  {wallpaper_id}          已登录,MVP 全免费解锁,幂等
 * - POST /reports {wallpaper_id, reason}  已登录,幂等,reason 1-200 字符
 * - POST /events  {event_name, event_id, wallpaper_id?, extra?}  可匿名,event_id 幂等(#10 漏斗数据入口)
 */
export async function actionsRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; auth: AuthContext },
): Promise<void> {
  const wpRepo = new WallpaperRepository(deps.pool);
  const actions = new UserActionRepository(deps.pool);

  app.post('/unlock', { preHandler: deps.auth.requireAuth }, async (request) => {
    const parsed = wallpaperIdSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('wallpaper_id 必须为正整数');
    await assertActiveWallpaper(wpRepo, parsed.data.wallpaper_id);
    return actions.unlock(request.user!.sub, parsed.data.wallpaper_id);
  });

  app.post('/reports', { preHandler: deps.auth.requireAuth }, async (request) => {
    const parsed = reportBodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('reason 必须为 1-200 字符的文本');
    await assertActiveWallpaper(wpRepo, parsed.data.wallpaper_id);
    return actions.report(request.user!.sub, parsed.data.wallpaper_id, parsed.data.reason);
  });

  app.post('/events', { preHandler: deps.auth.optionalAuth }, async (request) => {
    const parsed = eventBodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('event_name/event_id 必须为 1-64 字符');
    const userId = request.user?.sub ?? null;
    return actions.trackEvent({
      eventId: parsed.data.event_id,
      eventName: parsed.data.event_name,
      userId,
      wallpaperId: parsed.data.wallpaper_id ?? null,
      extra: parsed.data.extra ?? null,
    });
  });
}
