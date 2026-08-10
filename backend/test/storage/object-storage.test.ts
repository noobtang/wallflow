import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CosObjectStorage,
  createObjectStorage,
  FileObjectStorage,
  MockObjectStorage,
  originalKey,
  thumbnailKey,
} from '../../src/storage/object-storage';

/** 注入 fake COS SDK(putObject/getObjectUrl 本地模拟,零网络) */
function fakeCos(overrides: Record<string, unknown> = {}) {
  return {
    putObject: (
      params: { Bucket: string; Key: string; CacheControl?: string },
      cb: (err: { message?: string } | null, data: { Location: string }) => void,
    ) => {
      cb(null, {
        Location: `${params.Bucket}.cos.ap-guangzhou.myqcloud.com/${params.Key}`,
      });
    },
    getObjectUrl: (
      params: { Bucket: string; Region: string; Key: string; Expires?: number },
      cb?: (err: { message?: string } | null, data: { Url: string }) => void,
    ) => {
      const url = `https://${params.Bucket}.cos.${params.Region}.myqcloud.com/${params.Key}?q-sign-algorithm=sha1&q-sign-time=${params.Expires}`;
      if (cb) {
        cb(null, { Url: url });
        return;
      }
      return url;
    },
    ...overrides,
  };
}

const COS_CFG = {
  secretId: 'test-secret-id',
  secretKey: 'test-secret-key',
  bucket: 'wf-test-1250000000',
  region: 'ap-guangzhou',
};

describe('对象存储(#4 key 约定 #8/#9)', () => {
  it('key 约定: 原图与缩略图', () => {
    expect(originalKey('cc-x')).toBe('wallpapers/cc-x.jpg');
    expect(thumbnailKey('cc-x')).toBe('wallpapers/cc-x_thumb.jpg');
  });

  it('MockObjectStorage: 上传记录对象并返回 mock URL', async () => {
    const s = new MockObjectStorage();
    const r = await s.uploadObject(originalKey('cc-a'), Buffer.from('img'), 'image/jpeg');
    expect(r.key).toBe('wallpapers/cc-a.jpg');
    expect(r.url).toBe('https://cos-mock.local/wallpapers/cc-a.jpg');
    expect(s.objects.get('wallpapers/cc-a.jpg')).toEqual(Buffer.from('img'));
  });

  it('MockObjectStorage: getSignedUrl 返回 {baseUrl}/{key}(API 层对等签名直链)', () => {
    const s = new MockObjectStorage();
    expect(s.getSignedUrl('wallpapers/cc-a.jpg')).toBe(
      'https://cos-mock.local/wallpapers/cc-a.jpg',
    );
  });

  it('MockObjectStorage: dir 选项把对象落盘(便于本地冒烟检查)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-storage-'));
    const s = new MockObjectStorage({ dir });
    await s.uploadObject('wallpapers/cc-b_thumb.jpg', Buffer.from('t'), 'image/jpeg');
    expect(fs.readFileSync(path.join(dir, 'wallpapers', 'cc-b_thumb.jpg'))).toEqual(
      Buffer.from('t'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CosObjectStorage.uploadObject: putObject 带 Cache-Control,返回 key + https URL', async () => {
    const cos = fakeCos();
    const s = new CosObjectStorage(COS_CFG, { cos });
    const r = await s.uploadObject('wallpapers/cc-c.jpg', Buffer.from('img'), 'image/jpeg');
    expect(r.key).toBe('wallpapers/cc-c.jpg');
    expect(r.url).toBe('https://wf-test-1250000000.cos.ap-guangzhou.myqcloud.com/wallpapers/cc-c.jpg');
  });

  it('CosObjectStorage.uploadObject: putObject 失败 → reject(带 key 上下文)', async () => {
    const cos = fakeCos({
      putObject: (_p: unknown, cb: (err: { message?: string } | null) => void) =>
        cb({ message: 'AccessDenied' }),
    });
    const s = new CosObjectStorage(COS_CFG, { cos });
    await expect(s.uploadObject('wallpapers/cc-d.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
      /COS putObject 失败\(wallpapers\/cc-d\.jpg\)/,
    );
  });

  it('CosObjectStorage.getSignedUrl: 同步返回带签名直链,Expires 透传', () => {
    const cos = fakeCos();
    const s = new CosObjectStorage(COS_CFG, { cos });
    const url = s.getSignedUrl('wallpapers/cc-e.jpg', 3600);
    expect(url).toContain('wallpapers/cc-e.jpg');
    expect(url).toContain('q-sign-time=3600');
    expect(url).toContain('q-sign-algorithm');
  });

  it('CosObjectStorage.getSignedUrl: SDK 未返回 URL → 抛错(防御)', () => {
    const cos = fakeCos({ getObjectUrl: () => undefined });
    const s = new CosObjectStorage(COS_CFG, { cos });
    expect(() => s.getSignedUrl('wallpapers/cc-f.jpg')).toThrow(/未返回 URL/);
  });

  it('FileObjectStorage: 上传落盘到 dir 并返回 /dev-storage URL(#10 联调)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-filestore-'));
    const s = new FileObjectStorage({ dir, baseUrl: 'http://127.0.0.1:3100' });
    const r = await s.uploadObject(originalKey('cc-dev'), Buffer.from('img-bytes'), 'image/jpeg');
    expect(r.key).toBe('wallpapers/cc-dev.jpg');
    expect(r.url).toBe('http://127.0.0.1:3100/dev-storage/wallpapers/cc-dev.jpg');
    expect(fs.readFileSync(path.join(dir, 'wallpapers', 'cc-dev.jpg'))).toEqual(
      Buffer.from('img-bytes'),
    );
    expect(s.getSignedUrl('wallpapers/cc-dev.jpg')).toBe(
      'http://127.0.0.1:3100/dev-storage/wallpapers/cc-dev.jpg',
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('createObjectStorage: dev 无 COS 配置 → FileObjectStorage(联调可真实加载图片)', () => {
    const s = createObjectStorage({ NODE_ENV: 'development', PORT: 3100 });
    expect(s).toBeInstanceOf(FileObjectStorage);
  });

  it('createObjectStorage: test 环境无 COS 配置 → mock(测试零 IO)', () => {
    expect(createObjectStorage({ NODE_ENV: 'test' })).toBeInstanceOf(MockObjectStorage);
  });

  it('createObjectStorage: 未配置 → mock;配了 bucket 缺凭证(非生产)→ mock + 告警', () => {
    expect(createObjectStorage({ NODE_ENV: 'test' })).toBeInstanceOf(MockObjectStorage);

    const warns: string[] = [];
    const s = createObjectStorage(
      { COS_BUCKET: 'wf-1250000000', NODE_ENV: 'development' },
      { warn: (m) => warns.push(m) },
    );
    expect(s).toBeInstanceOf(MockObjectStorage);
    expect(warns.some((m) => m.includes('缺少凭证'))).toBe(true);
  });

  it('createObjectStorage: 生产配置了 COS_BUCKET 但缺凭证 → 硬失败(绝不静默落 mock)', () => {
    expect(() =>
      createObjectStorage({ COS_BUCKET: 'wf-1250000000', NODE_ENV: 'production' }),
    ).toThrow(/生产环境禁止静默降级/);
  });

  it('createObjectStorage: 完整凭证 → CosObjectStorage(签名直链本地可算,无需网络)', () => {
    const s = createObjectStorage({
      COS_BUCKET: 'wf-1250000000',
      COS_SECRET_ID: 'sid',
      COS_SECRET_KEY: 'skey',
      COS_REGION: 'ap-guangzhou',
    });
    expect(s).toBeInstanceOf(CosObjectStorage);
    const url = s.getSignedUrl('wallpapers/cc-g.jpg', 60);
    expect(url).toContain('wallpapers/cc-g.jpg');
    expect(url).toContain('q-sign');
  });
});
