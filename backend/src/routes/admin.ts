import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { AdminRepository } from '../repositories/admin.repository';
import { badRequest, notFound } from './wallpapers';

/** 回填暂停开关 key(#12): 调度器读取此 flag 决定是否跳过本轮回填 */
export const BACKFILL_PAUSED_FLAG = 'backfill_paused';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const reportIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * 管理接口(#12 运维补全): 隔离内容 / 审举报 / 暂停回填。
 * 鉴权: X-Admin-Key 与 env ADMIN_API_KEY 恒定时间比较;未配置 ADMIN_API_KEY → 全部 503
 * (管理面不上线就不暴露,避免空密钥误配)。响应形状沿用统一 { error } 错误体。
 */
export async function adminRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; adminApiKey: string },
): Promise<void> {
  if (!deps.adminApiKey) {
    app.get('/admin/health', async () => ({ configured: false }));
    // 未配置: 所有管理操作返回 503(显式提示,不给 404 误导排查)
    app.all('/admin/*', async () => {
      const err = new Error('ADMIN_API_KEY 未配置,管理接口不可用') as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    });
    return;
  }

  const admin = new AdminRepository(deps.pool);

  /** 恒定时间比较,防时序侧信道(密钥长度已知,无需定长再比较) */
  function isAuthorized(request: FastifyRequest): boolean {
    const header = request.headers['x-admin-key'];
    if (typeof header !== 'string' || header.length === 0) return false;
    if (header.length !== deps.adminApiKey.length) return false;
    let diff = 0;
    for (let i = 0; i < header.length; i++) {
      diff |= header.charCodeAt(i) ^ deps.adminApiKey.charCodeAt(i);
    }
    return diff === 0;
  }

  async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!isAuthorized(request)) {
      const err = new Error('管理员密钥无效') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
  }

  // 运维面板概览(健康检查/告警骨架: 一眼看关键指标)
  app.get('/admin/health', { preHandler: requireAdmin }, async () => {
    const [openReports, paused] = await Promise.all([
      admin.countOpenReports(),
      admin.getFlag(BACKFILL_PAUSED_FLAG, false),
    ]);
    return {
      configured: true,
      openReports,
      backfillPaused: paused,
    };
  });

  // ---- 隔离/恢复内容(版权投诉/违规下架的执行面) ----
  app.post('/admin/wallpapers/:id/block', { preHandler: requireAdmin }, async (request) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) throw badRequest('id 必须为正整数');
    const row = await admin.blockWallpaper(parsed.data.id);
    if (!row) throw notFound('壁纸不存在或已是隔离状态');
    return { id: row.id, status: row.status };
  });

  app.post('/admin/wallpapers/:id/restore', { preHandler: requireAdmin }, async (request) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) throw badRequest('id 必须为正整数');
    const row = await admin.restoreWallpaper(parsed.data.id);
    if (!row) throw notFound('壁纸不存在或已是 active');
    return { id: row.id, status: row.status };
  });

  // ---- 审举报(举报列表 + 处理) ----
  app.get('/admin/reports', { preHandler: requireAdmin }, async (request) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) throw badRequest('cursor/limit 非法');
    const page = await admin.listReports({
      limit: parsed.data.limit,
      cursor: parsed.data.cursor ?? null,
    });
    return {
      items: page.items.map((r) => ({
        id: r.id,
        userId: r.userId,
        reason: r.reason,
        createdAt: r.createdAt,
        wallpaper: {
          id: r.wallpaper.id,
          sourceId: r.wallpaper.sourceId,
          title: r.wallpaper.title,
          category: r.wallpaper.category,
          status: r.wallpaper.status,
          license: r.wallpaper.license,
        },
      })),
      nextId: page.nextId,
    };
  });

  // 处理举报: 下架或驳回后移除记录(幂等;不存在 → 404)
  app.delete('/admin/reports/:id', { preHandler: requireAdmin }, async (request) => {
    const parsed = reportIdParamsSchema.safeParse(request.params);
    if (!parsed.success) throw badRequest('id 必须为正整数');
    const removed = await admin.resolveReport(parsed.data.id);
    if (!removed) throw notFound('举报不存在');
    return { resolved: true };
  });

  // ---- 暂停/恢复回填(调度器读 flag,不中断正在运行的批次) ----
  app.post('/admin/backfill/pause', { preHandler: requireAdmin }, async () => {
    await admin.setFlag(BACKFILL_PAUSED_FLAG, true);
    return { paused: true };
  });

  app.post('/admin/backfill/resume', { preHandler: requireAdmin }, async () => {
    await admin.setFlag(BACKFILL_PAUSED_FLAG, false);
    return { paused: false };
  });
}
