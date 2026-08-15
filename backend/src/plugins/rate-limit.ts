import type { FastifyInstance } from 'fastify';

/**
 * 公开写接口限流(2026-08-15 E 运维小项): 零依赖内存滑动窗口,按来源 IP 计数。
 * - 保护 POST /events(可被脚本刷)、/reports、/favorites、/unlock 与登录接口
 * - /admin/* 不限(管理面有 X-Admin-Key 鉴权,运维调用不应被卡)
 * - IP 取 X-Forwarded-For 首段(生产在 nginx 后,request.ip 恒为反代 IP;nginx 已透传 XFF),
 *   无 XFF 时回退 request.ip
 * - 单进程内存态,MVP 单实例够用;多副本需换共享存储(redis 等),见 TODOS 备注
 * - 超限 → 429 { error: { code: 'RATE_LIMITED', message } },带 Retry-After
 */
export interface RateLimitOptions {
  /** 滑动窗口长度(ms) */
  windowMs: number;
  /** 窗口内最大请求数 */
  max: number;
}

/** 每 IP 的请求时间戳队列;过期条目惰性清理 + 全局定期清理防无限增长 */
const buckets = new Map<string, number[]>();
let lastSweep = 0;

export function registerRateLimit(app: FastifyInstance, opts: RateLimitOptions): void {
  const { windowMs, max } = opts;

  app.addHook('onRequest', async (request, reply) => {
    // 只限写方法(公开写接口);管理面不限
    if (request.method !== 'POST' && request.method !== 'DELETE') return;
    if (request.url.startsWith('/admin/')) return;

    const ip = (typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for'].split(',')[0].trim()
      : request.ip) || 'unknown';

    // 全局定期清理(每 10 个窗口清一次过期桶,防长期运行内存膨胀)
    const now = Date.now();
    if (now - lastSweep > windowMs * 10) {
      lastSweep = now;
      for (const [k, arr] of buckets) {
        if (arr.length === 0 || now - arr[arr.length - 1] > windowMs) buckets.delete(k);
      }
    }

    const arr = (buckets.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
      reply.header('Retry-After', String(Math.max(1, retryAfter)));
      return reply
        .code(429)
        .send({ error: { code: 'RATE_LIMITED', message: '请求过于频繁,请稍后再试' } });
    }
    arr.push(now);
    buckets.set(ip, arr);
  });
}
