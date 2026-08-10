import { describe, expect, it } from 'vitest';
import {
  createContentSafety,
  DegradedContentSafety,
  MockContentSafety,
} from '../../src/content-safety/content-safety';

const META = { sourceId: 'cc-1', title: '测试' };

describe('内容安全(#4)', () => {
  it('mock allow → 全部 safe', async () => {
    const s = new MockContentSafety('allow');
    expect(await s.checkImage(Buffer.from('x'), META)).toEqual({ status: 'safe' });
  });

  it('mock block → 违规(带原因)', async () => {
    const s = new MockContentSafety('block');
    const r = await s.checkImage(Buffer.from('x'), META);
    expect(r.status).toBe('blocked');
    expect(r.reason).toBeTruthy();
  });

  it('mock degrade → 检测服务不可用(降级路径)', async () => {
    const s = new MockContentSafety('degrade');
    expect((await s.checkImage(Buffer.from('x'), META)).status).toBe('unavailable');
  });

  it('工厂: dev 无凭据 → 默认放行(本地/CI 可跑通)', async () => {
    const s = createContentSafety({ NODE_ENV: 'development' });
    expect(s).toBeInstanceOf(MockContentSafety);
    expect((await s.checkImage(Buffer.from('x'), META)).status).toBe('safe');
  });

  it('工厂: production 无凭据 → 降级(pending_review 由导入方落地)', async () => {
    const warns: string[] = [];
    const s = createContentSafety({ NODE_ENV: 'production' }, { warn: (m) => warns.push(m) });
    expect(s).toBeInstanceOf(DegradedContentSafety);
    expect((await s.checkImage(Buffer.from('x'), META)).status).toBe('unavailable');
    expect(warns.length).toBeGreaterThan(0);
  });

  it('工厂: 配置了微信凭据 → 当前降级(真实 imgSecCheck 由 #7 接入)', async () => {
    const warns: string[] = [];
    const s = createContentSafety(
      { NODE_ENV: 'production', WECHAT_APPID: 'wx-1', WECHAT_SECRET: 's' },
      { warn: (m) => warns.push(m) },
    );
    expect(s).toBeInstanceOf(DegradedContentSafety);
    expect(warns.some((m) => m.includes('#7'))).toBe(true);
  });
});
