import Fastify from 'fastify';
import { config } from './config';
import { registerErrorHandler } from './plugins/error-handler';
import { registerRoutes } from './routes';

/** 可测试的服务器工厂: 测试通过 await buildServer() 后 app.inject 调用,无需真实端口 */
export async function buildServer() {
  const app = Fastify({ logger: true });
  registerErrorHandler(app);
  await registerRoutes(app);
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
