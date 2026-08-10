import { badgeClassFor } from '../../utils/badge';
import type { WallpaperItem } from '../../utils/types';

Component({
  properties: {
    item: { type: Object, value: {} as WallpaperItem },
  },
  data: {
    /** padding-bottom 百分比(按原图比例,封顶 180% 防超高卡片) */
    aspect: 100,
    badgeClass: 'badge--default',
    imgError: false,
  },
  observers: {
    'item': (item: unknown) => {
      // observers 内 this 类型推断受限,显式窄化(运行时 this 即组件实例)
      const self = this as unknown as { setData: (patch: Record<string, unknown>) => void };
      if (!item || typeof item !== 'object') return;
      const wallpaper = item as WallpaperItem;
      const w = Number(wallpaper.width) || 0;
      const h = Number(wallpaper.height) || 0;
      const aspect = w > 0 && h > 0 ? Math.min((h / w) * 100, 180) : 100;
      self.setData({ aspect, badgeClass: badgeClassFor(wallpaper.license), imgError: false });
    },
  },
  methods: {
    /** 当前 item(miniprogram-api-typings 对组件 data 类型推断有限,显式取用) */
    current(): WallpaperItem | null {
      return ((this.data as unknown as { item?: WallpaperItem }).item ?? null);
    },
    onTap() {
      const item = this.current();
      if (item) this.triggerEvent('tap', { id: item.id });
    },
    onLongPress() {
      const item = this.current();
      if (item) this.triggerEvent('longpress', { id: item.id });
    },
    onImgError() {
      this.setData({ imgError: true });
    },
    onImgRetry() {
      // 清错误标记让 image 重发请求(单图级重试,不整页刷新)
      this.setData({ imgError: false });
    },
  },
});
