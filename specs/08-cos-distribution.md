---
title: "#8 图片分发(自有服务器存储优先,COS 签名直链为第二选项)"
labels: [backend, p0]
---
# #8 图片分发(自有服务器存储优先,COS 签名直链为第二选项)

## Context

图源决策修正后(2026-08-10): 图片托管在**国内对象存储**(腾讯云 COS,阿里云 OSS 等价)。COS 国内节点天然可达,**无需海外代理**。采用私有读 + 短期签名 URL(防爬、防盗链、免后端带宽)。

> 历史: 原"后端流式代理"方案针对 upload.wikimedia.org(大陆被墙)设计;换 COS 后直链安全合规(CC0 允许再分发),代理降级为可选兜底。
>
> **2026-08-15 修正(用户决定)**: 图片改走**自有服务器 + 域名**,COS 降为第二选项。
> 存储层不变(仍是 `ObjectStorage` 抽象 + `wallpapers` 表存对象 key),新增
> `DiskObjectStorage`(上传落盘本地目录,nginx 静态直出);工厂优先级:
> 自有存储(`SELF_HOST_STORAGE_DIR` + `SELF_HOST_BASE_URL`)→ COS(完整凭证)→ dev 文件存储 → mock。

## Current State

#4 导入流水线上传到存储后,`wallpapers` 表存对象 key(不区分后端)。

## Proposed Change

提供存储上传工具;列表与详情接口(#6)返回**可访问直链 URL**(自有存储: 公开读;COS: 签名直链)。

### Implementation Details

- **自有服务器存储(首选)**: `DiskObjectStorage` — 上传字节落盘到 `SELF_HOST_STORAGE_DIR`(compose 中与 nginx 共享 `images` 卷),nginx 以 `/images/*` 静态服务(`Cache-Control: public, max-age=86400`);`getSignedUrl` 返回 `{SELF_HOST_BASE_URL}/{key}`(内容为 CC0/CC-BY 公开图片,公开读无需签名)。env: `SELF_HOST_STORAGE_DIR` / `SELF_HOST_BASE_URL`
- **COS(第二选项)**: 完整凭证(`COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION`)才启用;依赖 `cos-nodejs-sdk-v5`
- **上传**: 导入流程(#4)调 `uploadObject`(key = `wallpapers/{source_id}.jpg`;缩略图 `wallpapers/{source_id}_thumb.jpg`,由 #4 用 sharp 生成后一并上传)
- **缓存头**: COS 对象设置 `Cache-Control: public, max-age=86400`(自有存储由 nginx 头部等价实现)
- **微信侧**: `downloadFile` / `request` 合法域名 = 自有图片域名(或 COS 域名/备案 CDN 域名,见 #11)
- **可选代理兜底**: `/images/:id` 路由保留,默认关闭
- **鉴权一致性**: COS 签名 URL 免鉴权(短时效);自有存储公开读(图片内容非敏感)
- **刷新策略**: COS 签名 URL 短时效(~1h);前端过期时重新请求 #6 列表/详情接口获取新 URL(幂等,无状态,无需专用刷新接口)

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
