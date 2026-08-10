export type SaveOutcome = 'success' | 'error' | 'denied';

export interface SaveDeps {
  getSetting(): Promise<{ authSetting: Record<string, boolean> }>;
  authorize(scope: string): Promise<void>;
  /** 下载图片,返回临时文件路径 */
  downloadFile(url: string): Promise<string>;
  saveImage(tempFilePath: string): Promise<void>;
}

const SCOPE = 'scope.writePhotosAlbum';

/**
 * 保存到相册流程(设计文档 §4.3 状态机):
 * - 已授权 → 直接下载+保存
 * - 未授权 → wx.authorize → 同意则保存;被拒返回 'denied'(由 UI 层弹「去设置」引导)
 * - 下载/保存异常 → 'error'(按钮恢复可重试)
 */
export async function saveWallpaper(deps: SaveDeps, imageUrl: string): Promise<SaveOutcome> {
  const setting = await deps.getSetting();
  if (setting.authSetting[SCOPE]) {
    return downloadAndSave(deps, imageUrl);
  }
  try {
    await deps.authorize(SCOPE);
  } catch {
    return 'denied';
  }
  return downloadAndSave(deps, imageUrl);
}

async function downloadAndSave(deps: SaveDeps, imageUrl: string): Promise<SaveOutcome> {
  try {
    const tempFilePath = await deps.downloadFile(imageUrl);
    await deps.saveImage(tempFilePath);
    return 'success';
  } catch {
    return 'error';
  }
}
