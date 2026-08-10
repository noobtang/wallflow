import { setTimeout as sleep } from 'node:timers/promises';

/**
 * 限速下载器(#4)。约束来自 data/README.md 实测(2026-08-10):
 *   - upload.wikimedia.org 原图直链高频下载会被 429 限流(数据中心/共享 IP 尤其明显)
 *   - 缩略图通道 Special:FilePath?width=N 稳定 200,是官方建议的下载方式
 * 因此: 全局串行 + 相邻请求最小间隔(限速) + 429/5xx 指数退避重试 +
 * 原图重试耗尽后降级到 fallbackUrl(如 Wikimedia 缩略图通道),不因限流丢条目。
 */

export interface DownloadResult {
  buffer: Buffer;
  contentType: string;
  /** 实际成功响应的 URL(主地址或降级地址) */
  url: string;
}

export interface DownloadTarget {
  url: string;
  /** 主 URL 重试耗尽(429/5xx/网络错误)后的降级地址 */
  fallbackUrl?: string;
}

export interface DownloaderOptions {
  /** 请求 UA(上游对 UA 敏感,务必携带) */
  userAgent?: string;
  /** 单对象大小上限(防异常大文件),默认 30MB */
  maxBytes?: number;
  /** 429/5xx/网络错误重试次数,默认 5 */
  maxRetries?: number;
  /** 指数退避基数,默认 2000ms */
  retryBaseMs?: number;
  /** 相邻请求最小间隔(全局限速),默认 1500ms */
  minIntervalMs?: number;
  /** 单请求超时,默认 30s */
  timeoutMs?: number;
  /** 图片内容类型白名单(默认 jpeg/png/webp;不放行 svg 等可内嵌脚本的格式) */
  acceptContentTypes?: string[];
}

export type DownloadErrorCode = 'http' | 'size' | 'content-type' | 'network';

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly opts: { code: DownloadErrorCode; status?: number; url?: string } = {
      code: 'network',
    },
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

const DEFAULT_UA = 'wallflow-import/0.1 (curated manifest importer; github.com/noobtang/wallflow)';

const DEFAULT_ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export class RateLimitedDownloader {
  private lastRequestAt = 0;

  constructor(private readonly options: DownloaderOptions = {}) {}

  /**
   * 串行下载: 主 URL 重试耗尽 → 尝试 fallbackUrl(不同通道,更可能成功)。
   * 仅当主地址因可重试错误(429/5xx/网络)失败时才降级;404/内容类型/大小等
   * 确定性错误不再浪费一次 fallback 请求(两个通道通常同源,结果相同)。
   */
  async download(target: DownloadTarget): Promise<DownloadResult> {
    const attempts = target.fallbackUrl ? [target.url, target.fallbackUrl] : [target.url];
    let lastErr: unknown;
    for (const url of attempts) {
      try {
        return await this.fetchWithRetry(url);
      } catch (err) {
        lastErr = err;
        if (attempts.length > 1 && !this.isFallbackEligible(err)) break;
      }
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new DownloadError('下载失败: 未知错误', { code: 'network', url: target.url });
  }

  private isFallbackEligible(err: unknown): boolean {
    if (!(err instanceof DownloadError)) return true;
    if (err.opts.code === 'network') return true;
    if (err.opts.code === 'http') {
      const status = err.opts.status ?? 0;
      return status === 429 || status >= 500;
    }
    return false; // content-type / size: 确定性错误
  }

  private async fetchWithRetry(url: string): Promise<DownloadResult> {
    const {
      maxRetries = 5,
      retryBaseMs = 2000,
      timeoutMs = 30_000,
      maxBytes = 30 * 1024 * 1024,
      userAgent = DEFAULT_UA,
    } = this.options;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.throttle();

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': userAgent },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // 网络层错误(超时/连接失败)可重试
        lastErr = new DownloadError(`请求失败: ${(err as Error).message}`, {
          code: 'network',
          url,
        });
        await sleep(retryBaseMs * 2 ** attempt);
        continue;
      }

      if (res.ok) {
        const contentType = this.checkContentType(res);
        const buffer = await this.readBody(res, maxBytes);
        return { buffer, contentType, url };
      }

      if (res.status === 429 || res.status >= 500) {
        // 限流/服务端错误: 尊重 Retry-After,否则指数退避
        const retryAfterMs = this.parseRetryAfter(res.headers.get('retry-after'));
        const delay = Math.max(retryAfterMs, retryBaseMs * 2 ** attempt);
        lastErr = new DownloadError(`HTTP ${res.status}(重试 ${attempt + 1}/${maxRetries})`, {
          code: 'http',
          status: res.status,
          url,
        });
        await sleep(delay);
        continue;
      }

      // 其余 4xx: 确定性错误,不重试
      throw new DownloadError(`HTTP ${res.status}`, { code: 'http', status: res.status, url });
    }
    throw lastErr instanceof Error ? lastErr : new DownloadError('下载失败', { code: 'http', url });
  }

  /** 全局限速: 相邻请求开始时刻至少间隔 minIntervalMs */
  private async throttle(): Promise<void> {
    const { minIntervalMs = 1500 } = this.options;
    if (minIntervalMs <= 0) return;
    const wait = this.lastRequestAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private checkContentType(res: Response): string {
    const raw = res.headers.get('content-type') ?? '';
    const ct = raw.split(';')[0].trim().toLowerCase();
    const accepted = this.options.acceptContentTypes ?? DEFAULT_ACCEPTED;
    if (!accepted.includes(ct)) {
      // 显式白名单: 不放行 svg/其他非位图格式(避免内嵌脚本 + sharp 行为不确定)
      throw new DownloadError(`非白名单图片类型: ${ct || '(空)'}`, { code: 'content-type' });
    }
    return ct;
  }

  private async readBody(res: Response, maxBytes: number): Promise<Buffer> {
    if (!res.body) throw new DownloadError('响应无 body', { code: 'network' });
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DownloadError(`响应超过大小上限(${maxBytes} bytes)`, { code: 'size' });
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  /** Retry-After 支持秒数与 HTTP-date 两种格式 */
  private parseRetryAfter(value: string | null): number {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    return 0;
  }
}

/**
 * Wikimedia 原图 429 限流时的降级地址(data/README 实测结论):
 *   https://upload.wikimedia.org/.../<File>.jpg
 *   → https://commons.wikimedia.org/wiki/Special:FilePath/<File>?width=4096
 * 非 upload.wikimedia.org 的 URL 返回 undefined(不降级)。
 */
export function wikimediaFallbackUrl(imageUrl: string): string | undefined {
  try {
    const u = new URL(imageUrl);
    if (u.hostname !== 'upload.wikimedia.org') return undefined;
    const filename = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    if (!filename) return undefined;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=4096`;
  } catch {
    return undefined;
  }
}
