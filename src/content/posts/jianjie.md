---
title: 网站简介
published: 2025-12-04
description: 我的博客网站简介。
tags:
  - Cloudflare
  - 域名解析
  - CDN
  - 网站加速
category: 记录
draft: false
lang: ""
---
# 搭建：
1. cdn提供商：Cloudflare（海外） Tencent（大陆） Alibaba cloud （备用）(有时选小众cdn)
2. dns提供商：Dnspod Aliyun
3. 源站：托管式（GitHub作为仓库）由边缘安全加速平台eo提供pages托管服务和cloudflare全球worker提供服务
优点：零成本建站， eo+cf+esa 天下无敌
4. 理论上，不存在什么567啊，什么被厂商踹出机房的，因为规则限速率以及地理位置设置的很严格

## 维护：
1. 加载变慢属于不可避免的问题，增加加载速度成本较高，不适宜
2. 过几年提升速度，按照Tencent政策，如果pages长期免费开放，理论说这网站能开到Tencent关机房为止
# 选择Tencent Edgeone原因？
为中国大陆提供静态托管以及边缘安全加速，DDOS防护等。

# 选择cloudflare原因？
全球网络安全巨头，无高并发限制，流量限制，带宽限制，总400Tb左右带宽，理论上只要带宽不耗尽，就能死抗攻击，还不用给流量费。
为本网站提供海外访问安全。

# 选择Alibaba cloud？
理论上可以选择，并且预览地址还是国内已备案的，接入了全球加速，三网优化，缺点就是要跳转链接，备选aliyun。

---
最后修改于：2026/3/22