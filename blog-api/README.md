# 🌐 Yaoxi Blog API & Automation Dispatcher

博客统一查询 API 与全自动邮件发信中枢（Cloudflare Worker）：
1. **统一查询接口**：静态博客构建产物动态参数化查询（朋友圈检索、分页、标签过滤、缓存保护与熔断）。
2. **自动化邮件体系**：邮件订阅、双重激活验证（Double Opt-in）、新文章批量广播推送、合规一键退订、访客留言自动通报与自动确认回执。
3. **段落锚定弹幕**：读者投稿弹幕按文章段落精准挂载，Telegram 内联按钮人工审核，KV 零竞争队列，前端飞掠引擎带负延迟错峰与离屏暂停。
4. **实时共读**：Durable Objects WebSocket 房间聚合在线人数与段落热度，悬浮药丸「此刻 N 人与你同读」，正文绿点标记被阅读的段落。

---

## API 端点概览

### 1. 朋友圈参数化查询
- `GET /api/moments`：参数化朋友圈查询（支持 `limit`、`offset`、`tag`、`author`、`date`、`from`、`to`、`q`、`replies`、`pinned`）。

### 2. 自动化邮件与读者订阅（Newsletter）
- `POST /api/newsletter/subscribe`
  - 读者提交邮箱订阅，触发发送一封双重激活确认邮件（防止恶意刷邮箱）。
  - 请求体：`{ "email": "reader@example.com" }`（支持隐藏蜜罐字段 `honeypot`）。
  - 响应：`{ "ok": true, "message": "..." }`
- `GET /api/newsletter/verify?token=...`
  - 订阅激活链接（读者从邮件中点击）。
  - 验证成功后将邮箱写入活跃订阅列表，返回精美 HTML 成功页。
- `GET /api/newsletter/unsubscribe?token=...`
  - 一键合规退订链接（每封广播邮件底部自动附带，带签名 Token）。
  - 点击后即时移除订阅，返回 HTML 退订完成提示页。
- `POST /api/newsletter/broadcast`（🔒 需 `Authorization: Bearer <ADMIN_TOKEN>`）
  - 批量向所有活跃订阅者广播新文章通知（支持每封邮件自动注入专属退订链接）。
  - 请求体：
    ```json
    {
      "title": "文章标题",
      "summary": "文章核心摘要",
      "url": "https://blog.yaoxi.wiki/posts/xxx/",
      "pubDate": "2026-09-11",
      "tags": ["技术", "Astro"],
      "type": "post",
      "preview": false
    }
    ```
  - 当 `preview: true` 时，仅向站长邮箱发送一封测试预览信，不打扰订阅者。

### 3. 访客留言与意见反馈（Contact & Auto-Relay）
- `POST /api/contact`
  - 访客在博客页面提交留言。
  - 请求体：`{ "name": "称呼", "email": "访客邮箱", "message": "留言正文", "pageUrl": "来源页面" }`
  - 自动化双向发信：
    - ① 即时将留言工单格式化发至站长主邮箱（`OWNER_EMAIL`），包含访客信息与直达回复按钮。
    - ② 自动向访客发送一封温暖的确认回执信（Auto-Reply）。

### 4. 段落锚定弹幕（Danmaku）
- `GET /api/danmaku/live?post=<slug>`
  - 拉取某篇文章的已上墙弹幕（一次读取，客户端本地调度时间轴）。
  - 响应：`{ "ok": true, "items": [{ "id", "p", "x", "t", "a", "c", "ts" }] }`（`p` 段落索引，`x` 段落摘录锚点，`t` 正文，`a` 昵称，`c` 颜色，`ts` 时间戳）。
- `POST /api/danmaku/submit`
  - 读者投稿弹幕，进入待审队列（KV 独立键写入，无读改写竞争），并即时推送 Telegram 审核卡片（带「放行 / 驳回」内联按钮）。
  - 请求体：`{ "post": "文章slug", "p": 3, "x": "段落摘录", "t": "弹幕正文", "a": "昵称", "c": "#ef4444", "website": "" }`（`website` 为隐藏蜜罐字段）。
  - 限流：单 IP 10 分钟内最多 5 条；同内容 djb2 指纹 10 分钟内去重。
- `GET /api/danmaku/pending`（🔒 需 Admin Token）
  - 待审队列列表（最多 100 条，按投稿时间倒序）。
- `POST /api/danmaku/moderate`（🔒 需 Admin Token）
  - 审核弹幕（Telegram 按钮回调或手动调用）。
  - 请求体：`{ "id": "弹幕ID", "action": "approve" | "reject" }`

### 5. 实时共读（Presence · Durable Objects）
- `GET /api/presence/ws?post=<slug>`（WebSocket 升级请求）
  - 加入该文章的实时共读房间：在线人数 / 段落热度由 Durable Object 聚合后全房间广播。
  - 服务端 → 客户端：`{ "t": "pr", "n": <在线人数>, "h": { "<段落索引>": <人数> } }`
  - 客户端 → 服务端：`{ "t": "pos", "p": <段落索引> }`（阅读位置上报 / 25s 心跳，`-1` 表示未知）
  - 治理：单房间上限 120 人；广播合并节流 800ms；240s 无心跳的僵尸连接自动踢出。
- `GET /api/presence?post=<slug>`
  - HTTP 快照（降级查询 / 调试）：`{ "ok": true, "n": <在线人数>, "h": { ... } }`
- 实现说明：每篇文章一个 `PresenceRoom` Durable Object 实例（`idFromName(slug)`，SQLite 后端，免费额度可用）；采用 WebSocket Hibernation API，空闲休眠近零开销；人数与热度直接从连接附件（attachment）实时推导，无持久化双写。
  - 首次部署由 `wrangler.jsonc` 的 `migrations` 自动创建类（`tag: v1`），无需人工干预。
  - 未绑定 `PRESENCE`（如本地无 DO 环境）时返回 503，前端挂件静默隐藏，不影响阅读。

---

## 环境变量与 Secrets 配置

在 GitHub 仓库中配置以下 Secrets（通过 Actions 自动同步至 Cloudflare Worker）：

| Secret 变量名 | 必填 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API Token（需包含 Workers 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Cloudflare 账号 32 位 ID |
| `RESEND_API_KEY` | ✅ | Resend 发信服务 API Key（以 `re_` 开头，免费 3000 封/月） |
| `ADMIN_TOKEN` | ✅ | 保护管理与批量发信接口的令牌（推荐 `openssl rand -hex 32`） |
| `OWNER_EMAIL` | ❌ | 站长接收访客留言与监控报警的邮箱（默认 `yaoxi@yaoxi.wiki`） |
| `EMAIL_FROM` | ❌ | 发件人地址（如 `瑶曦 Blog <newsletter@yaoxi.wiki>`） |
| `TELEGRAM_BOT_TOKEN` | ❌ | Telegram 弹幕审核通知 Bot Token（CI 自动映射 `BOT_TOKEN`，无需新增） |
| `TELEGRAM_CHAT_ID` | ❌ | Telegram 审核通知接收 Chat（CI 自动映射 `CHAT_ID`，无需新增） |

> 💡 **弹幕自动放行**：`wrangler.jsonc` 的 `DANMAKU_AUTO_APPROVE` var 设为 `"true"` 时跳过人工审核直接上墙（默认 `"false"`）。未配置 Telegram 凭据时，投稿仍会进入待审队列，可用 `POST /api/danmaku/moderate` 手动处理。

> 💡 **本地调试/开发模式**：当未配置 `RESEND_API_KEY` 时，Worker 自动进入 Mock 模式，在控制台打印邮件内容而不真正投递，完全不会报错或中断。

---

## 部署

推送代码至 `main` 分支（`blog-api/**` 发生变更）将自动触发 **Deploy Blog API** 工作流，全自动完成 KV 绑定、Secrets 同步和 Worker 部署。
访问域名：`https://blog-api.yaoxi.cloud`
