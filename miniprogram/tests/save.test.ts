import { describe, expect, it, vi, type Mock } from 'vitest';
import { saveWallpaper, type SaveDeps } from '../utils/save';

const SCOPE = 'scope.writePhotosAlbum';

interface SaveMocks {
  getSetting: Mock;
  authorize: Mock;
  downloadFile: Mock;
  saveImage: Mock;
}

/** 构造可断言 mock 句柄 + SaveDeps(测试可覆盖单个 API) */
function makeDeps(overrides: Partial<SaveDeps> = {}): { deps: SaveDeps; fns: SaveMocks } {
  const fns: SaveMocks = {
    getSetting: vi.fn().mockResolvedValue({ authSetting: {} }),
    authorize: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue('/tmp/wallpaper.jpg'),
    saveImage: vi.fn().mockResolvedValue(undefined),
  };
  const deps: SaveDeps = {
    getSetting: overrides.getSetting ?? fns.getSetting,
    authorize: overrides.authorize ?? fns.authorize,
    downloadFile: overrides.downloadFile ?? fns.downloadFile,
    saveImage: overrides.saveImage ?? fns.saveImage,
  };
  return { deps, fns };
}

describe('保存流程状态机(设计文档 §4.3)', () => {
  it('已授权 → 直接下载 + 保存 → success(不再弹授权)', async () => {
    const { deps, fns } = makeDeps({
      getSetting: vi.fn().mockResolvedValue({ authSetting: { [SCOPE]: true } }),
    });
    const out = await saveWallpaper(deps, 'https://img.example.com/a.jpg');
    expect(out).toBe('success');
    expect(fns.authorize).not.toHaveBeenCalled();
    expect(fns.downloadFile).toHaveBeenCalledWith('https://img.example.com/a.jpg');
    expect(fns.saveImage).toHaveBeenCalledWith('/tmp/wallpaper.jpg');
  });

  it('未授权 → authorize 同意 → 下载保存 → success', async () => {
    const { deps, fns } = makeDeps();
    const out = await saveWallpaper(deps, 'u');
    expect(out).toBe('success');
    expect(fns.authorize).toHaveBeenCalledWith(SCOPE);
    expect(fns.downloadFile).toHaveBeenCalledTimes(1);
  });

  it('未授权 → authorize 被拒 → denied(不下载,UI 弹「去设置」引导)', async () => {
    const { deps, fns } = makeDeps({
      authorize: vi.fn().mockRejectedValue(new Error('auth deny')),
    });
    const out = await saveWallpaper(deps, 'u');
    expect(out).toBe('denied');
    expect(fns.downloadFile).not.toHaveBeenCalled();
    expect(fns.saveImage).not.toHaveBeenCalled();
  });

  it('下载失败 → error(按钮恢复可重试)', async () => {
    const { deps, fns } = makeDeps({
      getSetting: vi.fn().mockResolvedValue({ authSetting: { [SCOPE]: true } }),
      downloadFile: vi.fn().mockRejectedValue(new Error('network')),
    });
    expect(await saveWallpaper(deps, 'u')).toBe('error');
    expect(fns.saveImage).not.toHaveBeenCalled();
  });

  it('保存到相册失败 → error', async () => {
    const { deps } = makeDeps({
      getSetting: vi.fn().mockResolvedValue({ authSetting: { [SCOPE]: true } }),
      saveImage: vi.fn().mockRejectedValue(new Error('disk full')),
    });
    expect(await saveWallpaper(deps, 'u')).toBe('error');
  });
});
