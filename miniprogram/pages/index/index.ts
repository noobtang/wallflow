import { request } from '../../utils/api';
import { ensureLogin } from '../../utils/auth';
import { currentThemeClass, refreshThemeClass } from '../../utils/theme';
import { track } from '../../utils/track';
import type { FeedResponse, WallpaperItem } from '../../utils/types';

const PAGE_SIZE = 20;

Page({
  data: {
    themeClass: '',
    featured: null as WallpaperItem | null,
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
    this.setData({ themeClass: refreshThemeClass() });
    void ensureLogin().catch(() => {
      /* 登录失败不阻塞浏览 */
    });
    this.loadFirst();
  },

  onShow() {
    this.setData({ themeClass: currentThemeClass() });
  },

  onPullDownRefresh() {
    this.loadFirst().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    void this.loadNext();
  },

  onSearchTap() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  onFeaturedTap() {
    if (this.data.featured) this.openDetail(this.data.featured.id);
  },

  onCardTap(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    this.openDetail(e.detail.id);
  },

  openDetail(id: number) {
    track('preview_click', { wallpaperId: id });
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
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
      const res = await request<FeedResponse>({ path: `/wallpapers?limit=${PAGE_SIZE}` });
      // 今日精选静态运营位: 优先「精选」分类,否则取最新一张兜底
      let featured = res.items[0] ?? null;
      try {
        const feat = await request<FeedResponse>({ path: `/wallpapers?category=${encodeURIComponent('精选')}&limit=1` });
        if (feat.items.length > 0) featured = feat.items[0];
      } catch {
        /* 兜底用首条 */
      }
      const cols = this.distribute(res.items);
      this.setData({
        featured,
        left: cols.left,
        right: cols.right,
        cursor: res.nextCursor,
        finished: !res.nextCursor,
        hasMore: !!res.nextCursor,
        empty: res.items.length === 0 && !featured,
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
        path: `/wallpapers?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
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

  /** 按原图比例(宽高比)把新页条目分配到较矮的一列,保持双列高度均衡 */
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
