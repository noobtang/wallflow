import { z } from 'zod';

/** 许可白名单(#3 已定): 仅 CC0 / CC BY / 公有领域(PD)允许收录 */
export const ALLOWED_LICENSES = ['CC0', 'CC BY', 'PD'] as const;

/** 分类词表(#3 已定): 人工精选时在此范围内标注 */
export const CATEGORIES = ['风景', '极简', '萌宠', '动漫', '城市', '星空', '自然', '艺术'] as const;

const httpUrl = z.string().url();

export const manifestEntrySchema = z
  .object({
    sourceId: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    category: z.enum(CATEGORIES),
    tags: z.array(z.string().min(1).max(40)).min(1).max(20),
    license: z.enum(ALLOWED_LICENSES),
    licenseUrl: httpUrl,
    creator: z.string().min(1).max(200),
    creatorUrl: httpUrl,
    // 上界防手误: 常见壁纸分辨率上限内(8K=7680x4320,全景长图放宽到 20000)
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
    imageUrl: httpUrl.optional(),
    localFile: z.string().min(1).max(500).optional(),
  })
  .refine((d) => d.imageUrl !== undefined || d.localFile !== undefined, {
    message: 'imageUrl 与 localFile 至少提供一个',
    path: ['imageUrl'],
  });

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/** 人工精选清单: ManifestEntry 数组 */
export type Manifest = ManifestEntry[];
