import fs from 'node:fs';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';

/**
 * 对象存储抽象(#4 导入写入 → #8 分发)。
 * COS key 约定(见 specs/08-cos-distribution.md):
 *   原图    wallpapers/{sourceId}.jpg
 *   缩略图  wallpapers/{sourceId}_thumb.jpg
 *
 * DB 语义: wallpapers.url / thumb_url 存「对象 key」(非完整 URL);内容 API 读取时
 * 通过 getSignedUrl 生成短时效签名直链(#9)。Mock 的 getSignedUrl 返回 {baseUrl}/{key},
 * 与真实 COS 的「签名 URL」在 API 层对等。
 */

export function originalKey(sourceId: string): string {
  return `wallpapers/${sourceId}.jpg`;
}

export function thumbnailKey(sourceId: string): string {
  return `wallpapers/${sourceId}_thumb.jpg`;
}

export interface UploadResult {
  key: string;
  /** 完整可访问 URL(上传时可直接用;DB 存 key,url 仅调试/日志用) */
  url: string;
}

export interface ObjectStorage {
  uploadObject(key: string, data: Buffer, contentType: string): Promise<UploadResult>;
  /**
   * 短时效签名直链(#8)。Mock 返回 {baseUrl}/{key};COS 返回带签名的直链。
   * 同步返回(cos SDK getObjectUrl 本地计算签名,无网络 IO)。
   */
  getSignedUrl(key: string, expiresSeconds?: number): string;
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

  getSignedUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}

export interface CosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
}

/**
 * COS SDK 最小结构面: 真实 SDK 与测试 fake 均可注入(测试无需实现全部方法)。
 * 仅暴露本模块用到的 putObject / getObjectUrl 两个调用面。
 */
export interface CosSdkLike {
  putObject(
    params: {
      Bucket: string;
      Region: string;
      Key: string;
      Body: Buffer;
      ContentType: string;
      CacheControl: string;
    },
    callback: (err: { message?: string; code?: string } | null, data: { Location: string }) => void,
  ): void;
  getObjectUrl(
    params: { Bucket: string; Region: string; Key: string; Sign: boolean; Expires: number },
    callback?: (err: unknown, data: { Url: string }) => void,
  ): string | void;
}

/**
 * 腾讯云 COS 实现(#9): 私有读 bucket + putObject 上传(带 Cache-Control)+ 签名直链。
 * - getObjectUrl(Sign: true) 为本地签名计算(无网络),同步返回;过期由 COS 侧校验
 * - 测试通过 deps.cos 注入 fake SDK,避免真实凭证/网络
 */
export class CosObjectStorage implements ObjectStorage {
  private readonly cos: CosSdkLike;
  private readonly bucket: string;
  private readonly region: string;

  constructor(cfg: CosConfig, deps?: { cos?: CosSdkLike }) {
    this.bucket = cfg.bucket;
    this.region = cfg.region;
    this.cos =
      deps?.cos ??
      (new COS({ SecretId: cfg.secretId, SecretKey: cfg.secretKey }) as unknown as CosSdkLike);
  }

  uploadObject(key: string, data: Buffer, contentType: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: data,
          ContentType: contentType,
          CacheControl: 'public, max-age=86400', // 规格 #8: 对象缓存 1 天
        },
        (err, data) => {
          if (err) {
            reject(new Error(`COS putObject 失败(${key}): ${err.message ?? err.code ?? err}`));
            return;
          }
          // data.Location 形如 "<bucket>.cos.<region>.myqcloud.com/<key>",补协议
          resolve({ key, url: `https://${data.Location}` });
        },
      );
    });
  }

  getSignedUrl(key: string, expiresSeconds = 3600): string {
    const url = this.cos.getObjectUrl({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Sign: true,
      Expires: expiresSeconds,
    });
    // 同步重载返回 string(回调重载返回 void);兜底防御
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error(`COS getObjectUrl 未返回 URL(${key})`);
    }
    return url;
  }
}

/**
 * 存储工厂(#9 切换真实 COS)。
 * - 完整凭证(COS_BUCKET + COS_SECRET_ID + COS_SECRET_KEY)→ CosObjectStorage
 * - 配了 COS_BUCKET 但缺凭证: 生产 → 硬失败(绝不静默落 mock 假 URL);非生产 → 告警降级 mock
 * - 未配置 → MockObjectStorage
 */
export function createObjectStorage(
  config: {
    COS_BUCKET?: string;
    COS_SECRET_ID?: string;
    COS_SECRET_KEY?: string;
    COS_REGION?: string;
    NODE_ENV?: string;
  },
  logger: { warn: (msg: string) => void } = console,
): ObjectStorage {
  const hasBucket = Boolean(config.COS_BUCKET);
  const hasCreds = Boolean(config.COS_SECRET_ID && config.COS_SECRET_KEY);
  if (hasBucket && hasCreds) {
    return new CosObjectStorage({
      secretId: config.COS_SECRET_ID!,
      secretKey: config.COS_SECRET_KEY!,
      bucket: config.COS_BUCKET!,
      region: config.COS_REGION ?? 'ap-guangzhou',
    });
  }
  if (hasBucket && config.NODE_ENV === 'production') {
    throw new Error(
      'COS_BUCKET 已配置但缺少 COS_SECRET_ID/COS_SECRET_KEY;生产环境禁止静默降级 mock(会写入假 URL),请补全凭证',
    );
  }
  if (hasBucket) {
    logger.warn('[object-storage] COS_BUCKET 已配置但缺少凭证,本次使用 mock 存储(生产环境会硬失败)');
  }
  return new MockObjectStorage();
}
