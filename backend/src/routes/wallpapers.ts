import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { WallpaperRow } from '../repositories/wallpaper.repository';
import { WallpaperRepository } from '../repositories/wallpaper.repository';
import { tokenizeQuery } from '../search/segmenter';
import { CATEGORIES } from '../sources/manifest.schema';

/** 抛出 4xx(错误处理器按 statusCode 透传 message,统一 { error } 响应形状) */
export function badRequest(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
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

const searchQuerySchema = z.object({
  // 空串/纯空白 → 分词后无 token,按纯过滤处理(前端清空输入框友好)
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function wallpapersRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool },
): Promise<void> {
  const repo = new WallpaperRepository(deps.pool);

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
    const mapped = items.map(toListItem);
    const nextCursor =
      mapped.length === limit && mapped.length > 0
        ? encodeCursor(lastRank, mapped[mapped.length - 1].id)
        : null;
    return { items: mapped, nextCursor };
  });
}
