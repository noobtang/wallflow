import { describe, expect, it } from 'vitest';
import { hashIdentity, signToken, verifyToken } from '../../src/auth/tokens';

describe('会话令牌(#10 tokens)', () => {
  const SECRET = 'test-secret';

  it('hashIdentity: 确定性,不同 rawId/不同 secret 不同结果(64 hex)', () => {
    const a1 = hashIdentity(SECRET, 'wx:openid-1');
    const a2 = hashIdentity(SECRET, 'wx:openid-1');
    expect(a1).toBe(a2); // 同身份永远同 user_id
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdentity(SECRET, 'wx:openid-2')).not.toBe(a1); // 不同身份隔离
    expect(hashIdentity('other-secret', 'wx:openid-1')).not.toBe(a1); // 轮换密钥即失效
    // 身份空间前缀隔离: 匿名 device 与 openid 不碰撞
    expect(hashIdentity(SECRET, 'anon:openid-1')).not.toBe(a1);
  });

  it('sign/verify 往返: sub/kind 保留', () => {
    const token = signToken(SECRET, { sub: 'u-abc', kind: 'wechat' });
    expect(verifyToken(SECRET, token)).toEqual({ sub: 'u-abc', kind: 'wechat' });

    const anon = signToken(SECRET, { sub: 'u-def', kind: 'anon' });
    expect(verifyToken(SECRET, anon)).toEqual({ sub: 'u-def', kind: 'anon' });
  });

  it('过期 token → null(verifyToken 不抛)', () => {
    const token = signToken(SECRET, { sub: 'u-x', kind: 'anon' }, -1);
    expect(verifyToken(SECRET, token)).toBeNull();
  });

  it('篡改/错误密钥/垃圾输入 → null', () => {
    const token = signToken(SECRET, { sub: 'u-x', kind: 'anon' });
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyToken(SECRET, tampered)).toBeNull();
    expect(verifyToken('wrong-secret', token)).toBeNull();
    expect(verifyToken(SECRET, 'not-a-jwt')).toBeNull();
    expect(verifyToken(SECRET, '')).toBeNull();
  });
});
