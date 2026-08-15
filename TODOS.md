# TODOS — WallFlow 免费授权壁纸小程序

## Deferred from CEO Review (2026-08-10)

- [ ] 动态/视频壁纸(Pexels 视频)— 微信无视频设壁纸 API,延后到有平台支持或做 App 端时
- [ ] 真实广告位接入 — 流量主达标(UV ≥ 1000)后二期
- [ ] UGC 上传、评论 — MVP 明确不做
- [ ] 个性化推荐(ML)— 待相似推荐(标签匹配)验证后评估
- [ ] 管理后台 — 内容运营规模化后

## Pre-launch checklist

- [x] 选定首源:Wikimedia Commons(2026-08-10 调研)→ **二次修正(2026-08-10): 精选 CC0 语料转存国内 COS**(Wikimedia 大陆不可达,jsDelivr/Gitee 实测不可靠)
- [ ] 开通对象存储(用户 2026-08-11 搁置 COS 凭证,后期可能换供应商;接口已抽象 `ObjectStorage`,更换只改实现 + downloadFile 域名白名单)
- [x] manifest 精选清单原型(2026-08-10): `data/manifest.json` 20 张样例(Commons CC0/CC BY/PD 精选 + 手写中文标签),`npm run import:dry-run` 跑通
- [x] manifest 扩量 20 → 100 张(2026-08-11 #10): `fetch-candidates.mjs` 13 源取材(NASA/USFWS/NOAA/CC0 搜索/极光/星轨/抽象)+ 人工精选 + 手写中文元数据;离线资产 `data/images` 100 张(65MB, sharp 压缩);dev 库导入 100/100;CI 全绿
- [x] manifest 扩量至 300 张(2026-08-15): `scripts/build-expansion.mjs` 从候选池 941 条选 200(白名单许可+横向+2K+去重+关键词中文元数据+杂物负向过滤),dry-run 校验 300/300 通过
- [x] 扩库 200 张逐条人工核对(2026-08-15): `scripts/review-expansion.mjs` 决策表逐条过目 — 剔除 98 条非壁纸/重复(地名撞名极光、学校/法院/教堂、鱼标本、人物照、刷屏重复),保留 102 条手写修正标题/分类/标签,从候选池补足 98 条(分类配额均衡 + 同作者/前缀去重),`import:dry-run` 300/300 通过
- [x] 精选 100 张壁纸 + 中文分类标签(分类: 自然29/城市19/星空18/风景18/极简10/艺术6;许可: PD43/CC0 42/CC BY 15)
- [ ] 核实微信小程序注册主体(个人 vs 企业/个体户,流量主资格)
- [x] 部署清单已产出(2026-08-11 #12): `deploy/README.md` 上线前清单 + docker-compose.prod.yml(postgres+迁移+api+nginx TLS)+ 备份脚本;实际购买服务器/备案待用户执行
- [x] 内容安全检测已接入(2026-08-11 #5: allow/block/degrade → pending_review 接口 + mock;真实腾讯云内容安全待上线前配置)
- [x] 合法域名配置清单已覆盖(2026-08-11 #12 §6: request=api 域名 / downloadFile=图片域名)
- [x] 激励视频广告组件接入(2026-08-15: `utils/rewarded-ad.ts` + 详情页保存前看完广告再解锁;空 `REWARDED_AD_UNIT_ID` 自动降级免费;流量主开通后填 ID 即生效 ⚠️ 个人主体无流量主资格,需个体户/企业主体)

## From Outside Voice review (2026-08-10)

- [x] 中文搜索(2026-08-11 #6: jieba 分词 + 同义词 + 停用词 → search_text 入库,GIN FTS + 分类/标签过滤 + 复合 keyset 游标)
- [ ] 图片热链合规:CC0 源若允许热链则用直链+缓存策略;若需回调则按源实现
- [ ] 摄影师/来源链接在微信内的可达性验证(web-view 域名白名单)
- [x] 埋点事件定义表(2026-08-11: DESIGN-UI.md §5 漏斗事件 + POST /events 幂等上报已上线 #8)
- [ ] 激励视频服务端回调接入(流量主开通后,与广告 SDK 对接)
- [ ] 高清下载与"反付费墙"定位的平衡策略:广告 fill rate 低时的降级方案(如限时免费)

## From Eng review (2026-08-10)

- [ ] 后端流式代理带宽监控:MVP 已改 COS 签名直链(免后端带宽);若未来走代理,需监控带宽成本
- [x] 回填任务持久化(2026-08-15): `src/jobs/lease.ts` DB 租约(job_leases 表,过期强占)+ `src/jobs/scheduler.ts` 调度器 + `npm run backfill:scheduled`;cron/systemd 触发,防多副本重叠
- [x] 完整署名(2026-08-15): `miniprogram/utils/attribution.ts` — CC BY 输出标题/作者(含来源)/许可 URI/修改声明,详情页可一键复制
- [x] CI 测试:内容管道基于本地 manifest 导入(2026-08-15): `test/jobs/import-real-manifest.test.ts` — 真实 300 条 manifest 经 **localFile 分支 + mock COS** 全链路导入(零网络,无上游依赖): 契约校验(全量 localFile 文件存在)/导入落库/缩略图质量/幂等/resume 语义,4 测试
- [x] 运维(2026-08-15): 管理员路径 `/admin/*`(隔离内容/审举报/暂停回填)+ 运维面板 `/admin/health` + `ADMIN_API_KEY`;DB 备份脚本/健康检查已有
- [x] 运维告警 + 管理接口文档(2026-08-15): 5xx → 群机器人 webhook(`OPS_ALERT_WEBHOOK_URL`,防抖聚合 60s 窗口不刷屏,`src/ops/alerter.ts` 8 测试);管理接口完整 API 说明 `deploy/ADMIN-API.md`(认证/端点/错误/curl/告警配置)
- [x] 版权投诉与中国监管下架流程(2026-08-15): `deploy/TAKEDOWN-SOP.md` SOP + block/restore/reports 管理接口执行面
