import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health';

/** 注册全部路由(骨架阶段仅 health;业务路由在 #5-#10 逐个加入) */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
}
