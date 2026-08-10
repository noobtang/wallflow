import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // DB 测试(迁移 up/down + repository)共享同一库,串行执行保证确定性;
    // 规模上来后若想并行,可改为仅 DB 测试文件串行(单独 project 或 sequence)而非全局串行
    fileParallelism: false,
    // 测试环境变量默认值(config.ts 在导入时校验,缺 DATABASE_URL 会抛错)。
    // 注意: vitest 的 env 会覆盖外部注入的 process.env,所以这里必须优先透传外部
    // DATABASE_URL(CI 步骤注入的 postgres://wallflow:wallflow@...),仅本地无注入时
    // 回退到本地默认(test:test)。否则 CI 上测试会用错误的凭据连库。
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/wallflow_test',
    },
  },
});
