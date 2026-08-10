const TOKEN_KEY = 'wallflow_token';

export function getToken(): string | null {
  const v = wx.getStorageSync(TOKEN_KEY);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function setToken(token: string): void {
  wx.setStorageSync(TOKEN_KEY, token);
}

export function clearToken(): void {
  wx.removeStorageSync(TOKEN_KEY);
}
