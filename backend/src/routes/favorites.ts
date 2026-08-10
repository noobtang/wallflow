import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { AuthContext } from '../plugins/auth';
import { FavoriteRepository } from '../repositories/favorite.repository';
import { WallpaperRepository } from '../repositories/wallpaper.repository';
import type { ObjectStorage } from '../storage/object-storage';
import { decodeTsCursor, encodeTsCursor } from './cursor';
import { badRequest, notFound, toSignedListItem } from './wallpapers';

const addBodySchema = z.object({ wallpaper_id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * 收藏(#10,规格 #7): 全部需登录(401)。
 * - POST   /favorites {wallpaper_id}  收藏(幂等: 重复收藏第二次 200)
 * - GET    /favorites                我的收藏(join 壁纸,keyset 分页,签名直链)
 * - DELETE /favorites/:id            取消收藏(幂等)
 */
export async function favoritesRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; storage: ObjectStorage; auth: AuthContext },
): Promise<void> {
  const favRepo = new FavoriteRepository(deps.pool);
  const wpRepo = new WallpaperRepository(deps.pool);
  const { storage } = deps;

  app.post('/favorites', { preHandler: deps.auth.requireAuth }, async (request) => {
    const parsed = addBodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('wallpaper_id 必须为正整数');
    const wp = await wpRepo.findById(parsed.data.wallpaper_id);
    if (!wp || wp.status !== 'active') throw notFound('壁纸不存在');
    await favRepo.add(request.user!.sub, parsed.data.wallpaper_id);
    return { favorited: true };
  });

  app.get('/favorites', { preHandler: deps.auth.requireAuth }, async (request) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) throw badRequest('参数非法');
    let cursor: { createdAtMs: number; id: number } | null = null;
    if (parsed.data.cursor !== undefined) {
      cursor = decodeTsCursor(parsed.data.cursor);
      if (!cursor) throw badRequest('cursor 非法');
    }
    const rows = await favRepo.listByUser(request.user!.sub, {
      limit: parsed.data.limit,
      cursor,
    });
    const mapped = rows.map(({ wallpaper }) => toSignedListItem(wallpaper, storage));
    const last = rows[rows.length - 1];
    const nextCursor =
      mapped.length === parsed.data.limit && mapped.length > 0
        ? encodeTsCursor(last.favoritedAt.getTime(), last.wallpaper.id)
        : null;
    return { items: mapped, nextCursor };
  });

  app.delete('/favorites/:id', { preHandler: deps.auth.requireAuth }, async (request) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) throw badRequest('id 必须为正整数');
    const removed = await favRepo.remove(request.user!.sub, parsed.data.id);
    return { favorited: false, removed };
  });
}
