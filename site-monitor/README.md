# Site Monitor — 网站存活监控 Worker

免费版「快猫星云式」拨测监控，跑在 Cloudflare Workers 上（$0 成本）喵。

## 监控目标

| 站点 | URL | 期望 |
|---|---|---|
| 博客主站 | https://blog.yaoxi.wiki/ | 200 |
| 博客 API | https://blog.yaoxi.wiki/api/moments.json | 200 |
| Umami 统计 | https://umami.yaoxi.cloud/ | 200 |
| 个人主页 | https://yaoxi.wiki/ | 200 |
| 图床 | https://png.yaoxi.wiki/ | 200 |
| 状态页 | https://status.yaoxi.wiki/ | 200 |

> 拨测周期：每 5 分钟（cron `*/5 * * * *`）；也可访问 `https://site-monitor.yaoxi.workers.dev/api/run?secret=MONITOR_SECRET` 手动触发一轮检测。

## 告警通道

- **主通道：快猫星云 Flashduty 标准告警**
  - 故障触发：`event_status=Critical` + 稳定 `alert_key`（`site-monitor:{站点名}`）
  - 故障恢复：`event_status=Ok` + 同一 `alert_key` → 自动恢复告警
  - 附带 `labels`（site/url/monitor），可用于快猫星云订阅规则、路由与聚合
  - 状态机去重：持续故障只上报一次，恢复才再次上报（不刷屏）
- **旁路：Telegram**（可选，配置了 `BOT_TOKEN`/`CHAT_ID` 才启用）

## 环境变量 / Secrets

| 变量 | 必填 | 说明 |
|---|---|---|
| `FLASHCAT_INTEGRATION_KEY` | ✅ | 快猫星云「标准告警信息集成」的 integration_key |
| `FLASHCAT_API_HOST` | ❌ | 默认 `https://api.flashcat.cloud` |
| `FLASHCAT_SEVERITY` | ❌ | 故障级别，默认 `Critical` |
| `BOT_TOKEN` / `CHAT_ID` | ❌ | Telegram 旁路通知 |
| `MONITOR_SECRET` | ❌ | 保护手动触发 `/api/run` |
| `SITES` | ❌ | JSON 覆盖默认站点列表 |

## 快猫星云接入步骤

1. 快猫星云 → 集成中心 → 创建「标准告警信息集成」，拿到 `integration_key`
2. GitHub 仓库 → Settings → Secrets and variables → Actions → 新增 `FLASHCAT_INTEGRATION_KEY`
3. 推送本目录代码，GitHub Actions 自动把 secret 写入 Cloudflare 并部署
4. 验证：`GET https://{worker}.workers.dev/api/run?secret={MONITOR_SECRET}` 手动触发一轮检测

## API

| 路由 | 说明 |
|---|---|
| `GET /` | **自写状态页**（复刻快猫星云 UI：整体徽章 + 组件列表 + uptime% + 响应曲线 + 故障时间线，60s 轮询，自动明暗模式） |
| `GET /api/status` | 公开状态 JSON（各站点 state/since/lastCheck/lastMs，widget 兼容） |
| `GET /api/history?days=30&site=xxx` | 历史数据：uptime% / 采样点 / 故障事件（自动从快照推导） |
| `GET /api/run?secret=xxx` | 手动触发一轮检测 |

## 自写状态页（全自动，替代手动发布事件）

- 每轮检测自动写入 **hourly 历史快照**（KV 合并写入，避开免费额度 1000 写/天限制；30 天自动过期）
- 状态页数据完全来自监控器自身：故障 → 页面自动变红，恢复 → 自动变绿，**零手动**
- 历史数据积累满 1 小时后出现响应时间曲线，30 天后 uptime% 趋于准确

## 调度

Cron `*/5 * * * *`（每 5 分钟），6 站点 × 288 次/天 ≈ 1.7k 请求，远低于免费额度 10 万/天。

## 测试

```bash
node --test test/smoke.test.mjs
```
## 状态页自动发布（Flashduty Status Page API）

- 故障时自动创建 incident（受影响组件 → major_outage，状态页变红）
- 恢复时自动 resolved（组件 → operational，状态页变绿）
- 需要 GitHub secret：`FLASHDUTY_APP_KEY`（Flashduty 个人中心 APP Key）
- 未配置时自动跳过，不影响告警主链路