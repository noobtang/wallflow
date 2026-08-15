# data/manifest.json — 精选壁纸清单(300 张)

## 内容来源

全部取自 **Wikimedia Commons**(CC0 图库)。前 100 张由人工精选 + 手写中文元数据;
后 200 张由 `backend/scripts/build-expansion.mjs` 从候选池(941 条)机器生成草稿
(文件名关键词 → 中文标题/分类/标签,负向过滤杂物),经 `import:dry-run` schema 校验后并入。

- 许可白名单(与 #3 `ALLOWED_LICENSES` 一致): **CC0 / CC BY / PD(公有领域)**
- 每条的 `creatorUrl` 指向 Commons 文件描述页,归属可一键核验
- 许可分布: PD×100 / CC0×175 / CC BY×25;分类分布(规格词表): 自然×80 / 星空×65 / 城市×55 / 风景×56 / 极简×38 / 艺术×6
- 所有图片为横向(w>h),分辨率 ≥ 2000px 宽,含 2K/4K/8K 级大图(超宽全景已按 schema 上限 20000 过滤)
- ⚠️ **后 200 张为机器生成草稿**: 标题/标签基于文件名关键词,生产导入前建议逐条核对
  (尤其 CC BY 的署名与许可版本);重新生成: `cd backend && node scripts/build-expansion.mjs`

## 取材来源(2026-08-11 扩库,20 → 100)

- **NASA/USFWS/NOAA 政府图库**(PD 为主): 天文星云、火星全景、海洋生物、鸟类、地貌景观
- **CC0 结构化搜索**(`haswbstatement:P275=Q6938433`): 城市天际线、极光、星轨、抽象画作、独树极简
- **CC BY 搜索**(`haswbstatement:P275=Q50829104`): 少量高品质城市/自然补充
- 候选流水线: `cd backend && node scripts/fetch-candidates.mjs --limit 40` → 输出 `data/candidates.json`
  (白名单许可 + 横向 + 宽≥2000 + 尺寸≤20000 过滤),人工精选后手写中文元数据并入 manifest

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

`data/images/*.jpg` 是本清单的**离线图片资产**(100 张):

- 从 Wikimedia 下载后经 sharp 压缩(最长边 2560、JPEG q82),manifest 每条带
  `localFile: "../data/images/<sourceId>.jpg"`(相对 backend 工作目录)
- **用途**: 微信开发者工具联调时,`npm run import` 走本地文件零网络,
  图片落盘到 `backend/.dev-storage`,由后端 `/dev-storage/*` 静态服务提供
  (`FileObjectStorage`,仅 dev 环境;生产仍走 COS 签名直链)
- **刷新资产**: 海外/可访问 Wikimedia 时运行 `cd backend && node scripts/fetch-images.mjs`
  (限速 + 429 退避重试 + 幂等跳过已存在文件);429 限流严重时用
  `node scripts/fetch-images-retry.mjs --rounds 8`(多轮慢速补跑,间隔 30s)
- ⚠️ **超大原图条目**: 少数条目(如 `Cosmic Cliffs` PNG 31MB、抽象画 TIFF/黑洞 TIFF)的
  `imageUrl` 指向原始格式,超过导入器 30MB 上限 — 生产 clone 仓库后 `node dist/cli/import.js`
  走 `localFile` 零网络导入,不受影响;但若在无 `data/images` 的环境用 imageUrl 导入会失败,
  需先跑 `fetch-images.mjs` 或删除该条目的 imageUrl 只留 localFile

## 图片再分发合规(热链调研,2026-08-15)

> 结论先行: **运行时不对上游热链** — 图片在导入时一次性镜像到 COS(私有读 + 签名直链),
> 与 upload.wikimedia.org 无运行时依赖,天然规避热链的三大风险(上游改图/删图/限流)。
> 本节的合规义务全部已落地(见下),无代码改动要求。

### 上游政策(primary sources,2026-08-15 核实)

**Wikimedia Commons(来源: [Reusing content outside Wikimedia](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia))**

- 几乎所有内容可在遵守许可条款(部分需署名/链接许可/同许可传播)的前提下自由再使用,无需联系授权方
- 公有领域内容不强制署名,但**推荐保留来源**(溯源与争议佐证)
- **热链被允许但不被推荐**(来源: [Reusing content outside Wikimedia/technical](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/technical)): 文件可能被改/删/更名;热链同样须遵守许可(署名等)
- 禁止"hot spider"(每次用户搜索都转发到 Wikimedia);逐条复制或联系基金会申请 live feed

**CC0 1.0(来源: [CC0 Deed](https://creativecommons.org/publicdomain/zero/1.0/deed.en))**

- 可复制/修改/分发/商用,无需请求许可;**不强制署名**(产品保留来源仅为溯源)

**CC BY 4.0(来源: [CC BY 4.0 Deed](https://creativecommons.org/licenses/by/4.0/deed.en)) + [Wikipedia: Creative Commons license](https://en.wikipedia.org/wiki/Creative_Commons_license)**

- 可复制/修改/商用,但**必须署名**(作者 + 许可链接)+ **声明是否修改**(4.0 起)
- BY 是唯一必选要素;SA/NC/ND 不在本清单白名单内(manifest schema 已排除)

### 本产品的合规落点(与上述对照)

| 上游要求 | 产品现状 | 状态 |
|----------|----------|------|
| 不热链(推荐下载复用) | 导入时下载 → COS 镜像,运行时签名直链 | ✅ 已满足 |
| 禁 hot spider | 导入限速(1.5s/请求 + 退避),逐条复制 | ✅ 已满足 |
| CC0 可无署名 | 详情页保留来源说明(溯源非义务) | ✅ 已满足 |
| CC BY 署名(作者+许可链接) | `utils/attribution.ts` 输出标题/作者/许可 URI,一键复制 | ✅ 已满足 |
| CC BY 修改声明 | `MODIFICATION_NOTE`(压缩/缩放 ≤2560px 声明) | ✅ 已满足 |
| 缓存策略 | COS 对象 `Cache-Control: public, max-age=86400` + 签名 URL 过期刷新(~1h) | ✅ 已满足 |

### 若未来改为直链上游(不推荐)需注意

1. 只能用 `Special:FilePath?width=N` 通道(官方建议),且遵守每张图的许可署名要求
2. 高频访问会被 429 限流 — 需本地缓存 + 退避,且不能做"搜索即转发"的 hot spider 模式
3. 上游改图/删图会直接影响产品 — 建议仍是镜像到自有存储

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

- 扩量至 500+ 张: `fetch-candidates.mjs` 再生候选 → `build-expansion.mjs` 生成草稿 → 人工核对 → 并入
- 后 200 张标题/标签的**人工复核**(机器生成草稿,生产导入前建议逐条过一遍)
- 新条目离线资产(`localFile`): 需要时可跑 `fetch-images.mjs` 补齐(当前新条目仅 imageUrl,导入走限速下载)
- GitHub CC0 仓库(如 dharmx/walls 等)可作补充取材,收录前必须逐张核实许可
