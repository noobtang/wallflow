import path from 'node:path';
import Fastify from 'fastify';
import type pg from 'pg';
import { createWechatClient, type WechatClient } from './auth/wechat';
import { config } from './config';
import { createPool } from './db';
import { createAuth, type AuthContext } from './plugins/auth';
import { createOpsAlerter, OpsAlerter } from './ops/alerter';
import { registerErrorHandler } from './plugins/error-handler';
import { registerRateLimit, type RateLimitOptions } from './plugins/rate-limit';
import { registerRoutes } from './routes';
import { registerDevStatic } from './routes/dev-static';
import {
  createObjectStorage,
  FileObjectStorage,
  type ObjectStorage,
} from './storage/object-storage';

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
    /** 管理接口密钥(#12 运维补全);默认取 config.ADMIN_API_KEY(未配置则管理路由 503) */
    adminApiKey?: string;
    /** 运维告警(#12 告警接入);默认按 config 构建(测试可注入 mock,见 test/ops/alerter.test.ts) */
    opsAlerter?: OpsAlerter;
    /** 公开写接口限流(2026-08-15);undefined = 按 config;null = 关闭(测试可关) */
    rateLimit?: RateLimitOptions | null;
  } = {},
) {
  const app = Fastify({ logger: true });
  const pool = options.pool ?? createPool(config);
  const storage = options.storage ?? createObjectStorage(config);
  // dev 文件存储(#10 联调): 本机 /dev-storage/* 静态服务暴露落盘图片(路径遍历防护在路由内)
  if (!options.storage && storage instanceof FileObjectStorage) {
    const dir = config.DEV_STORAGE_DIR || path.resolve(process.cwd(), '.dev-storage');
    registerDevStatic(app, dir);
  }
  const jwtSecret = options.jwtSecret ?? config.JWT_SECRET;
  const wechat = options.wechat !== undefined ? options.wechat : createWechatClient(config);
  const auth = options.auth ?? createAuth({ jwtSecret });
  const opsAlerter = options.opsAlerter ?? createOpsAlerter(config);
  app.decorateRequest('user', null);
  registerErrorHandler(app);

  // 公开写接口限流(2026-08-15): 保护 /events /reports /favorites /unlock;测试可注入 null 关闭
  if (options.rateLimit !== null) {
    registerRateLimit(app, options.rateLimit ?? { windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX });
  }

  // 运维告警(#12): 5xx 响应 → 通知 webhook(告警器内部防抖聚合,发送不阻塞请求)
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500) {
      opsAlerter.record(reply.statusCode, request.method, request.url);
    }
  });
  await registerRoutes(app, {
    pool,
    storage,
    auth,
    wechat,
    jwtSecret,
    adminApiKey: options.adminApiKey ?? config.ADMIN_API_KEY,
  });
  if (!options.pool) {
    app.addHook('onClose', async () => {
      await pool.end();
    });
  }
  if (!options.opsAlerter) {
    // 自建的告警器随服务关停清理(注入的由测试/调用方负责)
    app.addHook('onClose', async () => {
      opsAlerter.dispose();
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
