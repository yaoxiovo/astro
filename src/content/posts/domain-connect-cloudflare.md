---
title: 如何把域名接入 Cloudflare（完整实操版）
published: 2026-05-10
description: 从添加站点、修改 NS、配置 DNS 到开启 SSL 与 HTTPS 重定向，手把手完成域名接入 Cloudflare。
tags:
  - Cloudflare
  - 域名
  - DNS
  - 建站
  - 教程
category: 代码教程
draft: false
lang: "zh_CN"
---

把域名接入 Cloudflare，本质上就是两件事：

1. 在 Cloudflare 添加你的域名并生成新的 NS（Name Server）；
2. 去域名注册商后台把 NS 改成 Cloudflare 提供的 NS。

等 NS 生效后，再把 DNS 记录补齐，你的网站就能走 Cloudflare 的 CDN、防护和证书体系。

## 一、准备工作

- 一个 Cloudflare 账号（免费版就够用）
- 一个已购买的域名（阿里云、腾讯云、Namecheap、GoDaddy 等都可以）
- 能登录域名注册商后台

## 二、在 Cloudflare 添加域名

1. 登录 Cloudflare 控制台：`https://dash.cloudflare.com`
2. 点击 `Add a domain`
3. 输入你的根域名（例如 `example.com`，不要带 `www`）
4. 选择免费套餐（Free）
5. Cloudflare 会自动扫描你当前 DNS 记录，先点继续

Cloudflare 会给你分配两条 NS，例如：

- `abby.ns.cloudflare.com`
- `jack.ns.cloudflare.com`

这两条要记下来，下一步会用。

## 三、到注册商修改 NS（最关键）

1. 进入域名注册商后台
2. 找到域名的 `Name Server` / `DNS 服务器` 设置
3. 删除原来的 NS
4. 填入 Cloudflare 给你的两条 NS
5. 保存提交

提交后回 Cloudflare 页面，点击 `Done, check nameservers`。

## 四、等待生效并确认状态

NS 全球生效通常需要几分钟到 24 小时，个别情况可能到 48 小时。

你可以用下面命令检查（本地终端）：

```bash
dig ns example.com +short
```

返回值如果是 Cloudflare 的 NS，就说明已切换成功。

## 五、配置常用 DNS 记录

在 Cloudflare 的 `DNS` 页面，至少补这几类：

1. 主站解析
`A` 记录：`@` -> 你的服务器 IP

2. `www` 解析
`CNAME` 记录：`www` -> `@`（或指向你的主域名）

3. 其他子域名
比如 `blog`、`api`，按需加 `A` 或 `CNAME`

`Proxy status` 建议：

- 网站业务域名：开橙云（Proxied）
- 邮件相关记录（MX、mail、smtp 等）：关代理（DNS only）

## 六、开启 HTTPS 和安全项

在 `SSL/TLS` 中建议这样配：

1. `Overview` -> 模式选 `Full (strict)`（前提是源站有有效证书）
2. `Edge Certificates` 开启 `Always Use HTTPS`
3. 开启 `Automatic HTTPS Rewrites`

如果你的源站暂时没证书，可先用 `Full` 过渡，但不建议长期使用 `Flexible`。

## 七、把不带 www 跳转到 www（可选）

在 `Rules` -> `Redirect Rules` 新建规则：

- 条件：`example.com/*`
- 动作：301 跳转到 `https://www.example.com/$1`

或者反过来统一跳到裸域，关键是全站保持一种主域名，避免 SEO 分散。

## 八、接入后排错清单

1. 访问仍旧报错或旧页面
- 清浏览器缓存
- 在 Cloudflare 执行 `Purge Cache`
- 确认 DNS 记录指向是否正确

2. 出现 `526` / `525`
- 说明 Cloudflare 到源站 TLS 握手失败
- 检查源站证书是否过期、域名是否匹配

3. 邮件收发异常
- 检查 MX 和 mail 子域名是否被错误开了代理
- 邮件记录应使用 `DNS only`

## 九、总结

域名接入 Cloudflare 的核心流程就是：

1. Cloudflare 添加站点；
2. 注册商修改 NS；
3. Cloudflare 内补齐 DNS；
4. 开启 SSL 与 HTTPS 规则。

做完这几步后，你的域名就正式接入了 Cloudflare，后续再按需加 WAF、限速规则和页面缓存策略即可。
