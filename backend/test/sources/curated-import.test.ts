import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CuratedImport, readManifestFile } from '../../src/sources/curated.import';
import type { Manifest } from '../../src/sources/manifest.schema';
import type { NormalizedWallpaper, SourcePort } from '../../src/sources/source.interface';

const validEntry = {
  sourceId: 'test-001',
  title: '测试壁纸',
  imageUrl: 'https://example.com/a.jpg',
  category: '风景',
  tags: ['风景', '测试'],
  license: 'CC0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  creator: 'TestCreator',
  creatorUrl: 'https://example.com/creator',
  width: 1920,
  height: 1080,
};

async function collect(importer: CuratedImport, manifest: Manifest): Promise<NormalizedWallpaper[]> {
  const out: NormalizedWallpaper[] = [];
  for await (const w of importer.read(manifest)) {
    out.push(w);
  }
  return out;
}

describe('CuratedImport', () => {
  it('10 行有效 manifest → 产出 10 条规范化记录,零告警(验收 1)', async () => {
    const manifest = Array.from({ length: 10 }, (_, i) => ({
      ...validEntry,
      sourceId: `test-${String(i + 1).padStart(3, '0')}`,
    })) as Manifest;

    const warnings: string[] = [];
    const out = await collect(new CuratedImport({ onWarning: (m) => warnings.push(m) }), manifest);

    expect(out).toHaveLength(10);
    expect(warnings).toHaveLength(0);
    expect(out[0]).toMatchObject({
      sourceId: 'test-001',
      license: 'CC0',
      category: '风景',
      width: 1920,
      height: 1080,
      tags: ['风景', '测试'],
    });
    expect(out[9].sourceId).toBe('test-010');
  });

  it('许可不在白名单(CC BY-SA)→ 拒绝(验收 2)', async () => {
    const bad = { ...validEntry, sourceId: 'test-bad-license', license: 'CC BY-SA' };

    const warnings: string[] = [];
    const out = await collect(new CuratedImport({ onWarning: (m) => warnings.push(m) }), [bad] as Manifest);

    expect(out).toHaveLength(0);
    expect(warnings.some((m) => m.includes('license'))).toBe(true);
  });

  it('畸形行(缺字段/类型错)→ 跳过且不中断整体,告警逐条输出(验收 3)', async () => {
    const manifest = [
      { ...validEntry, sourceId: 'test-ok-1' },
      { ...validEntry, sourceId: 'test-bad-title', title: undefined },
      { ...validEntry, sourceId: 'test-bad-width', width: '1080' },
      { ...validEntry, sourceId: 'test-ok-2' },
    ] as unknown as Manifest;

    const warnings: string[] = [];
    const out = await collect(new CuratedImport({ onWarning: (m) => warnings.push(m) }), manifest);

    expect(out).toHaveLength(2);
    expect(out.map((w) => w.sourceId)).toEqual(['test-ok-1', 'test-ok-2']);
    // 2 条畸形各告警一次 + 末尾汇总一次
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('test-bad-title');
    expect(warnings[1]).toContain('test-bad-width');
  });

  it('imageUrl 与 localFile 均缺失 → 拒绝', async () => {
    const warnings: string[] = [];
    const out = await collect(
      new CuratedImport({ onWarning: (m) => warnings.push(m) }),
      [{ ...validEntry, sourceId: 'test-no-image', imageUrl: undefined }] as Manifest
    );

    expect(out).toHaveLength(0);
    expect(warnings[0]).toContain('imageUrl');
  });

  it('manifest 非数组 → 不产出任何记录 + 告警', async () => {
    const warnings: string[] = [];
    const out = await collect(
      new CuratedImport({ onWarning: (m) => warnings.push(m) }),
      { not: 'an array' } as unknown as Manifest
    );

    expect(out).toHaveLength(0);
    expect(warnings[0]).toContain('不是数组');
  });

  it('SourcePort 契约完整: CuratedImport 可作为 SourcePort 使用(验收 4)', () => {
    const port: SourcePort = new CuratedImport();
    expect(typeof port.read).toBe('function');
    expect(port).toBeInstanceOf(CuratedImport);
  });

  it('readManifestFile: 文件缺失时抛出清晰错误', () => {
    expect(() => readManifestFile('/nonexistent/manifest.json')).toThrow();
  });

  it('集成: 读取仓库真实 data/manifest.json,全量通过导入', async () => {
    const manifestPath = path.resolve(__dirname, '..', '..', '..', 'data', 'manifest.json');
    const manifest = readManifestFile(manifestPath);
    expect(manifest.length).toBeGreaterThan(0);

    const warnings: string[] = [];
    const out = await collect(new CuratedImport({ onWarning: (m) => warnings.push(m) }), manifest);

    // 数量与文件自洽(扩量后零改动)
    expect(out).toHaveLength(manifest.length);
    expect(warnings).toHaveLength(0);
    // 每条的必需字段都非空、许可均在白名单、source 标记正确
    for (const w of out) {
      expect(w.source).toBe('curated');
      expect(w.sourceId.length).toBeGreaterThan(0);
      expect(w.title.length).toBeGreaterThan(0);
      expect(['CC0', 'CC BY', 'PD']).toContain(w.license);
      expect(w.tags.length).toBeGreaterThan(0);
      expect(w.width).toBeGreaterThan(0);
      expect(w.height).toBeGreaterThan(0);
      expect(w.imageUrl).toMatch(/^https:\/\//);
      expect(w.creatorUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });
});
