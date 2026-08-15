import type { WallpaperItem } from './types';

/** 修改声明(#12 Eng review: CC BY 需要完整署名,含修改声明) */
export const MODIFICATION_NOTE = '本图经压缩/缩放处理(最长边 ≤2560px),可能偏离原始作品。';

/**
 * 完整署名(#12 Eng review: "CC-BY 需 title/author/license URI/修改声明(非仅来源链接)")。
 * 按 CC BY 署名要素拼装: 标题 / 作者 / 许可协议(名称 + URI) / 修改声明。
 * 返回 markdown 风格纯文本,详情页展示 + 一键复制(CC BY 必须保留署名,用户二次使用可直接粘贴)。
 * 非 CC BY(CC0/PD)不强制署名,但仍给出简洁来源说明(信任教育 + 可追溯)。
 */
export function buildAttribution(wallpaper: WallpaperItem): string {
  const title = wallpaper.title || '未命名壁纸';
  const creator = wallpaper.creator || '未知作者';
  const creatorUrl = wallpaper.creatorUrl || '';
  const license = wallpaper.license || '';
  const licenseUrl = wallpaper.licenseUrl || '';

  const authorPart = creatorUrl
    ? `${creator}(来源: ${creatorUrl})`
    : creator;

  const licensePart = licenseUrl
    ? `${license} 许可(${licenseUrl})`
    : `${license} 许可`;

  const isCcBy = /^CC BY/i.test(license);

  if (isCcBy) {
    // CC BY 完整署名: 标题 + 作者 + 许可 URI + 修改声明
    return [
      `作品: ${title}`,
      `作者: ${authorPart}`,
      `许可: ${licensePart}`,
      `修改声明: ${MODIFICATION_NOTE}`,
    ].join('\n');
  }

  // CC0 / PD: 非强制署名,但保留来源信息便于追溯与核验
  return [
    `作品: ${title}`,
    `作者: ${authorPart}`,
    `许可: ${licensePart}`,
  ].join('\n');
}

/** 是否需要在 UI 上展示「修改声明」提示(仅 CC BY 有署名义务) */
export function needsModificationNote(license: string | null): boolean {
  return /^CC BY/i.test(license ?? '');
}

/** 许可 → 详情页展示的完整文案(标题 + 一句话说明) */
export function licenseTitle(license: string | null): string {
  return `许可协议 · ${license || '未知'}`;
}
