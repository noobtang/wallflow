import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { AuthContext } from '../plugins/auth';
import { FavoriteRepository } from '../repositories/favorite.repository';
import type { WallpaperRow } from '../repositories/wallpaper.repository';
import { WallpaperRepository } from '../repositories/wallpaper.repository';
import { tokenizeQuery } from '../search/segmenter';
import { CATEGORIES } from '../sources/manifest.schema';
import type { ObjectStorage } from '../storage/object-storage';
import { decodeTsCursor, encodeTsCursor } from './cursor';

/** 抛出 4xx(错误处理器按 statusCode 透传 message,统一 { error } 响应形状) */
export function badRequest(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
}

/** 抛出 404(未知 id;code 回退为 HTTP_404) */
export function notFound(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 404;
  return err;
}

/** 复合游标: base64url("{rank},{id}") — rank 排序下 id 单独不足以保证翻页无重复 */
function encodeCursor(rank: number, id: number): string {
  return Buffer.from(`${rank},${id}`).toString('base64url');
}

function decodeCursor(raw: string): { rank: number; id: number } | null {
  try {
    const [rankStr, idStr] = Buffer.from(raw, 'base64url').toString().split(',');
    const rank = Number(rankStr);
    const id = Number(idStr);
    if (!Number.isFinite(rank) || !Number.isInteger(id) || id <= 0) return null;
    return { rank, id };
  } catch {
    return null;
  }
}


/** 对外响应形状(对齐规格 06 统一形状;不泄漏 status/searchText/source 等内部字段) */
export interface WallpaperListItem {
  id: number;
  title: string | null;
  thumbUrl: string;
  fullUrl: string;
  license: string;
  licenseUrl: string | null;
  creator: string | null;
  creatorUrl: string | null;
  width: number | null;
  height: number | null;
  tags: string[] | null;
  category: string | null;
}

function toListItem(row: WallpaperRow): WallpaperListItem {
  return {
    id: row.id,
    title: row.title,
    thumbUrl: row.thumbUrl,
    fullUrl: row.url,
    license: row.license,
    licenseUrl: row.licenseUrl,
    creator: row.creator,
    creatorUrl: row.creatorUrl,
    width: row.width,
    height: row.height,
    tags: row.tags,
    category: row.category,
  };
}

/** 对外列表项: DB 存对象 key → 签名直链(#9);Mock 返回 {baseUrl}/{key};供收藏列表复用 */
export function toSignedListItem(row: WallpaperRow, storage: ObjectStorage): WallpaperListItem {
  return {
    ...toListItem(row),
    thumbUrl: storage.getSignedUrl(row.thumbUrl),
    fullUrl: storage.getSignedUrl(row.url),
  };
}

const searchQuerySchema = z.object({
  // 空串/纯空白 → 分词后无 token,按纯过滤处理(前端清空输入框友好)
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const feedQuerySchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** 排序(2026-08-15): latest = 新到旧(默认,created_at);hot = 7 天行为热度 */
  sort: z.enum(['latest', 'hot']).default('latest'),
});

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const similarQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/** 详情响应 = 列表项 + is_favorited(#10: 带 token 返回真实收藏态,匿名 false) */
interface WallpaperDetail extends WallpaperListItem {
  is_favorited: boolean;
}

export async function wallpapersRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; storage: ObjectStorage; auth: AuthContext },
): Promise<void> {
  const repo = new WallpaperRepository(deps.pool);
  const favRepo = new FavoriteRepository(deps.pool);
  const { storage } = deps;

  /**
   * 全文搜索(#6): GET /wallpapers/search?q=&category=&tag=&cursor=&limit=
   * - q: 中文关键词,jieba 分词后走 GIN FTS(相关度排序)
   * - category/tag: 精确过滤(与 q 可组合)
   * - 分页: 复合 keyset 游标(rank,id),返回 nextCursor(下一页用)
   */
  app.get('/wallpapers/search', async (request) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(query)'}: ${i.message}`)
        .join('; ');
      throw badRequest(`搜索参数非法: ${details}`);
    }
    const { q, category, tag, limit } = parsed.data;

    let cursor: { rank: number; id: number } | null = null;
    if (parsed.data.cursor !== undefined) {
      cursor = decodeCursor(parsed.data.cursor);
      if (!cursor) throw badRequest('cursor 非法');
    }

    // 中文查询同样过 jieba 分词再匹配(规格 #5);无有效 token → 纯过滤
    const tsq = q !== undefined && q.length > 0 ? tokenizeQuery(q) : '';

    const { items, lastRank } = await repo.search({
      query: tsq.length > 0 ? tsq : null,
      category,
      tag,
      cursor,
      limit,
    });
    const mapped = items.map((row) => toSignedListItem(row, storage));
    const nextCursor =
      mapped.length === limit && mapped.length > 0
        ? encodeCursor(lastRank, mapped[mapped.length - 1].id)
        : null;
    return { items: mapped, nextCursor };
  });

  /**
   * 首页信息流/分类页(#7): GET /wallpapers?category=&sort=&cursor=&limit=
   * - sort=latest(默认): keyset 分页 (created_at, id),游标 base64url(createdAtUnixMs,id),非法 → 400
   * - sort=hot(2026-08-15): 7 天行为热度(下载/收藏加权)降序,游标 (score, id) 同构(rank,id)
   * - 只返回 active;默认 20 条;列表缓存 60s
   */
  app.get('/wallpapers', async (request, reply) => {
    const parsed = feedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(query)'}: ${i.message}`)
        .join('; ');
      throw badRequest(`信息流参数非法: ${details}`);
    }
    const { category, limit, sort } = parsed.data;
    let nextCursor: string | null = null;
    let rows: WallpaperRow[];

    if (sort === 'hot') {
      let cursor: { rank: number; id: number } | null = null;
      if (parsed.data.cursor !== undefined) {
        cursor = decodeCursor(parsed.data.cursor);
        if (!cursor) throw badRequest('cursor 非法');
      }
      const { items, lastScore } = await repo.listHot(category ?? null, { limit, cursor });
      rows = items;
      if (items.length === limit && items.length > 0) {
        // 复用 (rank,id) 游标编码: rank 即 hot_score(双精度文本往返精确)
        nextCursor = encodeCursor(lastScore, items[items.length - 1].id);
      }
    } else {
      let cursor: { createdAtMs: number; id: number } | null = null;
      if (parsed.data.cursor !== undefined) {
        cursor = decodeTsCursor(parsed.data.cursor);
        if (!cursor) throw badRequest('cursor 非法');
      }
      rows = await repo.listFeed(category ?? null, { limit, cursor });
      const last = rows[rows.length - 1];
      nextCursor =
        rows.length === limit && rows.length > 0
          ? encodeTsCursor(last.createdAt.getTime(), last.id)
          : null;
    }

    const mapped = rows.map((row) => toSignedListItem(row, storage));
    reply.header('Cache-Control', 'public, max-age=60');
    return { items: mapped, nextCursor };
  });

  /**
   * 详情(#7/#10): GET /wallpapers/:id
   * - 完整署名 + 许可字段;非 active(blocked/pending_review)与未知 id 一律 404
   * - is_favorited: 带 token 返回真实收藏态(optionalAuth,坏 token 视为匿名);匿名 false;详情缓存 300s
   */
  app.get('/wallpapers/:id', { preHandler: deps.auth.optionalAuth }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) throw badRequest('id 必须为正整数');
    const row = await repo.findById(parsed.data.id);
    if (!row || row.status !== 'active') throw notFound('壁纸不存在');
    const isFavorited = request.user ? await favRepo.isFavorited(request.user.sub, row.id) : false;
    const detail: WallpaperDetail = { ...toSignedListItem(row, storage), is_favorited: isFavorited };
    // 详情已个性化(is_favorited): 带 token 时禁共享缓存(RFC 9111: public 允许缓存带 Authorization 的响应,
    // 会把用户 A 的收藏态透给用户 B);匿名响应人人相同才可 public
    reply.header('Cache-Control', request.user ? 'private, max-age=300' : 'public, max-age=300');
    return detail;
  });

  /**
   * 相似推荐(#7): GET /wallpapers/:id/similar?limit=8
   * - 按与目标壁纸重叠标签数降序,排除自身;无标签 → 空列表
   */
  app.get('/wallpapers/:id/similar', async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) throw badRequest('id 必须为正整数');
    const query = similarQuerySchema.safeParse(request.query);
    if (!query.success) throw badRequest('limit 非法');
    const row = await repo.findById(params.data.id);
    if (!row || row.status !== 'active') throw notFound('壁纸不存在');
    const tags = row.tags ?? [];
    const items =
      tags.length > 0 ? await repo.findSimilarByTags(params.data.id, tags, query.data.limit) : [];
    reply.header('Cache-Control', 'public, max-age=60');
    return { items: items.map((row) => toSignedListItem(row, storage)) };
  });

  /** 分类列表(带计数,#7): GET /categories — 只返回有 active 壁纸的分类,按计数降序 */
  app.get('/categories', async (_request, reply) => {
    const counts = await repo.countByCategory();
    const items = Object.entries(counts).map(([name, count]) => ({ name, count }));
    reply.header('Cache-Control', 'public, max-age=60');
    return { items };
  });
}
