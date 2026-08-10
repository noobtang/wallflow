import { request } from './api';
import { generateUuid } from './uuid';

/**
 * 埋点上报(#10 漏斗数据入口): POST /events,event_id 由客户端生成保证幂等。
 * fire-and-forget: 失败静默,不打断用户主流程(设计文档 §5 事件表)。
 */
export function track(
  eventName: string,
  opts?: { wallpaperId?: number; extra?: Record<string, unknown> },
): void {
  try {
    const eventId = `wf-${Date.now()}-${generateUuid()}`;
    void request({
      path: '/events',
      method: 'POST',
      data: {
        event_name: eventName,
        event_id: eventId,
        wallpaper_id: opts?.wallpaperId,
        extra: opts?.extra,
      },
    }).catch(() => {
      /* 埋点失败不打断用户流程 */
    });
  } catch {
    /* noop */
  }
}
