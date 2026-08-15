---
title: "#11 部署 + 上线前清单"
labels: [devops, p0]
---
# #11 部署 + 上线前清单

## Context

把整个 MVP 送上微信生态:后端上线 + 小程序提审 + 合规配置。这是最后一棒。

## Current State

#1-#10 完成:后端代码/数据库/前端全部就绪。尚未购买服务器、未注册小程序、未备案。

## Proposed Change

部署到国内轻量服务器 + 微信侧配置 + 提审。

### Implementation Details

**服务器(腾讯云/阿里云 Lighthouse 2核4G, Ubuntu 24.04)**:
1. 购买 + 域名 ICP 备案(必备,1-2 周提前量)
2. Docker Compose 部署: app + postgres + caddy
3. Caddy 自动 HTTPS(Let's Encrypt)
4. **第一步(2026-08-15 修正)**: 自有服务器图片存储优先 — 配 `SELF_HOST_STORAGE_DIR` + `SELF_HOST_BASE_URL`(图片域名),nginx `/images/*` 静态直出;COS 为第二选项(完整凭证才启用)。跑通 上传→直链下载 联调(原 Wikimedia 可达性承重墙已消除)

**微信侧**:
- 注册小程序账号(主体资格核实: 个人 vs 企业/个体户,影响流量主)
- `request` / `downloadFile` 合法域名: 配后端域名
- 内容安全检测 API 权限开通
- 隐私协议/用户授权(openid 处理声明,PIPL)
- 类目选择: 工具-图片/壁纸

**CI/CD**:
- GitHub Actions: test → build → SSH 部署(或 Docker Hub + server pull)
- 生产环境变量: 全部走服务器 env,不入仓库

**上线前清单**(对照 TODOS.md Pre-launch checklist):
- [ ] 图片存储联调 ✅/❌: 自有存储(SELF_HOST_STORAGE_DIR + SELF_HOST_BASE_URL)或 COS bucket + 密钥,上传→直链下载 200
- [ ] 精选 ≥100 张壁纸 + 中文分类
- [ ] 内容安全检测联调通过
- [ ] 微信审核提交流程完成

## Acceptance Criteria

1. 签名 URL 在服务器与真机均可下载返回 200(非签名/过期返回 403)
2. `https://<domain>/health` 公网可访问返回 ok
3. 小程序开发者工具真机预览: 完整流程跑通
4. 提审材料齐备(类目/隐私/域名/内容安全)
5. 后端有健康检查 + 基础告警(进程挂了能发现)
6. DB 自动备份策略配置(快照/cron)

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| E2E | 生产环境全流程冒烟 | +1 |
| E2E | 保存到相册真机 | +1 |

## Rollback Plan

- 后端: Docker Compose 回滚到上一镜像版本
- 小程序: 微信后台撤回版本
- DB: 快照恢复(如有破坏性迁移先验证)

## Effort Estimate

1d 服务器+部署 + 0.5d 微信配置 + 1d 提审准备 ≈ 2 天(不含备案等待)

## Related

- Epic: SPEC-MVP.md | TODOS.md Pre-launch checklist
