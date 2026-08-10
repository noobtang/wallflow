import { describe, expect, it } from 'vitest';
import { buildSearchText, segment, SYNONYMS, tokenizeQuery } from '../../src/search/segmenter';

describe('segmenter(#6 分词)', () => {
  it('jieba 完整词典: 中文短语切分为有意义的词(非单字)', () => {
    const tokens = segment('银河星空长卷');
    expect(tokens).toContain('银河');
    expect(tokens).toContain('星空');
    expect(tokens).toContain('长卷');
    // 不按单字切分(默认小词典行为)
    expect(tokens).not.toContain('银');
  });

  it('停用词被过滤(和/的 等,避免 tsquery AND 被虚词拖死)', () => {
    const tokens = segment('风景和城市');
    expect(tokens).toEqual(['风景', '城市']);
    expect(segment('美丽的夜空')).not.toContain('的');
  });

  it('标点/空白/单 ASCII 字母被过滤', () => {
    expect(segment('星空, 银河!')).toEqual(['星空', '银河']);
    expect(segment('a b c')).toEqual([]);
  });

  it('英文保留(小写化由 simple 分词器在 DB 侧完成)', () => {
    expect(segment('Misty Fjord')).toEqual(['Misty', 'Fjord']);
  });

  it('buildSearchText: 标题分词 + 标签 + 分类原词 + 分类同义词,去重空格分隔', () => {
    const text = buildSearchText('银河星空长卷', ['星空', '银河'], '星空');
    const tokens = text.split(' ');
    expect(tokens).toContain('星空');
    expect(tokens).toContain('银河');
    expect(tokens).toContain('长卷');
    expect(tokens).toContain('stars'); // 同义词
    expect(tokens).toContain('galaxy');
    expect(new Set(tokens).size).toBe(tokens.length); // 去重
    expect(tokens.includes('星空')).toBe(true); // 分类原词
  });

  it('buildSearchText: 风景分类附加 landscape/nature 同义词(验收 1)', () => {
    const text = buildSearchText('山间湖泊', ['风景', '山'], '风景');
    for (const syn of SYNONYMS['风景']) {
      expect(text.split(' ')).toContain(syn);
    }
    expect(text.split(' ')).toContain('风景');
  });

  it('tokenizeQuery: 查询侧同样分词 + 去停用词', () => {
    expect(tokenizeQuery('风景和城市')).toBe('风景 城市');
    expect(tokenizeQuery('  星空 银河  ')).toBe('星空 银河');
    expect(tokenizeQuery('!!!')).toBe(''); // 纯标点 → 空(路由层按纯过滤处理)
  });
});
