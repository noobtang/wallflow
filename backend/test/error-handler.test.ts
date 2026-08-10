import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../src/plugins/error-handler';

describe('registerErrorHandler (统一错误映射)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  function build(): FastifyInstance {
    const instance = Fastify();
    registerErrorHandler(instance);
    return instance;
  }

  it('passes through 4xx message with HTTP-based code', async () => {
    app = build();
    app.get('/boom', async () => {
      const err = new Error('Not found');
      (err as Error & { statusCode: number }).statusCode = 404;
      throw err;
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'HTTP_404', message: 'Not found' } });
  });

  it('masks 5xx messages and returns 500 shape', async () => {
    app = build();
    app.get('/boom', async () => {
      throw new Error('secret internal detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('secret');
  });

  it('unifies unknown-route 404 into the same error shape', async () => {
    app = build();
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /no-such-route not found' },
    });
  });
});
