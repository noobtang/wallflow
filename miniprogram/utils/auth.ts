import { ApiError, request } from './api';
import { AUTH_FALLBACK_ANON } from './config';
import { getToken, setToken } from './token';
import { generateUuid } from './uuid';

const DEVICE_KEY = 'wallflow_device_id';

let loginPromise: Promise<void> | null = null;

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

/**
 * 确保已登录(静默): 已有 token 直接返回;否则 wx.login → POST /auth/login。
 * - 并发调用共享同一个 promise(防重复登录)
 * - 降级: 后端未配置微信凭证(503)且 AUTH_FALLBACK_ANON 开启时,
 *   回退匿名设备身份(POST /auth/anon),保证 dev 环境可用
 */
export function ensureLogin(): Promise<void> {
  if (getToken()) return Promise.resolve();
  if (loginPromise) return loginPromise;
  loginPromise = doLogin().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

async function doLogin(): Promise<void> {
  try {
    const { code } = await wxLogin();
    const res = await request<{ token: string }>({
      path: '/auth/login',
      method: 'POST',
      data: { code },
      auth: false,
    });
    setToken(res.token);
  } catch (err) {
    if (
      AUTH_FALLBACK_ANON &&
      err instanceof ApiError &&
      (err.statusCode === 503 || err.statusCode === 400)
    ) {
      await loginAnon();
      return;
    }
    throw err;
  }
}

async function loginAnon(): Promise<void> {
  let deviceId = wx.getStorageSync(DEVICE_KEY) as string;
  if (!deviceId) {
    deviceId = generateUuid();
    wx.setStorageSync(DEVICE_KEY, deviceId);
  }
  const res = await request<{ token: string }>({
    path: '/auth/anon',
    method: 'POST',
    data: { device_id: deviceId },
    auth: false,
  });
  setToken(res.token);
}

function wxLogin(): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    wx.login({ success: resolve, fail: reject });
  });
}
