import path from 'node:path';
import { loadConfig } from '../config';
import { createContentSafety } from '../content-safety/content-safety';
import { createPool } from '../db';
import { RateLimitedDownloader } from '../jobs/downloader';
import { ImportJob } from '../jobs/import.job';
import { WallpaperRepository } from '../repositories/wallpaper.repository';
import { CuratedImport, readManifestFile } from '../sources/curated.import';
import { createObjectStorage } from '../storage/object-storage';

/**
 * 精选导入 CLI(#4 验收 1/2)。
 * 用法: npm run import [--dry-run] [--resume] [--limit N] [manifest.json]
 *   - 默认: 全量导入(限速下载 → 内容安全 → 缩略图 → mock/COS 上传 → 幂等 upsert)
 *   - --dry-run: 只校验 manifest 并输出规范化记录,零副作用
 *   - --resume: 断点续导,已入库条目跳过(不重复下载/上传)
 *   - --limit N: 冒烟用,只处理前 N 条
 */
const DEFAULT_MANIFEST = path.resolve(__dirname, '..', '..', '..', 'data', 'manifest.json');

interface CliArgs {
  dryRun: boolean;
  resume: boolean;
  limit: number | undefined;
  manifestPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, resume: false, limit: undefined, manifestPath: DEFAULT_MANIFEST };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--resume') out.resume = true;
    else if (arg === '--limit') out.limit = Number(argv[++i]);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else out.manifestPath = arg;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    console.error('用法: npm run import [--dry-run] [--limit N] [manifest.json]\n  --limit 必须是正整数');
    process.exitCode = 1;
    return;
  }
  const manifest = readManifestFile(args.manifestPath);
  const importer = new CuratedImport();

  // dry-run: 与 #3 import:dry-run 语义一致,只校验 manifest,不要求 DATABASE_URL/不联网
  if (args.dryRun) {
    let count = 0;
    const byLicense = new Map<string, number>();
    for await (const w of importer.read(manifest)) {
      count += 1;
      byLicense.set(w.license, (byLicense.get(w.license) ?? 0) + 1);
    }
    console.log(`✅ dry-run: manifest 校验通过,共 ${count} 条规范化记录(未下载/未落库)`);
    console.log(`许可分布: ${[...byLicense.entries()].map(([k, v]) => `${k}×${v}`).join(' / ')}`);
    process.exitCode = count > 0 ? 0 : 1;
    return;
  }

  const config = loadConfig();
  const pool = createPool(config);
  try {
    const job = new ImportJob({
      pool,
      repository: new WallpaperRepository(pool),
      downloader: new RateLimitedDownloader({
        // data/README 实测: 原图直链 429 限流 → 1.5s 请求间隔 + 指数退避
        userAgent: 'wallflow-import/0.1 (curated manifest; github.com/noobtang/wallflow)',
        minIntervalMs: 1500,
        retryBaseMs: 2000,
        maxRetries: 5,
      }),
      storage: createObjectStorage(config),
      safety: createContentSafety(config),
    });

    const summary = await job.run(importer, manifest, {
      limit: args.limit,
      resume: args.resume,
    });

    console.log('\n=== 导入摘要 ===');
    console.log(
      JSON.stringify(
        { ...summary, warnings: summary.warnings.slice(0, 20), warningCount: summary.warnings.length },
        null,
        2,
      ),
    );

    if (summary.locked) {
      console.error('另一个导入实例正在运行,本次退出');
      process.exitCode = 1;
    } else if (summary.total === 0) {
      console.error('清单为空(或全部被校验层跳过),无可导入条目');
      process.exitCode = 1;
    } else if (summary.failed === summary.total) {
      console.error('全部条目失败');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('import 失败:', err);
  process.exit(1);
});
