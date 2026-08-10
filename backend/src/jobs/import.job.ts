import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import type { ContentSafety } from '../content-safety/content-safety';
import {
  fromNormalizedWallpaper,
  WallpaperRepository,
} from '../repositories/wallpaper.repository';
import type { Manifest } from '../sources/manifest.schema';
import type { NormalizedWallpaper, SourcePort } from '../sources/source.interface';
import { buildSearchText } from '../search/segmenter';
import { originalKey, thumbnailKey, type ObjectStorage } from '../storage/object-storage';
import { RateLimitedDownloader, wikimediaFallbackUrl } from './downloader';
import { getImageMetadata, makeThumbnail, mimeFromFormat } from './thumbnail';

/** 序列化锁 key(#4 验收 7): pg advisory lock,会话级,进程退出/连接断开自动释放 */
export const ADVISORY_LOCK_KEY = 727_463_001;

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ImportJobDeps {
  pool: pg.Pool; // 供 advisory 序列化锁
  repository: WallpaperRepository;
  downloader: RateLimitedDownloader;
  storage: ObjectStorage;
  safety: ContentSafety;
  logger?: Logger;
}

export interface ImportOptions {
  /** 只跑一遍校验流(manifest 合法性),不下载/不上传/不落库(验收 1) */
  dryRun?: boolean;
  /** 冒烟: 只处理前 N 条 */
  limit?: number;
  /** 断点续导: 已入库的条目(source,source_id 已存在)跳过,不重复下载/上传(验收 3) */
  resume?: boolean;
  /** 整批失败(基础设施错误,如 DB 抖动)的退避重试次数,默认 3 */
  batchRetries?: number;
  batchRetryBaseMs?: number;
}

export interface ImportSummary {
  /** true = 已有实例在运行(advisory lock 被占用),本次未做任何事 */
  locked: boolean;
  dryRun: boolean;
  total: number;
  imported: number;
  /** resume 模式下已存在而跳过的条目数(不重复下载/上传) */
  resumed: number;
  blocked: number;
  pendingReview: number;
  failed: number;
  /** 处理过程告警(单条失败/内容违规/降级原因等;清单畸形行由 CuratedImport 在 source 层告警) */
  warnings: string[];
}

/**
 * 精选导入流水线(#4)。单条处理链:
 *   获取图片(本地文件或限速下载)→ 内容安全检测 → sharp 600px 缩略图
 *   → 上传原图+缩略图(COS key 约定 #8)→ upsert ON CONFLICT (source, source_id) 幂等
 * 单条失败跳过继续(断点续导靠幂等);整批基础设施失败退避重试;advisory lock 防并发。
 * categories 计数(countByCategory)为实时聚合,随 upsert 自动最新(验收 8)。
 */
export class ImportJob {
  constructor(private readonly deps: ImportJobDeps) {}

  private get log(): Logger {
    return this.deps.logger ?? console;
  }

  async run(source: SourcePort, manifest: Manifest, options: ImportOptions = {}): Promise<ImportSummary> {
    const { batchRetries = 3, batchRetryBaseMs = 5000 } = options;
    let attempt = 0;
    for (;;) {
      try {
        return await this.runOnce(source, manifest, options);
      } catch (err) {
        if (attempt >= batchRetries) throw err;
        attempt += 1;
        this.log.error(`[import] 整批失败,剩余 ${batchRetries - attempt} 次重试: ${(err as Error).message}`);
        await sleep(batchRetryBaseMs * 2 ** (attempt - 1));
      }
    }
  }

  private async runOnce(
    source: SourcePort,
    manifest: Manifest,
    options: ImportOptions,
  ): Promise<ImportSummary> {
    const warnings: string[] = [];
    const warn = (msg: string): void => {
      warnings.push(msg);
      this.log.warn(`[import] ${msg}`);
    };

    // dry-run: 只跑一遍校验流(CuratedImport 内部 zod 逐条校验+告警),零副作用
    if (options.dryRun) {
      let total = 0;
      for await (const w of source.read(manifest)) {
        void w;
        total += 1;
      }
      return { locked: false, dryRun: true, total, imported: 0, resumed: 0, blocked: 0, pendingReview: 0, failed: 0, warnings };
    }

    // 序列化锁: 独占连接上取会话级 advisory lock(池连接不可用于锁语义)
    const lockClient = await this.deps.pool.connect();
    try {
      const { rows } = await lockClient.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok',
        [ADVISORY_LOCK_KEY],
      );
      if (!rows[0]?.ok) {
        warn('已有导入实例在运行(advisory lock 被占用),本次跳过');
        return { locked: true, dryRun: false, total: 0, imported: 0, resumed: 0, blocked: 0, pendingReview: 0, failed: 0, warnings };
      }

      let total = 0;
      let imported = 0;
      let resumed = 0;
      let blocked = 0;
      let pendingReview = 0;
      let failed = 0;

      for await (const w of source.read(manifest)) {
        if (options.limit !== undefined && total >= options.limit) break;
        total += 1;
        if (options.resume) {
          const existing = await this.deps.repository.findBySourceAndSourceId(w.source, w.sourceId);
          if (existing) {
            resumed += 1;
            continue; // 断点续导: 已入库条目跳过,不重复下载/上传
          }
        }
        try {
          const status = await this.processItem(w, warn);
          if (status === 'blocked') blocked += 1;
          else if (status === 'pending_review') pendingReview += 1;
          else imported += 1;
        } catch (err) {
          failed += 1;
          warn(`条目 ${w.sourceId} 处理失败,跳过继续: ${(err as Error).message}`);
        }
      }

      return { locked: false, dryRun: false, total, imported, resumed, blocked, pendingReview, failed, warnings };
    } finally {
      // 即使上面 return/throw 也释放锁;未持有锁时 unlock 是安全 no-op
      await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
      lockClient.release();
    }
  }

  private async processItem(
    w: NormalizedWallpaper,
    warn: (msg: string) => void,
  ): Promise<'active' | 'blocked' | 'pending_review'> {
    // 1) 获取图片(本地文件或 URL 限速下载;Wikimedia 原图 429 自动降级缩略图通道)
    const image = await this.fetchImage(w);

    // 2) 内容安全检测(上传前;违规不入库,直接标记 blocked 跳过上传)
    const safety = await this.deps.safety.checkImage(image.buffer, {
      sourceId: w.sourceId,
      title: w.title,
    });
    if (safety.status === 'blocked') {
      warn(`条目 ${w.sourceId} 内容违规(${safety.reason ?? '未知'}): status=blocked`);
      await this.deps.repository.upsert({ ...fromNormalizedWallpaper(w), status: 'blocked' });
      return 'blocked';
    }

    // 3) sharp 600px 缩略图
    const thumb = await makeThumbnail(image.buffer);

    // 4) 上传原图 + 缩略图(COS key 约定 #8)
    const original = await this.deps.storage.uploadObject(
      originalKey(w.sourceId),
      image.buffer,
      mimeFromFormat(image.format),
    );
    const thumbUpload = await this.deps.storage.uploadObject(
      thumbnailKey(w.sourceId),
      thumb.buffer,
      'image/jpeg',
    );

    // 5) 幂等入库(ON CONFLICT (source, source_id));检测不可用 → pending_review(降级策略)
    const status = safety.status === 'unavailable' ? 'pending_review' : 'active';
    // #6 搜索: 入库时用 jieba 预分词生成 search_text(标题+标签+分类+同义词)
    // #9 语义: DB 存「对象 key」(规格 #8),内容 API 读取时经 getSignedUrl 生成签名直链
    const searchText = buildSearchText(w.title, w.tags, w.category);
    await this.deps.repository.upsert({
      ...fromNormalizedWallpaper(w),
      searchText,
      url: original.key,
      thumbUrl: thumbUpload.key,
      width: image.width,
      height: image.height,
      status,
    });
    return status;
  }

  private async fetchImage(
    w: NormalizedWallpaper,
  ): Promise<{ buffer: Buffer; format: string; width: number; height: number }> {
    let buffer: Buffer;
    if (w.localFile !== undefined) {
      buffer = await fs.readFile(path.resolve(w.localFile));
    } else if (w.imageUrl !== undefined) {
      const { buffer: downloaded } = await this.deps.downloader.download({
        url: w.imageUrl,
        fallbackUrl: wikimediaFallbackUrl(w.imageUrl),
      });
      buffer = downloaded;
    } else {
      throw new Error('条目缺少 imageUrl/localFile(不应发生,CuratedImport 已校验)');
    }

    const meta = await getImageMetadata(buffer);
    if (meta.width <= 0 || meta.height <= 0) {
      throw new Error('图片元数据解析失败,文件可能损坏或非图片');
    }
    return { buffer, format: meta.format, width: meta.width, height: meta.height };
  }
}
