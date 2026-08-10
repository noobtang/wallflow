import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { WechatClient } from '../../src/auth/wechat';
import { verifyToken } from '../../src/auth/tokens';
import { buildServer } from '../../src/server';
import { createTestPool, runMigrations, truncateAll } from '../helpers/db';

/** fake 微信: code='bad-code' → 无效 code;其余 → 固定 openid 映射 */
function fakeWechat(): WechatClient {
  return {
    code2Session: async (code: string) => {
      if (code === 'bad-code') return { ok: false, errcode: 40029, errmsg: 'invalid code' };
      return { ok: true, openid: `openid-${code}` };
    },
  };
}

const JWT_SECRET = 'test-jwt-secret';

describe('鉴权(#10 路由)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createTestPool();
    await runMigrations();
    await truncateAll(pool);
    app = await buildServer({ pool, wechat: fakeWechat(), jwtSecret: JWT_SECRET });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('POST /auth/login: mock code → 200 返回 JWT(可解出 HMAC 化的 user_id)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { code: 'mock-code-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('wechat');
    expect(body.expiresIn).toBe(7200);
    const payload = verifyToken(JWT_SECRET, body.token);
    expect(payload).not.toBeNull();
    expect(payload!.kind).toBe('wechat');
    expect(payload!.sub).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同一 openid 两次登录 → 相同 user_id(身份稳定)', async () => {
    const a = (await app.inject({ method: 'POST', url: '/auth/login', payload: { code: 'same' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/auth/login', payload: { code: 'same' } })).json();
    expect(verifyToken(JWT_SECRET, a.token)!.sub).toBe(verifyToken(JWT_SECRET, b.token)!.sub);
  });

  it('code 无效(errcode 40029)→ 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { code: 'bad-code' } });
    expect(res.statusCode).toBe(401);
  });

  it('code 缺失/非法 → 400', async () => {
    const noCode = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(noCode.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: '/auth/login', payload: { code: '' } });
    expect(empty.statusCode).toBe(400);
  });

  it('POST /auth/anon: 合法 UUID → 200;不同 device 不同 user_id;非法 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/anon',
      payload: { device_id: '3f3f0f0f-0000-4000-8000-000000000001' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('anon');
    const payload = verifyToken(JWT_SECRET, body.token);
    expect(payload!.kind).toBe('anon');

    const res2 = await app.inject({
      method: 'POST',
      url: '/auth/anon',
      payload: { device_id: '3f3f0f0f-0000-4000-8000-000000000002' },
    });
    expect(verifyToken(JWT_SECRET, res2.json().token)!.sub).not.toBe(payload!.sub);

    const bad = await app.inject({ method: 'POST', url: '/auth/anon', payload: { device_id: 'not-a-uuid' } });
    expect(bad.statusCode).toBe(400);
  });

  it('未配置微信凭证(wechat=null)→ login 503', async () => {
    const appNoWechat = await buildServer({ pool, wechat: null, jwtSecret: JWT_SECRET });
    try {
      const res = await appNoWechat.inject({ method: 'POST', url: '/auth/login', payload: { code: 'x' } });
      expect(res.statusCode).toBe(503);
    } finally {
      await appNoWechat.close();
    }
  });

  it('DB 无明文: 登录后的 user_id 是 64-hex 哈希,不含 openid 明文', async () => {
    const { token } = (await app.inject({ method: 'POST', url: '/auth/login', payload: { code: 'plain-check' } })).json();
    const payload = verifyToken(JWT_SECRET, token)!;
    expect(payload.sub).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.sub).not.toContain('plain-check');
    expect(payload.sub).not.toContain('openid-plain-check');
  });
});
