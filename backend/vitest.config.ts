import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // 测试环境变量默认值(config.ts 在导入时校验,缺 DATABASE_URL 会抛错)
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/wallflow_test',
    },
  },
});
