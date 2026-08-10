---
title: "#2 数据库 Schema + 迁移"
labels: [backend, p0]
---
# #2 数据库 Schema + 迁移

## Context

WallFlow 全部数据的地基:壁纸元数据缓存、收藏、解锁、举报、埋点。Schema 已在 ENG-PLAN.md 定义,这里落地为迁移。

## Current State

greenfield。无数据库。需本地/CI Postgres 16。

## Proposed Change

创建迁移(推荐 node-pg-migrate 或 Kysely migrations)落地 ENG-PLAN.md 的 5 张表:

- `wallpapers` — UNIQUE(source, source_id),GIN 索引 on search_text/tags,category+created_at 复合索引
- `favorites` — PK(user_id, wallpaper_id)
- `ad_unlocks` — UNIQUE(user_id, wallpaper_id)
- `reports` — UNIQUE(user_id, wallpaper_id)
- `events` — UNIQUE(event_id)

### Implementation Details

- 使用迁移工具(如 node-pg-migrate),迁移文件可回滚
- 提供 `db:up` / `db:down` / `db:reset` scripts
- `docker-compose.yml` 含 Postgres 16 服务(local dev)
- WallpaperRepository 封装 pg 池,查询走 prepared statements

## Acceptance Criteria

1. `db:up` 在空库执行成功,5 张表全部创建
2. 索引存在(`\di` 验证 GIN/复合索引)
3. `db:down` 可回滚
4. UNIQUE 约束生效(插入重复 (source,source_id) 报错)
5. WallpaperRepository 单测通过

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Integration | 迁移 up/down 幂等 | +2 |
| Integration | UNIQUE 约束冲突 | +2 |
| Unit | repository CRUD | +4 |

## Rollback Plan

迁移可回滚(`db:down`)。未上线无数据风险。

## Effort Estimate

1h 迁移 + 1h repository + 1h docker-compose + 1h 测试 ≈ 1 天

## Related

- Epic: SPEC-MVP.md | ENG-PLAN.md Schema 节
