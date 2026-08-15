# WallFlow 上线前清单(#12)

> 目标: 后端上国内服务器 + HTTPS + 小程序合法域名 + 提审材料齐备。
> 前置: #1-#10 代码全部就绪(后端 135 测试 / 小程序 17 单测 / CI 双 job 全绿)。
> 仓库配套: `deploy/docker-compose.prod.yml`(postgres + 迁移 + api + nginx)、`deploy/nginx/default.conf.template`、`deploy/.env.production.example`、`deploy/pg_backup.sh`。

---

## ⏱ 第 0 步 — 并行提前量(今天就开始,不阻塞写代码)

| 事项 | 耗时 | 说明 |
|------|------|------|
| 购买域名 | 当天 | 建议 `.com`/`.cn`(备案要求域名实名),预算 ~60-100 元/年 |
| **域名 ICP 备案** | **1-2 周(有的省份更长)** | 与服务器/小程序共用备案主体;此步是整条链路最长的等待 |
| 小程序主体核实 | 1 天 | **个人 vs 企业/个体户**: 决定能否开通流量主(广告)。个人主体可上线但无广告;若计划广告变现(解锁功能二期)需个体户/企业主体。以微信官方最新说明为准 |
| 购买国内轻量服务器 | 当天 | 腾讯云/阿里云 Lighthouse 2核4G Ubuntu 24.04,~60-100 元/月;须**境内**节点(合法域名要求) |

> ⚠️ 备案期间: 用微信开发者工具 + 测试号调试,勾选「不校验合法域名」;真机预览同理。备案完成前无法配置正式合法域名。

---

## 1️⃣ 域名 + 备案(服务器侧)

1. 域名实名认证(注册商控制台)→ 解析记录**暂不设置**(等服务器 IP)
2. 通过云服务商(腾讯云/阿里云)提交 ICP 备案,主体 = 小程序主体(个人或企业)
3. 备案审核期间并行做第 2、3 步

## 2️⃣ 小程序账号 + 备案

1. 注册小程序账号(微信公众平台,mp.weixin.qq.com),主体与域名备案一致
2. 完成**小程序备案**(2023 年 9 月起强制,个人主体可备案,在公众平台「设置-基本设置-备案」入口)
3. 类目选择: **工具 → 图片/壁纸**(个人主体可用;如类目要求资质,以审核反馈为准)
4. 开发管理 → 接口设置: 申请 **内容安全检测** 权限(`security.msgSecCheck` / 图片检测)

## 3️⃣ 服务器初始化

```bash
# 1. 安全组/防火墙: 仅开放 80/443(5432、3000 绝不开公网)
# 2. 安装 Docker(腾讯云轻量有官方脚本;国内源镜像)
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
# DockerHub 拉取加速(腾讯云内网源,仅服务器内网可用):
sudo tee /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }
EOF
sudo systemctl restart docker
```

## 4️⃣ 部署后端(compose 自迁移)

```bash
# 服务器上:
mkdir -p /data/wallflow && cd /data/wallflow
git clone https://github.com/noobtang/wallflow.git .   # 或 scp/rsync 代码
cp deploy/.env.production.example deploy/.env
vi deploy/.env        # 填写 DOMAIN/POSTGRES_PASSWORD/JWT_SECRET/WECHAT_*/图片存储
                     # JWT_SECRET 用: openssl rand -hex 32
                     # 图片存储(2026-08-15 首选自有服务器):
                     #   SELF_HOST_BASE_URL=https://images.wallflow.example.com  (nginx /images/* 静态直出)
                     #   SELF_HOST_STORAGE_DIR 由 compose 挂载(images 卷→/data/wallflow/images),无需手填
                     # 第二选项 COS: 填 COS_SECRET_ID/SECRET_KEY/BUCKET/REGION(两者都配时自有存储优先)
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
# 启动顺序: postgres(健康)→ migrate(一次性,node-pg-migrate up)→ api → nginx
# ⚠️ migrate 是一次性服务: 成功后为 Exited(0),属正常;重启用 up -d 即可
# ⚠️ 生产启动硬依赖: 未配置对象存储(COS_*)与微信(WECHAT_*)密钥时 api 会启动即崩
#    (ObjectStorage 工厂设计为生产不静默降级;微信登录未配置时 /auth/login 返回 503)
docker compose -f docker-compose.prod.yml ps --status running   # postgres/api/nginx 应为 Up
docker compose -f docker-compose.prod.yml ps -a | grep migrate  # Exited(0) = 迁移成功
# 验证(本机): 
curl -s http://localhost/health   # → {"status":"ok"}
```

**首次上线数据初始化**(注意: 生产镜像只含 dist/ 编译产物,CLI 用 `node dist/cli/*.js` 而非 npm scripts):

```bash
# 1. 导入精选壁纸(需已配置对象存储密钥;未配置则跳过,后续补):
docker compose -f docker-compose.prod.yml run --rm api node dist/cli/import.js -- --dry-run   # 先 dry-run
# ⚠️ import.js 的 --dry-run 子命令以实际 CLI 参数为准;不带参数即全量导入
# 2. 若此前用 mock 存了完整 URL,规整为对象 key:
docker compose -f docker-compose.prod.yml run --rm api node dist/cli/backfill-cos-keys.js
```

## 5️⃣ DNS + HTTPS

```bash
# 1. 域名解析: A 记录 → 服务器公网 IP(等待生效,dig 验证)
# 2. 证书: 推荐 acme.sh + Let's Encrypt(DNSPod API 可自动续期;或腾讯云免费证书手动替换)
curl https://get.acme.sh | sh
# 注意: dns_dp 模式需先配置 DNSPod API 凭证(export DP_Id=... DP_Key=...);
# 也可 DNS A 记录生效后改用 --nginx 或 webroot 模式,或直接申请腾讯云免费证书
acme.sh --issue --dns dns_dp -d api.wallflow.example.com   # 泛域名可选 -d '*.example.com'
mkdir -p /data/wallflow/deploy/nginx/certs
acme.sh --install-cert -d api.wallflow.example.com \
  --fullchain-file /data/wallflow/deploy/nginx/certs/fullchain.pem \
  --key-file /data/wallflow/deploy/nginx/certs/privkey.pem \
  --reloadcmd "docker exec wallflow-nginx nginx -s reload"
# 3. 验证: curl https://api.wallflow.example.com/health → ok
```

## 6️⃣ 微信侧配置

| 配置项 | 值 | 位置 |
|--------|-----|------|
| request 合法域名 | `https://api.wallflow.example.com` | 公众平台 → 开发管理 → 开发设置 → 服务器域名 |
| downloadFile 合法域名 | **图片域名**(自有图片域名,如 `https://images.wallflow.example.com`;或 COS bucket 域名) | 同上;`<image>`/`previewImage`/`downloadFile` 都走此白名单 |
| 图片域名 | **自有服务器存储(首选,2026-08-15)**: `SELF_HOST_BASE_URL=https://images.wallflow.example.com`,图片由 nginx `/images/*` 静态直出(共享 images 卷,公开读 + 缓存头);与 api 域名同证书或独立证书均可 | 第二选项 COS: `wallflow-wallpapers-1250000000.cos.ap-guangzhou.myqcloud.com`(建议绑定自定义域名走 CDN) |
| 内容安全 | 已开通权限 + `WECHAT_APPID/SECRET` 已填 → 生产导入自动真实检测;未配置则降级 pending_review(不入用户流) | — |
| 隐私协议 | 「相册(写入)」用途 + openid/设备标识处理声明(PIPL) | 公众平台 → 设置 → 用户隐私保护指引 |
| 代码开关 | 提交前把 `miniprogram/utils/config.ts` 的 `BASE_URL` 改为正式域名;**`AUTH_FALLBACK_ANON` 置 `false`**(生产走微信登录) | 代码 |

## 7️⃣ 提审材料自查(对照规格 #11 验收)

- [ ] **验收 1** 图片 URL: 真机 `downloadFile` 图片 200(自有存储: `https://images.<domain>/images/wallpapers/<sourceId>.jpg` 公开 200;COS: 签名 URL 200、过期/非签名 403)
- [ ] **验收 2** `https://<domain>/health` 公网 200
- [ ] **验收 3** 开发者工具真机预览全流程: 首页流 → 详情 → 收藏 → 保存相册
- [ ] **验收 4** 提审材料: 类目(工具-图片/壁纸)/ 隐私协议 / 合法域名 / 内容安全权限
- [ ] **验收 5** 健康检查 + 基础告警: compose `restart: unless-stopped` + 外部 uptime 监控(如腾讯云拨测/UptimeRobot);进程挂了能发现
- [ ] **验收 6** DB 备份: 部署 `deploy/pg_backup.sh` + cron(见下)

```bash
# 备份 cron(每日 3 点):
# ⚠️ 脚本从进程环境读 POSTGRES_USER/POSTGRES_DB(默认 wallflow/wallflow);
#    若你在 deploy/.env 里改了账号/库名,把对应 export 加进 crontab 行:
#    0 3 * * * POSTGRES_USER=xxx POSTGRES_DB=xxx /data/wallflow/deploy/pg_backup.sh
chmod +x /data/wallflow/deploy/pg_backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /data/wallflow/deploy/pg_backup.sh") | crontab -
```

**常见提审驳回点**(提交前自查): 无隐私协议/收集声明、类目与内容不符、页面为演示数据(需真实内容 ≥ 若干张)、诱导分享、功能点击无响应(空态/错误态要友好)。

## 8️⃣ 上线后运维

- **回滚**: 后端 `docker compose -f docker-compose.prod.yml up -d --build <旧镜像>`;小程序微信后台撤回版本;DB 快照/备份恢复
- **DB 迁移**: 破坏性迁移先在本库验证 → 备份 → 再上
- **内容扩充**: 精选语料 100 → 300 张(manifest 扩量 + 限速导入);导入后检查 pending_review 数量
- **日志**: `docker logs wallflow-api --tail 100`;Fastify 已带结构化日志(5xx 有记录)
- **管理接口(#12 运维补全)**: 完整 API 说明见 `deploy/ADMIN-API.md`(认证/全部端点/错误形状/curl 示例)
  - `GET /admin/health` — 运维面板(未处理举报数、回填暂停状态),日常巡查入口
  - `POST /admin/wallpapers/:id/block|restore` — 隔离/恢复内容(版权投诉下架执行面)
  - `GET /admin/reports` + `DELETE /admin/reports/:id` — 审举报
  - `POST /admin/backfill/pause|resume` — 暂停/恢复回填(flag 落库,多副本共享)
  - 调用带 `X-Admin-Key` 头;未配置密钥 → 管理路由整体 503(不上线不暴露)
- **运维告警(#12 告警接入)**: 填 `OPS_ALERT_WEBHOOK_URL`(群机器人 webhook,企业微信/钉钉通用)后,任意 5xx 响应自动推送;同窗口(默认 60s)多条合并,风暴不刷屏。配置见 `deploy/ADMIN-API.md` §5
- **定时回填(#12 回填持久化)**: `npm run backfill:scheduled`(重建 search_text)
  - 由 cron/systemd 周期性调用(**进程内 node-cron 不持久**: 崩溃即丢,多副本会重叠)
  - 内部 DB 租约(`job_leases` 表)防多副本重叠 + 读 `backfill_paused` 开关
  - 示例 cron: `30 3 * * * cd /data/wallflow/backend && docker compose -f deploy/docker-compose.prod.yml run --rm api node dist/cli/scheduled-backfill.js`
- **图片带宽监控(2026-08-15 A 项)**: 图片走自有服务器直出后带宽是真金白银(轻量服务器常见 5Mbps/几十 GB 月流量包)。nginx 的 `/images/` location 日志打到 stdout,汇总脚本: `docker logs wallflow-nginx --since 24h 2>&1 | deploy/scripts/image-bandwidth.sh` → 请求数 + 总字节 + 按 CDN 参考价估算成本
  - **降本建议(B 项)**: 图片域名挂 CDN(腾讯云/阿里云 CDN 回源),边缘缓存挡掉 95%+ 源站流量;纯配置无代码 — CDN 控制台配回源 `https://images.<domain>` → 小程序 downloadFile 白名单加 CDN 域名
- **图片卷备份(2026-08-15 D 项)**: `deploy/scripts/backup-images.sh`(rsync 硬链接快照 + 保留 7 份,增量占空间)
  - cron: `0 4 * * * /data/wallflow/deploy/scripts/backup-images.sh`(默认源 `/data/wallflow/images` → `/data/wallflow/backups/images`;异地/对象存储冷备可再加 rsync push)
- **埋点事件保留(2026-08-15 E 项)**: `npm run cleanup:events -- --days 90`(删除 90 天前 events,防表无限增长)
  - cron: `0 5 * * 0 /data/wallflow/deploy/scripts/...` 或 compose run: `docker compose -f deploy/docker-compose.prod.yml run --rm api node dist/cli/cleanup-events.js --days 90`
- **公开写接口限流(2026-08-15 E 项)**: 内置零依赖限流(默认 60s/300 次/IP,按 X-Forwarded-For),保护 `/events /reports /favorites /unlock`;调参见 `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`
- **运营统计(2026-08-15 A 项)**: `GET /admin/stats`(X-Admin-Key)— 内容存量 / 7d-30d 下载·收藏·活跃用户 / Top 壁纸 / 分类热度,周报数据源(配合 `weekly-candidates.mjs` 决定下周补什么分类)
- **版权投诉与监管下架**: 流程见 `deploy/TAKEDOWN-SOP.md`(受理 → 隔离 → 双人复核 → 结案)
- **二期**: 激励视频广告(需企业主体 + 流量主达标;组件已就绪,填 `REWARDED_AD_UNIT_ID` 即启用,见 `miniprogram/utils/config.ts`)、内容审核重检流程

## 开放问题(上线前需拍板)

1. ~~COS 供应商~~ → **自有服务器存储已定(2026-08-15)**: 填 `SELF_HOST_STORAGE_DIR`(compose 已挂 images 卷)+ `SELF_HOST_BASE_URL`(图片域名)即启用,COS 降为第二选项(两者都配置时自有存储优先)。换存储后端只改 `ObjectStorage` 实现 + downloadFile 域名白名单,接口与 DB 不变
2. **Web 端是否首发**(DESIGN-UI.md §8): 若与小程序同步上线,同一服务器/域名,另需 @fastify/cors + React 构建物部署(归 #13)
3. **广告变现主体**: 激励视频需企业/个体户主体 + 流量主开通;个人主体可先上线但无广告位(组件已按空 adUnitId 自动降级免费)

---

## 验收核对(规格 11)

| 验收 | 状态 |
|------|------|
| 1. 签名 URL 服务器+真机 200 / 非签名 403 | ⬜ 待 COS 凭证 + 真机 |
| 2. https://<domain>/health 公网 ok | ⬜ 待部署 |
| 3. 真机完整流程 | ⬜ 待部署 + 真机 |
| 4. 提审材料齐备 | ⬜ 见 §6-7 |
| 5. 健康检查 + 告警 | 🟡 5xx 内置告警就绪(填 `OPS_ALERT_WEBHOOK_URL`)+ 外部拨测待配 |
| 6. DB 自动备份 | 🟡 脚本就绪,待上 cron |
