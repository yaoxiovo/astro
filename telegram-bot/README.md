# 🤖 Yaoxi Blog Telegram Bot

推送博客新动态 / 新文章到 Telegram 的 Cloudflare Worker（纯订阅 / 查询 / 推送，不在 Bot 内发布动态）。

- **Cron 每 10 分钟** 检查 `blog.yaoxi.wiki/api/moments.json`（新朋友圈）和 `/rss.xml`（新文章），有变化即推送
- **命令**：`/latest` 最近动态 · `/random` 随机一条 · `/stats` 朋友圈统计 · `/search` 搜索 · `/subscribe` / `/unsubscribe` 订阅管理 · `/help` 帮助
- **命令菜单**：Worker 自动调用 `setMyCommands` 同步 8 个命令到 Telegram 输入框的 `/` 菜单（KV 节流 12h，任意消息懒触发），无需 BotFather 手动设置
- **时间胶囊**：到期胶囊自动推送提醒（每天首次 tick 检查）
- **每周日周报**：本周朋友圈数据汇总推送
- **v3.2 变更**：移除在 Bot 内发布动态的能力（文字/图片创作、`/publish` `/cancel`、图床上传），GITHUB_PAT 不再需要
- **指纹去重**：KV 存上次指纹，首次部署只建基线不推送历史

## 部署（GitHub Actions 全自动）

### 1️⃣ 准备工作（一次性，约 10 分钟）

| 需要 | 怎么拿 |
|---|---|
| **Cloudflare API Token** | dash.cloudflare.com → 我的资料 → API 令牌 → 创建令牌 → 模板选「编辑 Cloudflare Workers」；权限需包含：`Workers Scripts: Edit`、`Workers KV Storage: Edit`、`Account Settings: Read`；账号范围选你的账号 |
| **Cloudflare Account ID** | dash.cloudflare.com 首页右下角或 Workers 页面 URL 里的 32 位 ID |
| **BOT_TOKEN** | Telegram 找 @BotFather → `/newbot` → 创建后给的 token |
| **CHAT_ID** | 给 @yaoxi_xingye_bot 发一条任意消息（如 `/start`），然后打开 `https://api.telegram.org/bot<你的BOT_TOKEN>/getUpdates`，找到 `"chat":{"id":数字}` 即 CHAT_ID |

### 2️⃣ GitHub Secrets 配置

GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 上面拿的 CF API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 上面拿的 CF Account ID |
| `BOT_TOKEN` | Telegram Bot Token |
| `CHAT_ID` | 你的 chat id（默认推送目标） |
| `GH_PAT` | （可选，已不再需要）旧版发朋友圈功能已下线，可删除 |

> ⚠️ **安全**：`.dev.vars` / token 已被 `.gitignore` 排除，绝不入库；代码里只从 `env.BOT_TOKEN` 读取。

### 3️⃣ 触发部署

- push 代码（`telegram-bot/**` 变更）自动触发
- 或手动：Actions 页面 → **Deploy Telegram Bot** → Run workflow

### 4️⃣ 验证

1. 给 bot 发 `/start` → 收到欢迎语（同时自动同步命令菜单，输入框输入 `/` 可见全部命令）
2. `/latest` → 最近 5 条动态
3. `/random` → 随机一条（带「查看详情」按钮）
4. `/stats` → 朋友圈统计
5. 博客发布新动态/新文章 → 10 分钟内收到推送
6. 发照片/普通文字 → 提示「发布功能已下线」（v3.2 起 Bot 不再发布动态）

## 本地调试（电脑）

```bash
cd telegram-bot
npm i
npx wrangler login
npx wrangler dev   # 需要本机安装 workerd（不支持 Android/手机）
```

> ⚠️ wrangler 的本地运行时 `workerd` 不支持 Android（Termux），手机端只能用 GitHub Actions 部署。

## 结构

```
telegram-bot/
├── wrangler.jsonc      # Worker 配置（KV + Cron + vars）
├── src/index.js        # Bot 逻辑（命令 + 轮询 + 推送）
├── .dev.vars           # 本地开发密钥（gitignore，不入库）
└── .gitignore
.github/workflows/
└── deploy-bot.yml      # 自动部署 workflow
```