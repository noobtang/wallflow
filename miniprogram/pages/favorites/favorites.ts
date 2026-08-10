import { request } from '../../utils/api';
import { ensureLogin } from '../../utils/auth';
import { currentThemeClass, getThemePref, refreshThemeClass, setThemePref, type ThemePref } from '../../utils/theme';
import { track } from '../../utils/track';
import type { FeedResponse, WallpaperItem } from '../../utils/types';

const PAGE_SIZE = 20;

Page({
  data: {
    themeClass: '',
    themePref: 'system' as ThemePref,
    left: [] as WallpaperItem[],
    right: [] as WallpaperItem[],
    cursor: null as string | null,
    loading: false,
    finished: false,
    hasMore: true,
    error: false,
    empty: false,
    skeleton: true,
  },

  onLoad() {
    this.setData({ themeClass: refreshThemeClass(), themePref: getThemePref() });
    void ensureLogin().catch(() => {
      /* 登录失败 → 收藏列表会走错误态 */
    });
    this.loadFirst();
  },

  onShow() {
    this.setData({ themeClass: currentThemeClass() });
    // 详情页可能取消了收藏: 已有数据时静默重载会折叠列表/丢滚动位置,且与 loadNext 竞态,
    // 故有数据时跳过(本地 removeFavorite 已即时移除,下拉刷新/重新进入兜底)
    if (this.data.left.length > 0 || this.data.right.length > 0) return;
    void this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    void this.loadNext();
  },

  // ---- 主题切换(设计文档 §6: 浅色/深色/跟随系统) ----
  onThemeTap() {
    wx.showActionSheet({
      itemList: ['跟随系统', '浅色模式', '深色模式'],
      success: (res) => {
        const prefs: ThemePref[] = ['system', 'light', 'dark'];
        const pref = prefs[res.tapIndex];
        setThemePref(pref);
        this.setData({ themePref: pref, themeClass: refreshThemeClass() });
      },
    });
  },

  // ---- 关于 ----
  onAboutTap() {
    wx.showModal({
      title: '关于 WallFlow',
      content:
        'WallFlow 是一款开源壁纸小程序。\n\n所有壁纸均来自开源社区,采用 CC0 / CC BY 等自由授权,可免费保存与商用(CC BY 需署名)。\n\n项目开源: github.com/noobtang/wallflow',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  // ---- 收藏夹 ----
  onCardTap(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    track('preview_click', { wallpaperId: e.detail.id });
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },

  /** 长按取消收藏(收藏夹可管理) */
  onCardLongPress(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const id = e.detail.id;
    wx.showModal({
      title: '取消收藏',
      content: '确定要把这张壁纸移出收藏夹吗?',
      success: (res) => {
        if (res.confirm) void this.removeFavorite(id);
      },
    });
  },

  async removeFavorite(id: number) {
    try {
      await request<{ favorited: boolean }>({ path: `/favorites/${id}`, method: 'DELETE' });
      // 本地移除,不整页重刷
      const left = this.data.left.filter((it) => it.id !== id);
      const right = this.data.right.filter((it) => it.id !== id);
      this.setData({ left, right, empty: left.length === 0 && right.length === 0 });
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } catch {
      wx.showToast({ title: '操作失败,请重试', icon: 'none' });
    }
  },

  onRetry() {
    void this.loadFirst();
  },

  async loadFirst(): Promise<void> {
    this.setData({
      loading: true,
      error: false,
      empty: false,
      skeleton: true,
      left: [],
      right: [],
      cursor: null,
      finished: false,
      hasMore: true,
    });
    try {
      const res = await request<FeedResponse>({ path: `/favorites?limit=${PAGE_SIZE}` });
      const cols = this.distribute(res.items);
      this.setData({
        left: cols.left,
        right: cols.right,
        cursor: res.nextCursor,
        finished: !res.nextCursor,
        hasMore: !!res.nextCursor,
        empty: res.items.length === 0,
        skeleton: false,
        loading: false,
      });
    } catch {
      this.setData({ error: true, skeleton: false, loading: false });
    }
  },

  async loadNext(): Promise<void> {
    const { loading, finished, hasMore, cursor, skeleton } = this.data;
    if (loading || finished || !hasMore || !cursor || skeleton) return;
    this.setData({ loading: true });
    try {
      const res = await request<FeedResponse>({
        path: `/favorites?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      });
      const cols = this.distribute(res.items);
      this.setData({
        left: this.data.left.concat(cols.left),
        right: this.data.right.concat(cols.right),
        cursor: res.nextCursor,
        finished: !res.nextCursor,
        hasMore: !!res.nextCursor,
        loading: false,
      });
    } catch {
      this.setData({ loading: false });
    }
  },

  distribute(items: WallpaperItem[]): { left: WallpaperItem[]; right: WallpaperItem[] } {
    const left: WallpaperItem[] = [];
    const right: WallpaperItem[] = [];
    let leftH = 0;
    let rightH = 0;
    for (const item of items) {
      const h = this.estimateHeight(item);
      if (leftH <= rightH) {
        left.push(item);
        leftH += h;
      } else {
        right.push(item);
        rightH += h;
      }
    }
    return { left, right };
  },

  estimateHeight(item: WallpaperItem): number {
    const w = Number(item.width) || 1;
    const h = Number(item.height) || w;
    return Math.min(h / w, 1.8);
  },
});
