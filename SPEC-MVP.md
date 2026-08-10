---
title: "WallFlow MVP — 免费授权壁纸微信小程序"
labels: [epic, mvp]
---
# WallFlow MVP: 免费授权壁纸微信小程序

## Context

中文壁纸 App 把高清原图锁在会员付费墙后。用户想要免费、高清、风格合适的壁纸时,要么付费,要么在小红书/图库网站间折腾。WallFlow 是微信内即用的壁纸工具:浏览精选 CC0/CC-BY 壁纸 → 预览 → 一键保存到相册,每张图标注来源与许可协议。核心全部免费,高清解锁通过后端校验接口(MVP 阶段全免费,真实激励视频广告待流量主达标后接入)。

**内容源**: **精选 CC0/CC BY 语料转存国内对象存储(COS)**(2026-08-10 二次修正: Wikimedia 大陆不可达,jsDelivr/Gitee 实测不可靠 → CC0 允许再分发,转存 COS 零上游依赖)。Unsplash/Pexels 被排除(条款禁止壁纸应用)。Wikimedia/Openverse 自动化适配器二期。

## Current State

greenfield 项目,无代码。技术决策已锁定(ENG-PLAN.md): Node.js 20+ / Fastify 5 / TS strict / PostgreSQL 16 / Docker Compose / Caddy HTTPS。

## Proposed Change

交付一个可上线的最小完整产品:小程序前端 + Web 端 + 后端 API + 精选 CC0 语料导入(COS 托管)+ 保存流程。

```
微信小程序 ──HTTPS──▶ Fastify API ──▶ Service 层 ──▶ SourcePort ──▶ CuratedImport(精选导入)
                                   │                                   └─▶ 精选 manifest → COS
                                   └─▶ PostgreSQL (元数据缓存/收藏/解锁/埋点)
                                              ▲
                                          精选导入任务(npm run import)
```

图片分发:**COS 签名直链**(国内对象存储,天然可达;CC0 允许再分发,直链合规)。

## Child Issues

| # | Title | Priority | Effort | Dependencies |
|---|-------|----------|--------|--------------|
| 1 | 后端项目骨架 + CI | P0 | 1d | — |
| 2 | 数据库 Schema + 迁移 | P0 | 1d | #1 |
| 3 | SourcePort + 精选语料导入(CuratedImport) | P0 | 1-2d | #1 |
| 4 | 精选导入任务 + 内容安全检测 | P0 | 1-2d | #2, #3 |
| 5 | 中文搜索(FTS) | P0 | 1d | #2 |
| 6 | 内容 API(信息流/分类/详情/相似推荐) | P0 | 1.5d | #2 |
| 7 | 鉴权 + 收藏 + 解锁 + 举报 API | P0 | 2d | #2 |
| 8 | 图片分发(COS 签名直链) | P0 | 1d | #1 |
| 9 | 小程序前端(信息流/分类/搜索/详情/保存) | P0 | 3-4d | #5, #6, #7, #8 |
| 10 | 埋点漏斗 | P1 | 0.5d | #7 |
| 11 | 部署 + 上线前清单 | P0 | 1d | #1-10 |
| 12 | Web 客户端(React+Vite+Tailwind+PWA) | P1 | 3-4d | #5, #6, #7, #8 |

## Dependency Graph

```
#1 骨架 ──▶ #2 Schema ──┬──▶ #4 回填 ──▶ #6 内容 API
                        ├──▶ #5 搜索
                        └──▶ #7 用户 API ──▶ #10 埋点
#3 导入器 ──▶ #4
#5 + #6 + #7 + #8(图片代理)──▶ #9 小程序前端 ──▶ #11 部署
#5 + #6 + #7 + #8 ──▶ #12 Web 客户端(共享 API)
```

## Sequencing Rationale

1. #1-#3 先行:骨架/Schema/适配器是地基,回填依赖它们。
2. #4 回填先于 #6/#9:前端需要数据才能开发。
3. #5 搜索 + #6 内容 API + #7 用户 API 先于 #9 前端:前端搜索页/信息流/收藏全部依赖它们。
4. #10 埋点依赖 #7(上报路由挂在用户 API 层)。
5. #11 部署最后:依赖全部功能就绪。
6. #12 Web 与 #9 小程序可并行开发(共享 #5-#8 API 与 DESIGN-UI.md 设计体系),部署复用 #11。

## Definition of Done

1. 后端全部接口通过集成测试(含回填幂等、防绕过)
2. 小程序在微信开发者工具跑通 打开→找到→保存 全流程
3. 保存到相册成功,无白图(COS 直链验证通过)
4. 埋点漏斗数据可见
5. 微信审核提交流程完成
6. 设计文档 Review Decisions 全部落实

## Out of Scope (MVP)

- 激励视频真实广告(1000 UV 后二期)
- Openverse 第二源
- UGC/评论/个性化推荐
- 动态壁纸
- Wikimedia/Openverse 自动化图源(二期;MVP 为人工精选导入)
- 管理后台
- 壁纸合集/主题包、每日精选推送(订阅消息)— MVP 后增量(相似推荐已低成本并入 #6)
- Web 端登录(微信 code2Session 仅限小程序)— 方案待定(DESIGN-UI.md §8)
- Redis 缓存

## Related

- 设计文档: ~/.gstack/projects/wallflow/root-no-branch-design-20260810-212523.md
- 技术计划: /var/www/html/miniprogram/wallflow/ENG-PLAN.md
- TODOS: /var/www/html/miniprogram/wallflow/TODOS.md
