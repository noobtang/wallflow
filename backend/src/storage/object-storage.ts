import fs from 'node:fs';
import path from 'node:path';

/**
 * 对象存储抽象(#4 导入写入 → #8 分发)。
 * COS key 约定(见 specs/08-cos-distribution.md):
 *   原图    wallpapers/{sourceId}.jpg
 *   缩略图  wallpapers/{sourceId}_thumb.jpg
 * MVP 阶段默认 MockObjectStorage(内存,可选落盘);#9 接入真实 COS 后由同一工厂
 * 切换,ImportJob 只依赖接口,不需要知道底层实现。
 */

export function originalKey(sourceId: string): string {
  return `wallpapers/${sourceId}.jpg`;
}

export function thumbnailKey(sourceId: string): string {
  return `wallpapers/${sourceId}_thumb.jpg`;
}

export interface UploadResult {
  key: string;
  /** 对象可访问 URL。MVP mock 直接返回可访问 URL;#8 落地后由 getSignedUrl 提供签名直链 */
  url: string;
}

export interface ObjectStorage {
  uploadObject(key: string, data: Buffer, contentType: string): Promise<UploadResult>;
}

export interface MockObjectStorageOptions {
  /** mock URL 前缀(默认 https://cos-mock.local) */
  baseUrl?: string;
  /** 非空时同时把对象写入该目录(便于本地冒烟后人工检查产物) */
  dir?: string;
}

/** 内存 mock: 记录全部上传对象,URL 形如 {baseUrl}/{key} */
export class MockObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  private readonly baseUrl: string;
  private readonly dir?: string;

  constructor(options: MockObjectStorageOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://cos-mock.local';
    this.dir = options.dir;
  }

  async uploadObject(key: string, data: Buffer, _contentType: string): Promise<UploadResult> {
    this.objects.set(key, data);
    if (this.dir) {
      const file = path.join(this.dir, key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    }
    return { key, url: `${this.baseUrl}/${key}` };
  }
}

/**
 * 存储工厂。真实 COS 由 #9 接入(cos-nodejs-sdk-v5 + COS_SECRET_ID/KEY/BUCKET)。
 * - 生产环境配置了 COS_BUCKET 但 #9 未接入 → 直接 throw(绝不静默落 mock,
 *   否则 DB 里会是 cos-mock.local 假 URL 且无人察觉)
 * - 非生产环境配置了 COS_BUCKET → 告警 + 降级 mock(方便本地预演)
 */
export function createObjectStorage(
  config: { COS_BUCKET?: string; NODE_ENV?: string },
  logger: { warn: (msg: string) => void } = console,
): ObjectStorage {
  if (config.COS_BUCKET && config.NODE_ENV === 'production') {
    throw new Error(
      'COS_BUCKET 已配置但真实 COS 上传器尚未接入(#9);生产环境禁止静默降级 mock,请等待 #9 完成或移除 COS_BUCKET',
    );
  }
  if (config.COS_BUCKET) {
    logger.warn(
      '[object-storage] 真实 COS 上传器由 #9 接入;COS_BUCKET 已配置但本次仍使用 mock 存储',
    );
  }
  return new MockObjectStorage();
}
