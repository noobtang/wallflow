import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server';
import { OpsAlerter } from '../../src/ops/alerter';

/** 可编程 mock fetch: 记录调用,返回可控响应 */
function mockFetch() {
  const calls: Array<{ url: string; body: { msgtype: string; text: { content: string } } }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response('ok', { status: 200 });
  });
  return { calls, fn: fn as unknown as typeof fetch };
}

describe('OpsAlerter(#12 告警接入)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未配置 webhook → 全部 no-op(不发请求)', async () => {
    const { calls, fn } = mockFetch();
    const alerter = new OpsAlerter({ webhookUrl: '', fetchFn: fn });
    alerter.record(500, 'GET', '/wallpapers');
    alerter.record(502, 'POST', '/reports');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('4xx 不告警,5xx 触发;窗口内多条 5xx 合并为一条通知', async () => {
    const { calls, fn } = mockFetch();
    const alerter = new OpsAlerter({ webhookUrl: 'https://qyapi.weixin.qq.com/hook', fetchFn: fn });
    alerter.record(404, 'GET', '/wallpapers/999'); // 4xx → 忽略
    alerter.record(500, 'GET', '/wallpapers');
    alerter.record(503, 'GET', '/admin/health');
    alerter.record(500, 'GET', '/wallpapers'); // 同窗口内重复路径

    await vi.advanceTimersByTimeAsync(60_000); // 窗口结束 → 发送
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe('https://qyapi.weixin.qq.com/hook');
    expect(calls[0].body.msgtype).toBe('text');
    const content = calls[0].body.text.content;
    expect(content).toContain('5xx');
    expect(content).toContain('3 次'); // 4xx 不计入
    expect(content).toContain('GET /wallpapers');
    expect(content).toContain('GET /admin/health');
  });

  it('窗口结束后新的 5xx 再发新通知(跨窗口独立)', async () => {
    const { calls, fn } = mockFetch();
    const alerter = new OpsAlerter({ webhookUrl: 'https://hook.example', fetchFn: fn });

    alerter.record(500, 'GET', '/a');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].body.text.content).toContain('1 次');

    alerter.record(500, 'GET', '/b');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(calls[1].body.text.content).toContain('GET /b');
    expect(calls[1].body.text.content).toContain('1 次');
  });

  it('flushNow 立即发送待发批次(不等窗口);无待发返回 false', async () => {
    const { calls, fn } = mockFetch();
    const alerter = new OpsAlerter({ webhookUrl: 'https://hook.example', fetchFn: fn });

    expect(await alerter.flushNow()).toBe(false); // 无待发

    alerter.record(500, 'GET', '/x');
    expect(await alerter.flushNow()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].body.text.content).toContain('GET /x');
    expect(calls[0].body.text.content).toContain('1 次');

    expect(await alerter.flushNow()).toBe(false); // 已清空
  });

  it('webhook 发送失败不抛错(只记日志,不影响调用方)', async () => {
    const log = vi.fn();
    const failFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const alerter = new OpsAlerter({
      webhookUrl: 'https://hook.example',
      fetchFn: failFn as unknown as typeof fetch,
      log,
    });
    alerter.record(500, 'GET', '/y');
    await vi.advanceTimersByTimeAsync(60_000); // 不应 reject
    expect(failFn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('发送失败'), expect.any(Error));
  });

  it('dispose 清理待发批次与定时器(不再发送)', async () => {
    const { calls, fn } = mockFetch();
    const alerter = new OpsAlerter({ webhookUrl: 'https://hook.example', fetchFn: fn });
    alerter.record(500, 'GET', '/z');
    alerter.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fn).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('buildServer 集成: 5xx 响应触发告警,4xx 不触发', async () => {
    // 无 ADMIN_API_KEY → 管理操作 503,可稳定制造 5xx;再打一个 404 验证不误报
    const { calls, fn } = mockFetch();
    const app: FastifyInstance = await buildServer({
      wechat: null,
      jwtSecret: 'test',
      adminApiKey: '', // 未配置 → 管理路由 503
      opsAlerter: new OpsAlerter({ webhookUrl: 'https://hook.example', fetchFn: fn }),
    });
    try {
      await app.inject({ method: 'GET', url: '/admin/health' }); // 200(configured:false),不告警
      await app.inject({ method: 'GET', url: '/no-such-route' }); // 404,不告警
      await app.inject({ method: 'POST', url: '/admin/wallpapers/1/block' }); // 503 → 告警
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(calls[0].body.text.content).toContain('1 次');
      expect(calls[0].body.text.content).toContain('POST /admin/wallpapers/1/block');
    } finally {
      await app.close();
    }
  });

  it('样本路径去重且最多 5 条(风暴时通知体不膨胀)', async () => {
    const { calls, fn } = mockFetch();
    const alerter = new OpsAlerter({ webhookUrl: 'https://hook.example', fetchFn: fn });
    for (let i = 0; i < 10; i++) {
      alerter.record(500, 'GET', `/wallpapers/${i}`);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    const content = calls[0].body.text.content;
    expect(content).toContain('10 次');
    // 前 5 条样本(去重后 path 唯一)
    for (let i = 0; i < 5; i++) {
      expect(content).toContain(`GET /wallpapers/${i}`);
    }
    expect(content).not.toContain('GET /wallpapers/9');
  });
});
