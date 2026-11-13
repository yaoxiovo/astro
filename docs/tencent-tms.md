# 评论接入腾讯天御

评论、回复和旧版弹幕投稿统一调用腾讯云文本内容安全 `TextModeration`（API 版本 `2020-12-29`）。服务端使用 Web Crypto 生成 TC3-HMAC-SHA256 签名，无新增运行依赖，同时支持 Cloudflare Worker 与 `server/` 的 Node.js 运行方式。

## 处理规则

| 检测结果 | 处理 |
| --- | --- |
| Pass | 遵循 `DANMAKU_AUTO_APPROVE`：true 自动展示，false 人工待审 |
| Review | 人工待审，Telegram 提示天御结果 |
| Block | 保存为 rejected，返回 HTTP 422 与修改提示，不展示，不发送人工待审按钮 |
| 缺凭据、网络异常、5 秒超时、接口错误或无效返回 | 保存为 pending，交人工审核，即使自动放行开关开启也不展示 |
| 未启用天御 | 保留原有自动放行 / 人工审核行为，不请求腾讯接口 |

投稿先经过蜜罐、限流、字段校验和重复检测，再调用天御。送审内容为实际显示的昵称（已登录时使用认证昵称）、净化后的正文与段落摘录，不传 IP、邮箱、JWT 或平台凭据。无需修改数据库结构，`comment_events` 的 create 事件 `meta.moderation` 记录 suggestion、label、score、requestId 或固定错误码；不记录腾讯完整响应和错误信息。被拦截内容仍保存在数据库供管理员审计，可经现有管理员 restore 操作恢复。现有历史评论和管理员手工审核不自动重新送审。

## 配置

本机已复用此前保存的腾讯云凭据，写入被 Git 忽略的 `blog-api/.dev.vars` 与 `server/tms.env`（权限 0600，启用开关为 true）。域名 `blog-api.yaoxi.cloud` 实际指向 Linux 服务器 `43.128.137.8`，生产发布由远端 `Deploy Blog API` 工作流执行；Cloudflare Worker 仅保留备用副本，不能通过重新绑定域名覆盖现有 DNS。密钥未进入受版本控制的文件。已用短时 TC3 签名请求真实接口，测试文本返回 Pass。

先在腾讯云开通文本内容安全服务，为后端配置可调用 `tms:TextModeration` 的凭据，并确认账号额度与所用地域可用。BizType 使用控制台实际策略编号；未设置时不发送该参数，使用服务默认策略。

| 环境变量 | 用途 |
| --- | --- |
| `TENCENT_TMS_ENABLED` | `true` 开启，默认关闭 |
| `TENCENTCLOUD_SECRET_ID` | 腾讯云 SecretId，仅后端 Secret / 环境文件 |
| `TENCENTCLOUD_SECRET_KEY` | 腾讯云 SecretKey，仅后端 Secret / 环境文件 |
| `TENCENTCLOUD_TOKEN` | 可选，临时凭证的会话 Token，须与临时密钥配套并及时更新 |
| `TENCENT_TMS_REGION` | 默认 `ap-guangzhou`，按服务可用地域设置 |
| `TENCENT_TMS_BIZ_TYPE` | 可选，控制台审核策略编号 |
| `DANMAKU_AUTO_APPROVE` | 默认 false；开启后天御 Pass 才自动展示 |

### Cloudflare Worker

备用 Worker 可在控制台直接配置 SecretId、SecretKey，以及可选的 Token、BizType。现有备用实例已同步这组凭据。使用长期密钥时应移除先前配置的临时 `TENCENTCLOUD_TOKEN`。

`blog-api/wrangler.jsonc` 的 `TENCENT_TMS_ENABLED` 为 `"true"`；如需修改地域，同步修改该文件的 REGION。后续若恢复 Worker 发布，应使用远端 CI，并先核对域名归属。不要把密钥写入 vars、前端配置或仓库。

### Linux / Node.js

生产环境为 `/opt/yaoxi-workers`、`/etc/yaoxi-workers/blog-api.env` 与 `local-workers@blog-api.service`。工作流复用主站的 SERVER_SSH_KEY / SERVER_HOST / SERVER_USER。首次发布以 `8dc110e6` 为代码基线，后续读取服务器 `.blog-api-deploy-sha`；仅对 `blog-api/src/` 应用提交差异，保留服务器上已有的运行适配修复。补丁上下文冲突时停止发布。

部署脚本优先读取服务器既有 `/root/.config/lumitape/tencent-edgeone.json`，否则复用服务环境中已配置的腾讯凭据；只更新天御环境字段。部署前备份源码和环境文件到 `/var/backups/yaoxi-blog-api/`，检查 JavaScript 语法、真实天御 Pass、服务重启后的健康状态；失败则恢复备份。无需构建，不切换 DNS，不启停其他服务。

本地直接运行 Node 适配入口时，可在已有业务环境变量基础上设置 `ENV_FILE=/root/astro/server/tms.env`，由 `server/main.mjs` 加载上述审核配置。该文件只包含天御配置，不能代替服务原有的 DB_PATH、鉴权和邮件等环境设置。

### 验证

`node --test tests/tencent-tms.test.mjs tests/comments.test.mjs tests/ddos-auth.test.mjs` 只执行 Node 测试，不运行构建；所有腾讯响应均为测试桩，不消耗真实接口额度。配置真实凭据后还需在目标运行环境验证真实 Pass / Review / Block 策略与 RequestId；未配置密钥前不能视为线上已启用。

官方依据：[TextModeration](https://cloud.tencent.com/document/api/1124/51860)、[TC3 签名方法 v3](https://cloud.tencent.com/document/product/213/30654)。
