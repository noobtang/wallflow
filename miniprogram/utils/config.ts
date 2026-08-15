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

/**
 * 激励视频广告位 ID(流量主开通后填写,空 = 广告功能关闭,解锁直接免费)。
 * ⚠️ 个人主体无流量主资格,需个体户/企业主体 + 微信公众平台「流量主」开通后才能拿到。
 * 开通前留空: 保存流程走 MVP 全免费解锁(与后端 /unlock 一致),不影响功能。
 */
export const REWARDED_AD_UNIT_ID = '';

/** 激励视频广告是否启用(adUnitId 非空即启用) */
export const REWARDED_AD_ENABLED = REWARDED_AD_UNIT_ID.length > 0;

/**
 * 广告加载失败(fill rate 低)时的免费降级(2026-08-15,Outside Voice TODO:
 * 「高清下载与反付费墙定位的平衡策略」)。
 *
 * 策略: 广告失败(onError/show 失败)时,按每日限次(见下)直接免费解锁,
 * 避免填充率低时用户被「付费墙」卡死 — 与产品「免费开源壁纸」定位一致。
 * 次数在本地按自然日计数(轻量防滥用;服务端 /unlock 本就幂等全免费)。
 *
 * 关闭(false) = 严格付费墙: 广告失败不解锁,提示稍后重试。
 */
export const FREE_FALLBACK_ON_AD_ERROR = true;

/** 每日免费降级次数上限(自然日,本地计数) */
export const FREE_FALLBACK_DAILY_LIMIT = 3;

/** 免费降级计数本地存储 key */
export const FREE_FALLBACK_STORAGE_KEY = 'wallflow_free_fallback_count';
