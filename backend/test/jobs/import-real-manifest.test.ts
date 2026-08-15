import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { MockContentSafety } from '../../src/content-safety/content-safety';
import { RateLimitedDownloader } from '../../src/jobs/downloader';
import { ImportJob, type Logger } from '../../src/jobs/import.job';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { CuratedImport, readManifestFile } from '../../src/sources/curated.import';
import type { Manifest } from '../../src/sources/manifest.schema';
import { MockObjectStorage, originalKey, thumbnailKey } from '../../src/storage/object-storage';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

/**
 * 内容管道 CI 覆盖(#12 补全): 用仓库真实 manifest 走「localFile 分支 + mock COS」
 * 全链路导入 — 无上游依赖(不访问 Wikimedia)、无网络 IO,CI 可稳定复现。
 *
 * 背景: 既有导入测试(import.job.test.ts)走 imageUrl + 本地 HTTP 服务;
 *       真实 manifest 的 localFile 分支从未被导入测试覆盖。本文件补上:
 *       - localFile 解析(path.resolve 相对 backend CWD → data/images)
 *       - mock COS 上传(原图 + 缩略图)与 DB 落库
 *       - 与既有测试共用同一导入流水线(ImportJob),零网络
 */
const silentLogger: Logger = { info() {}, warn() {}, error() {} };

describe('真实 manifest 导入(#12 CI 断言覆盖)', () => {
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  const manifestPath = path.resolve(__dirname, '..', '..', '..', 'data', 'manifest.json');

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    repo = new WallpaperRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  function makeJob(storage: MockObjectStorage) {
    const downloader = new RateLimitedDownloader({ minIntervalMs: 0, retryBaseMs: 10, maxRetries: 1 });
    return new ImportJob({
      pool,
      repository: repo,
      downloader,
      storage,
      safety: new MockContentSafety('allow'),
      logger: silentLogger,
    });
  }

  it('manifest 300 条全部带 localFile 且文件存在(离线资产契约)', () => {
    const manifest = readManifestFile(manifestPath);
    expect(manifest.length).toBe(300);
    const missing: string[] = [];
    for (const e of manifest) {
      if (!e.localFile) {
        missing.push(`${e.sourceId}: 缺 localFile`);
        continue;
      }
      // localFile 相对 backend CWD;测试 CWD = backend/
      if (!fs.existsSync(path.resolve(e.localFile))) {
        missing.push(`${e.sourceId}: ${e.localFile} 不存在`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('真实 manifest 子集经 localFile 分支导入: 上传 + 落库 + 幂等(零网络)', async () => {
    const manifest = readManifestFile(manifestPath);
    // 取前 5 条(足够覆盖契约;全量 300 条 sharp 处理 ~20s,CI 用子集)
    const subset = manifest.slice(0, 5);
    expect(subset.every((e) => e.localFile)).toBe(true);

    const storage = new MockObjectStorage();
    const job = makeJob(storage);

    const summary = await job.run(new CuratedImport(), subset);
    expect(summary).toMatchObject({ locked: false, dryRun: false, total: 5, imported: 5, failed: 0, blocked: 0 });

    // 落库: 全部 active,URL 为对象 key(与 imageUrl 导入路径语义一致)
    for (const e of subset) {
      const row = await repo.findBySourceAndSourceId('curated', e.sourceId);
      expect(row).not.toBeNull();
      expect(row?.status).toBe('active');
      expect(row?.url).toBe(originalKey(e.sourceId));
      expect(row?.thumbUrl).toBe(thumbnailKey(e.sourceId));
      expect(row?.license).toBe(e.license);
      expect(row?.category).toBe(e.category);
    }

    // mock COS: 每条 2 个对象(原图 + 缩略图)
    expect(storage.objects.size).toBe(10);
    for (const e of subset) {
      expect(storage.objects.has(originalKey(e.sourceId))).toBe(true);
      expect(storage.objects.has(thumbnailKey(e.sourceId))).toBe(true);
    }

    // 缩略图确实是 600px JPEG(与 imageUrl 路径质量一致)
    const thumbInfo = await sharp(storage.objects.get(thumbnailKey(subset[0].sourceId))!).metadata();
    expect(thumbInfo.width).toBe(600);
    expect(thumbInfo.format).toBe('jpeg');

    // 幂等: 重跑不产生重复行
    const again = await job.run(new CuratedImport(), subset);
    expect(again).toMatchObject({ total: 5, imported: 5 });
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM wallpapers');
    expect(rows[0].n).toBe(5);
  });

  it('真实 manifest 全量经 localFile 分支 dry-run: 校验通过且每条约 1 条输出', async () => {
    const manifest = readManifestFile(manifestPath);
    const job = makeJob(new MockObjectStorage());
    // dry-run 不下载/不上传/不落库(验收 1);全量清单零网络可跑
    const summary = await job.run(new CuratedImport(), manifest, { dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, total: 300, imported: 0, failed: 0, warnings: [] });
  });

  it('resume 语义在 localFile 分支同样成立(已入库跳过,不重新上传)', async () => {
    const manifest = readManifestFile(manifestPath);
    const subset = manifest.slice(5, 8);
    const storage = new MockObjectStorage();
    const job = makeJob(storage);

    await job.run(new CuratedImport(), subset);
    const firstUploads = storage.objects.size;
    expect(firstUploads).toBe(6); // 3 条 × 2

    const resumed = await job.run(new CuratedImport(), subset, { resume: true });
    expect(resumed).toMatchObject({ total: 3, resumed: 3, imported: 0 });
    expect(storage.objects.size).toBe(firstUploads); // 没有新增上传
  });

  it('localFile 损坏/缺失 → 单条失败跳过,其余继续导入(容错)', async () => {
    // 取真实清单一条作为「正常」基准(含有效 localFile),再复制两条改坏
    const base = readManifestFile(manifestPath)[0];
    expect(base.localFile).toBeTruthy();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-corrupt-'));
    try {
      // 损坏: 文件存在但内容不是图片(sharp 解析元数据会抛错)
      const corruptPath = path.join(tmpDir, 'corrupt.jpg');
      fs.writeFileSync(corruptPath, Buffer.from('this is definitely not an image'));
      // 缺失: localFile 指向不存在的文件(fs.readFile ENOENT)
      const missingPath = path.join(tmpDir, 'missing.jpg');

      const corruptEntry = { ...base, sourceId: 'cc-corrupt-bad', localFile: corruptPath };
      const missingEntry = { ...base, sourceId: 'cc-missing-bad', localFile: missingPath };
      const goodEntry = { ...base, sourceId: 'cc-corrupt-good', localFile: base.localFile };

      const storage = new MockObjectStorage();
      const job = makeJob(storage);
      const summary = await job.run(new CuratedImport(), [corruptEntry, missingEntry, goodEntry] as Manifest);

      // 两条坏条目计数为 failed,正常条目照常导入;整批不中断
      expect(summary).toMatchObject({ total: 3, imported: 1, failed: 2, blocked: 0 });
      // 告警里能定位到具体 sourceId(排查依据)
      expect(summary.warnings.some((w) => w.includes('cc-corrupt-bad'))).toBe(true);
      expect(summary.warnings.some((w) => w.includes('cc-missing-bad'))).toBe(true);

      // 坏条目不落库、不占存储
      expect(await repo.findBySourceAndSourceId('curated', 'cc-corrupt-bad')).toBeNull();
      expect(await repo.findBySourceAndSourceId('curated', 'cc-missing-bad')).toBeNull();
      expect(storage.objects.has(originalKey('cc-corrupt-bad'))).toBe(false);
      expect(storage.objects.has(originalKey('cc-missing-bad'))).toBe(false);

      // 正常条目正常入库 + 上传(容错不误伤)
      const good = await repo.findBySourceAndSourceId('curated', 'cc-corrupt-good');
      expect(good?.status).toBe('active');
      expect(storage.objects.has(originalKey('cc-corrupt-good'))).toBe(true);
      expect(storage.objects.has(thumbnailKey('cc-corrupt-good'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
