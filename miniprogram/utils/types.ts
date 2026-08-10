/** 壁纸列表项(与后端 WallpaperListItem 对齐;fullUrl/thumbUrl 已是签名直链) */
export interface WallpaperItem {
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

export interface FeedResponse {
  items: WallpaperItem[];
  nextCursor: string | null;
}

export interface CategoriesResponse {
  items: Array<{ name: string; count: number }>;
}
