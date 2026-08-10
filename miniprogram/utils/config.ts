/**
 * 全局配置。
 * 生产: 改 BASE_URL 为已备案 HTTPS 域名,并同步到微信公众平台
 * 「开发管理 → 服务器域名」的 request/downloadFile 白名单(#11 部署清单)。
 * 开发工具调试: 详情 → 本地设置 → 勾选「不校验合法域名」。
 */
export const BASE_URL = 'http://127.0.0.1:3000';

/**
 * 后端未配置微信凭证(/auth/login 返回 503)时,降级匿名设备身份(/auth/anon),
 * 保证 dev / 未配置凭证环境可用。生产上线前应置 false(微信登录为主)。
 */
export const AUTH_FALLBACK_ANON = true;

/** 请求超时(ms) */
export const REQUEST_TIMEOUT = 10000;

/** 搜索历史本地缓存 key */
export const SEARCH_HISTORY_KEY = 'wallflow_search_history';

/** 搜索历史条数上限 */
export const SEARCH_HISTORY_LIMIT = 10;
