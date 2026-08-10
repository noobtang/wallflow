import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // DB 测试(迁移 up/down + repository)共享同一库,串行执行保证确定性;
    // 规模上来后若想并行,可改为仅 DB 测试文件串行(单独 project 或 sequence)而非全局串行
    fileParallelism: false,
    // 测试环境变量默认值(config.ts 在导入时校验,缺 DATABASE_URL 会抛错)
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/wallflow_test',
    },
  },
});
