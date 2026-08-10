---
title: "#9 小程序前端(信息流/分类/搜索/详情/保存)"
labels: [frontend, p0]
---
# #9 小程序前端

## Context

用户看到和交互的部分:浏览壁纸 → 找到喜欢的 → 保存到相册。设计: 3 步完成"打开→找到→保存"。

## Current State

后端 API(#5, #6, #7, #8)就绪后可联调。项目根目录当前无小程序代码。

## Proposed Change

原生微信小程序(WXML/WXSS/TS),页面: 首页信息流 / 分类 / 搜索 / 详情 / 收藏。

### Implementation Details

**页面结构**:
```
miniprogram/
├── app.ts / app.json / app.wxss   # 全局配置,tabBar: 首页/分类/我的
├── pages/
│   ├── index/           # 首页信息流(双列瀑布流,懒加载)
│   ├── category/        # 分类 Tab(中文分类标签)
│   ├── search/          # 搜索页
│   ├── detail/          # 详情页(大图+署名+许可+保存+收藏+举报)
│   └── favorites/       # 我的收藏
├── components/
│   └── wallpaper-card/  # 壁纸卡片(复用)
├── utils/
│   ├── api.ts           # 后端 API 封装(带 token)
│   ├── auth.ts          # 登录(code2Session→token)
│   └── track.ts         # 埋点上报
└── project.config.json  # 合法域名配置
```

**关键交互**:
- 首页: 双列瀑布流,下拉刷新 + 上拉加载(keyset 分页)
- 详情: 大图预览(COS 签名直链)、署名+许可展示、保存按钮(授权→保存相册)、收藏、举报
- 保存: `wx.getSetting` → `wx.authorize(scope.writePhotosAlbum)` → `wx.downloadFile`(合法域名)→ `wx.saveImageToPhotosAlbum`;拒绝授权给引导弹窗
- 登录: 静默 `wx.login` → `POST /auth/login` → 存 token
- 深色模式: `darkmode: true` + CSS 变量
- 分享: `wx.shareAppMessage` 自定义封面

## Acceptance Criteria

1. 首页双列流加载 ≥20 张图,滚动加载不卡顿
2. 分类切换过滤正确
3. 搜索"风景"返回相关结果
4. 详情页: 保存到相册成功(真机);授权被拒时有引导
5. 收藏/取消收藏即时反馈
6. 深色模式切换正常
7. 分享卡片带缩略图
8. 无网络时显示友好错误态,可重试

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| E2E | 打开→找到→保存 全流程(真机) | +1 |
| Unit | api.ts 封装/错误处理 | +3 |
| Unit | 保存授权流程状态机 | +2 |

## Rollback Plan

小程序发版走微信审核。代码回滚 = 撤回版本。前端与后端接口向前兼容即可。

## Effort Estimate

1d 骨架+信息流 + 1d 详情+保存 + 1d 搜索/分类/收藏 + 1d 打磨 ≈ 3-4 天

## Related

- Epic: SPEC-MVP.md | #5, #6, #7, #8
