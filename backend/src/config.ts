import 'dotenv/config';
import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-secret-change-me';

/**
 * 环境变量 schema(zod 校验)。
 * - 缺失 DATABASE_URL 等必填项 → 启动失败并报清晰错误(承重墙: 配置错误早暴露)
 * - 可选值(COS/微信等)默认空串,由后续任务(#4/#7/#8)接入时启用
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  WECHAT_APPID: z.string().default(''),
  WECHAT_SECRET: z.string().default(''),
  JWT_SECRET: z.string().default(DEV_JWT_SECRET),
  COS_SECRET_ID: z.string().default(''),
  COS_SECRET_KEY: z.string().default(''),
  COS_BUCKET: z.string().default(''),
  COS_REGION: z.string().default('ap-guangzhou'),
});

export type AppConfig = z.infer<typeof envSchema>;

/** 纯函数: 校验给定环境对象;失败抛出带全部问题的错误 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }

  // 生产环境禁止使用默认密钥(安全边界,防带着 dev 密钥上线)
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error(
      'Invalid environment configuration:\n  JWT_SECRET must be set in production (default dev secret is forbidden)',
    );
  }

  return parsed.data;
}

// 进程启动即校验一次;测试通过 vitest env 提供 DATABASE_URL
export const config: AppConfig = loadConfig();
