---
title: "#1 后端项目骨架 + CI"
labels: [backend, p0]
---
# #1 后端项目骨架 + CI

## Context

WallFlow 后端的第一个落地任务。所有后续任务(#2-#10)都在此骨架上进行。目标:一个可运行、可测试、可部署的 Fastify + TypeScript 服务,含 CI。

## Current State

greenfield。`/var/www/html/miniprogram/wallflow/` 仅有文档文件(TODOS.md / ENG-PLAN.md / REVIEW-REPORT.md / SPEC-MVP.md)。无 package.json、无代码。

## Proposed Change

初始化 `backend/` 目录,建立完整工程骨架。

### Implementation Details

**目录结构**:

```
backend/
├── package.json
├── tsconfig.json            # strict: true
├── .env.example             # 全部 env 变量模板
├── src/
│   ├── server.ts            # Fastify 入口
│   ├── config.ts            # zod 校验 env(缺失即启动失败)
│   ├── routes/
│   │   └── health.ts        # GET /health → {status: ok}
│   ├── plugins/
│   │   └── error-handler.ts # 统一错误映射中间件
│   └── types/
│       └── index.ts
├── test/
│   └── health.test.ts
└── Dockerfile
```

**package.json 依赖**:
- runtime: `fastify`, `zod`, `pg`, `dotenv`
- dev: `typescript`, `tsx`, `vitest`, `@types/node`, `eslint`, `prettier`
- scripts: `dev`(tsx watch)、`build`(tsc)、`start`、`test`(vitest run)、`lint`、`typecheck`

**env 变量(zod 校验,缺失即报错)**:
- `PORT`(默认 3000)
- `DATABASE_URL`
- `WECHAT_APPID`, `WECHAT_SECRET`
- `JWT_SECRET`
- `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION`(腾讯云 COS,见 #8)

**Dockerfile**: node:20-alpine 多阶段构建(install → build → runtime)。

**CI(GitHub Actions `.github/workflows/ci.yml`)**:
- `lint` + `typecheck` + `test`(vitest)
- Node 20, Postgres 16 service container(供集成测试用)

## Acceptance Criteria

1. `npm run typecheck` 通过(tsc --noEmit, zero errors)
2. `npm run lint` 通过
3. `npm test` 通过(health.test.ts 绿灯)
4. `npm run dev` 启动后 `GET /health` 返回 `{status: "ok"}`
5. 缺失 `DATABASE_URL` 时启动失败并报清晰错误(zod 校验生效)
6. `docker build` 成功
7. CI 工作流文件存在,包含 lint/typecheck/test 三步

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | health route 返回 200 | +1 |
| Unit | config zod 校验缺失 env 报错 | +2 |
| Unit | error-handler 映射已知异常 | +2 |

## Rollback Plan

greenfield 骨架,无数据无迁移。删除 `backend/` 目录即可完全回滚。

## Effort Estimate

1h 脚手架 + 1h 配置 + 1h CI + 1h 测试 ≈ 0.5-1 天

## Files Reference

| File | Change |
|------|--------|
| `backend/package.json` | 新建,依赖+scripts |
| `backend/tsconfig.json` | 新建,strict |
| `backend/src/server.ts` | 新建,Fastify 入口+health 路由 |
| `backend/src/config.ts` | 新建,zod env 校验 |
| `backend/test/health.test.ts` | 新建 |
| `backend/Dockerfile` | 新建 |
| `.github/workflows/ci.yml` | 新建 |

## Out of Scope

- 数据库连接池(pg pool 配置在 #2)
- 任何业务路由(在 #6, #7)
- 部署配置(在 #10)

## Related

- Epic: SPEC-MVP.md
- 技术计划: ENG-PLAN.md
