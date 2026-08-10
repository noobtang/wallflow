import { describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../utils/api';
import { mockRequestFailOnce, mockRequestOnce, mockWx } from './setup';

describe('api.ts 请求封装', () => {
  it('2xx → resolve data', async () => {
    mockRequestOnce(200, { items: [1, 2] });
    await expect(request<{ items: number[] }>({ path: '/wallpapers' })).resolves.toEqual({
      items: [1, 2],
    });
  });

  it('非 2xx → ApiError(透传后端 error.code / message)', async () => {
    mockRequestOnce(400, { error: { code: 'HTTP_400', message: '参数非法' } });
    const err = await request({ path: '/wallpapers', data: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.statusCode).toBe(400);
    expect(apiErr.code).toBe('HTTP_400');
    expect(apiErr.message).toBe('参数非法');
  });

  it('网络失败 → ApiError(NETWORK_ERROR)', async () => {
    mockRequestFailOnce('request:fail timeout');
    const err = await request({ path: '/wallpapers' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NETWORK_ERROR');
    expect((err as ApiError).statusCode).toBe(0);
  });

  it('auth 默认携带 Bearer token', async () => {
    mockWx.setStorageSync('wallflow_token', 'jwt-abc');
    let seenHeader: Record<string, string> = {};
    (mockWx.request as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (opts: { header?: Record<string, string>; success?: (res: unknown) => void }) => {
        seenHeader = opts.header ?? {};
        opts.success?.({ statusCode: 200, data: {}, header: {}, cookies: [] });
      },
    );
    await request({ path: '/favorites' });
    expect(seenHeader.authorization).toBe('Bearer jwt-abc');
  });

  it('auth:false 不携带 token(登录接口)', async () => {
    mockWx.setStorageSync('wallflow_token', 'jwt-abc');
    let seenHeader: Record<string, string> = {};
    (mockWx.request as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (opts: { header?: Record<string, string>; success?: (res: unknown) => void }) => {
        seenHeader = opts.header ?? {};
        opts.success?.({ statusCode: 200, data: {}, header: {}, cookies: [] });
      },
    );
    await request({ path: '/auth/login', method: 'POST', data: { code: 'x' }, auth: false });
    expect(seenHeader.authorization).toBeUndefined();
  });
});
