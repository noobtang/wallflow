import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashIdentity, signToken, TOKEN_TTL_SECONDS } from '../auth/tokens';
import { WECHAT_ERR, type WechatClient } from '../auth/wechat';
import { badRequest } from './wallpapers';

const loginBodySchema = z.object({ code: z.string().min(1).max(128) });
const anonBodySchema = z.object({ device_id: z.string().uuid() });

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/**
 * 鉴权(#10,规格 #7):
 * - POST /auth/login  {code}   小程序 wx.login code → code2session 换 openid → HMAC 映射 user_id → JWT
 * - POST /auth/anon   {device_id}  Web 端匿名登录(UUID,客户端生成,收藏按设备隔离)
 * 均签发短时效(2h)JWT;身份明文永不落库(验收 6)。
 */
export async function authRoutes(
  app: FastifyInstance,
  deps: { jwtSecret: string; wechat: WechatClient | null },
): Promise<void> {
  app.post('/auth/login', async (request) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('code 必须为非空字符串');
    if (!deps.wechat) {
      throw httpError(503, '微信登录未配置(WECHAT_APPID/WECHAT_SECRET)');
    }
    const result = await deps.wechat.code2Session(parsed.data.code);
    if (!result.ok) {
      if (result.errcode === WECHAT_ERR.INVALID_CODE) {
        throw httpError(401, 'code 无效或已过期,请重新 wx.login');
      }
      throw httpError(502, `微信登录服务异常(${result.errcode})`);
    }
    const userId = hashIdentity(deps.jwtSecret, `wx:${result.openid}`);
    const token = signToken(deps.jwtSecret, { sub: userId, kind: 'wechat' });
    return { token, expiresIn: TOKEN_TTL_SECONDS, kind: 'wechat' };
  });

  app.post('/auth/anon', async (request) => {
    const parsed = anonBodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('device_id 必须为合法 UUID(客户端生成)');
    const userId = hashIdentity(deps.jwtSecret, `anon:${parsed.data.device_id}`);
    const token = signToken(deps.jwtSecret, { sub: userId, kind: 'anon' });
    return { token, expiresIn: TOKEN_TTL_SECONDS, kind: 'anon' };
  });
}
