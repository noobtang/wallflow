import Fastify from 'fastify';
import type pg from 'pg';
import { createWechatClient, type WechatClient } from './auth/wechat';
import { config } from './config';
import { createPool } from './db';
import { createAuth, type AuthContext } from './plugins/auth';
import { registerErrorHandler } from './plugins/error-handler';
import { registerRoutes } from './routes';
import { createObjectStorage, type ObjectStorage } from './storage/object-storage';

/**
 * 可测试的服务器工厂: 测试通过 await buildServer() 后 app.inject 调用,无需真实端口。
 * 业务路由需要 DB/对象存储/鉴权,默认按 config 自建(app 关闭时回收);测试可注入共享实例。
 * - storage: 有 COS 凭证 → 真实 COS;无 → mock(测试/本地无副作用)
 * - wechat: 无 WECHAT_APPID/SECRET → null(/auth/login 返回 503);测试注入 fake client
 * - jwtSecret: 默认取 config(JWT_SECRET);测试可注入固定值
 */
export async function buildServer(
  options: {
    pool?: pg.Pool;
    storage?: ObjectStorage;
    auth?: AuthContext;
    wechat?: WechatClient | null;
    jwtSecret?: string;
  } = {},
) {
  const app = Fastify({ logger: true });
  const pool = options.pool ?? createPool(config);
  const storage = options.storage ?? createObjectStorage(config);
  const jwtSecret = options.jwtSecret ?? config.JWT_SECRET;
  const wechat = options.wechat !== undefined ? options.wechat : createWechatClient(config);
  const auth = options.auth ?? createAuth({ jwtSecret });
  app.decorateRequest('user', null);
  registerErrorHandler(app);
  await registerRoutes(app, { pool, storage, auth, wechat, jwtSecret });
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
