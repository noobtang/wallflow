import type { AppConfig } from '../config';

/**
 * 运维告警(#12 告警接入): 5xx 响应 → 通用 webhook 通知(企业微信/钉钉群机器人等)。
 *
 * 设计:
 * - 零依赖: 用 Node ≥20 内置 fetch 发 POST,不引第三方通知 SDK
 * - 防抖聚合: 同一时间窗(minIntervalMs)内的多条 5xx 合并为一条通知,
 *   首条到达后延迟一个窗口发送 → 每窗口至多一条,风暴时不会刷屏
 * - 容错: 通知失败只记日志,绝不抛错影响业务请求
 * - 禁用: webhookUrl 为空 → 全链路 no-op(未配置不产生任何副作用)
 *
 * 通知格式: { msgtype: "text", text: { content } }(企业微信/钉钉群机器人通用;
 * 其他平台如 Slack 可自行在 webhook 前挂一层适配,或改 OPS_ALERT_PAYLOAD 扩展)。
 */

export interface OpsAlerterOptions {
  /** 群机器人 webhook URL;空串 → 禁用 */
  webhookUrl: string;
  /** 告警窗口(ms): 窗口内多条 5xx 合并;默认 60s */
  minIntervalMs?: number;
  /** 测试注入: 默认 global fetch */
  fetchFn?: typeof fetch;
  /** 测试/静默注入: 默认 console.warn */
  log?: (message: string, error?: unknown) => void;
}

/** 从 AppConfig 构造(环境变量): OPS_ALERT_WEBHOOK_URL / OPS_ALERT_MIN_INTERVAL_SECONDS */
export function createOpsAlerter(config: AppConfig): OpsAlerter {
  return new OpsAlerter({
    webhookUrl: config.OPS_ALERT_WEBHOOK_URL,
    minIntervalMs: config.OPS_ALERT_MIN_INTERVAL_SECONDS * 1000,
  });
}

interface PendingBatch {
  firstAt: number;
  count: number;
  paths: string[]; // 去重的 "METHOD /path" 样本(最多保留 5 条)
}

export class OpsAlerter {
  private readonly webhookUrl: string;
  private readonly minIntervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string, error?: unknown) => void;
  private pending: PendingBatch | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: OpsAlerterOptions) {
    this.webhookUrl = options.webhookUrl;
    this.minIntervalMs = options.minIntervalMs ?? 60_000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.log = options.log ?? ((msg, err) => console.warn(`[ops-alert] ${msg}`, err ?? ''));
  }

  /**
   * Fastify onResponse 钩子调用: statusCode >= 500 → 记录并(节流)发送。
   * 仅做聚合与调度,发送是异步的,不会阻塞请求返回。
   */
  record(statusCode: number, method: string, url: string): void {
    if (!this.webhookUrl) return;
    if (statusCode < 500) return; // 只告警 5xx(调用方钩子已过滤,这里双保险)
    const now = Date.now();
    if (!this.pending) {
      this.pending = { firstAt: now, count: 0, paths: [] };
    }
    this.pending.count += 1;
    const path = `${method} ${url}`;
    if (!this.pending.paths.includes(path)) {
      this.pending.paths.push(path);
      if (this.pending.paths.length > 5) this.pending.paths.pop(); // 只带前 5 条样本
    }
    if (!this.timer) {
      // 首条到达后延迟一个窗口再发 → 窗口内后续 5xx 都并入同一条
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flushPending();
      }, this.minIntervalMs);
      // 定时器不阻止进程退出(告警丢了可接受,业务请求优先)
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
    void statusCode; // 状态码已体现在聚合计数里,不单独透传
  }

  /** 立即发送待发批次(测试/进程关停时调用);无待发或禁用 → false */
  async flushNow(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return false;
    const batch = this.pending;
    this.pending = null;
    await this.send(batch);
    return true;
  }

  /** 清理定时器(进程关停;避免悬挂) */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  private async flushPending(): Promise<void> {
    if (!this.pending) return;
    const batch = this.pending;
    this.pending = null;
    await this.send(batch);
  }

  private async send(batch: PendingBatch): Promise<void> {
    if (!this.webhookUrl) return;
    const content = [
      '⚠️ WallFlow 5xx 告警',
      `时间: ${new Date(batch.firstAt).toISOString()}`,
      `次数: ${batch.count} 次`,
      ...batch.paths.map((p) => `路径: ${p}`),
    ].join('\n');
    try {
      const res = await this.fetchFn(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } }),
        signal: AbortSignal.timeout(5_000), // 通知超时兜底,不悬挂
      });
      if (!res.ok) {
        this.log(`webhook 返回 ${res.status}`, await res.text().catch(() => ''));
      }
    } catch (err) {
      this.log('发送失败', err);
    }
  }
}
