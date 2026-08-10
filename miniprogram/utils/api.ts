import { BASE_URL, REQUEST_TIMEOUT } from './config';
import { getToken } from './token';

/** 统一 API 错误: statusCode=0 表示网络层失败 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  data?: Record<string, unknown>;
  /** 是否携带 Bearer token(默认 true;登录接口自身传 false) */
  auth?: boolean;
  timeout?: number;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * 后端 API 封装:
 * - 自动拼接 BASE_URL、注入 token(RFC 6750 Bearer)
 * - 2xx → resolve data;4xx/5xx → ApiError(取后端 { error: { code, message } });
 *   网络失败 → ApiError(NETWORK_ERROR)
 */
export function request<T>(options: RequestOptions): Promise<T> {
  const token = options.auth === false ? null : getToken();
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${options.path}`,
      method: options.method ?? 'GET',
      data: options.data as Record<string, unknown>,
      timeout: options.timeout ?? REQUEST_TIMEOUT,
      header: token ? { authorization: `Bearer ${token}` } : {},
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }
        const body = res.data as ApiErrorBody | undefined;
        reject(
          new ApiError(
            res.statusCode,
            body?.error?.code ?? `HTTP_${res.statusCode}`,
            body?.error?.message ?? `请求失败(${res.statusCode})`,
          ),
        );
      },
      fail: (err) => {
        reject(new ApiError(0, 'NETWORK_ERROR', err.errMsg || '网络开小差了'));
      },
    });
  });
}
