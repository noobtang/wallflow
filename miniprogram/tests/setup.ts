import { beforeEach, vi } from 'vitest';

/** 本地存储模拟 */
const storage = new Map<string, string>();

/** wx 全局 mock: 覆盖 utils 用到的 API,各测试用例按需 mockImplementation 配置行为 */
export const mockWx = {
  request: vi.fn(),
  login: vi.fn(),
  getStorageSync: vi.fn((key: string) => storage.get(key) ?? ''),
  setStorageSync: vi.fn((key: string, value: string) => {
    storage.set(key, String(value));
  }),
  removeStorageSync: vi.fn((key: string) => {
    storage.delete(key);
  }),
  getSetting: vi.fn(),
  authorize: vi.fn(),
  downloadFile: vi.fn(),
  saveImageToPhotosAlbum: vi.fn(),
  openSetting: vi.fn(),
  showToast: vi.fn(),
  showModal: vi.fn(),
  showActionSheet: vi.fn(),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  previewImage: vi.fn(),
  setClipboardData: vi.fn(),
  getSystemInfoSync: vi.fn(() => ({ statusBarHeight: 20, theme: 'light' })),
  getAppBaseInfo: vi.fn(() => ({ theme: 'light' })),
};

(globalThis as unknown as { wx: unknown }).wx = mockWx;

export function resetStorage(): void {
  storage.clear();
}

/** 配置下一次 wx.request 返回指定状态码 + data */
export function mockRequestOnce(statusCode: number, data: unknown): void {
  (mockWx.request as ReturnType<typeof vi.fn>).mockImplementationOnce(
    (opts: { success?: (res: unknown) => void; fail?: (err: unknown) => void }) => {
      opts.success?.({ statusCode, data, header: {}, cookies: [], errMsg: 'request:ok' });
    },
  );
}

/** 配置下一次 wx.request 网络失败 */
export function mockRequestFailOnce(errMsg = 'request:fail timeout'): void {
  (mockWx.request as ReturnType<typeof vi.fn>).mockImplementationOnce(
    (opts: { success?: (res: unknown) => void; fail?: (err: unknown) => void }) => {
      opts.fail?.({ errMsg, errno: 0 });
    },
  );
}

beforeEach(() => {
  resetStorage();
  // 清空行为与调用记录,恢复默认成功空响应
  for (const fn of Object.values(mockWx)) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mockWx.request.mockImplementation(
    (opts: { success?: (res: unknown) => void; fail?: (err: unknown) => void }) => {
      opts.success?.({ statusCode: 200, data: {}, header: {}, cookies: [], errMsg: 'request:ok' });
    },
  );
  mockWx.getSystemInfoSync.mockReturnValue({ statusBarHeight: 20, theme: 'light' });
  mockWx.getAppBaseInfo.mockReturnValue({ theme: 'light' });
});
