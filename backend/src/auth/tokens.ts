import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * 会话令牌(#10,规格 #7 鉴权决策)。
 * - 双身份(微信 openid / Web 匿名 device_id)统一映射内部 user_id:
 *   HMAC-SHA256(JWT_SECRET 作 key)哈希,DB 不存任何明文身份(验收 6)
 * - 前缀隔离身份空间: wx:<openid> 与 anon:<device_id> 不可能碰撞
 * - JWT: HS256,短时效 2h,MVP 仅 access token(无 refresh)
 */
export const TOKEN_TTL_SECONDS = 2 * 60 * 60;

export type IdentityKind = 'wechat' | 'anon';

export interface TokenPayload {
  /** 内部 user_id(HMAC 哈希后的稳定 ID,存 favorites.user_id) */
  sub: string;
  kind: IdentityKind;
}

/**
 * HMAC-SHA256 派生内部 user_id;同一 rawId 永远映射同一 user_id。
 * 注意(轮换代价): JWT_SECRET 即 HMAC key,轮换会使所有 user_id 变化、收藏记录"隐身"
 * (安全事件轮换时需接受此代价,或后续引入独立 USER_ID_SECRET 解耦 token 与身份映射)。
 */
export function hashIdentity(secret: string, rawId: string): string {
  return crypto.createHmac('sha256', secret).update(rawId).digest('hex');
}

/** 签发 JWT(expiresInSeconds 供测试注入短时效;默认 2h) */
export function signToken(
  secret: string,
  payload: TokenPayload,
  expiresInSeconds: number = TOKEN_TTL_SECONDS,
): string {
  return jwt.sign({ kind: payload.kind }, secret, {
    algorithm: 'HS256',
    subject: payload.sub,
    expiresIn: expiresInSeconds,
  });
}

/** 校验 JWT;非法/过期/缺 sub → null(不抛,供鉴权层统一处理) */
export function verifyToken(secret: string, token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
      return null;
    }
    const kind: IdentityKind = decoded.kind === 'wechat' ? 'wechat' : 'anon';
    return { sub: decoded.sub, kind };
  } catch {
    return null;
  }
}
