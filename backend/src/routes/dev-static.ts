import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

/** 扩展名 → Content-Type(dev 静态服务仅服务图片资产,见 #10 联调) */
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * dev 静态服务(#10 联调): 在开发环境把 FileObjectStorage 落盘的图片
 * (backend/.dev-storage)以 /dev-storage/* 暴露给本机,让微信开发者工具
 * (勾选「不校验合法域名」)能真实加载图片。
 * - 仅 NODE_ENV=development 且无 COS bucket 时注册(server.ts 判断)
 * - 路径遍历防护: 规范化后必须仍位于 dir 之内,否则 403
 */
export function registerDevStatic(app: FastifyInstance, dir: string): void {
  const root = path.resolve(dir);

  app.get<{ Params: { '*': string } }>('/dev-storage/*', async (req, reply) => {
    const key = req.params['*'];
    // 反斜杠/绝对路径/.. 一律拒绝;resolve 后必须仍在 root 内(路径遍历防护)
    if (!key || key.includes('\\') || key.includes('\0') || key.split('/').includes('..')) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    let data: Buffer;
    try {
      data = await fs.promises.readFile(file);
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
    const ext = path.extname(file).toLowerCase();
    reply.type(MIME[ext] ?? 'application/octet-stream').header('Cache-Control', 'public, max-age=3600');
    return reply.send(data);
  });
}
