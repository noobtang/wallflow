export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'wallflow_theme';

/** 读取手动主题偏好(默认跟随系统) */
export function getThemePref(): ThemePref {
  const v = wx.getStorageSync(THEME_KEY) as ThemePref | '';
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function setThemePref(pref: ThemePref): void {
  wx.setStorageSync(THEME_KEY, pref);
}

/** 当前系统主题(基础库 ≥2.20.1 用 getAppBaseInfo,兜底 getSystemInfoSync) */
export function systemTheme(): 'light' | 'dark' {
  try {
    const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    return (base as { theme?: 'light' | 'dark' }).theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** 根容器主题 class: '' 表示完全跟随系统(theme.json 处理);手动偏好时强制覆盖 */
export function computeThemeClass(pref: ThemePref, sys: 'light' | 'dark'): string {
  if (pref === 'dark') return 'theme--dark';
  if (pref === 'light') return 'theme--light';
  return sys === 'dark' ? 'theme--dark' : 'theme--light';
}

/** 页面 onShow 时刷新根容器 class(跟随 app.globalData.themeClass) */
export function currentThemeClass(): string {
  const app = getApp() as unknown as { globalData?: { themeClass?: string } };
  return app?.globalData?.themeClass ?? '';
}

export function refreshThemeClass(): string {
  const cls = computeThemeClass(getThemePref(), systemTheme());
  const app = getApp() as unknown as { globalData?: { themeClass?: string } };
  if (app?.globalData) app.globalData.themeClass = cls;
  return cls;
}
