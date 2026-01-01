---
title: 将域名接入 Cloudflare 完整教程
published: 2025-12-27
description: '手把手教你把域名接入 Cloudflare，实现免费 CDN 加速、DDoS 防护、HTTPS 等功能。'
tags: [Cloudflare, 域名解析, CDN, 网站加速, 教程]
category: '记录'
draft: false 
lang: ''
---

# 将域名接入 Cloudflare（2025 最新保姆级教程）

Cloudflare 提供免费的全球 CDN、DNS 解析、DDoS 防护、免费 SSL 等功能。将域名接入后，你的网站访问速度更快、更安全，且能轻松开启 HTTPS。本教程适用于新手，假设你已经有域名（比如在阿里云、Namecheap、GoDaddy 等注册商购买）。

**准备工作**
- 一个已注册的域名（根域名，如 example.com，不要带 www）
- 一个邮箱（用于注册 Cloudflare）
- 你的服务器/主机 IP 地址（后续添加 A 记录用）

## 步骤 1：注册 Cloudflare 账号

1. 打开官网：https://www.cloudflare.com/
2. 点击右上角 **Sign Up**（注册）
3. 输入邮箱 + 密码 → 创建账号
4. 去邮箱接收验证邮件，点击链接完成验证

登录后进入仪表板（dashboard）：https://dash.cloudflare.com/

## 步骤 2：添加站点（Add a Site）

1. 在仪表板首页，点击右上角 **Add a Site**（添加站点）按钮  
   （如果没看到，点击左侧 **Websites** → **Add a site**）

2. 输入你的**根域名**（如 example.com，不要加 http/https 或 www），点击 **Add site**

3. 选择套餐：直接选 **Free**（免费版已足够强大，包含 CDN、SSL、DDoS 防护），点击 **Continue**

4. Cloudflare 会自动扫描你现有的 DNS 记录（如果域名之前有解析）  
   - 通常会导入 A、CNAME、MX 等记录  
   - **仔细检查**：确保你的主机 IP（A 记录）正确。如果缺失，手动添加  
   - 确认无误后点击 **Continue**

## 步骤 3：修改域名 Nameservers（最关键一步）

1. Cloudflare 会给你提供两条专属的 **Nameservers**（名称服务器），类似：
   - ns1.cloudflare.com → 实际是类似 alice.ns.cloudflare.com
   - ns2.cloudflare.com → 实际是类似 bob.ns.cloudflare.com

2. 登录你的**域名注册商后台**（阿里云、腾讯云、Namecheap 等）
3. 找到域名管理 → DNS 设置 / 名称服务器（Nameservers）
4. 选择“自定义 Nameservers” 或 “使用自定义 DNS”
5. 删除原有 NS，填入 Cloudflare 提供的两条 NS
6. 保存提交

**注意**：
- 修改 NS 后，全网 DNS 传播需要 **几分钟到 24 小时**（通常 1–4 小时）
- 期间网站可能短暂不可访问（正常现象）
- 传播期间别反复改来改去

## 步骤 4：等待激活 & 验证

1. 回到 Cloudflare 仪表板，点击 **Check nameservers** 或刷新页面
2. 等状态变为 **Active**（活跃），表示接入成功
3. Cloudflare 会发邮件通知你“站点已激活”

## 步骤 5：添加/优化 DNS 记录（必须做）

1. 左侧菜单 → **DNS** → **Records**
2. 确保有以下记录（橙色云表示开启 Cloudflare 代理/CDN，灰色云表示仅 DNS）：

   - **A** 记录：@（根域名） → 你的服务器 IP，**开启代理（橙色云）**
   - **CNAME** 记录：www → @（指向根域名），**开启代理**
   - 如果有邮箱（MX）、子域名等，保持原有记录

3. 推荐设置：
   - SSL/TLS → **Overview** → 加密模式选 **Full (strict)**
   - SSL/TLS → **Edge Certificates** → 开启 **Always Use HTTPS**
   - SSL/TLS → **Edge Certificates** → 开启 **Automatic HTTPS Rewrites**

## 步骤 6：测试 & 常见优化

1. 等 DNS 生效后，浏览器访问你的域名
2. 检查是否走 Cloudflare（右键检查 → Headers → 有 cf-cache-status: HIT 表示命中缓存）
3. 推荐优化：
   - Speed → **Optimization** → 开启 Auto Minify（压缩 JS/CSS/HTML）
   - Caching → **Configuration** → Cache Level 选 **Standard**
   - Security → **WAF** → 开启托管规则（Managed Rules）

## 常见问题 Q&A

**Q：改了 NS 后网站打不开？**  
A：正常，等待 DNS 传播。用 https://www.whatsmydns.net/ 检查 NS 是否全球生效。

**Q：国内访问变慢？**  
A：部分地区 Cloudflare 节点优化一般，可把非必要子域名设为灰色云（仅 DNS，不代理）。

**Q：想关闭 CDN 只用 DNS？**  
A：把记录的云朵点成灰色即可。

**Q：SSL 证书不生效？**  
A：确认加密模式为 Full (strict)，并开启 Always Use HTTPS。

## 结语

通过以上步骤，你的域名就成功接入 Cloudflare 了！免费享受全球加速、安全防护和自动 HTTPS。后续还可以玩 Workers、Pages、R2 等强大功能。

有问题欢迎评论或补充～ 祝建站愉快！

（最后更新：2025 年 12 月）