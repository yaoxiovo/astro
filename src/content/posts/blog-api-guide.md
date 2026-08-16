---
title: 博客 API 接口大全与调用教程
published: 2026-08-16
description: 本站全部 API 接口的详细文档与调用教程：朋友圈数据、单篇文章元数据与纯文本、参数化动态查询、站点监控状态、RSS 订阅等，附 curl / Python / JavaScript 调用示例。
tags:
  - API
  - 接口文档
  - 教程
  - Web 开发
category: 技术分享
draft: false
lang: "zh_CN"
---

本博客（Yaoxi Blog）对外提供两类 API 接口，本篇文章一次性讲清楚**全部端点、参数、响应结构与调用方法**。

## 一、总览

| 类型 | 部署位置 | 特点 |
|---|---|---|
| **静态 JSON API** | `https://blog.yaoxi.wiki/api/*` | 构建期生成，随博客部署自动更新，零额外成本，可跨域（CORS `*`） |
| **Worker 动态 API** | `https://blog-api.yaoxi.cloud/*` | 运行时参数化查询（`?limit=&tag=` 等），数据实时过滤，带缓存 |
| **RSS / SEO 端点** | `https://blog.yaoxi.wiki/*.xml` | 订阅与爬虫 |
| **内部 Worker 端点** | 各 Worker 域名 | Telegram Bot / 站点监控的接口，部分需鉴权 |

**通用约定：**

- 所有 JSON 响应：`Content-Type: application/json; charset=utf-8`
- 静态 API 支持 CORS：`Access-Control-Allow-Origin: *`，任何前端/第三方可直接跨域调用
- 数据更新时间：静态 API 随博客重新构建更新（每次发布文章/动态后部署即更新）；Worker 缓存 120 秒

---

## 二、快速开始

### curl

```bash
# 拉取全部朋友圈
curl https://blog.yaoxi.wiki/api/moments.json

# 拉取单篇文章（元数据 + 纯文本正文）
curl https://blog.yaoxi.wiki/api/posts/umami.json

# 参数化查询：最近 5 条「日常」标签的顶层动态
curl "https://blog-api.yaoxi.cloud/api/moments?limit=5&tag=日常&replies=0"
```

### JavaScript（浏览器 / Node）

```js
const res = await fetch("https://blog.yaoxi.wiki/api/moments/stats.json");
const stats = await res.json();
console.log(`共 ${stats.total} 条动态，${stats.totalImages} 张图`);
```

### Python

```python
import requests

r = requests.get("https://blog.yaoxi.wiki/api/moments.json")
data = r.json()
for m in data["moments"][:3]:
    print(m["published"][:10], m["text"][:40])
```

---

## 三、朋友圈静态 API（blog.yaoxi.wiki/api/moments*）

### 1. 全部朋友圈 `GET /api/moments.json`

返回全部动态（含回复、时间胶囊已解封的），按「置顶优先 + 时间倒序」排列。

**响应示例：**

```json
{
  "updated": "2026-08-16T08:00:00.000Z",
  "moments": [
    {
      "slug": "cfworker",
      "published": "2026-06-26T10:00:00.000Z",
      "author": "瑶曦网络科技官方",
      "source": "Astro for Android",
      "pinned": true,
      "replyTo": null,
      "capsule": null,
      "location": null,
      "images": [],
      "videos": [],
      "tags": [],
      "text": "为什么使用 Cloudflare Workers 做反向代理？全球加速：..."
    }
  ]
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `slug` | string | 动态唯一标识（详情页 `/moment/{slug}/`） |
| `published` | string | 发布时间 ISO 8601 |
| `author` | string \| null | 作者（缺省为站长） |
| `source` | string \| null | 发布来源（如 "Astro for Android"） |
| `pinned` | boolean | 是否置顶 |
| `replyTo` | string \| null | 回复对象 slug（非空表示这是一条回复） |
| `capsule` | string \| null | 时间胶囊解封日期（未到期动态不会出现在此） |
| `location` | object \| null | 位置 `{name, lat, lng}` |
| `images` / `videos` | string[] | 媒体文件名（需拼 CDN 前缀，见下文） |
| `tags` | string[] | 正文中 `#标签` 提取结果 |
| `text` | string | 正文纯文本（Markdown 已清洗） |

**图片/视频完整地址拼接规则：**

```js
const RAW = "https://png.yaoxi.wiki/astro/raw";
const WEBP = "https://png.yaoxi.wiki/astro/webp";
const VIDEO = "https://png.yaoxi.wiki/astro/video";
// 文件名若不带日期目录，则按 published 日期自动补全
// 例：images: ["10.jpg"], published: "2026-08-14"
// → https://png.yaoxi.wiki/astro/raw/2026-08-14/10.jpg
//    https://png.yaoxi.wiki/astro/webp/2026-08-14/10.webp（缩略图）
```

### 2. 归档 `GET /api/moments/archive.json`

按「年 → 月」分组归档（仅顶层动态，排除回复）。

```json
{
  "updated": "...",
  "archive": [
    {
      "year": 2026,
      "total": 7,
      "months": [
        { "month": 6, "count": 3, "items": [ { "slug": "...", "published": "...", "author": "...", "tags": [], "text": "..." } ] }
      ]
    }
  ]
}
```

### 3. 时间胶囊 `GET /api/moments/capsules.json`

全部时间胶囊清单（**含未到期**，供自动化判断解封）。

```json
{ "updated": "...", "capsules": [ { "slug": "...", "capsule": "2099-12-31", "published": "...", "tags": [], "text": "写给未来的自己" } ] }
```

### 4. 搜索索引 `GET /api/moments/search.json`

全量搜索索引（slug / date / author / text / tags），适合做客户端全文搜索。

### 5. 统计 `GET /api/moments/stats.json`

朋友圈数据统计（与统计页同口径）：

```json
{
  "total": 7, "replies": 1, "totalWords": 2491, "avgWords": 356,
  "totalImages": 3, "totalVideos": 2,
  "firstDate": "2026-06-26T10:00:00.000Z", "lastDate": "2026-08-14T10:00:00.000Z",
  "years": [ { "year": 2026, "count": 7 } ],
  "months": [ { "month": "2026-06", "count": 3 } ],
  "weekdays": [ { "day": 0, "label": "周日", "count": 1 } ],
  "tags": [ { "tag": "日常", "count": 2 } ],
  "longest": { "slug": "cfworker", "words": 800 }
}
```

### 6. 按日期 `GET /api/moments/day/{YYYY-MM-DD}.json`

```bash
curl https://blog.yaoxi.wiki/api/moments/day/2026-08-14.json
```

### 7. 按标签 `GET /api/moments/tag/{tag}.json`

```bash
curl "https://blog.yaoxi.wiki/api/moments/tag/日常.json"
```

---

## 四、文章 API

### 8. 单篇文章 `GET /api/posts/{slug}.json` ⭐ 新

单篇元数据 + **完整纯文本正文**，供第三方引用、小程序、AI 喂数据。

```bash
curl https://blog.yaoxi.wiki/api/posts/umami.json
```

**响应示例：**

```json
{
  "slug": "umami",
  "title": "Umami 统计修复日志",
  "published": "2026-04-03T00:00:00.000Z",
  "updated": null,
  "draft": false,
  "description": "记录 Umami 统计从显示为 0 到恢复的排障过程...",
  "image": "",
  "tags": ["Umami", "网站统计"],
  "category": "开发记录",
  "series": "",
  "lang": "zh_CN",
  "pinned": false,
  "prev": { "slug": "other-sites", "title": "..." },
  "next": { "slug": "zhinan", "title": "..." },
  "wordCount": 1488,
  "readingTime": 4,
  "excerpt": "记录 Umami 统计从显示为 0 到恢复的排障过程...",
  "text": "文章正文纯文本（Markdown 已清洗为纯文本）..."
}
```

| 字段 | 说明 |
|---|---|
| `wordCount` | 正文纯文本字数 |
| `readingTime` | 估算阅读时长（分钟，约 400 字/分钟） |
| `excerpt` | 摘要（frontmatter description 优先，否则正文前 200 字） |
| `prev` / `next` | 前后篇导航（按发布时间排序） |
| `text` | **完整纯文本正文**，可直接用于摘要、翻译、喂给大模型 |

未知 slug 返回 `404` + `{ "error": "not found", "slug": "..." }`。

---

## 五、Worker 动态 API（blog-api）⭐ 新

静态站无法在运行时处理查询参数，博客提供了独立 Worker 做**参数化查询**：

```text
部署后地址：https://blog-api.yaoxi.cloud
（如绑定了自定义域，用你自己的域名即可）
```

### 9. 参数化朋友圈查询 `GET /api/moments`

```bash
# 最近 5 条
curl "https://blog-api.yaoxi.cloud/api/moments?limit=5"

# 8 月「技术」标签、排除回复、跳过前 10 条
curl "https://blog-api.yaoxi.cloud/api/moments?tag=技术&replies=0&limit=10&offset=10"

# 指定日期范围 + 关键词
curl "https://blog-api.yaoxi.cloud/api/moments?from=2026-08-01&to=2026-08-31&q=咖啡"
```

**完整参数表：**

| 参数 | 说明 | 示例 |
|---|---|---|
| `limit` | 返回条数（默认全部） | `?limit=5` |
| `offset` | 分页偏移（配合 limit） | `?limit=10&offset=10` |
| `tag` | 标签过滤（单标签） | `?tag=日常` |
| `author` | 作者精确匹配 | `?author=瑶曦` |
| `date` | 精确日期 YYYY-MM-DD | `?date=2026-08-14` |
| `from` / `to` | 日期范围（含边界） | `?from=2026-08-01&to=2026-08-31` |
| `q` | 关键词搜索（正文/标签/作者） | `?q=咖啡` |
| `replies` | `0`=仅顶层 · `1`=仅回复 · 不传=全部 | `?replies=0` |
| `pinned` | `1`=仅置顶 | `?pinned=1` |

**响应：**

```json
{
  "updated": "2026-08-16T08:00:00.000Z",
  "params": { "limit": 5, "offset": 0, "tag": "日常", "replies": "0", "q": null, ... },
  "total": 7,
  "returned": 5,
  "moments": [ /* 与 /api/moments.json 同结构 */ ]
}
```

- `total` = 过滤后总条数，`returned` = 本次实际返回条数（分页用）
- 所有参数可**任意组合**
- 数据源为博客构建产物，Cache API 缓存 120 秒
- 全 CORS + OPTIONS 预检支持

### 10. API 文档 `GET /`

`blog-api` 根路径自带参数文档（JSON），部署后可自发现：

```bash
curl https://blog-api.yaoxi.cloud/
```

---

## 六、RSS 与 SEO 端点

| 端点 | 说明 |
|---|---|
| `GET /rss.xml` | 文章 RSS（全文，图片路径已优化） |
| `GET /moments/rss.xml` | 朋友圈 RSS（标题 = 日期+摘要，tags 作分类） |
| `GET /robots.txt` | 爬虫规则 + sitemap 指向 |
| `GET /sitemap-index.xml` | 站点地图（仅收录首页/归档/文章页） |

```bash
# 在支持 RSS 的阅读器里订阅
# https://blog.yaoxi.wiki/rss.xml
# https://blog.yaoxi.wiki/moments/rss.xml
```

---

## 七、站点监控 API（site-monitor Worker）

监控 Worker 提供公开状态查询（数据来自每 5 分钟一轮的拨测）：

| 端点 | 说明 |
|---|---|
| `GET /api/status` | 实时状态（各站点 up/down/响应时长） |
| `GET /api/history?days=30&site=博客主站` | 历史数据（uptime%、采样曲线、故障事件，最长 90 天） |
| `GET /api/widget/v1/summary.json` | 快猫星云 widget 兼容格式（博客首页状态徽标/横幅数据源） |
| `GET /api/run?secret=xxx` | 手动触发一轮检测（需 MONITOR_SECRET） |
| `GET /api/sp-test`、`GET /api/diag` | Flashduty 状态页诊断（脱敏） |

```bash
curl https://status.yaoxi.wiki/api/status
curl "https://status.yaoxi.wiki/api/history?days=30"
```

**响应示例（/api/status）：**

```json
{
  "updatedAt": 1789999999999,
  "sites": [
    { "name": "博客主站", "url": "https://blog.yaoxi.wiki/", "state": "up", "since": 1789999900000, "lastCheck": 1789999999000, "lastMs": 210 }
  ]
}
```

---

## 八、Telegram Bot 端点（yaoxi-blog-bot Worker）

| 端点 | 说明 |
|---|---|
| `POST /webhook` | Telegram 更新入口（需 `X-Telegram-Bot-Api-Secret-Token` 头，无 secret 返回 401） |
| `GET /tick` | 手动触发一轮推送检查（新动态/文章/胶囊/周报/一言） |
| `GET /err` | 查看最近一次 webhook 处理错误 |

```bash
# 无密钥访问 webhook 会返回 401，说明鉴权生效
curl -X POST https://yaoxi-blog-bot.yaoxiovo.workers.dev/webhook -H "Content-Type: application/json" -d '{}'
# → 401 unauthorized

# 手动触发推送检查（cron 外）
curl https://yaoxi-blog-bot.yaoxiovo.workers.dev/tick
# → ticked
```

---

## 九、实战场景

### 场景 A：第三方站点展示「瑶曦最新动态」

```html
<!-- 任意网页，无需后端 -->
<script>
fetch("https://blog.yaoxi.wiki/api/moments.json")
  .then(r => r.json())
  .then(d => {
    const m = d.moments[0];
    document.write(`<a href="https://blog.yaoxi.wiki/moment/${m.slug}/">${m.text.slice(0, 50)}</a>`);
  });
</script>
```

### 场景 B：小程序 / App 拉取文章做离线阅读

```js
// 构建期生成，一次拉取全部文章正文
const slugs = ["umami", "zhinan", "astro-cdn-hosting"];
const articles = await Promise.all(
  slugs.map(s => fetch(`https://blog.yaoxi.wiki/api/posts/${s}.json`).then(r => r.json()))
);
articles.forEach(a => console.log(a.title, a.wordCount, "字"));
```

### 场景 C：AI / 脚本消费朋友圈做周报

```python
import requests

r = requests.get("https://blog-api.yaoxi.cloud/api/moments",
                 params={"from": "2026-08-10", "to": "2026-08-16", "replies": "0"})
data = r.json()
print(f"本周 {data['total']} 条动态：")
for m in data["moments"]:
    print("-", m["text"][:60])
```

---

## 十、注意事项

1. **静态 API 是构建期快照**：新增动态/文章后，需要等博客重新构建部署（push 后 Cloudflare 自动完成）才会更新
2. **Worker API 有 120s 缓存**：极端情况下数据可能滞后约 2 分钟，但可承受高频轮询（不消耗源站）
3. **媒体拼接**：`images` / `videos` 是文件名，需要按上文规则拼 CDN 前缀
4. **限流**：暂无硬性限流，请勿高频恶意请求（数据量小，正常使用无压力）
5. **`/api/run`、`/webhook` 等内部端点需要密钥**，请勿公开传播密钥

---

## 十一、接口清单速查表

| # | 端点 | 类型 | 说明 |
|---|---|---|---|
| 1 | `GET /api/moments.json` | 静态 | 全部朋友圈 |
| 2 | `GET /api/moments/archive.json` | 静态 | 归档（年→月） |
| 3 | `GET /api/moments/capsules.json` | 静态 | 时间胶囊 |
| 4 | `GET /api/moments/search.json` | 静态 | 搜索索引 |
| 5 | `GET /api/moments/stats.json` | 静态 | 统计 |
| 6 | `GET /api/moments/day/{date}.json` | 静态 | 按日期 |
| 7 | `GET /api/moments/tag/{tag}.json` | 静态 | 按标签 |
| 8 | `GET /api/posts/{slug}.json` | 静态 | 单篇元数据+纯文本 ⭐ |
| 9 | `GET /api/moments?参数` | Worker | 参数化查询 ⭐ |
| 10 | `GET /` | Worker | API 文档 ⭐ |
| 11 | `GET /rss.xml`、`/moments/rss.xml` | RSS | 订阅 |
| 12 | `GET /api/status` 等 | Worker | 站点监控 |
| 13 | `POST /webhook` 等 | Worker | Telegram Bot |

> 本文档随博客更新：所有静态 API 的数据结构与返回内容，以线上实际响应为准。
