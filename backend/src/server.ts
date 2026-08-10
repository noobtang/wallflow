import Fastify from 'fastify';
import type pg from 'pg';
import { config } from './config';
import { createPool } from './db';
import { registerErrorHandler } from './plugins/error-handler';
import { registerRoutes } from './routes';

/**
 * 可测试的服务器工厂: 测试通过 await buildServer() 后 app.inject 调用,无需真实端口。
 * 业务路由需要 DB,默认按 config 自建连接池(app 关闭时回收);测试可注入共享 pool。
 */
export async function buildServer(options: { pool?: pg.Pool } = {}) {
  const app = Fastify({ logger: true });
  const pool = options.pool ?? createPool(config);
  registerErrorHandler(app);
  await registerRoutes(app, { pool });
  if (!options.pool) {
    app.addHook('onClose', async () => {
      await pool.end();
    });
  }
  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`WallFlow backend listening on :${config.PORT} (env=${config.NODE_ENV})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// CJS 入口守卫: 仅直接运行时启动(被测试 import 时不启动)
if (require.main === module) {
  void main();
}
