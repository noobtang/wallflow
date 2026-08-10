---
title: "#4 精选导入任务 + 内容安全检测"
labels: [backend, p0]
---
# #4 精选导入任务 + 内容安全检测

## Context

内容从精选语料进入本地库与 COS 的管道。设计决策(ENG-PLAN.md 修正): 元数据入库缓存,用户请求读库;**图片托管在国内 COS**(见 #8),零上游依赖。MVP 规模 100-300 张,导入为**人工触发的精选导入**(非定时爬虫;二期自动化图源再引入定时任务)。

## Current State

#2(Schema)与 #3(CuratedImport)完成后,有表可用、有清单可读。

## Proposed Change

`npm run import` 命令 + 内容安全检测接入。

### Implementation Details

**导入流水线**(`src/jobs/import.job.ts`):
- 读 manifest(#3)→ 逐条: 获取图片(本地文件或 URL)→ **内容安全检测** → **sharp 生成缩略图(宽 600px)** → 上传 COS(原图 + 缩略图,key 见 #8)→ 元数据 `upsert ON CONFLICT (source, source_id)` 幂等
- **序列化执行**: 单实例锁(DB advisory lock 或 .lock 文件),防并发启动重叠
- 失败重试: 单条失败跳过继续,整批失败退避后重试;断点续导(按 source_id 幂等)
- 每批完成后更新 `categories` 计数(供 #6 `GET /categories` 使用)
- 手动触发:`npm run import`;支持 `--dry-run`(只校验 manifest 不落库)

**内容安全检测**:
- 上传前调微信 imgSecCheck(二进制 media check)
- 检测失败 → `status=blocked`,不入用户可见流
- **降级策略(已定)**: imgSecCheck 超时/不可用 → **放行 + 标记 `pending_review`**,不入精选流(用户可见流只含 `status=active`),待重检后转正或 blocked

## Acceptance Criteria

1. `npm run import --dry-run` 通过 10 行测试 manifest,不落库
2. `npm run import` 跑通: ≥10 张入库 + COS 上传成功,无重复(幂等验证)
3. 中断重跑无重复数据(upsert 生效,断点续导)
4. 单条畸形数据被跳过,不中断整体
5. 内容安全检测: mock 返回违规时该条 blocked
6. imgSecCheck 不可用时该条标记 pending_review,不进用户可见流
7. 序列化锁生效(并发启动只跑一个实例)
8. categories 计数随导入更新
9. 原图与缩略图均上传 COS,DB 存两个对象 key

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Integration | 导入幂等(中断重跑无重复) | +2 |
| Integration | 内容安全 mock 违规→blocked | +2 |
| Unit | 单条失败不影响整体 | +2 |
| Integration | COS 上传(mock SDK) | +2 |

## Rollback Plan

导入是追加型 upsert,无破坏性操作;出错停止即可。COS 对象可删可重传。

## Effort Estimate

1d 导入流水线 + 0.5d 内容安全 ≈ 1-1.5 天

## Related

- Epic: SPEC-MVP.md | #2, #3, #8 | ENG-PLAN.md 错误映射
