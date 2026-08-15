import { describe, expect, it } from 'vitest';
import {
  buildAttribution,
  MODIFICATION_NOTE,
  needsModificationNote,
} from '../utils/attribution';
import type { WallpaperItem } from '../utils/types';

function wallpaper(overrides: Partial<WallpaperItem> = {}): WallpaperItem {
  return {
    id: 1,
    title: '测试壁纸',
    thumbUrl: 'https://cdn.example.com/thumb.jpg',
    fullUrl: 'https://cdn.example.com/full.jpg',
    license: 'CC BY',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    creator: '张三',
    creatorUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    width: 4000,
    height: 3000,
    tags: ['测试'],
    category: '风景',
    ...overrides,
  };
}

describe('attribution.ts 完整署名(#12)', () => {
  it('CC BY 输出完整署名: 标题/作者(含来源)/许可 URI/修改声明', () => {
    const text = buildAttribution(wallpaper());
    expect(text).toContain('作品: 测试壁纸');
    expect(text).toContain('作者: 张三(来源: https://commons.wikimedia.org/wiki/File:Test.jpg)');
    expect(text).toContain('许可: CC BY 许可(https://creativecommons.org/licenses/by/4.0/)');
    expect(text).toContain(`修改声明: ${MODIFICATION_NOTE}`);
  });

  it('CC BY 无 creatorUrl/licenseUrl 时优雅降级(不拼接空来源)', () => {
    const text = buildAttribution(wallpaper({ creatorUrl: null, licenseUrl: null }));
    expect(text).toContain('作者: 张三');
    expect(text).not.toContain('(来源: )');
    expect(text).toContain('许可: CC BY 许可');
  });

  it('CC0/PD 不强制署名: 无修改声明,保留来源信息', () => {
    const text = buildAttribution(wallpaper({ license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }));
    expect(text).toContain('作品: 测试壁纸');
    expect(text).toContain('作者: 张三');
    expect(text).toContain('许可: CC0 许可');
    expect(text).not.toContain('修改声明');
  });

  it('未知作者/空标题兜底', () => {
    const text = buildAttribution(wallpaper({ title: null, creator: null }));
    expect(text).toContain('作品: 未命名壁纸');
    expect(text).toContain('作者: 未知作者');
  });

  it('needsModificationNote: 仅 CC BY 为 true', () => {
    expect(needsModificationNote('CC BY')).toBe(true);
    expect(needsModificationNote('CC BY 3.0')).toBe(true);
    expect(needsModificationNote('CC0')).toBe(false);
    expect(needsModificationNote('PD')).toBe(false);
    expect(needsModificationNote(null)).toBe(false);
  });
});
