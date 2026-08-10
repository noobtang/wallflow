import type { FastifyInstance, FastifyReply } from 'fastify';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

interface HttpLikeError {
  statusCode?: number;
  code?: string;
  message: string;
}

/** 安全收窄 unknown 错误: 兼容 Fastify 抛出的 { statusCode, code } 结构与普通 Error */
function toHttpError(error: unknown): HttpLikeError {
  if (error instanceof Error) {
    const withMeta = error as Error & { statusCode?: number; code?: string };
    return { message: error.message, statusCode: withMeta.statusCode, code: withMeta.code };
  }
  return { message: 'Unknown error' };
}

function sendErrorBody(reply: FastifyReply, statusCode: number, code: string, message: string): void {
  const body: ApiErrorBody = { error: { code, message } };
  reply.code(statusCode).send(body);
}

/**
 * 统一错误映射(ENG-PLAN 错误映射表):
 * - 5xx: 记录日志,对外返回脱敏消息(不泄露内部细节)
 * - 4xx: 透传 error.message(业务可读)
 * - code 回退为 HTTP_{statusCode}(普通 Error 抛出时仍可被前端按 code 分流)
 * - 响应统一为 { error: { code, message } }
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const e = toHttpError(error);
    const statusCode = e.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    }
    sendErrorBody(
      reply,
      statusCode,
      e.code ?? `HTTP_${statusCode}`,
      statusCode >= 500 ? 'Internal server error' : e.message,
    );
  });

  // setErrorHandler 不拦截路由未匹配;补 setNotFoundHandler 保持统一响应形状
  app.setNotFoundHandler((request, reply) => {
    sendErrorBody(reply, 404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found`);
  });
}
