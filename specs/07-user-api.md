---
title: "#7 鉴权 + 收藏 + 解锁 + 举报 API"
labels: [backend, p0]
---
# #7 鉴权 + 收藏 + 解锁 + 举报 API

## Context

用户侧交互 API。ENG-PLAN.md 决策: 双身份(小程序 openid / Web 匿名设备)统一映射 user_id(HMAC 哈希)→ 短时效 token;收藏/解锁/举报均有唯一约束防滥用。

## Current State

#2 Schema 完成(favorites/ad_unlocks/reports 表存在)。#1 骨架可注册路由。

## Proposed Change

实现鉴权中间件 + 4 组 API。

### Implementation Details

**鉴权**(`src/plugins/auth.ts`):
- `POST /auth/login` {code} → 后端调微信 code2Session → openid(小程序端)
- `POST /auth/anon` {device_id} → 签发匿名设备 token(**Web 端**,2026-08-10 拍板;收藏按设备);device_id 为**客户端生成的随机 UUID**(不可枚举,防盗用他人收藏)
- openid / device_id 统一映射内部 user_id,均用 HMAC-SHA256(env JWT_SECRET 派生 key)哈希,不存明文
- 签发 JWT(短时效,如 2h)+ refresh token(可选 MVP 简化: 仅 access token)
- 鉴权中间件: 校验 Authorization header,注入 request.user

**API**:
| 路由 | 说明 | 约束 |
|------|------|------|
| `POST /favorites` {wallpaper_id} | 收藏 | 已登录 |
| `GET /favorites` | 我的收藏(分页) | 已登录 |
| `DELETE /favorites/:id` | 取消收藏 | 已登录 |
| `POST /unlock` {wallpaper_id} | MVP 全免费解锁(记录 openid+壁纸) | 已登录,UNIQUE(user,wallpaper) |
| `POST /reports` {wallpaper_id, reason} | 举报 | 已登录,UNIQUE(user,wallpaper),reason 长度校验 |
| `POST /events` {event_name, event_id, wallpaper_id?} | 埋点上报(#10 漏斗的数据入口) | 可匿名,UNIQUE(event_id) 幂等 |

- 收藏返回时 join wallpaper 详情(含缩略图)
- 解锁接口:MVP 返回成功 + 记录,不接真实广告(流量主达标后二期)

## Acceptance Criteria

0. `POST /events` 幂等上报(重复 event_id 不重复入库)— 详细见 #10

1. `POST /auth/login` 用 mock code 返回 token(集成测试)
1.5. `POST /auth/anon` 签发匿名 token,收藏按设备隔离(集成测试)
2. 未登录访问收藏/解锁/举报 → 401
3. 重复收藏 → 幂等(第二次 200 或已存在,非 500)
4. 解锁重复 → 幂等
5. 举报重复 → 幂等
6. openid 以 HMAC 哈希存储(DB 验证无明文)
7. 全部路由集成测试通过

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | HMAC openid 哈希 | +2 |
| Unit | JWT 签发/校验/过期 | +3 |
| Integration | 登录→收藏→解锁→举报 全链路 | +4 |
| Integration | 401/幂等/重复 | +4 |

## Rollback Plan

接口可单独下线。JWT_SECRET 轮换会使现有 token 失效(需告知用户重新登录)。

## Effort Estimate

0.5d 鉴权 + 1d 四组 API + 0.5d 测试 ≈ 2 天

## Related

- Epic: SPEC-MVP.md | #2 | ENG-PLAN.md 安全决策
