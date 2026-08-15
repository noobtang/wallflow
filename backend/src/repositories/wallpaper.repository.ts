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

export const ROW_COLUMNS = `id, source, source_id AS "sourceId", title, url, thumb_url AS "thumbUrl",
  license, license_url AS "licenseUrl", creator, creator_url AS "creatorUrl",
  width, height, tags, search_text AS "searchText", category, status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** 行 → 领域类型(列已别名映射,这里做显式收尾与空值处理);供 join 场景(FavoriteRepository)复用 */
export function mapRow(row: pg.QueryResultRow): WallpaperRow {
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

  /**
   * 热门信息流(2026-08-15,分析变现第一步): 按最近 7 天用户行为加权热度排序。
   * - 权重: download_success 5 / favorite_add 3 / download_click 2(下载是壁纸产品最强信号;
   *   收藏次之;点击最弱)。无事件壁纸 score 0,按 id DESC 兜底(新内容仍可见)
   * - 窗口: events.created_at >= now() - interval '7 days'(按事件发生时间,非导入时间)
   * - 分页: (score, id) 复合 keyset 游标,与 search 的 (rank, id) 同构;
   *   score 用 double precision(文本往返精确,等值比较安全,见 search 的精度陷阱注释)
   * - 索引: events 有 idx_events_name_created(event_name, created_at);MVP 事件量级下聚合代价可忽略
   */
  async listHot(
    category: string | null,
    options: { limit: number; cursor?: { rank: number; id: number } | null },
  ): Promise<{ items: WallpaperRow[]; lastScore: number }> {
    const { limit, cursor = null } = options;
    const { rows } = await this.pool.query(
      `WITH scored AS (
         SELECT w.*,
                COALESCE(SUM(
                  CASE e.event_name
                    WHEN 'download_success' THEN 5
                    WHEN 'favorite_add' THEN 3
                    WHEN 'download_click' THEN 2
                    ELSE 0
                  END
                ), 0)::double precision AS hot_score
         FROM wallpapers w
         LEFT JOIN events e
           ON e.wallpaper_id = w.id
          AND e.created_at >= now() - interval '7 days'
          AND e.event_name IN ('download_success', 'favorite_add', 'download_click')
         WHERE w.status = 'active'
           AND ($1::text IS NULL OR w.category = $1)
         GROUP BY w.id
       )
       SELECT ${ROW_COLUMNS}, hot_score FROM scored
       WHERE ($2::double precision IS NULL
              OR hot_score < $2
              OR (hot_score = $2 AND id < $3))
       ORDER BY hot_score DESC, id DESC
       LIMIT $4`,
      [category, cursor?.rank ?? null, cursor?.id ?? null, limit],
    );
    const items = rows.map(mapRow);
    const lastScore = items.length > 0 ? Number(rows[rows.length - 1].hot_score) : 0;
    return { items, lastScore };
  }

  /**
   * 信息流/分类页(#7): (created_at, id) 复合 keyset 分页。
   * - 排序 created_at DESC, id DESC;游标 (created_at, id) 保证翻页无重复无遗漏
   * - 精度前提: created_at 已由迁移截断到毫秒,与 JS Date 无损往返
   *   (若保留 µs,同毫秒连续插入的行会被游标比较漏掉)
   */
  async listFeed(
    category: string | null,
    options: { limit: number; cursor?: FeedCursor | null },
  ): Promise<WallpaperRow[]> {
    const { limit, cursor = null } = options;
    const { rows } = await this.pool.query(
      `SELECT ${ROW_COLUMNS} FROM wallpapers
       WHERE status = 'active'
         AND ($1::text IS NULL OR category = $1)
         AND ($2::timestamptz IS NULL
              OR (created_at, id) < ($2::timestamptz, $3::bigint))
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [category, cursor ? new Date(cursor.createdAtMs) : null, cursor?.id ?? null, limit],
    );
    return rows.map(mapRow);
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

  /**
   * 相似推荐(#7): 同标签壁纸按重叠标签数降序(id 倒序打平),排除自身。
   * tags && $2 走 GIN 索引;无标签时调用方不应调用本方法。
   */
  async findSimilarByTags(
    id: number,
    tags: string[],
    limit: number,
  ): Promise<WallpaperRow[]> {
    const { rows } = await this.pool.query(
      `SELECT ${ROW_COLUMNS} FROM wallpapers w
       WHERE w.status = 'active'
         AND w.id <> $1
         AND w.tags && $2::text[]
       ORDER BY (SELECT count(*) FROM unnest(w.tags) AS t WHERE t = ANY($2::text[])) DESC,
                w.id DESC
       LIMIT $3`,
      [id, tags, limit],
    );
    return rows.map(mapRow);
  }

  /**
   * 全文搜索(#6): GIN to_tsvector('simple', search_text) @@ tsquery + 分类/标签过滤。
   * - query: 已分词的查询串(空格分隔,jieba 在路由层完成);'' = 不限(纯过滤)
   * - plainto_tsquery: 对用户输入安全(无 tsquery 语法注入面),AND 语义
   * - 排序: 有 query 按 ts_rank DESC + id DESC;无 query rank 恒 0 → 纯 id DESC
   * - 复合 keyset 游标 (rank, id): rank 排序下 id 游标会重复/遗漏,必须两个字段一起
   *   才能保证翻页无重复无遗漏(rank 相同时退化为 id 游标)
   * - 精度陷阱(实测): ts_rank 返回 real(float4),pg 驱动把 float4 以文本往返(丢精度),
   *   导致游标参数与库里 rank 的等值比较失败(相差 ~1e-17)→ 翻页漏数据。
   *   修复: CTE 内把 rank 升为 double precision,float8 的文本往返是精确的,等值成立。
   * - 已知取舍: buildSearchText 去重 + AND 语义下,单词查询所有结果都命中全部词,
   *   ts_rank 打平 → 退化为 id DESC;多词查询按命中度排序仍有效
   */
  async search(options: SearchOptions): Promise<SearchResult> {
    const { query, category = null, tag = null, limit = 20, cursor = null } = options;
    const q = query ?? '';
    const { rows } = await this.pool.query(
      `WITH ranked AS (
         SELECT w.*,
                CASE WHEN $1 = '' THEN 0::double precision
                     ELSE ts_rank(to_tsvector('simple', w.search_text), plainto_tsquery('simple', $1))::double precision END AS rank
         FROM wallpapers w
         WHERE w.status = 'active'
           AND ($1 = '' OR to_tsvector('simple', w.search_text) @@ plainto_tsquery('simple', $1))
           AND ($2::text IS NULL OR w.category = $2)
           AND ($3::text IS NULL OR w.tags @> ARRAY[$3]::text[])
       )
       SELECT ${ROW_COLUMNS}, rank FROM ranked
       WHERE ($4::double precision IS NULL
              OR rank < $4
              OR (rank = $4 AND id < $5))
       ORDER BY rank DESC, id DESC
       LIMIT $6`,
      [q, category, tag, cursor?.rank ?? null, cursor?.id ?? null, limit],
    );
    const items = rows.map(mapRow);
    const lastRank = items.length > 0 ? Number(rows[rows.length - 1].rank) : 0;
    return { items, lastRank };
  }
}

export interface SearchOptions {
  /** 已分词的查询串(空格分隔);'' = 不限(纯分类/标签过滤) */
  query: string | null;
  category?: string | null;
  tag?: string | null;
  /** 页大小,默认 20;路由层限制 1-50 */
  limit?: number;
  /** 复合 keyset 游标: (rank, id);无查询时 rank=0(纯 id 游标) */
  cursor?: { rank: number; id: number } | null;
}

/** 信息流 keyset 游标(#7): (created_at, id),createdAtMs 为 Unix 毫秒 */
export interface FeedCursor {
  createdAtMs: number;
  id: number;
}

export interface SearchResult {
  items: WallpaperRow[];
  /** 本页最后一条的 rank(路由用它构造 nextCursor 复合游标) */
  lastRank: number;
}
