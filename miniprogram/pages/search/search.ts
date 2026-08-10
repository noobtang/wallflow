import { request } from '../../utils/api';
import { currentThemeClass, refreshThemeClass } from '../../utils/theme';
import { track } from '../../utils/track';
import { SEARCH_HISTORY_KEY, SEARCH_HISTORY_LIMIT } from '../../utils/config';
import type { FeedResponse, WallpaperItem } from '../../utils/types';

const PAGE_SIZE = 20;
const HOT_WORDS = ['风景', '星空', '极简', '动漫', '萌宠', '城市', '自然', '艺术'];
const DEBOUNCE_MS = 300;

Page({
  data: {
    themeClass: '',
    keyword: '',
    history: [] as string[],
    hotWords: HOT_WORDS,
    results: [] as WallpaperItem[],
    searched: false,
    empty: false,
    loading: false,
    error: false,
    finished: false,
    hasMore: true,
    cursor: null as string | null,
  },

  debounceTimer: null as ReturnType<typeof setTimeout> | null,

  onLoad() {
    this.setData({ themeClass: refreshThemeClass(), history: this.loadHistory() });
    track('search_exposed');
  },

  onShow() {
    this.setData({ themeClass: currentThemeClass() });
  },

  onUnload() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  },

  onInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const trimmed = keyword.trim();
    if (!trimmed) {
      this.setData({ searched: false, results: [], empty: false, error: false });
      return;
    }
    // 输入防抖 300ms(设计文档 §4.4)
    this.debounceTimer = setTimeout(() => {
      void this.doSearch(trimmed, false);
    }, DEBOUNCE_MS);
  },

  onConfirm() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    void this.doSearch(keyword, true);
  },

  onHotTap(e: WechatMiniprogram.TouchEvent) {
    const word = e.currentTarget.dataset.word as string;
    this.setData({ keyword: word });
    void this.doSearch(word, true);
  },

  onHistoryTap(e: WechatMiniprogram.TouchEvent) {
    const word = e.currentTarget.dataset.word as string;
    this.setData({ keyword: word });
    void this.doSearch(word, true);
  },

  clearHistory() {
    wx.removeStorageSync(SEARCH_HISTORY_KEY);
    this.setData({ history: [] });
  },

  loadHistory(): string[] {
    const v = wx.getStorageSync(SEARCH_HISTORY_KEY);
    return Array.isArray(v) ? (v as string[]).slice(0, SEARCH_HISTORY_LIMIT) : [];
  },

  saveHistory(keyword: string): void {
    const next = [keyword, ...this.loadHistory().filter((k) => k !== keyword)].slice(
      0,
      SEARCH_HISTORY_LIMIT,
    );
    wx.setStorageSync(SEARCH_HISTORY_KEY, next);
    this.setData({ history: next });
  },

  onCardTap(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    track('preview_click', { wallpaperId: e.detail.id });
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },

  onRetry() {
    const keyword = this.data.keyword.trim();
    if (keyword) void this.doSearch(keyword, false);
  },

  onClearKeyword() {
    this.setData({ keyword: '', searched: false, results: [], empty: false, error: false });
  },

  async doSearch(keyword: string, recordHistory: boolean): Promise<void> {
    track('search_click', { extra: { q: keyword } });
    if (recordHistory) this.saveHistory(keyword);
    this.setData({ searched: true, loading: true, error: false, empty: false, results: [], cursor: null, finished: false, hasMore: true });
    try {
      const res = await request<FeedResponse>({
        path: `/wallpapers/search?limit=${PAGE_SIZE}&q=${encodeURIComponent(keyword)}`,
      });
      this.setData({
        results: res.items,
        cursor: res.nextCursor,
        finished: !res.nextCursor,
        hasMore: !!res.nextCursor,
        empty: res.items.length === 0,
        loading: false,
      });
    } catch {
      this.setData({ error: true, loading: false });
    }
  },

  onReachBottom() {
    void this.loadNext();
  },

  async loadNext(): Promise<void> {
    const { loading, finished, hasMore, cursor, keyword, searched } = this.data;
    if (loading || finished || !hasMore || !cursor || !searched) return;
    if (!keyword.trim()) return;
    this.setData({ loading: true });
    try {
      const res = await request<FeedResponse>({
        path: `/wallpapers/search?limit=${PAGE_SIZE}&q=${encodeURIComponent(keyword)}&cursor=${encodeURIComponent(cursor)}`,
      });
      this.setData({
        results: this.data.results.concat(res.items),
        cursor: res.nextCursor,
        finished: !res.nextCursor,
        hasMore: !!res.nextCursor,
        loading: false,
      });
    } catch {
      this.setData({ loading: false });
    }
  },
});
