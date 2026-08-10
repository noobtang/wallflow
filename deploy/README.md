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
vi deploy/.env        # 填写 DOMAIN/POSTGRES_PASSWORD/JWT_SECRET/WECHAT_*/COS_*
                     # JWT_SECRET 用: openssl rand -hex 32
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
# 启动顺序: postgres(健康)→ migrate(一次性,node-pg-migrate up)→ api → nginx
docker compose -f docker-compose.prod.yml ps          # 全部 Up/healthy
# 验证(本机): 
curl -s http://localhost/health   # → {"status":"ok"}
```

**首次上线数据初始化**:

```bash
# 1. 导入精选壁纸(需先配好 COS 密钥,或先 mock 再补):
docker compose -f docker-compose.prod.yml run --rm api npm run import -- --dry-run   # 先 dry-run
docker compose -f docker-compose.prod.yml run --rm api npm run import                # 全量导入
# 2. 若此前用 mock 存了完整 URL,规整为对象 key:
docker compose -f docker-compose.prod.yml run --rm api npm run backfill:cos-keys
```

## 5️⃣ DNS + HTTPS

```bash
# 1. 域名解析: A 记录 → 服务器公网 IP(等待生效,dig 验证)
# 2. 证书: 推荐 acme.sh + Let's Encrypt(DNSPod API 可自动续期;或腾讯云免费证书手动替换)
curl https://get.acme.sh | sh
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
| downloadFile 合法域名 | **图片域名**(COS bucket 自定义域名或默认域名) | 同上;`<image>`/`previewImage`/`downloadFile` 都走此白名单 |
| 图片域名 | COS 方案: `wallflow-wallpapers-1250000000.cos.ap-guangzhou.myqcloud.com`(建议绑定自定义域名走 CDN) | 若更换对象存储供应商,此域名随之替换,后端接口不变 |
| 内容安全 | 已开通权限 + `WECHAT_APPID/SECRET` 已填 → 生产导入自动真实检测;未配置则降级 pending_review(不入用户流) | — |
| 隐私协议 | 「相册(写入)」用途 + openid/设备标识处理声明(PIPL) | 公众平台 → 设置 → 用户隐私保护指引 |
| 代码开关 | 提交前把 `miniprogram/utils/config.ts` 的 `BASE_URL` 改为正式域名;**`AUTH_FALLBACK_ANON` 置 `false`**(生产走微信登录) | 代码 |

## 7️⃣ 提审材料自查(对照规格 #11 验收)

- [ ] **验收 1** 签名 URL: 真机 `downloadFile` 图片 200;非签名/过期访问 → 403(COS 私有读)
- [ ] **验收 2** `https://<domain>/health` 公网 200
- [ ] **验收 3** 开发者工具真机预览全流程: 首页流 → 详情 → 收藏 → 保存相册
- [ ] **验收 4** 提审材料: 类目(工具-图片/壁纸)/ 隐私协议 / 合法域名 / 内容安全权限
- [ ] **验收 5** 健康检查 + 基础告警: compose `restart: unless-stopped` + 外部 uptime 监控(如腾讯云拨测/UptimeRobot);进程挂了能发现
- [ ] **验收 6** DB 备份: 部署 `deploy/pg_backup.sh` + cron(见下)

```bash
# 备份 cron(每日 3 点):
chmod +x /data/wallflow/deploy/pg_backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /data/wallflow/deploy/pg_backup.sh") | crontab -
```

**常见提审驳回点**(提交前自查): 无隐私协议/收集声明、类目与内容不符、页面为演示数据(需真实内容 ≥ 若干张)、诱导分享、功能点击无响应(空态/错误态要友好)。

## 8️⃣ 上线后运维

- **回滚**: 后端 `docker compose -f docker-compose.prod.yml up -d --build <旧镜像>`;小程序微信后台撤回版本;DB 快照/备份恢复
- **DB 迁移**: 破坏性迁移先在本库验证 → 备份 → 再上
- **内容扩充**: 精选语料 20 → 100-300 张(manifest 扩量 + 限速导入);导入后检查 pending_review 数量
- **日志**: `docker logs wallflow-api --tail 100`;Fastify 已带结构化日志(5xx 有记录)
- **二期**: 激励视频广告(需企业主体 + 流量主达标)、内容审核重检流程

## 开放问题(上线前需拍板)

1. **COS 供应商**: 用户已搁置 COS 凭证,后期可能更换 — 届时只需换 `ObjectStorage` 实现 + 换 downloadFile 域名白名单,接口与 DB 不变
2. **Web 端是否首发**(DESIGN-UI.md §8): 若与小程序同步上线,同一服务器/域名,另需 @fastify/cors + React 构建物部署(归 #13)

---

## 验收核对(规格 11)

| 验收 | 状态 |
|------|------|
| 1. 签名 URL 服务器+真机 200 / 非签名 403 | ⬜ 待 COS 凭证 + 真机 |
| 2. https://<domain>/health 公网 ok | ⬜ 待部署 |
| 3. 真机完整流程 | ⬜ 待部署 + 真机 |
| 4. 提审材料齐备 | ⬜ 见 §6-7 |
| 5. 健康检查 + 告警 | 🟡 compose restart + 拨测待配 |
| 6. DB 自动备份 | 🟡 脚本就绪,待上 cron |
