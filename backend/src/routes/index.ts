import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { healthRoutes } from './health';
import { wallpapersRoutes } from './wallpapers';

/** 注册全部路由(骨架 + #6 搜索;其余业务路由在 #7-#10 逐个加入) */
export async function registerRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool },
): Promise<void> {
  await app.register(healthRoutes);
  await app.register(wallpapersRoutes, deps);
}
