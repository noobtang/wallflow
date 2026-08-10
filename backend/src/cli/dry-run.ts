import path from 'node:path';
import { CuratedImport, readManifestFile } from '../sources/curated.import';

/**
 * 精选清单 dry-run(#3 验收): 只校验 manifest、输出规范化记录,不落库。
 * 用法: npm run import:dry-run [manifest 路径]
 */
const DEFAULT_MANIFEST = path.resolve(__dirname, '..', '..', '..', 'data', 'manifest.json');

async function main(): Promise<void> {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
  const manifest = readManifestFile(manifestPath);

  const importer = new CuratedImport();
  let count = 0;
  const byLicense = new Map<string, number>();
  const byCategory = new Map<string, number>();

  for await (const w of importer.read(manifest)) {
    count += 1;
    byLicense.set(w.license, (byLicense.get(w.license) ?? 0) + 1);
    byCategory.set(w.category, (byCategory.get(w.category) ?? 0) + 1);
    console.log(
      `[${String(count).padStart(2)}] ${w.license.padEnd(5)} ${String(w.width).padStart(5)}x${w.height} ` +
        `${w.category} 「${w.title}」 tags=${w.tags.join('/')} by ${w.creator}`
    );
  }

  console.log('');
  console.log(`✅ dry-run 完成: ${count} 条规范化输出(未落库)`);
  console.log(
    `许可分布: ${[...byLicense.entries()].map(([k, v]) => `${k}×${v}`).join(' / ')} | ` +
      `分类分布: ${[...byCategory.entries()].map(([k, v]) => `${k}×${v}`).join(' / ')}`
  );

  if (count === 0) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('dry-run 失败:', err);
  process.exit(1);
});
