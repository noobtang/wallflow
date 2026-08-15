import { describe, expect, it } from 'vitest';
import {
  freeFallbackRemaining,
  watchRewardedAd,
  type RewardedVideoAdLike,
  type StorageLike,
} from '../utils/rewarded-ad';

/** 内存版本地存储(测试注入,免 wx API) */
function memStorage(initial: Record<string, unknown> = {}): StorageLike & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    get: (key) => store.get(key) as never,
    set: (key, value) => {
      store.set(key, value);
    },
  };
}

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

  it('广告错误 → error;创建失败 → error;show 失败 → error(严格付费墙: 降级开关关闭)', async () => {
    // 默认 FREE_FALLBACK_ON_AD_ERROR=true,广告失败会降级为 degraded;
    // 本用例显式 freeFallback: false 固定「严格付费墙」语义(降级开关关闭时的行为)。
    const ad = makeAd({});
    const p = watchRewardedAd({ enabled: true, freeFallback: false, createRewardedVideoAd: () => ad });
    await new Promise((r) => setTimeout(r, 0));
    ad.emitError(new Error('ad fail'));
    expect(await p).toBe('error');

    const badFactory = (): RewardedVideoAdLike => {
      throw new Error('create failed');
    };
    expect(await watchRewardedAd({ enabled: true, freeFallback: false, createRewardedVideoAd: badFactory })).toBe('error');

    const ad2 = makeAd({ showImpl: () => Promise.reject(new Error('show fail')) });
    const p2 = watchRewardedAd({ enabled: true, freeFallback: false, createRewardedVideoAd: () => ad2 });
    expect(await p2).toBe('error');
  });

  it('load 失败不阻断(show 仍尝试)', async () => {
    const ad = makeAd({ loadImpl: () => Promise.reject(new Error('load fail')) });
    const p = watchRewardedAd({ enabled: true, createRewardedVideoAd: () => ad });
    await new Promise((r) => setTimeout(r, 0));
    ad.emitClose({ isEnded: true });
    expect(await p).toBe('completed');
  });

  describe('广告失败限次免费降级(2026-08-15 平衡策略)', () => {
    it('onError → 命中降级(有剩余次数)→ degraded 且计数 +1', async () => {
      const storage = memStorage();
      const ad = makeAd({});
      const p = watchRewardedAd({ enabled: true, freeFallback: true, storage, createRewardedVideoAd: () => ad });
      await new Promise((r) => setTimeout(r, 0));
      ad.emitError(new Error('no fill'));
      expect(await p).toBe('degraded');
      const record = storage.store.get('wallflow_free_fallback_count') as { date: string; count: number };
      expect(record.count).toBe(1);
      expect(freeFallbackRemaining(storage)).toBe(2);
    });

    it('当日次数用尽(3 次)→ error(严格付费墙,不再免费)', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const storage = memStorage({ wallflow_free_fallback_count: { date: today, count: 3 } });
      const ad = makeAd({});
      const p = watchRewardedAd({ enabled: true, freeFallback: true, storage, createRewardedVideoAd: () => ad });
      await new Promise((r) => setTimeout(r, 0));
      ad.emitError(new Error('no fill'));
      expect(await p).toBe('error');
      expect((storage.store.get('wallflow_free_fallback_count') as { count: number }).count).toBe(3); // 未再计数
      expect(freeFallbackRemaining(storage)).toBe(0);
    });

    it('跨自然日重置计数(昨天用尽 → 今天可再次降级)', async () => {
      const yesterday = '2000-01-01'; // 与今天必然不同
      const storage = memStorage({ wallflow_free_fallback_count: { date: yesterday, count: 3 } });
      const ad = makeAd({});
      const p = watchRewardedAd({ enabled: true, freeFallback: true, storage, createRewardedVideoAd: () => ad });
      await new Promise((r) => setTimeout(r, 0));
      ad.emitError(new Error('no fill'));
      expect(await p).toBe('degraded');
      const record = storage.store.get('wallflow_free_fallback_count') as { date: string; count: number };
      expect(record.date).not.toBe(yesterday);
      expect(record.count).toBe(1);
    });

    it('降级开关关闭 → onError 仍为 error(严格付费墙)', async () => {
      const storage = memStorage();
      const ad = makeAd({});
      const p = watchRewardedAd({ enabled: true, freeFallback: false, storage, createRewardedVideoAd: () => ad });
      await new Promise((r) => setTimeout(r, 0));
      ad.emitError(new Error('no fill'));
      expect(await p).toBe('error');
      expect(storage.store.size).toBe(0); // 未计数
    });

    it('创建广告失败 / show 失败 → 同样走降级', async () => {
      const storage = memStorage();
      const badFactory = (): RewardedVideoAdLike => {
        throw new Error('create failed');
      };
      expect(await watchRewardedAd({ enabled: true, freeFallback: true, storage, createRewardedVideoAd: badFactory })).toBe('degraded');

      const ad = makeAd({ showImpl: () => Promise.reject(new Error('show fail')) });
      const p = watchRewardedAd({ enabled: true, freeFallback: true, storage, createRewardedVideoAd: () => ad });
      expect(await p).toBe('degraded');
      expect((storage.store.get('wallflow_free_fallback_count') as { count: number }).count).toBe(2);
    });
  });
});
