---
title: "#10 埋点漏斗"
labels: [backend, p1]
---
# #10 埋点漏斗

## Context

验证"搜索→预览→下载"转化漏斗与留存,是产品成功指标的数据基础(设计文档 Success Criteria)。

## Current State

#2 events 表存在(UNIQUE event_id)。#7 API 层可挂上报路由。

## Proposed Change

`POST /events` 上报接口 + 前端 track.ts 集成。

### Implementation Details

- **路由**: `POST /events` {event_name, event_id, wallpaper_id?} — 幂等(UNIQUE event_id)
- **事件**: `search_exposed` / `search_click` / `preview_click` / `download_click` / `download_success` / `favorite_add`
- **去重**: 客户端生成 UUID event_id;重放/重试不重复入库
- **身份**: openid 哈希关联(已登录时)
- **查询**: 后端提供 `GET /analytics/funnel?date=` — **MVP 用服务端 env API key 保护(非用户 token)**,或 dev-only 直连 SQL;正式管理后台二期
- 留存: 日活/周活查询(MVP 简化为每日 events 去重用户数)

## Acceptance Criteria

1. 上报成功返回 201,重复 event_id 返回 200(幂等不重复入库)
2. events 表查询: 某日漏斗各环节 count 正确
3. 未登录也能上报(匿名 user_id=null)
4. 前端关键操作均触发上报(搜索/预览/下载)

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | event_id 去重 | +2 |
| Integration | 上报→查询漏斗 | +2 |
| E2E | 前端搜索→下载触发上报 | +1 |

## Rollback Plan

纯追加埋点,无破坏性。停用路由即回滚。

## Effort Estimate

0.5 天

## Related

- Epic: SPEC-MVP.md | #7 | 设计文档 Success Criteria
