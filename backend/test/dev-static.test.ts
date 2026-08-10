import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerDevStatic } from '../src/routes/dev-static';

describe('dev 静态服务(#10 联调: /dev-storage/*)', () => {
  let dir: string;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-devstatic-'));
    fs.mkdirSync(path.join(dir, 'wallpapers'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'wallpapers', 'cc-a.jpg'), Buffer.from('JPEGBYTES'));
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'top-secret');
    app = Fastify();
    registerDevStatic(app, dir);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('正常路径: 返回图片字节 + image/jpeg + 缓存头', async () => {
    const res = await app.inject({ method: 'GET', url: '/dev-storage/wallpapers/cc-a.jpg' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('JPEGBYTES');
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['cache-control']).toContain('max-age=3600');
  });

  it('不存在 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/dev-storage/wallpapers/nope.jpg' });
    expect(res.statusCode).toBe(404);
  });

  it('路径遍历(../) → 拦截(Fastify 路由层规范化,403/404 均可,核心是不泄露文件)', async () => {
    const res = await app.inject({ method: 'GET', url: '/dev-storage/../secret.txt' });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('top-secret');
  });

  it('URL 编码的 .. 绕过 → 仍拦截(解码后路径规范化,读不到目录外)', async () => {
    const res = await app.inject({ method: 'GET', url: '/dev-storage/%2e%2e/secret.txt' });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('top-secret');
  });

  it('反斜杠路径 → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/dev-storage/..%5Csecret.txt' });
    expect(res.statusCode).toBe(403);
  });
});
