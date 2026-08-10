---
title: "#12 Web 客户端(React + Vite + Tailwind + PWA)"
labels: [frontend, web, p1]
---
# #12 Web 客户端(React + Vite + Tailwind + PWA)

## Context

用户确认(2026-08-10): 产品同时支持 Web 端。Web 与小程序(#9)共享同一后端 API(#5-#8)与设计体系(DESIGN-UI.md §4.6) — 同一 token、同一批接口、同一套 CSS 变量。信息架构与埋点事件完全一致。

## Current State

后端 API(#6 内容 / #7 用户 / #8 图片代理)就绪后即可开发;与 #9 小程序可并行。项目根目录无 Web 代码。

## Proposed Change

交付一个可安装的 PWA 壁纸站点(React + Vite + Tailwind + Service Worker),桌面/移动响应式。

### Implementation Details

**技术栈**: React 18 + Vite + TypeScript(strict)+ Tailwind CSS + React Router + Service Worker(Workbox 或手写)。

**目录结构**:
```
web/
├── package.json / vite.config.ts / tsconfig.json
├── tailwind.config.ts          # 颜色 token 对齐 DESIGN-UI.md §2.1(明亮默认 + 深色)
├── index.html / manifest.webmanifest
├── public/
│   ├── sw.js                   # Service Worker(预缓存壳 + 图片 LRU 缓存)
│   └── icons/
└── src/
    ├── main.tsx / App.tsx      # 路由 + 主题 Provider
    ├── theme.ts                # 明亮/深色切换(localStorage + prefers-color-scheme)
    ├── api/
    │   ├── client.ts           # fetch 封装(带 token,同 #9 utils/api.ts 语义)
    │   └── auth.ts             # 匿名设备 token(方案见 DESIGN-UI.md §8)
    ├── pages/                  # / 首页 · /category · /search · /detail/:id · /favorites
    └── components/             # WallpaperGrid / WallpaperCard / Lightbox / CategoryChips
```

**关键实现**:
- **布局**: 响应式栅格 — 桌面 3-4 列 / 平板 3 列 / 移动 2 列;桌面端顶部导航 + 键盘(←/→ 切换、Enter 保存、Esc 关闭)
- **详情 Lightbox**: **页内手势**(用户拍板)— 触摸滑动切换、双指/滚轮缩放、双击复位;图片为 COS 签名直链
- **主题**: 明亮默认 + 切换按钮;`localStorage` 持久化;`prefers-color-scheme` 初始检测
- **保存下载**: `fetch(url) → blob → a[download]`;桌面直接下载,移动端系统处理
- **Service Worker**: 预缓存应用壳(HTML/JS/CSS/图标);图片 Cache API 缓存(LRU 限额 ~50MB,离线可看已浏览壁纸)**— 缓存 key 用稳定标识(壁纸 id / COS 对象路径去掉 query),签名参数单独存,避免签名 URL 每次不同导致去重失效**;接口走 network-first + 缓存回退
- **埋点**: 事件名与 #10 一致(`preview_click`/`search_click`/`download_click`/`download_success`/`favorite_add`)
- **鉴权(已拍板)**: `POST /auth/anon` 匿名设备 token — 客户端生成 device_id,后端签发,localStorage 持久化,收藏按设备

## Acceptance Criteria

1. 桌面/平板/移动三档响应式正常(3-4/3/2 列)
2. 详情 Lightbox: 触摸滑动 + 缩放可用;桌面键盘 ←/→/Enter/Esc 可用
3. 主题切换生效并持久化(localStorage),默认明亮
4. 保存下载成功(桌面 + 移动)
5. 离线: 二次打开应用壳可用,已缓存壁纸可见
6. PWA 可安装(manifest 完整,SW 注册成功)
7. 埋点事件与 #10 一致,漏斗数据正确
8. 图片全部经后端代理(无上游直链)

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | theme 切换/持久化 | +2 |
| Unit | api client 错误处理 | +3 |
| E2E(Playwright) | 首页→详情→下载 全流程 | +2 |
| E2E | 离线模式(禁网后壳与缓存图可用) | +1 |

## Rollback Plan

静态站点: 回滚 = 部署上一构建版本;SW 版本号递增即可强制刷新。

## Effort Estimate

1d 骨架+栅格+主题 + 1d Lightbox+手势 + 1d SW 离线 + 1d 打磨 ≈ 3-4 天

## Related

- Epic: SPEC-MVP.md | DESIGN-UI.md §4.6(Web 设计)| #5, #6, #7, #8(共享 API)| #10(埋点)| #11(部署复用)
