import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, type TokenPayload } from '../auth/tokens';

/** 扩展 FastifyRequest: 鉴权注入的用户身份(未登录/匿名时为 null) */
declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload | null;
  }
}

export interface AuthContext {
  /** 必需鉴权 preHandler: 无/坏 token → 401(收藏/解锁/举报等) */
  requireAuth: (request: FastifyRequest, _reply: FastifyReply) => Promise<void>;
  /** 可选鉴权 preHandler: 坏 token 静默降级匿名(详情页 is_favorited 用) */
  optionalAuth: (request: FastifyRequest, _reply: FastifyReply) => Promise<void>;
}

/** 由 Authorization: Bearer <jwt> 解析用户;格式错误/校验失败 → null(RFC 6750 scheme 大小写不敏感) */
function resolveUser(secret: string, request: FastifyRequest): TokenPayload | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  return verifyToken(secret, token);
}

export function createAuth(deps: { jwtSecret: string }): AuthContext {
  const requireAuth: AuthContext['requireAuth'] = async (request) => {
    const user = resolveUser(deps.jwtSecret, request);
    if (!user) {
      const err = new Error('未登录或登录已过期') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
    request.user = user;
  };

  const optionalAuth: AuthContext['optionalAuth'] = async (request) => {
    request.user = resolveUser(deps.jwtSecret, request);
  };

  return { requireAuth, optionalAuth };
}
