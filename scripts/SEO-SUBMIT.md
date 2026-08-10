# 🚀 SEO 主动推送配置指南

`submit-urls.js` 支持三条推送通道，全部配置好后每次 `git push` 会自动触发
`.github/workflows/submit-urls.yml`，无需手动操作喵。

## 通道一览

| 通道 | 状态 | 配置方式 |
|---|---|---|
| IndexNow (Bing / Yandex / Seznam 等) | ✅ 已生效（key 内置） | 无需配置 |
| Google Indexing API | ⏳ 需要配置 | GitHub Secret: `GOOGLE_SERVICE_ACCOUNT_KEY` |
| 百度站长平台 | ⏳ 可选 | GitHub Secret: `BAIDU_TOKEN` |

---

## 1️⃣ Google Indexing API 配置（推荐，实时收录）

> Google 官方限制：**仅适用于总页面数 < 200 的站点**，每日配额 200 URL。
> 本站约 30+ 页面，完全在限额内喵。

### 步骤

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 新建项目（或选已有项目）
2. 左侧菜单：**APIs & Services → Library**，搜索 **Indexing API**，点击 **Enable**
3. **APIs & Services → Credentials → Create Credentials → Service Account**
   - 名字随意，如 `blog-indexing`
   - 角色选 **Owner**（或基础 Editor），点击创建
4. 在 Service Accounts 列表里找到刚创建的账号 → **Actions → Manage keys → Add Key → Create new key → JSON**
   - 会下载一个 `<key>.json` 文件（**这就是 `GOOGLE_SERVICE_ACCOUNT_KEY` 的内容**）
5. 打开 [Google Search Console](https://search.google.com/search-console) → 你的站点（blog.yaoxi.wiki）
   - **设置 → 用户和权限 → 添加用户**
   - 填入服务账号的邮箱（形如 `blog-indexing@<project-id>.iam.gserviceaccount.com`）
   - 权限选 **完整**
6. 把 JSON 内容加到 GitHub Secrets：
   - 仓库 → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `GOOGLE_SERVICE_ACCOUNT_KEY`
   - Value: 把 JSON 文件的完整内容粘贴进去（多行也行，脚本已兼容）

### 验证

在 Actions 页面手动运行 `Submit URLs to Search Engines` workflow，
日志里出现 `[Google] 授权成功！正在向 Google Indexing API 批量提交 URL...` 即成功喵。

---

## 2️⃣ 百度站长平台配置（可选，国内收录）

1. 打开 [百度搜索资源平台](https://ziyuan.baidu.com/) → 登录 → **普通收录 → 资源提交 → 主动推送(API)**
2. 在 **链接提交** 页面可以看到你的 token（形如 `xxxxxxxxxxxxxxxx`）
3. 添加到 GitHub Secret：Name: `BAIDU_TOKEN`，Value: token
4. 另外建议在百度平台 **sitemap 提交** 里手动提交：`https://blog.yaoxi.wiki/sitemap-index.xml`

> 百度还支持"快速收录"，需要在百度平台开通权限后使用 `https://api.zhanzhang.baidu.com/urls` 推送，
> 本脚本默认用标准主动推送 API，稳定够用喵。

---

## 3️⃣ 本地手动运行

```bash
# 自动检测最近改动
node scripts/submit-urls.js

# 全量提交（谨慎，Google 配额 200/天）
node scripts/submit-urls.js --all

# 手动指定 URL
node scripts/submit-urls.js https://blog.yaoxi.wiki/posts/xxx/
```

本地如需 Google 推送，可把服务账号 JSON 写入 `.env`（已被 gitignore）：
```
GOOGLE_SERVICE_ACCOUNT_KEY={"type": "service_account", ...}
BAIDU_TOKEN=xxxxxxxx
```