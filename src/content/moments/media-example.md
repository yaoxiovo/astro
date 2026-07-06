---
author: 瑶曦网络科技官方
published: 2026-07-06T20:25:00+08:00
source: "Astro for Windows"
images:
  - "10.jpg"
---

今天顺利完成了朋友圈多媒体（图片 WebP 缩略图、原图、流畅视频）大重构！ #开发日志 #Astro

为了测试智能前缀和发表日期 YYYY-MM-DD 自动拼接，本喵特意写了这个实例说说喵。
在这条说说的 Frontmatter 中，我们仅仅填写了纯文件名：
- 图片：`cat.png` 和 `my-avatar.jpg`
- 视频：`my-video.mp4`

系统会自动根据发表日期 `2026-07-06` 进行智能路径归档并拼装出以下地址喵：
- 原图 1：`https://png.yaoxi.wiki/astro/raw/2026-07-06/cat.png`
- 缩略图 1：`https://png.yaoxi.wiki/astro/webp/2026-07-06/cat.webp`
- 原图 2：`https://png.yaoxi.wiki/astro/raw/2026-07-06/my-avatar.jpg`
- 缩略图 2：`https://png.yaoxi.wiki/astro/webp/2026-07-06/my-avatar.webp`
- 流式视频：`https://png.yaoxi.wiki/astro/video/2026-07-06/my-video.mp4`

不仅如此，视频播放器已经默认开启了 `preload="auto"`，流式缓冲直接拉满，彻底告别播放卡顿，非常 Premium 喵呜~！
