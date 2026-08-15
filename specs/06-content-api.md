---
title: "#6 内容 API(信息流/分类/详情/相似推荐)"
labels: [backend, p0]
---
# #6 内容 API(信息流/分类/详情/相似推荐)

## Context

前端主数据源 — 首页信息流、分类过滤、详情页、相似推荐全部由此 API 提供。ENG-PLAN.md 决策: 元数据读缓存、keyset 分页、**图片由自有服务器存储分发(#8,2026-08-15 起首选;COS 签名直链为第二选项),无上游依赖**。

## Current State

#2 Schema 完成(wallpapers 表 + 索引)。#1 骨架可注册路由。

## Proposed Change

实现 4 组只读内容路由。**注意: 返回的图片 URL 为存储直链(见 #8;自有存储公开读,COS 为签名直链短时效 ~1h),前端直接用于加载/下载。**

### Implementation Details

| 路由 | 说明 | 参数 | 分页 |
|------|------|------|------|
| `GET /wallpapers` | 信息流/分类 | `category?`, `sort?`(latest/hot), `cursor?` | keyset(created_at, id) 或 (hot_score, id) |
| `GET /wallpapers/:id` | 详情 | — | — |
| `GET /wallpapers/:id/similar` | 相似推荐(标签匹配) | `limit=8` | — |
| `GET /categories` | 分类列表(带计数) | — | — |

**响应形状**(统一):
```json
{
  "id": 1,
  "title": "Mountain Lake Sunrise",
  "thumbUrl": "https://<cos-domain>/wallpapers/1_thumb.jpg?x-cos-signature=...",
  "fullUrl": "https://<cos-domain>/wallpapers/1.jpg?x-cos-signature=...",
  "license": "CC BY 4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
  "creator": "Jane Doe",
  "creatorUrl": "https://commons.wikimedia.org/wiki/User:JaneDoe",
  "width": 4000, "height": 3000,
  "tags": ["风景", "山", "湖泊"],
  "category": "风景",
  "is_favorited": false
}
```

- **keyset 分页**: `WHERE (created_at, id) < ($ts, $id) ORDER BY created_at DESC, id DESC LIMIT 20` — 避免深 offset 性能衰减
- **cursor 编码**: `base64url(createdAtUnixMs + "," + id)`,服务端解码后比较;非法 cursor → 400
- **sort=hot(2026-08-15 分析变现)**: `GET /wallpapers?sort=hot` — 按最近 7 天行为加权热度排序(下载成功 5 / 收藏 3 / 下载点击 2,无事件按 id DESC 兜底);分页游标复用 (rank,id) 编码(rank 即 hot_score);支持与 category 组合;事件数据来自 `POST /events`(#8 埋点入口)
- **分类**: `wallpapers.category` 索引;分类计数由回填任务(#4)更新
- **相似推荐**: 按 tags 重叠数排序(GIN 索引 + 简单 SQL),MVP 不做向量
- **缓存头**: 列表 `Cache-Control: public, max-age=60`;详情 `max-age=300`
- **过滤**: 只返回 `status=active` 且许可为自由协议(CC0/CC BY/PD)的记录
- **is_favorited**: 详情接口(`GET /wallpapers/:id`)在已登录时返回当前用户是否已收藏(收藏按钮初始态);未登录返回 false。列表接口不返回(收藏页单独查询)
- **错误**: 参数非法 → 400;未知 id → 404;DB 故障 → 502 + 前端友好重试

## Acceptance Criteria

1. `GET /wallpapers` 默认返回 20 条,keyset 翻页无重复无遗漏
2. `?category=风景` 只返回该分类
3. `GET /wallpapers/:id` 返回完整署名+许可字段;未知 id → 404
4. `GET /wallpapers/:id/similar` 有数据时返回 ≥1 条同标签壁纸
5. 返回的图片 URL 全部为自有存储/ COS 域名直链,无任何海外上游直链
6. 集成测试: 翻页/分类/详情/相似 全通过

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Integration | keyset 翻页正确性(重复/遗漏) | +2 |
| Integration | 分类过滤 + 详情 + 404 | +3 |
| Unit | 相似推荐排序逻辑 | +2 |
| Unit | 参数校验(非法 cursor/category) | +2 |

## Rollback Plan

只读路由,下线即回滚,无状态变更。

## Effort Estimate

0.5d 路由 + 0.5d keyset/相似 + 0.5d 测试 ≈ 1.5 天

## Related

- Epic: SPEC-MVP.md | #2, #8 | ENG-PLAN.md 性能决策(keyset 分页)
