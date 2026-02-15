---
title: 大龙虾，openclaw本地部署+本地ai模型Windows教程
published: 2026-02-06
description: 好用的ai助手
tags:
  - 教程
  - AI
category: 记录
draft: false
lang: ""
---
部署一路上踩了不少坑😅😅😅
# 1.部署准备
1. 环境：node.js，最新版，官网地址：https://nodejs.org/zh-cn/download
2. Windows10/11+
3. ollama
## 2.ollama下载模型
1. 进入官网：
::url{href="https://ollama.com/"}
下载ollama并安装。安装完成后回到官网点击搜索框，输入qwen3,（可以是其他模型）按自己的存储空间和显卡选择，建议qwen3：0.6b。
2. 或者用cmd直接输入下串命令（一样）
`ollama run qwen3:0.6b`
### 3.node.js环境下载
1. 访问官网
::url{href="https://yaoxi.wiki"}
2. 点击下载，等待安装完成
#### 4.openclaw下载
1. 注意：需要完成node.js环境下载才能继续操作
2. 访问官网：
::url{href="https://openclaw.ai/"}
3. 复制链接，以管理员权限打开windows powershell，右键粘粘等待ing
4. 