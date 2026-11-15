# 完整博客部署到首尔源站

生产域名为 `https://blog.yaoxi.wiki`，EdgeOne 回源首尔服务器 `43.128.137.8:443`，回源 Host 同域名。

GitHub Actions 的 `deploy.yml` 在 GitHub 执行依赖安装和 Astro 构建，上传完整 `dist/` 至 `/www/blog-releases/<commit>`，最终把 `/www/wwwroot/blog.yaoxi.wiki` 切换到该版本。服务器不执行构建。旧 `blog-api.yaoxi.wiki` API 服务继续独立运行。

每次发布的文件集合完整，网络传输为增量：rsync 校验内容并以现网版本为 `--link-dest`，未变化的文件通过硬链接复用，只上传变化的文件。新版本上传完毕后原子切换目录；本机 HTTPS 健康检查失败会恢复之前版本。

漫画页面、目录和清单属于博客构建产物；漫画原图仍以香港源站 `blog-s3-hk.yaoxi.wiki` 为主，EdgeOne 选项使用现有个人版域名 `blog-s3-eo.yaoxi.wiki`。不把约 1.4 GB 漫画原图重复打包进每次博客发布。首尔现存的图片副本不改变阅读器的 CDN 线路。

站点证书由 `/opt/yaoxi-acme` 的 DNSPod DNS 验证签发，安装到 `/www/server/panel/vhost/cert/blog.yaoxi.wiki/`；证书续期执行 Nginx 检查和平滑重载。SSH 部署固定校验源站 Ed25519 公钥；服务器私钥与签名密钥仅放 GitHub Secrets。
