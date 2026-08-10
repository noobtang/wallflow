import type pg from 'pg';
import type { NormalizedWallpaper } from '../sources/source.interface';

/** wallpapers 行(数据库列 → camelCase 映射) */
export interface WallpaperRow {
  id: number;
  source: string;
  sourceId: string;
  title: string | null;
  url: string;
  thumbUrl: string;
  license: string;
  licenseUrl: string | null;
  creator: string | null;
  creatorUrl: string | null;
  width: number | null;
  height: number | null;
  tags: string[] | null;
  searchText: string | null;
  category: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 入库输入(与 Row 解耦: 导入 #4 与 API #6 可各自构造) */
export interface WallpaperUpsertInput {
  source: string;
  sourceId: string;
  title?: string | null;
  url: string;
  thumbUrl: string;
  license: string;
  licenseUrl?: string | null;
  creator?: string | null;
  creatorUrl?: string | null;
  width?: number | null;
  height?: number | null;
  tags?: string[] | null;
  searchText?: string | null;
  category?: string | null;
  status?: string;
}

/**
 * 从 CuratedImport 输出映射为入库输入(#3 → #4 衔接)。
 * 缩略图未生成前回退原图 URL,#4 用 sharp 生成 600px 缩略图后替换 thumbUrl。
 * search_text 先用「标题 + 标签」占位,#6 接入 jieba 预分词。
 * 注意: 仅 localFile 的条目 url 用 localFile 兜底;#4 真实导入时总是先转存 COS 再调 upsert。
 */
export function fromNormalizedWallpaper(w: NormalizedWallpaper): WallpaperUpsertInput {
  const imageUrl = w.imageUrl ?? w.localFile ?? '';
  return {
    source: w.source,
    sourceId: w.sourceId,
    title: w.title,
    url: imageUrl,
    thumbUrl: imageUrl,
    license: w.license,
    licenseUrl: w.licenseUrl,
    creator: w.creator,
    creatorUrl: w.creatorUrl,
    width: w.width,
    height: w.height,
    tags: w.tags,
    category: w.category,
    searchText: [w.title, ...w.tags].join(' '),
  };
}

const ROW_COLUMNS = `id, source, source_id AS "sourceId", title, url, thumb_url AS "thumbUrl",
  license, license_url AS "licenseUrl", creator, creator_url AS "creatorUrl",
  width, height, tags, search_text AS "searchText", category, status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** 行 → 领域类型(列已别名映射,这里做显式收尾与空值处理) */
function mapRow(row: pg.QueryResultRow): WallpaperRow {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    title: row.title ?? null,
    url: row.url,
    thumbUrl: row.thumbUrl,
    license: row.license,
    licenseUrl: row.licenseUrl ?? null,
    creator: row.creator ?? null,
    creatorUrl: row.creatorUrl ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    tags: row.tags ?? null,
    searchText: row.searchText ?? null,
    category: row.category ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PageOptions {
  limit: number;
  /** keyset 游标(上一页最后一条的 id);null = 第一页 */
  cursor?: number | null;
}

/** 只读内容查询 + 幂等写入(#3/#4/#6 共用) */
export class WallpaperRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** 幂等写入: ON CONFLICT (source, source_id) 全量更新,返回完整行 */
  async upsert(input: WallpaperUpsertInput): Promise<WallpaperRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO wallpapers
         (source, source_id, title, url, thumb_url, license, license_url, creator, creator_url,
          width, height, tags, search_text, category, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (source, source_id) DO UPDATE SET
         title = EXCLUDED.title,
         url = EXCLUDED.url,
         thumb_url = EXCLUDED.thumb_url,
         license = EXCLUDED.license,
         license_url = EXCLUDED.license_url,
         creator = EXCLUDED.creator,
         creator_url = EXCLUDED.creator_url,
         width = EXCLUDED.width,
         height = EXCLUDED.height,
         tags = EXCLUDED.tags,
         search_text = EXCLUDED.search_text,
         category = EXCLUDED.category,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING ${ROW_COLUMNS}`,
      [
        input.source,
        input.sourceId,
        input.title ?? null,
        input.url,
        input.thumbUrl,
        input.license,
        input.licenseUrl ?? null,
        input.creator ?? null,
        input.creatorUrl ?? null,
        input.width ?? null,
        input.height ?? null,
        input.tags ?? null,
        input.searchText ?? null,
        input.category ?? null,
        input.status ?? 'active',
      ],
    );
    return mapRow(rows[0]);
  }

  async findById(id: number): Promise<WallpaperRow | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW_COLUMNS} FROM wallpapers WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findBySourceAndSourceId(source: string, sourceId: string): Promise<WallpaperRow | null> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW_COLUMNS} FROM wallpapers WHERE source = $1 AND source_id = $2`,
      [source, sourceId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * 分类页/信息流: 仅 active,keyset 分页(id 倒序),category 为 null 时全量。
   * 注: 按 id 倒序无法利用 (category, created_at DESC) 复合索引;MVP 百行规模无影响,
   * #6 量级上来后若变瓶颈,可改为 (category, id) 复合索引或 created_at 游标。
   */
  async listByCategory(
    category: string | null,
    options: PageOptions,
  ): Promise<WallpaperRow[]> {
    const { limit, cursor = null } = options;
    const { rows } = await this.pool.query(
      `SELECT ${ROW_COLUMNS} FROM wallpapers
       WHERE status = 'active'
         AND ($1::text IS NULL OR category = $1)
         AND ($2::bigint IS NULL OR id < $2)
       ORDER BY id DESC
       LIMIT $3`,
      [category, cursor, limit],
    );
    return rows.map(mapRow);
  }

  /** 首页信息流(不限分类) */
  async listActive(options: PageOptions): Promise<WallpaperRow[]> {
    return this.listByCategory(null, options);
  }

  /** 分类计数(供 #6 GET /categories) */
  async countByCategory(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT category, count(*)::int AS count
       FROM wallpapers
       WHERE status = 'active' AND category IS NOT NULL
       GROUP BY category
       ORDER BY count DESC`,
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.category] = row.count;
    }
    return result;
  }
}
