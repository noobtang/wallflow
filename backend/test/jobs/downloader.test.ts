import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DownloadError,
  RateLimitedDownloader,
  wikimediaFallbackUrl,
} from '../../src/jobs/downloader';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function listen(handler: Handler): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function baseUrl(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const JPEG = Buffer.from('fake-jpeg-bytes');

describe('RateLimitedDownloader', () => {
  let server: Server;
  const requestLog: Array<{ ts: number; path: string }> = [];
  let urls: Record<string, { status: number; ct?: string; body?: Buffer }> = {};

  beforeAll(async () => {
    server = await listen((req, res) => {
      const path = req.url ?? '/';
      requestLog.push({ ts: Date.now(), path });
      const cfg = urls[path];
      if (!cfg) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(cfg.status, { 'Content-Type': cfg.ct ?? 'image/jpeg' });
      res.end(cfg.body ?? JPEG);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requestLog.length = 0;
    urls = {};
  });

  it('200 image/jpeg → 返回 buffer 与 content-type', async () => {
    urls['/ok.jpg'] = { status: 200, ct: 'image/jpeg' };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0 });
    const { buffer, contentType, url } = await dl.download({ url: `${baseUrl(server)}/ok.jpg` });
    expect(buffer).toEqual(JPEG);
    expect(contentType).toBe('image/jpeg');
    expect(url).toContain('/ok.jpg');
  });

  it('429 + Retry-After → 退避重试后成功(尊重 Retry-After)', async () => {
    // 前 2 次 429(Retry-After: 1s),第 3 次 200
    const counts = new Map<string, number>();
    const retryServer = await listen((req, res) => {
      const path = req.url ?? '/';
      requestLog.push({ ts: Date.now(), path });
      const hit = (counts.get(path) ?? 0) + 1;
      counts.set(path, hit);
      if (hit <= 2) {
        res.writeHead(429, { 'Retry-After': '1' });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(JPEG);
      }
    });

    const dl = new RateLimitedDownloader({ minIntervalMs: 0, retryBaseMs: 10, maxRetries: 5 });
    const result = await dl.download({ url: `${baseUrl(retryServer)}/retry.jpg` });
    expect(result.buffer).toEqual(JPEG);
    expect(requestLog.filter((r) => r.path === '/retry.jpg')).toHaveLength(3);
    await new Promise<void>((resolve) => retryServer.close(() => resolve()));
  });

  it('持续 429 → maxRetries 次后抛 DownloadError(http)', async () => {
    urls['/always429.jpg'] = { status: 429 };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0, retryBaseMs: 10, maxRetries: 2 });
    await expect(dl.download({ url: `${baseUrl(server)}/always429.jpg` })).rejects.toMatchObject({
      name: 'DownloadError',
      opts: { code: 'http', status: 429 },
    });
    expect(requestLog.filter((r) => r.path === '/always429.jpg')).toHaveLength(3); // 1 次 + 2 次重试
  });

  it('4xx(404)→ 立即失败,不重试', async () => {
    urls['/missing.jpg'] = { status: 404 };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0, maxRetries: 5 });
    await expect(dl.download({ url: `${baseUrl(server)}/missing.jpg` })).rejects.toMatchObject({
      opts: { code: 'http', status: 404 },
    });
    expect(requestLog.filter((r) => r.path === '/missing.jpg')).toHaveLength(1);
  });

  it('非图片 content-type → DownloadError(content-type),不重试', async () => {
    urls['/page.html'] = { status: 200, ct: 'text/html' };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0, maxRetries: 3 });
    await expect(dl.download({ url: `${baseUrl(server)}/page.html` })).rejects.toMatchObject({
      opts: { code: 'content-type' },
    });
    expect(requestLog.filter((r) => r.path === '/page.html')).toHaveLength(1);
  });

  it('image/svg+xml → 拒绝(白名单不含 svg,防内嵌脚本)', async () => {
    urls['/evil.svg'] = { status: 200, ct: 'image/svg+xml' };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0 });
    await expect(dl.download({ url: `${baseUrl(server)}/evil.svg` })).rejects.toMatchObject({
      opts: { code: 'content-type' },
    });
  });

  it('超过大小上限 → DownloadError(size)', async () => {
    urls['/big.jpg'] = { status: 200, ct: 'image/jpeg', body: Buffer.alloc(500) };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0, maxBytes: 100 });
    await expect(dl.download({ url: `${baseUrl(server)}/big.jpg` })).rejects.toMatchObject({
      opts: { code: 'size' },
    });
  });

  it('minIntervalMs 限速: 相邻请求开始间隔 ≥ 配置值', async () => {
    urls['/a.jpg'] = { status: 200 };
    urls['/b.jpg'] = { status: 200 };
    const dl = new RateLimitedDownloader({ minIntervalMs: 80 });
    const t0 = Date.now();
    await dl.download({ url: `${baseUrl(server)}/a.jpg` });
    await dl.download({ url: `${baseUrl(server)}/b.jpg` });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(70); // 留余量,避免计时抖动
  });

  it('主 URL 可重试错误(5xx)耗尽 → 降级 fallbackUrl 成功', async () => {
    urls['/primary.jpg'] = { status: 503 };
    urls['/fallback.jpg'] = { status: 200, ct: 'image/jpeg' };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0, retryBaseMs: 10, maxRetries: 1 });
    const { url } = await dl.download({
      url: `${baseUrl(server)}/primary.jpg`,
      fallbackUrl: `${baseUrl(server)}/fallback.jpg`,
    });
    expect(url).toContain('/fallback.jpg');
  });

  it('主 URL 确定性错误(404)→ 不尝试 fallback,直接失败', async () => {
    urls['/missing.jpg'] = { status: 404 };
    urls['/fallback.jpg'] = { status: 200, ct: 'image/jpeg' };
    const dl = new RateLimitedDownloader({ minIntervalMs: 0 });
    await expect(
      dl.download({
        url: `${baseUrl(server)}/missing.jpg`,
        fallbackUrl: `${baseUrl(server)}/fallback.jpg`,
      }),
    ).rejects.toMatchObject({ opts: { code: 'http', status: 404 } });
    expect(requestLog.filter((r) => r.path === '/missing.jpg')).toHaveLength(1);
    expect(requestLog.filter((r) => r.path === '/fallback.jpg')).toHaveLength(0);
  });

  it('wikimediaFallbackUrl: 仅 upload.wikimedia.org 生成降级地址', () => {
    expect(wikimediaFallbackUrl('https://upload.wikimedia.org/wikipedia/commons/a/a2/Milky_way1.jpg')).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Milky_way1.jpg?width=4096',
    );
    expect(
      wikimediaFallbackUrl('https://upload.wikimedia.org/wikipedia/commons/2/2f/My%20Space.jpg'),
    ).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/My%20Space.jpg?width=4096');
    expect(wikimediaFallbackUrl('https://example.com/a.jpg')).toBeUndefined();
    expect(wikimediaFallbackUrl('not a url')).toBeUndefined();
  });
});

describe('DownloadError', () => {
  it('可携带 code/status/url 元数据', () => {
    const e = new DownloadError('boom', { code: 'http', status: 429, url: 'https://x' });
    expect(e.name).toBe('DownloadError');
    expect(e.opts.code).toBe('http');
    expect(e.opts.status).toBe(429);
  });
});
