import { request } from '../../utils/api';
import { currentThemeClass, refreshThemeClass } from '../../utils/theme';
import { track } from '../../utils/track';
import type { CategoriesResponse, FeedResponse, WallpaperItem } from '../../utils/types';

const PAGE_SIZE = 20;

interface Chip {
  name: string;
  count: number | null;
}

Page({
  data: {
    themeClass: '',
    chips: [{ name: '全部', count: null }] as Chip[],
    active: '全部',
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
    void this.loadChips();
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

  async loadChips(): Promise<void> {
    try {
      const res = await request<CategoriesResponse>({ path: '/categories' });
      const chips: Chip[] = [
        { name: '全部', count: null },
        ...res.items.map((c) => ({ name: c.name, count: c.count })),
      ];
      this.setData({ chips });
    } catch {
      /* 词表兜底: 保留「全部」,分类加载失败不阻塞浏览 */
    }
  },

  onChipTap(e: WechatMiniprogram.TouchEvent) {
    const name = e.currentTarget.dataset.name as string;
    if (!name || name === this.data.active) return;
    track('search_click', { extra: { category: name } });
    this.setData({ active: name });
    this.loadFirst();
  },

  onSeeAll() {
    this.setData({ active: '全部' });
    this.loadFirst();
  },

  onCardTap(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    track('preview_click', { wallpaperId: e.detail.id });
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },

  onRetry() {
    void this.loadFirst();
  },

  feedPath(cursor: string | null): string {
    const params: string[] = [`limit=${PAGE_SIZE}`];
    if (this.data.active !== '全部') {
      params.push(`category=${encodeURIComponent(this.data.active)}`);
    }
    if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
    return `/wallpapers?${params.join('&')}`;
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
      const res = await request<FeedResponse>({ path: this.feedPath(null) });
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
      const res = await request<FeedResponse>({ path: this.feedPath(cursor) });
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
