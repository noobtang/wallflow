import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { MockContentSafety } from '../../src/content-safety/content-safety';
import { RateLimitedDownloader } from '../../src/jobs/downloader';
import { ADVISORY_LOCK_KEY, ImportJob, type Logger } from '../../src/jobs/import.job';
import { WallpaperRepository } from '../../src/repositories/wallpaper.repository';
import { CuratedImport } from '../../src/sources/curated.import';
import type { Manifest } from '../../src/sources/manifest.schema';
import { MockObjectStorage, originalKey, thumbnailKey } from '../../src/storage/object-storage';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

function makeEntry(sourceId: string, imageUrl: string, category = '风景'): unknown {
  return {
    sourceId,
    title: `测试壁纸 ${sourceId}`,
    imageUrl,
    category,
    tags: ['测试', category],
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    creator: 'Tester',
    creatorUrl: 'https://example.com/creator',
    width: 1920,
    height: 1080,
  };
}

describe('ImportJob(#4 导入流水线)', () => {
  let server: Server;
  let base: string;
  let jpeg1600x900: Buffer;
  let pool: pg.Pool;
  let repo: WallpaperRepository;

  beforeAll(async () => {
    jpeg1600x900 = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path === '/img-1.jpg' || path === '/img-2.jpg' || path === '/img-3.jpg') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(jpeg1600x900);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    pool = await createTestPool();
    await runMigrations();
    repo = new WallpaperRepository(pool);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  function makeJob(opts: { safety?: MockContentSafety; storage?: MockObjectStorage } = {}) {
    const downloader = new RateLimitedDownloader({
      minIntervalMs: 0,
      retryBaseMs: 10,
      maxRetries: 2,
    });
    return new ImportJob({
      pool,
      repository: repo,
      downloader,
      storage: opts.storage ?? new MockObjectStorage(),
      safety: opts.safety ?? new MockContentSafety('allow'),
      logger: silentLogger,
    });
  }

  it('导入 3 条 → 全部 active,字段完整,实际尺寸入库,COS 对象 6 个(验收 2/9)', async () => {
    const storage = new MockObjectStorage();
    const job = makeJob({ storage });
    const manifest = [
      makeEntry('cc-int-1', `${base}/img-1.jpg`),
      makeEntry('cc-int-2', `${base}/img-2.jpg`),
      makeEntry('cc-int-3', `${base}/img-3.jpg`),
    ] as Manifest;

    const summary = await job.run(new CuratedImport(), manifest);
    expect(summary).toMatchObject({ locked: false, total: 3, imported: 3, failed: 0, blocked: 0 });

    const row = await repo.findBySourceAndSourceId('curated', 'cc-int-1');
    expect(row).toMatchObject({
      status: 'active',
      license: 'CC0',
      category: '风景',
      tags: ['测试', '风景'],
      title: '测试壁纸 cc-int-1',
    });
    // 实际文件尺寸(1600x900)覆盖清单声明(1920x1080)
    expect(row?.width).toBe(1600);
    expect(row?.height).toBe(900);
    // 上传后 URL 指向存储对象
    expect(row?.url).toBe('wallpapers/cc-int-1.jpg'); // #9: DB 存对象 key
    expect(row?.thumbUrl).toBe('wallpapers/cc-int-1_thumb.jpg');

    // 原图 + 缩略图均上传
    expect(storage.objects.size).toBe(6);
    expect(storage.objects.has(originalKey('cc-int-1'))).toBe(true);
    expect(storage.objects.has(thumbnailKey('cc-int-1'))).toBe(true);

    // 缩略图确实是 600px 宽 JPEG(验收 9 质量侧)
    const thumbInfo = await sharp(storage.objects.get(thumbnailKey('cc-int-1'))!).metadata();
    expect(thumbInfo.width).toBe(600);
    expect(thumbInfo.format).toBe('jpeg');
  });

  it('幂等: 重跑无重复数据,断点续导安全(验收 3)', async () => {
    const job = makeJob();
    const manifest = [
      makeEntry('cc-idem-1', `${base}/img-1.jpg`),
      makeEntry('cc-idem-2', `${base}/img-2.jpg`),
    ] as Manifest;

    const first = await job.run(new CuratedImport(), manifest);
    const second = await job.run(new CuratedImport(), manifest);
    expect(first.imported).toBe(2);
    expect(second.imported).toBe(2);

    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM wallpapers',
    );
    expect(rows[0].n).toBe(2); // 无重复行
  });

  it('单条 404 → 跳过继续,其余导入(验收 4)', async () => {
    const job = makeJob();
    const manifest = [
      makeEntry('cc-ok-1', `${base}/img-1.jpg`),
      makeEntry('cc-missing', `${base}/missing.jpg`),
      makeEntry('cc-ok-2', `${base}/img-2.jpg`),
    ] as Manifest;

    const summary = await job.run(new CuratedImport(), manifest);
    expect(summary).toMatchObject({ total: 3, imported: 2, failed: 1 });
    expect(summary.warnings.some((w) => w.includes('cc-missing'))).toBe(true);
    expect(await repo.findBySourceAndSourceId('curated', 'cc-ok-1')).not.toBeNull();
    expect(await repo.findBySourceAndSourceId('curated', 'cc-missing')).toBeNull();
  });

  it('内容违规 → status=blocked,不进用户可见流,不占用存储(验收 5)', async () => {
    const storage = new MockObjectStorage();
    const job = makeJob({ safety: new MockContentSafety('block'), storage });
    const manifest = [makeEntry('cc-bad-1', `${base}/img-1.jpg`)] as Manifest;

    const summary = await job.run(new CuratedImport(), manifest);
    expect(summary).toMatchObject({ imported: 0, blocked: 1 });

    const row = await repo.findBySourceAndSourceId('curated', 'cc-bad-1');
    expect(row?.status).toBe('blocked');
    expect(await repo.listActive({ limit: 10 })).toHaveLength(0); // 用户可见流不含 blocked
    expect(storage.objects.size).toBe(0); // 检测失败,上传前拦截
  });

  it('检测不可用 → 放行 + pending_review,不入可见流(降级策略,验收 6)', async () => {
    const storage = new MockObjectStorage();
    const job = makeJob({ safety: new MockContentSafety('degrade'), storage });
    const manifest = [makeEntry('cc-pending-1', `${base}/img-1.jpg`)] as Manifest;

    const summary = await job.run(new CuratedImport(), manifest);
    expect(summary).toMatchObject({ imported: 0, pendingReview: 1 });

    const row = await repo.findBySourceAndSourceId('curated', 'cc-pending-1');
    expect(row?.status).toBe('pending_review');
    expect(await repo.listActive({ limit: 10 })).toHaveLength(0);
    expect(storage.objects.size).toBe(2); // 降级 = 放行,原图+缩略图照常上传
  });

  it('序列化锁: 已有实例在跑 → 本次跳过(验收 7)', async () => {
    const lockClient = await pool.connect();
    try {
      const { rows } = await lockClient.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok',
        [ADVISORY_LOCK_KEY],
      );
      expect(rows[0]?.ok).toBe(true);

      const job = makeJob();
      const manifest = [makeEntry('cc-lock-1', `${base}/img-1.jpg`)] as Manifest;
      const summary = await job.run(new CuratedImport(), manifest);
      expect(summary.locked).toBe(true);
      expect(summary.imported).toBe(0);
      expect(await repo.findBySourceAndSourceId('curated', 'cc-lock-1')).toBeNull();
    } finally {
      await lockClient
        .query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
        .catch(() => undefined);
      lockClient.release();
    }

    // 释放后重跑成功
    const summary = await makeJob().run(new CuratedImport(), [makeEntry('cc-lock-1', `${base}/img-1.jpg`)] as Manifest);
    expect(summary.imported).toBe(1);
  });

  it('dry-run: 只校验 manifest,不落库不下载(验收 1)', async () => {
    const storage = new MockObjectStorage();
    const job = makeJob({ storage });
    const manifest = [makeEntry('cc-dry-1', `${base}/img-1.jpg`)] as Manifest;

    const summary = await job.run(new CuratedImport(), manifest, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.total).toBe(1);
    expect(summary.imported).toBe(0);
    expect(storage.objects.size).toBe(0);
    expect(await repo.findBySourceAndSourceId('curated', 'cc-dry-1')).toBeNull();
  });

  it('categories 计数随导入更新(验收 8)', async () => {
    const job = makeJob();
    const manifest = [
      makeEntry('cc-cat-1', `${base}/img-1.jpg`, '风景'),
      makeEntry('cc-cat-2', `${base}/img-2.jpg`, '风景'),
      makeEntry('cc-cat-3', `${base}/img-3.jpg`, '星空'),
    ] as Manifest;
    await job.run(new CuratedImport(), manifest);

    expect(await repo.countByCategory()).toEqual({ 风景: 2, 星空: 1 });
  });

  it('resume: 已入库条目跳过,不重复下载/上传(断点续导,验收 3)', async () => {
    const storage = new MockObjectStorage();
    const job = makeJob({ storage });
    const manifest = [
      makeEntry('cc-res-1', `${base}/img-1.jpg`),
      makeEntry('cc-res-2', `${base}/img-2.jpg`),
    ] as Manifest;

    await job.run(new CuratedImport(), manifest);
    const firstUploads = storage.objects.size;

    // 重跑 resume: 两条均已存在 → 全部跳过,不重新下载/上传
    const summary = await job.run(new CuratedImport(), manifest, { resume: true });
    expect(summary).toMatchObject({ total: 2, resumed: 2, imported: 0, failed: 0 });
    expect(storage.objects.size).toBe(firstUploads); // 没有新的上传

    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM wallpapers',
    );
    expect(rows[0].n).toBe(2);

    // 混合: 1 条已存在 + 1 条新 → resumed 1 / imported 1
    const mixed = await job.run(
      new CuratedImport(),
      [
        makeEntry('cc-res-1', `${base}/img-1.jpg`),
        makeEntry('cc-res-3', `${base}/img-3.jpg`),
      ] as Manifest,
      { resume: true },
    );
    expect(mixed).toMatchObject({ total: 2, resumed: 1, imported: 1 });
  });

  it('--limit: 只处理前 N 条(冒烟)', async () => {
    const job = makeJob();
    const manifest = [
      makeEntry('cc-lim-1', `${base}/img-1.jpg`),
      makeEntry('cc-lim-2', `${base}/img-2.jpg`),
      makeEntry('cc-lim-3', `${base}/img-3.jpg`),
    ] as Manifest;
    const summary = await job.run(new CuratedImport(), manifest, { limit: 2 });
    expect(summary.total).toBe(2);
    expect(summary.imported).toBe(2);
    expect(await repo.findBySourceAndSourceId('curated', 'cc-lim-3')).toBeNull();
  });
});
