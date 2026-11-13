# 漫画图片线路

漫画封面、横幅和章节图片默认使用 Cloudflare 优选线路。阅读器支持手动切换线路，并保存选择。

| 线路 | 图片域名 |
| --- | --- |
| Cloudflare 优选（默认） | `https://blog-s3-cf.yaoxi.wiki` |
| EdgeOne | `https://blog-s3-eo.yaoxi.wiki` |
| 阿里云 ESA | `https://blog-s3-esa.yaoxi.wiki` |

`blog-s3-cf.yaoxi.wiki` 的 DNS CNAME 指向 `cf.yaoxi.cloud`，由该入口提供优选地址。前端始终请求漫画域名，以保留正确的 TLS 和 Host；无需在前端填写优选 IP。

三条线路均通过 HTTPS 回源香港云，源站为 `blog-s3-hk.yaoxi.wiki`。Cloudflare 使用专属回源别名 `blog-s3-hk.yaoxiovo.cn` 接入同一香港云站点。

所有线路保留相同的 `/comics/<作品>/chapters/<章节>/page-<页码>.webp` 路径。香港云保存完整图片，R2 保留资源副本。当前阶段仅支持手动切换 CDN，容灾和智能择优后续实施。

更新线路时，需要同时同步 `catalog.json`、作品的 `index.json` 和 `manifest.json`，以及 `scripts/import-comic.mjs` 的导入默认值。默认线路继续使用 `cdn` 标识，兼容已有阅读偏好；已保存的旧 R2 选项会回到默认线路。

阅读漫画时，博客侧边栏显示当前页的缓存状态。切换页码或线路后，卡片通过 HEAD 请求读取缓存头，显示 CDN 原始状态、Age、Cache-Control、ETag、请求标识等；只读取响应头，不下载图片正文。该结果反映独立检查，可能复用浏览器缓存，不用于推断首次图片请求的状态。缓存头未公开时显示未知，请求失败时单独标注。

三个 CDN 的漫画域名均配置 `Access-Control-Expose-Headers`，供浏览器读取这些诊断字段。该规则在响应阶段生效，不需要清空图片缓存。

GitHub 仓库只保留漫画框架和数据清单，封面、横幅、章节图片及分块包均不再跟踪。`public/comics/` 和 `comic-assets/` 可用于本地导入与校验，已加入忽略规则；云端完整资源不受仓库清理影响。
