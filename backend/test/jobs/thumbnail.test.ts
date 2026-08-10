import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getImageMetadata,
  makeThumbnail,
  mimeFromFormat,
  THUMB_WIDTH,
} from '../../src/jobs/thumbnail';

describe('makeThumbnail', () => {
  let big: Buffer; // 2000x1000
  let small: Buffer; // 300x200

  beforeAll(async () => {
    big = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .png()
      .toBuffer();
    small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#111' },
    })
      .png()
      .toBuffer();
  });

  it('2000x1000 → 600px 宽 JPEG 缩略图,等比缩放', async () => {
    const thumb = await makeThumbnail(big);
    expect(thumb.width).toBe(THUMB_WIDTH);
    expect(thumb.height).toBe(300); // 600 / 2
    const info = await sharp(thumb.buffer).metadata();
    expect(info.format).toBe('jpeg');
    expect(thumb.buffer.length).toBeLessThan(big.length);
  });

  it('小于 600px 的图不放大(withoutEnlargement)', async () => {
    const thumb = await makeThumbnail(small);
    expect(thumb.width).toBe(300);
    expect(thumb.height).toBe(200);
  });

  it('getImageMetadata: 返回真实宽高与格式', async () => {
    const meta = await getImageMetadata(big);
    expect(meta).toEqual({ width: 2000, height: 1000, format: 'png' });
  });

  it('mimeFromFormat 映射', () => {
    expect(mimeFromFormat('jpeg')).toBe('image/jpeg');
    expect(mimeFromFormat('png')).toBe('image/png');
    expect(mimeFromFormat('webp')).toBe('image/webp');
    expect(mimeFromFormat('unknown')).toBe('application/octet-stream');
  });
});
