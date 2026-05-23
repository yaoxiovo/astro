---
title: Umami 统计修复日志
published: 2026-04-03
description: 记录 Umami 统计从显示为 0 到恢复的排障过程：修正 Supabase 连接串、处理 TLS 参数，并从导出的 JSON 数据恢复会话与事件记录。
tags:
  - Umami
  - 网站统计
  - 数据库配置
  - 修复日志
category: 开发记录
draft: false
lang: "zh_CN"
---

## 背景

博客的 Umami 统计曾一度显示为 0。最初判断是数据库配置问题，后续排查确认并不是 Umami 前端统计脚本的问题，而是部署环境、Supabase 连接串和数据库数据状态叠加导致。

## 问题现象

EdgeOne Pages 构建 Umami 时，`check-db` 阶段失败。早期日志显示 Prisma 能检测到 `DATABASE_URL`，但执行实际查询时无法访问数据库：

```txt
Invalid `prisma.$queryRaw()` invocation:
Raw query failed. Message: Can't reach database server
```

修正连接串后，错误变为 TLS 证书链校验失败：

```txt
Error opening a TLS connection: self-signed certificate in certificate chain
```

这说明网络连通性已经恢复，剩余问题集中在 TLS 参数和数据库状态。

## 修复过程

### 1. 修正 Supabase 连接串

原连接串存在拼接错误，把 direct connection 和 pooler connection 混在了一起，导致部署环境无法正确解析数据库地址。

最终改为 Supabase pooler 连接方式，并保留 SSL：

```env
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true"
```

其中：

- 使用 pooler，避免部署环境不支持 Supabase direct connection 的 IPv6 问题；
- 使用 `sslmode=require` 保持 TLS 加密；
- 加上 `uselibpqcompat=true`，避免 Node/Postgres 客户端把 `sslmode=require` 当成严格证书链校验处理。

### 2. 确认数据库被重新初始化

连接修复后，Umami 能重新跑 Prisma 迁移，但数据库里只剩默认数据：

- `public.user`：1 条；
- `public.website`：1 条；
- `public.session`：几乎为空；
- `public.website_event`：几乎为空。

迁移时间集中在一次构建过程中，说明当前库已经接近重新初始化状态，而不是单纯统计查询失败。

### 3. 从导出的 JSON 恢复业务数据

后续找到了旧项目导出的业务表 JSON。有效数据包括：

- `public.user.json`
- `public.website.json`
- `public.session.json`
- `public.website_event.json`

其中核心数据量约为：

```txt
public.session        2364
public.website_event  4363
public.website        3
public.user           1
```

由于 Supabase SQL Editor 对单次查询大小有限制，完整 SQL 无法一次运行，最终将恢复 SQL 拆成小分片，按顺序导入：

```txt
01_restore_user.sql
02_restore_website.sql
03_session_001.sql ... 03_session_012.sql
04_event_001.sql ... 04_event_022.sql
99_verify_after.sql
```

导入策略使用 `INSERT ... ON CONFLICT ... DO UPDATE`，避免已有主键导致恢复中断。

## 当前结果

恢复完成后，数据库核心表已经回填：

```txt
user           1
website        4
session        2196
website_event  4469
```

`website` 比旧备份多 1 条，是重新初始化时生成的默认站点；`website_event` 比旧备份略多，应该包含恢复期间或修复后新写入的访问事件。

整体上，Umami 的历史访问统计已经基本恢复可用。

## 后续处理

恢复后需要继续做几件事：

1. 在 Supabase 开启或确认备份策略，最好启用 PITR；
2. 重置曾经暴露过的数据库密码；
3. 更新 EdgeOne / Umami 的 `DATABASE_URL`；
4. 在 Umami 后台清理多余的默认站点；
5. 确认新访问能正常写入；
6. 谨慎处理 RLS，不要在不了解 Umami 访问方式的情况下直接启用。

## 结论

这次问题不是单一 bug，而是三个问题叠加：

- 数据库连接串格式错误；
- 部署环境与 Supabase direct connection / TLS 参数不匹配；
- 数据库被重新初始化，历史统计表数据丢失。

最终通过修正连接串、调整 TLS 参数、再从 JSON 导出数据分片恢复，完成了 Umami 统计数据修复。
