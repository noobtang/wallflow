import { REWARDED_AD_ENABLED, REWARDED_AD_UNIT_ID } from './config';

export type AdWatchResult = 'completed' | 'canceled' | 'error';

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
}

/**
 * 播放激励视频并返回结果。
 * - completed: 用户完整看完(isEnded=true)→ 调用方再调 /unlock + 保存
 * - canceled:  中途关闭 → 不解锁
 * - error:     广告加载/播放失败 → 不解锁(不给免费,避免激励被绕过;或可配降级策略)
 */
export function watchRewardedAd(deps: AdDeps = {}): Promise<AdWatchResult> {
  const enabled = deps.enabled ?? REWARDED_AD_ENABLED;
  if (!enabled) {
    // 未开通流量主: 广告关闭,直接视为看完(MVP 全免费解锁)
    return Promise.resolve('completed');
  }

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

    try {
      const factory = deps.createRewardedVideoAd ?? wx.createRewardedVideoAd;
      ad = factory({ adUnitId: REWARDED_AD_UNIT_ID });
    } catch {
      settle('error');
      return;
    }

    ad.onClose((res) => {
      settle(res.isEnded ? 'completed' : 'canceled');
    });
    ad.onError(() => {
      settle('error');
    });

    // 预加载失败不阻断播放(show 内部会再尝试)
    ad.load().catch(() => undefined);
    ad.show().catch(() => settle('error'));
  });
}
