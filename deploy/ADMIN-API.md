# WallFlow 管理接口 API 说明(#12)

> 管理面 = 内容隔离 / 举报审阅 / 回填开关 / 运维告警的对接文档。
> 适用对象: 运维、自动化脚本(告警/巡检)、版权投诉处理人员(与 `TAKEDOWN-SOP.md` 配合)。
> 前置: 已配置 `ADMIN_API_KEY`(未配置 → 全部管理操作返回 503,见下文)。

---

## 1. 认证

所有管理接口(除 `/admin/health` 的未配置探测外)要求请求头:

```
X-Admin-Key: <ADMIN_API_KEY>
```

- 密钥来自环境变量 `ADMIN_API_KEY`(建议 `openssl rand -hex 32` 生成)
- 服务端恒定时间比较,长度不匹配同样返回 401(不泄露密钥长度)
- **未配置 `ADMIN_API_KEY`**:
  - `GET /admin/health` → `200 {"configured": false}`(用于探测管理面是否可用)
  - 其余管理操作 → `503`(管理面上线前不暴露,避免空密钥误配)
- 错误: 缺失/错误密钥 → `401 {"error":{"code":"HTTP_401","message":"管理员密钥无效"}}`

## 2. 通用约定

- 响应错误统一为 `{ "error": { "code": "...", "message": "..." } }`
- 5xx 错误对外统一脱敏为 `Internal server error`(不泄露内部细节)
- 所有写操作**幂等或明确报错**: 重复操作返回 404/提示,不产生脏数据
- 时间字段为 ISO 8601;分页使用 keyset(cursor)

## 3. 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/health` | 运维面板: 未处理举报数、回填暂停状态 |
| POST | `/admin/wallpapers/:id/block` | 隔离内容(版权投诉/违规下架执行面) |
| POST | `/admin/wallpapers/:id/restore` | 恢复内容(误隔离/申诉通过) |
| GET | `/admin/reports` | 举报列表(keyset 分页,含壁纸摘要) |
| DELETE | `/admin/reports/:id` | 处理举报(下架或驳回后移除记录) |
| POST | `/admin/backfill/pause` | 暂停定时回填(flag 落库,多副本共享) |
| POST | `/admin/backfill/resume` | 恢复定时回填 |

## 4. 端点详情

### 4.1 GET /admin/health

运维面板概览(健康检查/告警骨架)。

```
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" https://api.example.com/admin/health
```

```json
{
  "configured": true,
  "openReports": 3,
  "backfillPaused": false
}
```

| 字段 | 说明 |
|------|------|
| `configured` | 管理面是否已配置密钥 |
| `openReports` | 未处理举报数(审阅队列长度) |
| `backfillPaused` | 回填是否处于暂停(调度器读此开关) |

### 4.2 POST /admin/wallpapers/:id/block

隔离内容: `status → blocked`,从信息流/搜索/详情/收藏列表全部移除(详情返回 404)。

```
curl -s -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  https://api.example.com/admin/wallpapers/42/block
```

```json
{ "id": 42, "status": "blocked" }
```

错误:

| 状态码 | 场景 |
|--------|------|
| 400 | `id` 非正整数 |
| 404 | 壁纸不存在或已是 `blocked`(重复操作幂等提示) |

### 4.3 POST /admin/wallpapers/:id/restore

恢复内容: `status → active`,重新对外可见。

```
curl -s -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  https://api.example.com/admin/wallpapers/42/restore
```

```json
{ "id": 42, "status": "active" }
```

错误: 400(id 非法)/ 404(不存在或已是 `active`)。

### 4.4 GET /admin/reports

举报审阅列表,按 `reports.id` 倒序 keyset 分页;每条含被举报壁纸摘要(不暴露举报人明文身份,仅哈希 ID)。

```
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" \
  "https://api.example.com/admin/reports?limit=20"
```

```json
{
  "items": [
    {
      "id": 7,
      "userId": "<hmac-hash>",
      "reason": "涉嫌侵权",
      "createdAt": "2026-08-15T08:00:00.000Z",
      "wallpaper": {
        "id": 42,
        "sourceId": "cc-xxx",
        "title": "示例壁纸",
        "category": "风景",
        "status": "active",
        "license": "CC0"
      }
    }
  ],
  "nextId": null
}
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `limit` | 20 | 1-100 |
| `cursor` | 无 | 上一页返回的 `nextId`;翻页: `?cursor=<nextId>` |

`nextId` 非 null 表示还有下一页(取最后一条的 `id` 作为下一页 `cursor`)。

### 4.5 DELETE /admin/reports/:id

处理举报(下架或驳回后移除记录;幂等 —— 记录已删 → 404)。

```
curl -s -X DELETE -H "X-Admin-Key: $ADMIN_API_KEY" \
  https://api.example.com/admin/reports/7
```

```json
{ "resolved": true }
```

错误: 400(id 非法)/ 404(举报不存在)。

### 4.6 POST /admin/backfill/pause | resume

暂停/恢复定时回填(`backfill_search` 调度器读取 `backfill_paused` flag;不中断正在运行的批次)。

```
curl -s -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  https://api.example.com/admin/backfill/pause
```

```json
{ "paused": true }
```

`resume` 返回 `{ "paused": false }`。flag 落库(`system_flags`),多副本/多实例共享,重启不丢失。

## 5. 运维告警接入(5xx 通知)

后端内置 5xx 告警: 任何响应 `statusCode >= 500` → 聚合后推送到群机器人 webhook。

### 5.1 配置

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `OPS_ALERT_WEBHOOK_URL` | 空(禁用) | 群机器人 webhook(企业微信/钉钉群机器人通用格式) |
| `OPS_ALERT_MIN_INTERVAL_SECONDS` | 60 | 告警窗口: 窗口内多条 5xx 合并为一条通知 |

示例(企业微信群机器人):

```bash
OPS_ALERT_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
OPS_ALERT_MIN_INTERVAL_SECONDS=60
```

### 5.2 行为

- **防抖聚合**: 同一 60s 窗口内的多条 5xx 合并为一条通知(首条到达后延迟一个窗口发送)
- 通知体: 5xx 告警 + 时间 + 次数 + 前 5 条去重路径样本(风暴时不会刷屏)
- **容错**: 通知发送失败只记日志,不影响业务请求;超时 5s 兜底
- **禁用即零副作用**: webhook 为空时全链路 no-op
- 4xx(客户端错误)不告警;404 等常规错误不打扰

通知示例(JSON POST 到 webhook):

```json
{
  "msgtype": "text",
  "text": {
    "content": "⚠️ WallFlow 5xx 告警\n时间: 2026-08-15T08:00:00.000Z\n次数: 3 次\n路径: GET /wallpapers\n路径: GET /admin/health"
  }
}
```

> 其他平台(Slack/飞书等)可自行在 webhook 前挂一层格式适配(本通知格式为通用 text 消息)。

## 6. 对接建议(运维自动化)

- **日常巡检**: 定时 `GET /admin/health` → `openReports > 0` 或 `backfillPaused: true` 时告警/提示
- **版权投诉流程**: 见 `TAKEDOWN-SOP.md` —— 受理 → `block` 隔离 → 双人复核 → `DELETE /admin/reports/:id` 结案
- **回填维护**: 需要停回填时 `pause`,完成后 `resume`(调度器租约见 `backend/src/jobs/lease.ts`)
- **告警自检**: 可在测试环境触发一个 5xx(如未配置密钥的管理操作)验证 webhook 通路
