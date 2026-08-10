import fs from 'node:fs';
import { manifestEntrySchema, type Manifest } from './manifest.schema';
import type { NormalizedWallpaper, SourcePort } from './source.interface';

export interface CuratedImportOptions {
  /** 畸形/非法条目告警回调(默认 console.warn) */
  onWarning?: (message: string) => void;
}

/**
 * CuratedImport — MVP 内容源(#3)。
 * 读取人工精选的 manifest 清单 → zod 逐条校验(字段缺失/类型错/许可不在白名单
 * → 跳过 + 告警,不中断)→ 输出规范化壁纸元数据流,供 #4 入库。
 */
export class CuratedImport implements SourcePort {
  private readonly onWarning: (message: string) => void;

  constructor(options: CuratedImportOptions = {}) {
    this.onWarning = options.onWarning ?? ((m) => console.warn(`[curated-import] ${m}`));
  }

  async *read(manifest: Manifest): AsyncGenerator<NormalizedWallpaper> {
    if (!Array.isArray(manifest)) {
      this.onWarning('manifest 不是数组,忽略整个清单');
      return;
    }

    let skipped = 0;
    for (const raw of manifest) {
      const parsed = manifestEntrySchema.safeParse(raw);
      if (!parsed.success) {
        skipped += 1;
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        const rawSourceId = (raw as { sourceId?: unknown } | null)?.sourceId ?? '?';
        this.onWarning(`条目被跳过 — ${issues} (sourceId=${String(rawSourceId)})`);
        continue;
      }

      const e = parsed.data;
      yield {
        source: 'curated',
        sourceId: e.sourceId,
        title: e.title,
        license: e.license,
        licenseUrl: e.licenseUrl,
        creator: e.creator,
        creatorUrl: e.creatorUrl,
        width: e.width,
        height: e.height,
        tags: e.tags,
        category: e.category,
        ...(e.imageUrl !== undefined ? { imageUrl: e.imageUrl } : {}),
        ...(e.localFile !== undefined ? { localFile: e.localFile } : {}),
      };
    }

    if (skipped > 0) {
      this.onWarning(`本次导入共跳过 ${skipped} 条畸形/非法条目`);
    }
  }
}

/** 读取 manifest JSON 文件(顶层数组形式) */
export function readManifestFile(filePath: string): Manifest {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Manifest;
}
