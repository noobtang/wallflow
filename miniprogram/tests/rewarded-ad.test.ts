import { describe, expect, it, vi } from 'vitest';
import { watchRewardedAd, type RewardedVideoAdLike } from '../utils/rewarded-ad';

/** 构造可控的 fake 广告实例 */
function makeAd(handlers: {
  onClose?: (res: { isEnded: boolean }) => void;
  onError?: (err: unknown) => void;
  loadImpl?: () => Promise<void>;
  showImpl?: () => Promise<void>;
}): RewardedVideoAdLike & {
  emitClose: (res: { isEnded: boolean }) => void;
  emitError: (err: unknown) => void;
  load: () => Promise<void>;
  show: () => Promise<void>;
} {
  let closeCb: ((res: { isEnded: boolean }) => void) | undefined;
  let errorCb: ((err: unknown) => void) | undefined;
  return {
    load: handlers.loadImpl ?? (() => Promise.resolve()),
    show: handlers.showImpl ?? (() => Promise.resolve()),
    onClose: (cb) => {
      closeCb = cb;
    },
    onError: (cb) => {
      errorCb = cb;
    },
    offClose: () => {
      closeCb = undefined;
    },
    offError: () => {
      errorCb = undefined;
    },
    emitClose: (res) => closeCb?.(res),
    emitError: (err) => errorCb?.(err),
  };
}

describe('rewarded-ad.ts 激励视频封装(#12)', () => {
  it('未配置 adUnitId(流量主未开通)→ 直接 completed(MVP 全免费降级)', async () => {
    const result = await watchRewardedAd({});
    expect(result).toBe('completed');
  });

  it('看完(isEnded=true)→ completed;中途关闭(isEnded=false)→ canceled', async () => {
    const ad = makeAd({});
    const p = watchRewardedAd({ enabled: true, createRewardedVideoAd: () => ad });
    // 等待 load/show 被调用(异步 tick)
    await new Promise((r) => setTimeout(r, 0));
    ad.emitClose({ isEnded: true });
    expect(await p).toBe('completed');

    const ad2 = makeAd({});
    const p2 = watchRewardedAd({ enabled: true, createRewardedVideoAd: () => ad2 });
    await new Promise((r) => setTimeout(r, 0));
    ad2.emitClose({ isEnded: false });
    expect(await p2).toBe('canceled');
  });

  it('广告错误 → error;创建失败 → error;show 失败 → error', async () => {
    const ad = makeAd({});
    const p = watchRewardedAd({ enabled: true, createRewardedVideoAd: () => ad });
    await new Promise((r) => setTimeout(r, 0));
    ad.emitError(new Error('ad fail'));
    expect(await p).toBe('error');

    const badFactory = (): RewardedVideoAdLike => {
      throw new Error('create failed');
    };
    expect(await watchRewardedAd({ enabled: true, createRewardedVideoAd: badFactory })).toBe('error');

    const ad2 = makeAd({ showImpl: () => Promise.reject(new Error('show fail')) });
    const p2 = watchRewardedAd({ enabled: true, createRewardedVideoAd: () => ad2 });
    expect(await p2).toBe('error');
  });

  it('load 失败不阻断(show 仍尝试)', async () => {
    const ad = makeAd({ loadImpl: () => Promise.reject(new Error('load fail')) });
    const p = watchRewardedAd({ enabled: true, createRewardedVideoAd: () => ad });
    await new Promise((r) => setTimeout(r, 0));
    ad.emitClose({ isEnded: true });
    expect(await p).toBe('completed');
  });
});
