/** 许可 → 徽章样式 class(文字徽章,设计文档 §2.1: CC0 青绿 / CC BY 蓝 / PD 灰) */
export function badgeClassFor(license: string | null): string {
  const l = (license ?? '').toUpperCase();
  if (l === 'CC0') return 'badge--cc0';
  if (l.startsWith('CC BY')) return 'badge--ccby';
  if (l === 'PD' || l.includes('PUBLIC DOMAIN')) return 'badge--pd';
  return 'badge--default';
}

/** 许可 → 用户可读说明(信任教育) */
export function licenseDescription(license: string | null): string {
  const l = (license ?? '').toUpperCase();
  if (l === 'CC0') return 'CC0 公有领域: 可自由使用、修改、商用,无需署名。';
  if (l.startsWith('CC BY')) return 'CC BY: 可自由使用、修改、商用,需按作者要求署名。';
  if (l === 'PD' || l.includes('PUBLIC DOMAIN'))
    return '公有领域(Public Domain): 版权已过期或作者放弃权利,可自由使用。';
  return '开源授权壁纸,具体条款见许可协议。';
}
