import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { WechatClient } from '../auth/wechat';
import type { AuthContext } from '../plugins/auth';
import type { ObjectStorage } from '../storage/object-storage';
import { actionsRoutes } from './actions';
import { authRoutes } from './auth';
import { favoritesRoutes } from './favorites';
import { healthRoutes } from './health';
import { wallpapersRoutes } from './wallpapers';

export interface RouteDeps {
  pool: pg.Pool;
  storage: ObjectStorage;
  auth: AuthContext;
  wechat: WechatClient | null;
  jwtSecret: string;
}

/** 注册全部路由(骨架 + 内容/搜索 + 鉴权 + 收藏 + 解锁/举报/埋点) */
export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  await app.register(healthRoutes);
  await app.register(wallpapersRoutes, deps);
  await app.register(authRoutes, { jwtSecret: deps.jwtSecret, wechat: deps.wechat });
  await app.register(favoritesRoutes, deps);
  await app.register(actionsRoutes, deps); // 解锁/举报/埋点(#8 剩余)
}
