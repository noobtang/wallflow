---
title: "#5 中文搜索(FTS)"
labels: [backend, p0]
---
# #5 中文搜索(FTS)

## Context

中文关键词搜索(风景/极简/动漫等)。决策(ENG-PLAN.md): 入库预分词 + Postgres FTS,无运行时 LIKE。

> **阻塞关系**: 前端搜索页(#9)依赖本任务的路由 `GET /wallpapers/search`,按 P0 排期。

## Current State

#2 Schema 已含 search_text 列和 GIN 索引。

## Proposed Change

入库时对 title/tags/描述做 jieba 分词生成 search_text;搜索时 `to_tsvector('simple', search_text) @@ to_tsquery('simple', ?)`。

### Implementation Details

- **分词**: jieba-wasm(node 版)在 IngestionService 入库时生成 search_text(空格分隔分词)
- **同义词**: 简单同义词表(如 风景→landscape/nature/scenery),入库时附加
- **拼音容错**: 可选,MVP 先不做(记 TODO)
- **搜索接口**: `GET /wallpapers/search?q=<中文>` → 查询分词后 FTS
- 中文 query 同样过 jieba 分词再匹配

## Acceptance Criteria

1. 入库后搜"风景"能命中 landscape/nature 分类图
2. 搜索接口返回结果按相关度排序
3. 无结果时返回空数组(非 500)
4. 搜索结果分页正常

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | jieba 分词正确性 | +3 |
| Integration | 入库→中文搜索命中 | +3 |
| Integration | 空结果/分页 | +2 |

## Rollback Plan

搜索为只读功能,回滚 = 停用搜索路由。search_text 可重新生成。

## Effort Estimate

0.5d 分词接入 + 0.5d 搜索路由 ≈ 1 天

## Related

- Epic: SPEC-MVP.md | #2, #4 | ENG-PLAN.md 性能决策
