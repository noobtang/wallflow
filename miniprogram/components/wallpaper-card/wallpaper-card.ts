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
    /** 长按标记: 抑制长按松手后跟随触发的 tap(微信中 longpress 与 tap 都会触发) */
    longPressed: false,
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
      // 长按松手后 tap 会跟随触发,此处抑制避免「弹窗+跳转」双动作
      if (this.data.longPressed) {
        this.setData({ longPressed: false });
        return;
      }
      const item = this.current();
      if (item) this.triggerEvent('tap', { id: item.id });
    },
    onLongPress() {
      const item = this.current();
      if (item) {
        this.setData({ longPressed: true });
        this.triggerEvent('longpress', { id: item.id });
      }
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
