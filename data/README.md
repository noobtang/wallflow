# data/manifest.json — 精选壁纸清单(MVP 样例 20 张)

## 内容来源

全部取自 **Wikimedia Commons**(CC0 图库),由人工精选 20 张,手写中文标题与标签。

- 许可白名单(与 #3 `ALLOWED_LICENSES` 一致): **CC0 / CC BY / PD(公有领域)**
- 每条的 `creatorUrl` 指向 Commons 文件描述页,归属可一键核验
- 许可分布: CC0×4 / CC BY×10 / PD×6;分类分布(规格词表): 星空×5 / 自然×6 / 城市×3 / 极简×3 / 风景×2 / 艺术×1
- 所有图片为横向(w>h),分辨率 ≥ 2288×1880,含 2K/4K 级大图

## 实测发现(2026-08-10,供 #4 导入实现参考)

> ✅ **已按此实现(2026-08-11, #4 导入流水线)**: `npm run import` 走限速下载
> (1.5s/请求)+ 429/5xx 指数退避 + 原图失败自动降级 `Special:FilePath?width=4096`;
> 运行时图片全部走 COS 签名直链(#8),与上游无关。

1. **原图直链会被限流(429)**: upload.wikimedia.org 对原分辨率文件的高频下载有
   激进限流(数据中心/共享 IP 尤其明显;多次 HEAD/GET 后 429,响应体建议改用缩略图)。
   → **导入流水线必须**: 限速 + 429 重试退避(指数退避),逐条下载,禁止并发突发。
2. **缩略图通道稳定**: `https://commons.wikimedia.org/wiki/Special:FilePath/<文件名>?width=N`
   返回 200(实测 800px 正常),是 Commons 官方建议的下载方式。
   → 导入时可先用 `Special:FilePath?width=4096` 拉大缩略图,原图 429 时降级,不影响收录。
3. **与产品架构的关系**: 这些限流只影响"导入时的一次性下载"。产品运行时图片全部走
   COS 签名直链(#8),与 upload.wikimedia.org 无关 — 本清单不向用户暴露上游直链。

## 图片资产(#10 联调,2026-08-11)

`data/images/*.jpg` 是本清单的**离线图片资产**(20 张,共 ~11.5MB):

- 从 Wikimedia 下载后经 sharp 压缩(最长边 2560、JPEG q82),manifest 每条带
  `localFile: "../data/images/<sourceId>.jpg"`(相对 backend 工作目录)
- **用途**: 微信开发者工具联调时,`npm run import` 走本地文件零网络,
  图片落盘到 `backend/.dev-storage`,由后端 `/dev-storage/*` 静态服务提供
  (`FileObjectStorage`,仅 dev 环境;生产仍走 COS 签名直链)
- **刷新资产**: 海外/可访问 Wikimedia 时运行 `cd backend && node scripts/fetch-images.mjs`
  (限速 + 429 退避重试 + 幂等跳过已存在文件)
- 生产不需要本目录(导入在生产走 imageUrl → COS,见 deploy/README)

## 二次加工前的字段说明

| 字段 | 说明 |
|------|------|
| `sourceId` | `cc-<文件名>` 派生,全局唯一,供 #4 `ON CONFLICT (source, source_id)` 幂等 |
| `imageUrl` | 原图 URL(已去 utm 参数),导入下载用 |
| `localFile` | 离线资产相对路径(backend CWD),联调零网络导入用;与 imageUrl 二选一 |
| `license` / `licenseUrl` | 白名单许可 + 官方许可页 |
| `creator` / `creatorUrl` | 作者署名 + Commons 文件页(CC BY 必须保留署名) |
| `category` / `tags` | 分类词表(风景/极简/萌宠/动漫/城市/星空/自然/艺术)+ 手写中文标签 |

## 后续

- 二期扩量至 100-300 张: 同流程(Commons 搜索 → 许可/尺寸过滤 → 人工精选 → 手写标签)
- GitHub CC0 仓库(如 dharmx/walls 等)可作补充取材,收录前必须逐张核实许可
