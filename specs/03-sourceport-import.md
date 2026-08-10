---
title: "#3 SourcePort + 精选语料导入(CuratedImport)"
labels: [backend, p0]
---
# #3 SourcePort + 精选语料导入(CuratedImport)

## Context

**内容源决策(2026-08-10 二次修正)**: Wikimedia Commons 大陆不可达,jsDelivr 官方 CDN 大陆被阻断、Gitee 防盗链强制登录(均实测) → MVP 内容源改为 **精选 CC0/CC BY 语料 + 国内对象存储(COS/OSS)转存**。CC0/CC BY/MIT 许可允许再分发,转存完全合法且零上游可达性依赖。

SourcePort 接口抽象保留 — CuratedImport 为 MVP 实现;Wikimedia/Openverse 适配器延后二期。

## Current State

无代码。精选清单(manifest)由人工准备(设计文档 The Assignment: 精选 100-300 张 + 手写中文标签)。

## Proposed Change

实现 SourcePort 接口 + CuratedImport(清单导入器),输出规范化壁纸元数据供 #4 入库。

### Implementation Details

**SourcePort**(`src/sources/source.interface.ts`):
```ts
interface SourcePort {
  // MVP: 读取精选清单;二期: search 拉取上游
  read(manifest: Manifest): AsyncIterable<NormalizedWallpaper>;
}
interface NormalizedWallpaper {
  sourceId: string; title: string;
  license: string; licenseUrl: string;
  creator: string; creatorUrl: string;
  width: number; height: number; tags: string[];
  localFile?: string;   // 清单中本地/下载源文件
  imageUrl?: string;    // 或远程 URL
  category: string;
}
```

**Manifest 格式**(`data/manifest.json`,人工维护):
```json
[
  {
    "sourceId": "nordic-001", "title": "Misty Fjord",
    "imageUrl": "https://...", "category": "风景",
    "tags": ["风景", "山", "湖泊"],
    "license": "CC0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "creator": "JaneDoe", "creatorUrl": "https://github.com/JaneDoe",
    "width": 3840, "height": 2160
  }
]
```

- **CuratedImport**(`src/sources/curated.import.ts`): 读 manifest → zod 逐条校验(字段缺失/类型错 → 跳过 + 告警)→ 许可白名单校验(仅 CC0/CC BY/PD,带 licenseUrl)→ 输出 NormalizedWallpaper 流
- **标签来源(已定)**: 人工精选时在 manifest 中手写中文标签(分类词表: 风景/极简/萌宠/动漫/城市/星空/自然/艺术)
- **内容输入源**: GitHub 开源壁纸仓库(如 dharmx/walls 等 CC0/MIT 仓库,仅供精选取材)+ 各 CC0 图库 + 原创挑选;收录前核实许可

## Acceptance Criteria

1. 给定 10 行测试 manifest,导入产出 10 条规范化记录
2. 许可不在白名单(CC0/CC BY/PD)的条目被拒
3. 畸形行(缺字段/类型错)跳过且不中断,告警日志
4. SourcePort 契约类型完整(二期可插拔 Wikimedia 适配器)

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | manifest 解析 + 许可白名单过滤 | +3 |
| Unit | zod 拒绝畸形行 | +3 |
| Integration | 10 行 manifest 全流程 → 规范化输出 | +1 |

## Rollback Plan

纯新增读取器,无状态,不影响其他模块。

## Effort Estimate

0.5d 接口 + 0.5d 导入器 + 0.5d 测试 ≈ 1-1.5 天

## Related

- Epic: SPEC-MVP.md | #2, #4 | 设计文档内容源修正 | ENG-PLAN.md SourcePort 节
