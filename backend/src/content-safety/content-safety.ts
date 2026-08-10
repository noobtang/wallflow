/**
 * 内容安全检测(#4)。上传前调用;MVP 阶段为 mock / 降级实现。
 *
 * 降级策略(规格已定): imgSecCheck 超时/不可用 → 放行 + 标记 pending_review,
 * 不入用户可见流(用户可见流只含 status=active),待重检后转正或 blocked。
 *
 * 真实微信 imgSecCheck 随 #7 接入(依赖 WECHAT_APPID/SECRET 换取 access_token,
 * 调用 media_check_async);接入前:
 *   - dev/test 无凭据 → MockContentSafety('allow')(默认放行,方便本地跑通)
 *   - production 无凭据 → DegradedContentSafety(全部 unavailable → pending_review,符合规格)
 */

export type SafetyStatus = 'safe' | 'blocked' | 'unavailable';

export interface SafetyResult {
  status: SafetyStatus;
  /** 判定说明(blocked 的违规原因 / unavailable 的不可用原因) */
  reason?: string;
}

export interface SafetyMeta {
  sourceId: string;
  title: string;
}

export interface ContentSafety {
  checkImage(image: Buffer, meta: SafetyMeta): Promise<SafetyResult>;
}

export type MockSafetyMode = 'allow' | 'block' | 'degrade';

/** 可配置 mock: allow=全部放行(dev 默认),block=全部违规,degrade=检测服务不可用 */
export class MockContentSafety implements ContentSafety {
  constructor(private readonly mode: MockSafetyMode = 'allow') {}

  async checkImage(_image: Buffer, _meta: SafetyMeta): Promise<SafetyResult> {
    switch (this.mode) {
      case 'block':
        return { status: 'blocked', reason: 'mock: 命中违规规则' };
      case 'degrade':
        return { status: 'unavailable', reason: 'mock: 检测服务不可用' };
      default:
        return { status: 'safe' };
    }
  }
}

/** 生产无凭据时的降级实现(规格策略): 永远 unavailable → 导入方标记 pending_review */
export class DegradedContentSafety implements ContentSafety {
  async checkImage(_image: Buffer, _meta: SafetyMeta): Promise<SafetyResult> {
    return { status: 'unavailable', reason: 'WECHAT_APPID/SECRET 未配置,imgSecCheck 不可用' };
  }
}

export interface ContentSafetyConfig {
  NODE_ENV?: string;
  WECHAT_APPID?: string;
  WECHAT_SECRET?: string;
}

export function createContentSafety(
  config: ContentSafetyConfig,
  logger: { warn: (msg: string) => void } = console,
): ContentSafety {
  if (config.WECHAT_APPID && config.WECHAT_SECRET) {
    logger.warn('[content-safety] 真实 imgSecCheck 由 #7 接入;当前退回降级策略(pending_review)');
    return new DegradedContentSafety();
  }
  if (config.NODE_ENV === 'production') {
    logger.warn(
      '[content-safety] 生产环境未配置微信凭据 → 降级: 全部标记 pending_review 待重检',
    );
    return new DegradedContentSafety();
  }
  // dev/test: 默认放行,保证本地/CI 能完整跑通导入
  return new MockContentSafety('allow');
}
