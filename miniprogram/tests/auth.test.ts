import { describe, expect, it, vi } from 'vitest';
import { ensureLogin, isLoggedIn } from '../utils/auth';
import { mockRequestFailOnce, mockRequestOnce, mockWx } from './setup';

function mockLoginSuccess(code: string): void {
  (mockWx.login as ReturnType<typeof vi.fn>).mockImplementation(
    (opts: { success?: (res: { code: string }) => void }) => {
      opts.success?.({ code });
    },
  );
}

describe('auth.ts 静默登录', () => {
  it('已有 token 直接返回,不重复登录', async () => {
    mockWx.setStorageSync('wallflow_token', 'existing-token');
    expect(isLoggedIn()).toBe(true);
    await ensureLogin();
    expect(mockWx.login).not.toHaveBeenCalled();
    expect(mockWx.request).not.toHaveBeenCalled();
  });

  it('wx.login → POST /auth/login → 持久化 token', async () => {
    mockLoginSuccess('code-001');
    mockRequestOnce(200, { token: 'jwt-login' });
    await ensureLogin();
    expect(mockWx.login).toHaveBeenCalledTimes(1);
    expect(mockWx.getStorageSync('wallflow_token')).toBe('jwt-login');
  });

  it('后端 503(微信凭证未配置)→ 降级匿名 /auth/anon + 持久化 device_id', async () => {
    mockLoginSuccess('code-001');
    mockRequestOnce(503, { error: { code: 'HTTP_503', message: '微信凭证未配置' } });
    mockRequestOnce(200, { token: 'jwt-anon' });
    await ensureLogin();
    const deviceId = mockWx.getStorageSync('wallflow_device_id') as string;
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockWx.getStorageSync('wallflow_token')).toBe('jwt-anon');
  });

  it('降级也失败 → 抛错且无 token(不误存)', async () => {
    mockLoginSuccess('code-001');
    mockRequestOnce(503, { error: {} });
    mockRequestFailOnce();
    await expect(ensureLogin()).rejects.toBeInstanceOf(Error);
    expect(mockWx.getStorageSync('wallflow_token')).toBe('');
  });

  it('并发调用只触发一次登录(共享 promise)', async () => {
    mockLoginSuccess('code-001');
    mockRequestOnce(200, { token: 'jwt-concurrent' });
    await Promise.all([ensureLogin(), ensureLogin(), ensureLogin()]);
    expect(mockWx.login).toHaveBeenCalledTimes(1);
    expect(mockWx.request).toHaveBeenCalledTimes(1);
    expect(mockWx.getStorageSync('wallflow_token')).toBe('jwt-concurrent');
  });
});
