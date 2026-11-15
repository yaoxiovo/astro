# 漫画附属歌曲

歌曲复用 `src/content/music/*.md` 和 `/music/<slug>/` 详情页。在歌曲 frontmatter 中添加漫画 slug：

```yaml
comics:
  - huyao-xiaohongniang
songType: 片尾曲
title: 歌曲名
artist: 歌手
src: /music/mp3/song.mp3
cover: /music/song-cover.jpg
lrc: /music/lrc/song.lrc
published: 2026-11-15
```

正文可写歌曲介绍。`comics` 可关联多部漫画；`songType` 可填写主题曲、插曲等，自由选填。未关联的歌曲保持音乐馆原有行为。

漫画目录会展示关联歌曲，点击进入歌曲详情；详情页提供返回所属漫画的链接。暂无歌曲时显示空状态，不生成虚构曲目。

`lrc` 支持本站路径、HTTPS 地址或内联 LRC 文本（建议 YAML 多行字符串）。外部文件需允许跨域读取。播放器支持时间戳同步高亮、滚动和点击歌词跳转；不填写时显示无歌词提示。歌词按文本渲染。

## 已收录资源

已收录用户提供的 14 首 Lethe 歌曲，均关联《狐妖小红娘》。歌词保存在 `public/music/lrc/huyao-*.lrc`。音频由 `https://blog-api.yaoxi.wiki/comic-media/` 提供，对应服务器 `/www/wwwroot/blog-comic-media/`；该目录独立于前端部署目录，不受 rsync 清理影响。Nginx 扩展配置为 `/www/server/panel/vhost/nginx/extension/blog-api.yaoxi.wiki/comic-media.conf`，支持 Range、7 天缓存和跨域读取。原始文件保留在 `/www/wwwroot/111/`。

歌曲封面从各 MP3 的内嵌图片原样提取，不重新编码。当前 14 首音频的内嵌封面完全相同（640 × 640 JPEG），统一引用 `public/music/covers/huyao-lethe-embedded.jpg`。
