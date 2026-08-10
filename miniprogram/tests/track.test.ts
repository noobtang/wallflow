import { describe, expect, it, vi } from 'vitest';
import { track } from '../utils/track';
import { mockWx } from './setup';

/** 让 fire-and-forget 的 promise 链落地 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('track.ts 埋点上报', () => {
  it('POST /events,payload 含 event_name/event_id/wallpaper_id/extra', async () => {
    track('download_success', { wallpaperId: 42, extra: { from: 'detail' } });
    await flush();
    expect(mockWx.request).toHaveBeenCalledTimes(1);
    const opts = (mockWx.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      url: string;
      method?: string;
      data?: { event_name: string; event_id: string; wallpaper_id?: number; extra?: unknown };
    };
    expect(opts.url).toContain('/events');
    expect(opts.method).toBe('POST');
    expect(opts.data?.event_name).toBe('download_success');
    expect(opts.data?.wallpaper_id).toBe(42);
    expect((opts.data?.event_id ?? '').length).toBeGreaterThan(8);
    expect(opts.data?.extra).toEqual({ from: 'detail' });
  });

  it('上报失败静默(不抛错,不打断主流程)', async () => {
    (mockWx.request as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (opts: { fail?: (err: unknown) => void }) => {
        opts.fail?.({ errMsg: 'request:fail' });
      },
    );
    expect(() => track('preview_click')).not.toThrow();
    await flush();
  });
});
