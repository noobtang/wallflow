import sharp from 'sharp';

/** 缩略图宽度(规格 #4): 600px 宽 JPEG */
export const THUMB_WIDTH = 600;

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/** sharp 生成 600px 宽 JPEG 缩略图;小于 600px 的原图不放大(withoutEnlargement) */
export async function makeThumbnail(image: Buffer): Promise<ThumbnailResult> {
  const { data, info } = await sharp(image)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/**
 * 原图实际尺寸/格式。导入时以真实文件为准(清单里的宽高可能不准,
 * 且 Wikimedia 降级通道返回的是 4096px 缩放版,尺寸与清单不一致)。
 */
export async function getImageMetadata(
  image: Buffer,
): Promise<{ width: number; height: number; format: string }> {
  const meta = await sharp(image).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format ?? '' };
}

const FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function mimeFromFormat(format: string): string {
  return FORMAT_MIME[format] ?? 'application/octet-stream';
}
