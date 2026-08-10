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
- [x] manifest 精选清单原型(2026-08-10): `data/manifest.json` 20 张样例(Commons CC0/CC BY/PD 精选 + 手写中文标签),`npm run import:dry-run` 跑通 → 扩量 100-300 张待做
- [ ] manifest 扩量:从 GitHub CC0 仓库/CC0 图库精选至 100-300 张,逐张核实许可(注意: upload.wikimedia.org 原图高频下载会 429 限流,导入须限速+退避,见 data/README.md)
- [ ] 精选 100-300 张壁纸 + 中文分类标签
- [ ] 核实微信小程序注册主体(个人 vs 企业/个体户,流量主资格)
- [x] 部署清单已产出(2026-08-11 #12): `deploy/README.md` 上线前清单 + docker-compose.prod.yml(postgres+迁移+api+nginx TLS)+ 备份脚本;实际购买服务器/备案待用户执行
- [x] 内容安全检测已接入(2026-08-11 #5: allow/block/degrade → pending_review 接口 + mock;真实腾讯云内容安全待上线前配置)
- [x] 合法域名配置清单已覆盖(2026-08-11 #12 §6: request=api 域名 / downloadFile=图片域名)
- [ ] 激励视频广告组件接入(组件可提前接入,流量主开通后生效;⚠️ 个人主体无流量主资格,广告变现需个体户/企业主体)

## From Outside Voice review (2026-08-10)

- [x] 中文搜索(2026-08-11 #6: jieba 分词 + 同义词 + 停用词 → search_text 入库,GIN FTS + 分类/标签过滤 + 复合 keyset 游标)
- [ ] 图片热链合规:CC0 源若允许热链则用直链+缓存策略;若需回调则按源实现
- [ ] 摄影师/来源链接在微信内的可达性验证(web-view 域名白名单)
- [x] 埋点事件定义表(2026-08-11: DESIGN-UI.md §5 漏斗事件 + POST /events 幂等上报已上线 #8)
- [ ] 激励视频服务端回调接入(流量主开通后,与广告 SDK 对接)
- [ ] 高清下载与"反付费墙"定位的平衡策略:广告 fill rate 低时的降级方案(如限时免费)

## From Eng review (2026-08-10)

- [ ] 后端流式代理带宽监控:MVP 采用流式代理,需监控带宽成本,升高时升级 COS 转存
- [ ] 回填任务持久化:DB 锁/租约防多副本重叠(node-cron 非持久调度)
- [ ] 完整署名:CC-BY 需 title/author/license URI/修改声明(非仅来源链接)
- [ ] CI 测试:内容管道基于本地 manifest 导入(无上游实时依赖),COS SDK 用 mock
- [ ] 运维:DB 备份/PITR、健康检查、告警、管理员路径(暂停回填/隔离内容/审举报)
- [ ] 版权投诉与中国监管下架流程
