# 微信开发者工具联调指南(#10)

目标: 在微信开发者工具里加载 `miniprogram/`,把首页瀑布流跑通。

## 前置: 本地后端必须能跑(图片能真实加载)

首页瀑布流的关键是**图片 URL 能真的下载**。本项目 dev 环境使用
`FileObjectStorage`(#10): 图片字节落盘在 `backend/.dev-storage/`,由后端
`/dev-storage/*` 静态路由服务,不依赖 COS 凭证、不依赖海外图床。

```bash
cd backend
# 1) 准备 Postgres(本机需已装),建库:
createdb wallflow
# 2) 按 .env.example 填 backend/.env(至少 DATABASE_URL;COS/微信可不填)
# 3) 应用迁移 + 导入壁纸(图片资产在仓库 data/images/,零网络):
npm run db:up
npm run import -- --resume   # localFile 本地读取,秒级完成
# 4) 起后端(默认 3000):
npm run dev
```

> 图片资产已随仓库分发(`data/images/*.jpg`,manifest 的 `localFile` 指向它们),
> 无需访问 Wikimedia。若你在海外/能访问 Wikimedia 且想重新抓取,
> 可运行 `node scripts/fetch-images.mjs` 刷新资产。

## 加载项目

1. 打开微信开发者工具 → 导入项目
2. 项目目录选择 **`miniprogram/`**(含 project.config.json 的那个目录)
3. AppID: 选「测试号」即可(或你自己的小程序 AppID)
4. 本地设置: 详情 → 本地设置 → **勾选「不校验合法域名」**
   (dev 后端是 http://127.0.0.1,未备案、非 HTTPS,必须勾选)

## BASE_URL 两种模式

`miniprogram/utils/config.ts` 的 `BASE_URL`:

| 场景 | BASE_URL | 说明 |
|------|----------|------|
| 开发者工具(本机后端) | `http://127.0.0.1:3000`(默认) | 本机后端同机,直接可达 |
| 真机预览(手机) | `http://<电脑局域网IP>:3000` | 手机与电脑同一 Wi-Fi;IP 用 `ipconfig`/`ifconfig` 查 |

> 真机预览注意: 微信开发者工具「真机调试」时手机访问电脑的 3000 端口,
> 需确认电脑防火墙放行 3000,且仍勾选不校验合法域名。

## 后端换了端口?

- 改 `backend/.env` 的 `PORT`(如 3100)
- 同步改 `miniprogram/utils/config.ts` 的 `BASE_URL` 端口
- `FileObjectStorage` 的 `DEV_STORAGE_BASE_URL` 留空时默认取 `http://127.0.0.1:<PORT>`

> 本机联调实测(2026-08-11): 3000 被同机其他应用占用时,
> `backend/.env` 改 `PORT=3100` 后,后端自动在 3100 提供 `/dev-storage/*`
> 图片服务;miniprogram 的 BASE_URL 同步改为 `http://127.0.0.1:3100` 即可。

## 联调验证过的链路(后端侧)

```bash
curl http://127.0.0.1:3100/health                  # {"status":"ok"}
curl 'http://127.0.0.1:3100/wallpapers?limit=2'   # 20 条,thumbUrl/fullUrl 指向 /dev-storage/*
curl 'http://127.0.0.1:3100/categories'           # 分类 + 计数
# 任取一条 thumbUrl 下载 → 200 + image/jpeg + 600px 缩略图
```

## 首页瀑布流跑通检查清单

- [ ] 后端 `curl http://127.0.0.1:3000/health` → `{"status":"ok"}`
- [ ] `curl http://127.0.0.1:3000/wallpapers` 返回 20 条,每条 `thumbUrl` 形如
      `http://127.0.0.1:3000/dev-storage/wallpapers/xxx_thumb.jpg`
- [ ] 浏览器打开该 thumbUrl 能显示图片(200 + image/jpeg)
- [ ] 开发者工具模拟器: 首页出现双列瀑布流,图片真实渲染,滚动加载下一页
- [ ] 深色模式: 右上角胶囊按钮 → 跟随系统 / 手动切换三档

## 常见问题

| 现象 | 原因 / 解决 |
|------|-------------|
| 图片全部「加载失败」 | 后端没起 / BASE_URL 不对 / 没勾不校验域名 |
| `errno 600001` 之类域名错误 | 未勾「不校验合法域名」 |
| 首页空白(无网络请求) | 确认 config.ts BASE_URL 与后端端口一致 |
| 收藏/登录报错 | dev 环境无需微信凭证: 自动降级匿名身份(AUTH_FALLBACK_ANON) |
| 保存到相册失败 | 开发者工具需模拟器「隐私授权」弹窗放行;真机需后台配置相册隐私声明 |

## 生产注意(与联调无关,上线前)

- 生产后端走 COS 签名直链(COS 凭证就位后自动启用),图片域名是 COS 域名,
  需配到微信后台 downloadFile 合法域名;`FileObjectStorage` 与 `/dev-storage` 仅在
  `NODE_ENV=development` 生效(server.ts 有守卫)。
- 上线前 `AUTH_FALLBACK_ANON=false`(微信登录为主),见 deploy/README.md。
