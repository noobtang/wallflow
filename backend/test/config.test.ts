import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig (zod env validation)', () => {
  it('throws with clear error when DATABASE_URL is missing', () => {
    // 缺失值: zod 报 "DATABASE_URL: Required"(带字段路径,清晰可定位)
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('throws custom message when DATABASE_URL is empty', () => {
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow(/DATABASE_URL is required/);
  });

  it('applies defaults (PORT=3000, NODE_ENV=development)', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
  });

  it('coerces PORT from string', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x', PORT: '8080' });
    expect(cfg.PORT).toBe(8080);
  });

  it('rejects invalid PORT', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' })).toThrow();
  });

  it('forbids default JWT_SECRET in production', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production' }),
    ).toThrow(/JWT_SECRET must be set in production/);
  });

  it('accepts explicit JWT_SECRET in production', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'postgres://x',
      NODE_ENV: 'production',
      JWT_SECRET: 'real-secret',
    });
    expect(cfg.JWT_SECRET).toBe('real-secret');
  });
});
