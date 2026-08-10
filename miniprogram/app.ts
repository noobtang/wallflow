import { ensureLogin } from './utils/auth';
import { refreshThemeClass } from './utils/theme';

/**
 * 全局入口:
 * - 静默登录(设计文档: app 启动即登录,收藏/保存前已是登录态;失败不阻塞浏览)
 * - 主题初始化(默认跟随系统;手动偏好强制覆盖),写入 globalData.themeClass,
 *   各页面 onShow 读取并挂到根容器 class
 */
App({
  globalData: {
    themeClass: '',
  },
  onLaunch() {
    void ensureLogin().catch(() => {
      /* 登录失败静默,浏览可用 */
    });
    refreshThemeClass();
  },
} as unknown as WechatMiniprogram.App.Options<Record<string, unknown>>);
