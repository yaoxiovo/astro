---
title: Cloudflare Workers 反向代理教程（小白照抄版）
description: 一篇适合新手直接复制粘贴的 Cloudflare Workers 反向代理教程，无需服务器即可搭建可用代理。
published: 2026-01-09
tags:
  - 教程
  - Cloudflare
---


Cloudflare Workers 反向代理教程（小白照抄版）

> 本文适合 完全没接触过 Cloudflare Workers 的新手。 只要会复制粘贴，就一定能搭好一个可用的反向代理。

---

一、你最终能得到什么

照着本文一步一步做完，你将得到：

一个可用的反向代理地址（workers.dev 或自定义域名）

访问代理地址 = 访问真实网站

全程不需要服务器、不需要备案


示例：

访问：https://你的worker.workers.dev/test
等同于：https://example.com/test

---

二、开始前你需要准备什么

请确认你已经准备好以下内容：

1. 一个 Cloudflare 账号（免费即可）


2. 能正常登录 Cloudflare 控制台


3. 一个你想要代理的网站（例如：https://example.com）



Cloudflare 控制台地址：

👉 https://dash.cloudflare.com

登录后，在左侧菜单中找到 Workers & Pages。

---

三、新建一个 Worker（跟着点就行）

第一步：创建 Worker

1. 进入 Workers & Pages

2. 点击 Create application

3. 选择 Workers

4. 点击 Create Worker

5. 随便填写一个名称（如：proxy-test）

6. 点击 Deploy

看到成功提示后，说明 Worker 已创建完成。

---

第二步：进入代码编辑页面

1. 点击刚创建好的 Worker

2. 点击 Edit code

3. 页面中会出现一段默认代码

👉 全部删除即可，不需要看。

---

四、最基础的反向代理代码（直接复制）

将下面代码 完整复制，粘贴到编辑器中：

`export default {
  async fetch(request) {
    // 这里改成你要代理的网站
    const TARGET = 'https://example.com'

    const url = new URL(request.url)
    const newUrl = TARGET + url.pathname + url.search

    return fetch(newUrl, request)
  }
}`

⚠️ 注意事项：

必须把 https://example.com 换成你自己的目标网站

不要多删或多加任何字符

---

保存并部署

1. 点击右上角 Save and Deploy

2. 等待提示部署成功

此时，你的反向代理已经可以使用了。

---

五、测试是否搭建成功

在浏览器中访问你的 Worker 地址，例如：

https://proxy-test.workers.dev

如果看到的是目标网站内容，说明成功。

再测试路径访问：

https://proxy-test.workers.dev/abc

等同于：

https://example.com/abc

---

六、出现 403 或异常？用这个版本

如果访问时报 403、页面空白或跳转异常，使用下面这个 兼容版代码。

export default {
  async fetch(request) {
    const TARGET = 'https://example.com'
    const url = new URL(request.url)

    const headers = new Headers(request.headers)
    headers.set('Host', new URL(TARGET).host)

    const newRequest = new Request(TARGET + url.pathname + url.search, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'follow'
    })

    return fetch(newRequest)
  }
}

保存并重新部署后再次测试。


---

七、前端接口跨域（CORS）解决方案

如果你是给前端项目做代理接口，请使用下面这个版本：

export default {
  async fetch(request) {
    const TARGET = 'https://example.com'
    const url = new URL(request.url)

    const response = await fetch(TARGET + url.pathname + url.search, request)
    const newResponse = new Response(response.body, response)

    newResponse.headers.set('Access-Control-Allow-Origin', '*')
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')

    return newResponse
  }
}


---

八、绑定自定义域名（可选）

如果你不想使用 workers.dev：

1. 将你的域名接入 Cloudflare


2. 进入 Worker → Triggers


3. 添加 Custom Domain


4. 例如：proxy.yourdomain.com



完成后即可使用自己的域名访问代理。


---

九、新手常见问题

能代理 HTTPS 吗？

可以，Cloudflare Workers 原生支持 HTTPS。

免费额度够用吗？

免费版每天 10 万次请求，一般个人使用完全够用。

为什么有的网站代理不了？

部分网站会限制 Cloudflare IP，这属于目标站策略限制。


---

十、总结

一句话概括：

> 复制代码 → 改目标网址 → 保存部署 → 直接使用



Cloudflare Workers 是目前成本最低、上手最快的反向代理方案之一。

在此基础上，你还可以继续扩展：

多站点代理

加访问密码

API 中转

防盗链
