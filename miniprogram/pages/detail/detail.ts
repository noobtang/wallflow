import { ApiError, request } from '../../utils/api';
import { ensureLogin } from '../../utils/auth';
import { badgeClassFor, licenseDescription } from '../../utils/badge';
import { saveWallpaper } from '../../utils/save';
import { currentThemeClass, refreshThemeClass } from '../../utils/theme';
import { track } from '../../utils/track';
import type { WallpaperItem } from '../../utils/types';

/** 详情 = 列表项 + 收藏态(与后端 WallpaperDetail 对齐) */
interface DetailData extends WallpaperItem {
  is_favorited: boolean;
}

interface SimilarResponse {
  items: WallpaperItem[];
}

const REPORT_REASONS = ['低俗色情', '侵权违规', '重复内容', '其他'];
const STACK_LIMIT = 8; // 相似推荐连续 push 时防止超过微信 10 层栈上限

Page({
  data: {
    themeClass: '',
    statusBarHeight: 20,
    id: 0,
    loading: true,
    error: false,
    notFound: false,
    imgError: false,
    detail: null as DetailData | null,
    similar: [] as WallpaperItem[],
    badgeClass: 'badge--default',
    saveState: 'idle' as 'idle' | 'saving' | 'success' | 'error',
    favorited: false,
    favoriting: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = Number(options.id);
    const sys = wx.getSystemInfoSync();
    this.setData({ id, statusBarHeight: sys.statusBarHeight ?? 20 });
    this.setData({ themeClass: refreshThemeClass() });
    this.load();
  },

  onShow() {
    this.setData({ themeClass: currentThemeClass() });
  },

  async load(): Promise<void> {
    this.setData({ loading: true, error: false, notFound: false });
    try {
      // 先静默登录,让详情接口返回真实 is_favorited
      await ensureLogin().catch(() => {});
      const [detail, similar] = await Promise.all([
        request<DetailData>({ path: `/wallpapers/${this.data.id}` }),
        request<SimilarResponse>({ path: `/wallpapers/${this.data.id}/similar?limit=8` }),
      ]);
      this.setData({
        detail,
        favorited: detail.is_favorited,
        similar: similar.items,
        badgeClass: badgeClassFor(detail.license),
        loading: false,
      });
      wx.setNavigationBarTitle({ title: detail.title || '壁纸详情' });
    } catch (err) {
      // 404 = 不存在;400 = id 非法(Number 解析 NaN 等情况),同样按「壁纸不存在」处理
      const notFound = err instanceof ApiError && (err.statusCode === 404 || err.statusCode === 400);
      this.setData({ loading: false, error: true, notFound });
    }
  },

  onRetry() {
    void this.load();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  // ---- 大图(设计决策: 小程序用 previewImage 全屏预览) ----
  onPreview() {
    const d = this.data.detail;
    if (!d) return;
    wx.previewImage({ urls: [d.fullUrl], current: d.fullUrl });
  },

  onImgError() {
    this.setData({ imgError: true });
  },

  onImgRetry() {
    this.setData({ imgError: false });
  },

  // ---- 保存(设计文档 §4.3 状态机) ----
  async onSave() {
    const detail = this.data.detail;
    if (!detail || this.data.saveState === 'saving') return;
    track('download_click', { wallpaperId: detail.id });
    this.setData({ saveState: 'saving' });
    const outcome = await saveWallpaper(
      {
        getSetting: () =>
          new Promise<{ authSetting: Record<string, boolean> }>((resolve, reject) => {
            wx.getSetting({
              success: (res) => resolve({ authSetting: res.authSetting as unknown as Record<string, boolean> }),
              fail: reject,
            });
          }),
        authorize: (scope) =>
          new Promise((resolve, reject) => {
            wx.authorize({ scope, success: () => resolve(), fail: reject });
          }),
        downloadFile: (url) =>
          new Promise<string>((resolve, reject) => {
            wx.downloadFile({
              url,
              success: (res) => {
                if (res.statusCode === 200) resolve(res.tempFilePath);
                else reject(new Error(`download ${res.statusCode}`));
              },
              fail: reject,
            });
          }),
        saveImage: (filePath) =>
          new Promise((resolve, reject) => {
            wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject });
          }),
      },
      detail.fullUrl,
    );

    if (outcome === 'success') {
      track('download_success', { wallpaperId: detail.id });
      this.setData({ saveState: 'success' });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
      setTimeout(() => this.setData({ saveState: 'idle' }), 2000);
    } else if (outcome === 'denied') {
      this.setData({ saveState: 'idle' });
      this.showPermissionGuide();
    } else {
      this.setData({ saveState: 'error' });
      wx.showToast({ title: '保存失败,请重试', icon: 'none' });
      setTimeout(() => this.setData({ saveState: 'idle' }), 2000);
    }
  },

  showPermissionGuide() {
    wx.showModal({
      title: '需要相册权限',
      content: '开启相册权限才能把壁纸保存到系统相册。',
      confirmText: '去设置',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) wx.openSetting({});
      },
    });
  },

  // ---- 收藏(即时反馈 + 埋点) ----
  async onToggleFavorite() {
    const detail = this.data.detail;
    if (!detail || this.data.favoriting) return;
    this.setData({ favoriting: true });
    try {
      await ensureLogin();
      if (!this.data.favorited) {
        await request<{ favorited: boolean }>({
          path: '/favorites',
          method: 'POST',
          data: { wallpaper_id: detail.id },
        });
        track('favorite_add', { wallpaperId: detail.id });
        this.setData({ favorited: true });
      } else {
        await request<{ favorited: boolean; removed: boolean }>({
          path: `/favorites/${detail.id}`,
          method: 'DELETE',
        });
        this.setData({ favorited: false });
      }
      wx.showToast({ title: this.data.favorited ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch {
      wx.showToast({ title: '操作失败,请重试', icon: 'none' });
    } finally {
      this.setData({ favoriting: false });
    }
  },

  // ---- 举报 ----
  onReport() {
    wx.showActionSheet({
      itemList: REPORT_REASONS,
      success: (res) => {
        void this.submitReport(REPORT_REASONS[res.tapIndex]);
      },
    });
  },

  async submitReport(reason: string) {
    try {
      await ensureLogin();
      await request({ path: '/reports', method: 'POST', data: { wallpaper_id: this.data.id, reason } });
      wx.showToast({ title: '已提交,感谢反馈', icon: 'none' });
    } catch {
      wx.showToast({ title: '提交失败,请重试', icon: 'none' });
    }
  },

  // ---- 更多 ----
  onMore() {
    wx.showActionSheet({
      itemList: ['设为壁纸引导', '复制原图链接', '举报'],
      success: (res) => {
        if (res.tapIndex === 0) this.showSetWallpaperGuide();
        else if (res.tapIndex === 1) this.copyOriginalLink();
        else if (res.tapIndex === 2) this.onReport();
      },
    });
  },

  showSetWallpaperGuide() {
    wx.showModal({
      title: '设为壁纸',
      content: '1. 点「保存壁纸」存入系统相册\n2. 打开「照片」App 选中图片\n3. 分享 → 用作壁纸',
      showCancel: false,
    });
  },

  copyOriginalLink() {
    const d = this.data.detail;
    if (!d) return;
    wx.setClipboardData({ data: d.fullUrl });
  },

  onLicenseTap() {
    const detail = this.data.detail;
    if (!detail) return;
    wx.showModal({
      title: `许可协议 · ${detail.license}`,
      content: licenseDescription(detail.license),
      showCancel: false,
      confirmText: '知道了',
    });
  },

  // ---- 相似推荐(页面栈防超限) ----
  onSimilarTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    track('preview_click', { wallpaperId: id });
    const url = `/pages/detail/detail?id=${id}`;
    if (getCurrentPages().length >= STACK_LIMIT) {
      wx.redirectTo({ url });
    } else {
      wx.navigateTo({ url });
    }
  },

  // ---- 分享(自定义封面 = 壁纸图) ----
  onShareAppMessage() {
    const d = this.data.detail;
    return {
      title: d ? `${d.title || 'WallFlow 开源壁纸'} · 免费开源壁纸` : 'WallFlow 开源壁纸',
      imageUrl: d ? d.thumbUrl : undefined,
      path: d ? `/pages/detail/detail?id=${d.id}` : '/pages/index/index',
    };
  },
});
