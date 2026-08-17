# 🌐 Yaoxi Blog API

博客统一查询 API（Cloudflare Worker）——静态站无法在运行时处理查询参数，本 Worker 提供**动态参数化接口**。

数据源 = 博客构建产物 `https://blog.yaoxi.wiki/api/moments.json`（Cache API 缓存 120s，不占 KV 写入额度）。

## 端点

### `GET /api/moments` — 参数化朋友圈查询

| 参数 | 说明 | 示例 |
|---|---|---|
| `limit` | 返回条数（默认全部） | `?limit=5` |
| `offset` | 分页偏移 | `?limit=10&offset=10` |
| `tag` | 标签过滤（单标签） | `?tag=日常` |
| `author` | 作者过滤 | `?author=瑶曦` |
| `date` | 精确日期 YYYY-MM-DD | `?date=2026-08-14` |
| `from` / `to` | 日期范围（含） | `?from=2026-08-01&to=2026-08-31` |
| `q` | 关键词搜索（正文/标签/作者） | `?q=咖啡` |
| `replies` | `0`=仅顶层 · `1`=仅回复 · 不传=全部 | `?replies=0` |
| `pinned` | `1`=仅置顶 | `?pinned=1` |

响应：`{ updated, params, total, returned, moments }`，字段与博客 `/api/moments.json` 一致。

参数上限：`limit ≤ 100`，`offset ≤ 10000`，超出会被自动截断。

### `GET /` — API 文档（参数说明）

## 限流（防刷爆账单）

| 维度 | 阈值 | 超限 |
|---|---|---|
| 单 IP | 60 次 / 60 秒 | 429 + `Retry-After` |
| 全局 | 600 次 / 60 秒 | 429 + `Retry-After` |

- 计数走 KV namespace `blog-api-rate-limit`（绑定名 `RATE_LIMIT_KV`），部署 workflow 首次部署时自动创建。
- 采用近似计数（每 5 次落盘一次），牺牲少量精度换 KV 写入额度。
- 源站连续失败 5 次后熔断 5 分钟，期间优先返回缓存或返回 502，避免回源风暴。
- 响应头：`X-RateLimit-Limit`、`X-RateLimit-Remaining`、`Cache-Control: public, max-age=60, s-maxage=120`。
- 建议额外在 Cloudflare Dashboard 对 `blog-api.yaoxi.cloud/api/moments` 加一条 Rate Limiting 规则（单 IP 60/分钟），作为网关层兜底。

所有响应带 CORS（`Access-Control-Allow-Origin: *`），第三方可直接跨域调用。

## 部署

push 到 `main`（`blog-api/**` 变更）自动触发 **Deploy Blog API** workflow；或 Actions 页面手动 Run workflow。

需要 GitHub Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（与 bot/monitor 相同，通常已配置）。

部署后访问地址：**`https://blog-api.yaoxi.cloud`**（已在 `wrangler.jsonc` 配置 custom domain，部署时自动创建 DNS 记录）。

需要 GitHub Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（与 bot/monitor 相同，通常已配置）。

> 若 `yaoxi.cloud` 不在 Cloudflare 账号名下或 DNS 冲突，部署会失败——此时去掉 `wrangler.jsonc` 里的 `routes` 段，改用默认 `workers.dev` 子域。
