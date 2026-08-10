/**
 * 微信 code2session 客户端(#10 登录)。
 * - 小程序端 wx.login 拿 code → 后端调微信官方接口换 openid(官方背书身份,不信任客户端自报 openid)
 * - 接口抽象便于测试注入 fake(本地/CI 无真实 appid/secret 也可全链路测试)
 * - 工厂: 未配置 WECHAT_APPID/SECRET → null(login 路由返回 503,提示配置)
 */

export type WechatCode2SessionResult =
  | { ok: true; openid: string }
  | { ok: false; errcode: number; errmsg: string };

export interface WechatClient {
  code2Session(code: string): Promise<WechatCode2SessionResult>;
}

/** 微信 errcode 语义(登录相关) */
export const WECHAT_ERR = {
  INVALID_CODE: 40029, // code 无效/已使用/已过期(有效期 5 分钟,一次性)
  FREQUENCY_LIMIT: 45011,
} as const;

export class RealWechatClient implements WechatClient {
  constructor(private readonly cfg: { appid: string; secret: string }) {}

  async code2Session(code: string): Promise<WechatCode2SessionResult> {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(this.cfg.appid)}` +
      `&secret=${encodeURIComponent(this.cfg.secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';
    let res: Response;
    try {
      // 8s 超时: 微信接口挂起时不拖死请求(Fastify 无默认请求超时)
      res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch (err) {
      return { ok: false, errcode: -1, errmsg: `微信接口不可达: ${(err as Error).message}` };
    }
    if (!res.ok) {
      return { ok: false, errcode: -1, errmsg: `微信接口 HTTP ${res.status}` };
    }
    let data: { openid?: string; errcode?: number; errmsg?: string };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return { ok: false, errcode: -2, errmsg: '微信响应非 JSON' };
    }
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, errcode: data.errcode, errmsg: data.errmsg ?? 'code2session 失败' };
    }
    if (!data.openid) {
      return { ok: false, errcode: -2, errmsg: '微信未返回 openid' };
    }
    return { ok: true, openid: data.openid };
  }
}

export function createWechatClient(cfg: {
  WECHAT_APPID?: string;
  WECHAT_SECRET?: string;
}): WechatClient | null {
  if (cfg.WECHAT_APPID && cfg.WECHAT_SECRET) {
    return new RealWechatClient({ appid: cfg.WECHAT_APPID, secret: cfg.WECHAT_SECRET });
  }
  return null;
}
