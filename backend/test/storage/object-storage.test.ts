import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createObjectStorage,
  MockObjectStorage,
  originalKey,
  thumbnailKey,
} from '../../src/storage/object-storage';

describe('对象存储(#4 key 约定 #8)', () => {
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

  it('MockObjectStorage: dir 选项把对象落盘(便于本地冒烟检查)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-storage-'));
    const s = new MockObjectStorage({ dir });
    await s.uploadObject('wallpapers/cc-b_thumb.jpg', Buffer.from('t'), 'image/jpeg');
    expect(fs.readFileSync(path.join(dir, 'wallpapers', 'cc-b_thumb.jpg'))).toEqual(
      Buffer.from('t'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('createObjectStorage: 未配置 COS_BUCKET → mock;非生产配置了也降级 mock 并告警', () => {
    expect(createObjectStorage({})).toBeInstanceOf(MockObjectStorage);

    const warns: string[] = [];
    const s = createObjectStorage(
      { COS_BUCKET: 'wf-1250000000', NODE_ENV: 'development' },
      { warn: (m) => warns.push(m) },
    );
    expect(s).toBeInstanceOf(MockObjectStorage);
    expect(warns.some((m) => m.includes('#9'))).toBe(true);
  });

  it('createObjectStorage: 生产配置了 COS_BUCKET 但 #9 未接入 → 硬失败(绝不静默落 mock)', () => {
    expect(() =>
      createObjectStorage({ COS_BUCKET: 'wf-1250000000', NODE_ENV: 'production' }),
    ).toThrow(/生产环境禁止静默降级/);
  });
});
