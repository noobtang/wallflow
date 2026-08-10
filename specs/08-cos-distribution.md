---
title: "#8 图片分发(COS 签名直链)"
labels: [backend, p0]
---
# #8 图片分发(COS 签名直链)

## Context

图源决策修正后(2026-08-10): 图片托管在**国内对象存储**(腾讯云 COS,阿里云 OSS 等价)。COS 国内节点天然可达,**无需海外代理**。采用私有读 + 短期签名 URL(防爬、防盗链、免后端带宽)。

> 历史: 原"后端流式代理"方案针对 upload.wikimedia.org(大陆被墙)设计;换 COS 后直链安全合规(CC0 允许再分发),代理降级为可选兜底。

## Current State

#4 导入流水线上传 COS 后,`wallpapers` 表存 COS 对象 key。

## Proposed Change

提供 COS 上传/签名工具;列表与详情接口(#6)返回**签名直链 URL**。

### Implementation Details

- **依赖**: `cos-nodejs-sdk-v5`(腾讯云);env: `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION`
- **上传**: 导入流程(#4)调 `uploadObject`(bucket 私有读,key = `wallpapers/{source_id}.jpg`;缩略图 `wallpapers/{source_id}_thumb.jpg`,由 #4 用 sharp 生成后一并上传)
- **签名**: `getSignedUrl(key, expires=3600)` → #6 返回的 `thumbUrl`/`fullUrl` 即签名 URL
- **缓存头**: COS 对象设置 `Cache-Control: public, max-age=86400`
- **微信侧**: `downloadFile` / `request` 合法域名 = COS 域名(或备案 CDN 域名,见 #11)
- **可选代理兜底**: `/images/:id` 路由保留(转发 COS,用于统一域名/白名单需求),**默认关闭**
- **鉴权一致性**: 签名 URL 本身免鉴权(短时效),与小程序/Web 用户 token 无关
- **刷新策略**: 签名 URL 短时效(~1h);前端过期时重新请求 #6 列表/详情接口获取新签名 URL(幂等,无状态,无需专用刷新接口)

## Acceptance Criteria

1. 上传一张测试图 → COS 对象存在
2. 签名 URL 下载返回 200;过期后(expires=1s 测试)返回 403
3. 未签名访问私有对象 → 403
4. 小程序 `wx.downloadFile` 用签名 URL 下载成功(真机)
5. `GET /images/:id` 兜底路由(开启时)转发 COS 成功

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | 签名生成/过期(mock SDK) | +2 |
| Integration | 上传→签名→下载 全链路 | +2 |
| Unit | 可选代理路由 404/转发 | +2 |

## Rollback Plan

无状态。COS 对象保留可回滚;签名逻辑可单独下线改回代理。

## Effort Estimate

0.5d SDK 接入 + 0.5d 签名/测试 ≈ 1 天

## Related

- Epic: SPEC-MVP.md | #4, #6 | 设计文档内容源修正
