/**
 * 时间键 keyset 游标(信息流/收藏共用): base64url("{createdAtUnixMs},{id}")。
 * 语义: 上一页最后一条的 (created_at, id);下一页取 (created_at, id) 更小的行。
 * 前提: created_at 已由迁移截断到毫秒(与 JS Date 无损往返)。
 */

export interface TsCursor {
  createdAtMs: number;
  id: number;
}

export function encodeTsCursor(createdAtMs: number, id: number): string {
  return Buffer.from(`${createdAtMs},${id}`).toString('base64url');
}

export function decodeTsCursor(raw: string): TsCursor | null {
  try {
    const [tsStr, idStr] = Buffer.from(raw, 'base64url').toString().split(',');
    const createdAtMs = Number(tsStr);
    const id = Number(idStr);
    // 安全整数 + 上界(2100-01-01): 防构造出超出 Date 有效范围的 ms → Invalid Date
    // 在 node-pg 序列化时抛 RangeError 变 500(应为 400)
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0 || createdAtMs > 4102444800000) {
      return null;
    }
    if (!Number.isInteger(id) || id <= 0) return null;
    return { createdAtMs, id };
  } catch {
    return null;
  }
}
