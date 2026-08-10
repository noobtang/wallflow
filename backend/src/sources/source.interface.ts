import type { Manifest } from './manifest.schema';

/** 规范化壁纸元数据 — SourcePort 输出,供 #4 入库(#2 Schema 对应行) */
export interface NormalizedWallpaper {
  /** 内容源标识: CuratedImport 固定 'curated';二期适配器各自标识 */
  source: string;
  /** 源内唯一 ID(如 cc-tatry-...),与 source 组成 (source, source_id) 入库键 */
  sourceId: string;
  title: string;
  /** 白名单许可: CC0 / CC BY / PD */
  license: string;
  licenseUrl: string;
  creator: string;
  /** 作者/出处页面(如 Commons 文件描述页,供归属核验) */
  creatorUrl: string;
  width: number;
  height: number;
  /** 中文标签(人工精选时手写) */
  tags: string[];
  /** 分类(词表: 风景/极简/萌宠/动漫/城市/星空/自然/艺术) */
  category: string;
  /** 远程源图 URL;与 localFile 二选一 */
  imageUrl?: string;
  /** 本地源文件路径;与 imageUrl 二选一 */
  localFile?: string;
}

/**
 * 内容源抽象(#3)。MVP 实现: CuratedImport(读精选清单)。
 * 二期可插拔 Wikimedia / Openverse 适配器实现同一接口(search 拉取上游)。
 */
export interface SourcePort {
  read(manifest: Manifest): AsyncIterable<NormalizedWallpaper>;
}
