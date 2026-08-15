import {
  FREE_FALLBACK_DAILY_LIMIT,
  FREE_FALLBACK_ON_AD_ERROR,
  FREE_FALLBACK_STORAGE_KEY,
  REWARDED_AD_ENABLED,
  REWARDED_AD_UNIT_ID,
} from './config';

export type AdWatchResult = 'completed' | 'canceled' | 'error' | 'degraded';

/** 本地存储依赖(测试注入;默认走 wx storage) */
export interface StorageLike {
  get<T>(key: string): T | '';
  set(key: string, value: unknown): void;
}

/**
 * 激励视频广告封装(流量主开通后接入,二期)。
 *
 * 微信小程序激励视频流程:
 *   1. wx.createRewardedVideoAd({ adUnitId }) 创建实例(需在页面生命周期内)
 *   2. 播放前 load()(预加载,onLoad 后调用;失败可重试)
 *   3. show() → 用户看完(触发 onClose,res.isEnded === true)或中途关闭(isEnded === false)
 *   4. 客户端验证 isEnded 后才算看完 —— 服务端 /unlock 由「看完」后的业务调用触发,
 *      不信任客户端自行上报(服务端回调验证二期与广告平台对接时补充)
 *
 * 设计: 未配置 adUnitId → watchAd 直接 resolve 'completed'(MVP 全免费解锁,无缝降级)。
 * 测试通过注入 createRewardedVideoAd 工厂隔离 wx API。
 */
export interface RewardedVideoAdLike {
  load(): Promise<void>;
  show(): Promise<void>;
  onClose(cb: (res: { isEnded: boolean }) => void): void;
  onError(cb: (err: unknown) => void): void;
  offClose?(cb?: (res: { isEnded: boolean }) => void): void;
  offError?(cb?: (err: unknown) => void): void;
}

export interface AdDeps {
  /** 测试注入: 默认取 config.REWARDED_AD_ENABLED */
  enabled?: boolean;
  createRewardedVideoAd?: (options: { adUnitId: string }) => RewardedVideoAdLike;
  /** 测试注入: 默认取 config.FREE_FALLBACK_ON_AD_ERROR */
  freeFallback?: boolean;
  /** 测试注入: 默认走 wx.getStorageSync / wx.setStorageSync */
  storage?: StorageLike;
}

/**
 * 播放激励视频并返回结果。
 * - completed: 用户完整看完(isEnded=true)→ 调用方再调 /unlock + 保存
 * - canceled:  中途关闭 → 不解锁
 * - error:     广告加载/播放失败 → 不解锁
 * - degraded:  广告失败但命中「每日限次免费降级」→ 调用方可视为看完并提示用户
 */
export function watchRewardedAd(deps: AdDeps = {}): Promise<AdWatchResult> {
  const enabled = deps.enabled ?? REWARDED_AD_ENABLED;
  if (!enabled) {
    // 未开通流量主: 广告关闭,直接视为看完(MVP 全免费解锁)
    return Promise.resolve('completed');
  }

  const freeFallback = deps.freeFallback ?? FREE_FALLBACK_ON_AD_ERROR;

  return new Promise<AdWatchResult>((resolve) => {
    let settled = false;
    let ad: RewardedVideoAdLike | null = null;
    const cleanup = (): void => {
      ad?.offClose?.();
      ad?.offError?.();
    };
    const settle = (result: AdWatchResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    // 广告失败(fill rate 低)时的限次免费降级: 命中则本次免费解锁并计数
    const tryFreeFallback = (): void => {
      if (!freeFallback) {
        settle('error');
        return;
      }
      const storage = deps.storage ?? wxStorage;
      const today = new Date().toISOString().slice(0, 10);
      let record: { date: string; count: number } = { date: today, count: 0 };
      try {
        const raw = storage.get<{ date: string; count: number }>(FREE_FALLBACK_STORAGE_KEY);
        if (raw && typeof raw === 'object' && raw.date === today) record = raw;
      } catch {
        // 读取失败按无记录处理
      }
      if (record.count >= FREE_FALLBACK_DAILY_LIMIT) {
        settle('error'); // 今日免费次数已用尽 → 严格付费墙
        return;
      }
      try {
        storage.set(FREE_FALLBACK_STORAGE_KEY, { date: today, count: record.count + 1 });
      } catch {
        // 写入失败不阻断降级(计数尽力而为)
      }
      settle('degraded');
    };

    try {
      const factory = deps.createRewardedVideoAd ?? wx.createRewardedVideoAd;
      ad = factory({ adUnitId: REWARDED_AD_UNIT_ID });
    } catch {
      tryFreeFallback();
      return;
    }

    ad.onClose((res) => {
      settle(res.isEnded ? 'completed' : 'canceled');
    });
    ad.onError(() => {
      tryFreeFallback();
    });

    // 预加载失败不阻断播放(show 内部会再尝试)
    ad.load().catch(() => undefined);
    ad.show().catch(() => tryFreeFallback());
  });
}

/** 默认本地存储实现(微信 storage;计数键见 config) */
const wxStorage: StorageLike = {
  get: (key) => wx.getStorageSync(key) as never,
  set: (key, value) => {
    wx.setStorageSync(key, value);
  },
};

/**
 * 今日免费降级剩余次数(供 UI 提示「今日剩 N 次」)。
 * 广告未启用时无意义(全免费),返回 0。
 */
export function freeFallbackRemaining(storage: StorageLike = wxStorage): number {
  if (!FREE_FALLBACK_ON_AD_ERROR) return 0;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = storage.get<{ date: string; count: number }>(FREE_FALLBACK_STORAGE_KEY);
    if (raw && typeof raw === 'object' && raw.date === today) {
      return Math.max(0, FREE_FALLBACK_DAILY_LIMIT - raw.count);
    }
  } catch {
    // 读取失败按无记录处理
  }
  return FREE_FALLBACK_DAILY_LIMIT;
}
