---
title: Cloudflare Worker 反向代理代码：CORS、Cookie 与 302 跳转修复
published: 2026-05-04
description: 提供可直接部署的 Cloudflare Worker 反向代理代码，支持 CORS、Cookie 重写、路径前缀代理和 301/302 跳转修复。
tags:
  - Cloudflare Worker
  - 反向代理
  - CORS
  - Cookie
  - JavaScript
category: 代码教程
draft: false
lang: 'zh_CN'
---

# Cloudflare Worker 反向代理代码

这是一份可直接部署的 Cloudflare Worker 反向代理代码，适合代理自己有权限使用的 API 或站点。

主要修复点：

- 支持 `GET / POST / PUT / PATCH / DELETE`
- 支持 CORS 预检请求
- 修复 `302 / 301` 跳转回源站的问题
- 修复登录 Cookie 绑定源站域名导致不生效的问题
- 支持 `/proxy/*` 路径前缀代理
- 防止把 Worker 代理到自己造成无限循环
- 清理不应转发的 hop-by-hop headers

## Worker 代码

把下面代码复制到 Cloudflare Worker 里即可。

```js
const DEFAULT_TARGET = "https://example.com";
// 改成你的上游地址，例如：
// const DEFAULT_TARGET = "https://api.example.com";
// const DEFAULT_TARGET = "https://example.com/api";

const ENABLE_CORS = true;

// 如果前端要带 cookie / Authorization 且用 credentials: "include"，
// 必须改成 true，并把 ALLOWED_ORIGINS 改成具体域名，不能用 "*"。
const CORS_ALLOW_CREDENTIALS = false;
const ALLOWED_ORIGINS = ["*"];

// 如果你只想让 /proxy/* 走代理，改成 "/proxy"。
// 如果整个 Worker 域名都反代，保持空字符串。
const STRIP_PREFIX = "";

// 如果 STRIP_PREFIX = "/proxy"，建议开启，避免登录 cookie path 不匹配。
const REWRITE_COOKIE_PATH_TO_PREFIX = true;

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export default {
  async fetch(request, env) {
    const targetValue = env.TARGET || DEFAULT_TARGET;
    const stripPrefix = normalizePrefix(env.STRIP_PREFIX || STRIP_PREFIX);

    let target;
    try {
      target = new URL(targetValue);
    } catch {
      return text("Invalid TARGET URL", 500, request);
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return text("TARGET must be http or https", 500, request);
    }

    const incomingUrl = new URL(request.url);

    // 防止把 Worker 自己代理到自己，导致无限循环。
    if (
      incomingUrl.protocol === target.protocol &&
      incomingUrl.hostname === target.hostname &&
      normalizePort(incomingUrl) === normalizePort(target)
    ) {
      return text("Proxy loop blocked: TARGET cannot equal Worker host", 508, request);
    }

    if (ENABLE_CORS && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: makeCorsHeaders(request),
      });
    }

    let upstreamUrl;
    try {
      upstreamUrl = buildUpstreamUrl(incomingUrl, target, stripPrefix);
    } catch (err) {
      return text(err.message || "Bad proxy path", 404, request);
    }

    const upstreamHeaders = new Headers(request.headers);

    // Host 不要手动转发；Workers 会按目标 URL 处理。
    upstreamHeaders.delete("host");

    for (const name of HOP_BY_HOP_HEADERS) {
      upstreamHeaders.delete(name);
    }

    upstreamHeaders.set("X-Forwarded-Host", incomingUrl.host);
    upstreamHeaders.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));

    const hasBody = !["GET", "HEAD"].includes(request.method);

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: hasBody ? request.body : undefined,

      // 必须 manual：否则 302 到别的域时，Authorization/Cookie 等敏感 header 可能继续跟过去。
      redirect: "manual",
    });

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamRequest);
    } catch (err) {
      return text(`Upstream fetch failed: ${err && err.message ? err.message : err}`, 502, request);
    }

    const responseHeaders = copyHeadersSafely(upstreamResponse.headers);

    // 修复 301 / 302 Location 跳回源站的问题。
    rewriteLocationHeader(responseHeaders, upstreamUrl, target, incomingUrl, stripPrefix);

    // 修复登录 / 会话 cookie 绑定到源站域名，导致代理域名下不生效的问题。
    rewriteSetCookieHeaders(
      responseHeaders,
      upstreamResponse.headers,
      stripPrefix
    );

    if (ENABLE_CORS) {
      applyCorsHeaders(responseHeaders, request);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

function buildUpstreamUrl(incomingUrl, target, stripPrefix) {
  let requestPath = incomingUrl.pathname;

  if (stripPrefix) {
    const exact = requestPath === stripPrefix;
    const child = requestPath.startsWith(stripPrefix + "/");

    if (!exact && !child) {
      throw new Error(`Not Found: only ${stripPrefix}/* is proxied`);
    }

    requestPath = requestPath.slice(stripPrefix.length) || "/";
  }

  const upstream = new URL(target.toString());
  upstream.pathname = joinPaths(target.pathname, requestPath);

  // 保留 TARGET 自带 query，同时追加用户请求 query。
  const params = new URLSearchParams(upstream.search);
  for (const [key, value] of incomingUrl.searchParams) {
    params.append(key, value);
  }
  upstream.search = params.toString();

  return upstream;
}

function joinPaths(basePath, requestPath) {
  const base = !basePath || basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const path = requestPath.startsWith("/") ? requestPath : "/" + requestPath;
  return base + path || "/";
}

function normalizePrefix(prefix) {
  if (!prefix || prefix === "/") return "";
  return "/" + String(prefix).replace(/^\/+|\/+$/g, "");
}

function normalizePort(url) {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function copyHeadersSafely(headers) {
  const copied = new Headers(headers);

  // 由 runtime 自动计算，手动保留容易和流式 body 不一致。
  copied.delete("content-length");

  return copied;
}

function rewriteLocationHeader(headers, upstreamUrl, target, incomingUrl, stripPrefix) {
  const location = headers.get("location");
  if (!location) return;

  let locationUrl;
  try {
    locationUrl = new URL(location, upstreamUrl);
  } catch {
    return;
  }

  // 只重写源站自己的跳转；跳到第三方 OAuth / 支付页面时不要乱改。
  if (locationUrl.origin !== target.origin) return;

  const rewritten = new URL(locationUrl.toString());
  rewritten.protocol = incomingUrl.protocol;
  rewritten.host = incomingUrl.host;

  const targetBasePath = normalizeBasePath(target.pathname);
  let newPath = rewritten.pathname;

  if (
    targetBasePath &&
    (newPath === targetBasePath || newPath.startsWith(targetBasePath + "/"))
  ) {
    newPath = newPath.slice(targetBasePath.length) || "/";
  }

  if (stripPrefix) {
    newPath = joinPaths(stripPrefix, newPath);
  }

  rewritten.pathname = newPath;
  headers.set("location", rewritten.toString());
}

function normalizeBasePath(pathname) {
  const path = pathname.replace(/\/+$/, "");
  return path === "" || path === "/" ? "" : path;
}

function rewriteSetCookieHeaders(responseHeaders, originalHeaders, stripPrefix) {
  const cookies = getSetCookies(originalHeaders);
  if (!cookies.length) return;

  responseHeaders.delete("set-cookie");

  for (const cookie of cookies) {
    responseHeaders.append(
      "set-cookie",
      rewriteSingleCookie(cookie, stripPrefix)
    );
  }
}

function getSetCookies(headers) {
  // Cloudflare Workers 支持 getAll("Set-Cookie")。
  if (typeof headers.getAll === "function") {
    return headers.getAll("Set-Cookie");
  }

  // 部分运行环境支持标准 getSetCookie。
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = headers.get("Set-Cookie");
  return single ? [single] : [];
}

function rewriteSingleCookie(cookie, stripPrefix) {
  let result = cookie;

  // 去掉 Domain，让浏览器把 cookie 绑定到当前代理域名。
  result = result.replace(/;\s*Domain=[^;]*/gi, "");

  // 如果 Worker 挂在 /proxy/*，cookie 的 Path=/ 可能不会随 /proxy/* 请求发送。
  if (stripPrefix && REWRITE_COOKIE_PATH_TO_PREFIX) {
    if (/;\s*Path=[^;]*/i.test(result)) {
      result = result.replace(/;\s*Path=[^;]*/i, `; Path=${stripPrefix}`);
    } else {
      result += `; Path=${stripPrefix}`;
    }
  }

  return result;
}

function makeCorsHeaders(request) {
  const headers = new Headers();

  if (!ENABLE_CORS) return headers;

  const origin = request.headers.get("Origin");
  const requestHeaders = request.headers.get("Access-Control-Request-Headers");

  if (CORS_ALLOW_CREDENTIALS) {
    if (origin && isAllowedOrigin(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Credentials", "true");
    }
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS"
  );
  headers.set("Access-Control-Allow-Headers", requestHeaders || "*");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set(
    "Vary",
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
  );

  return headers;
}

function applyCorsHeaders(headers, request) {
  const cors = makeCorsHeaders(request);

  for (const [key, value] of cors.entries()) {
    if (key.toLowerCase() === "vary") {
      appendVary(headers, value);
    } else {
      headers.set(key, value);
    }
  }
}

function appendVary(headers, value) {
  const existing = headers.get("Vary");
  const values = new Set();

  if (existing) {
    for (const item of existing.split(",")) {
      const trimmed = item.trim();
      if (trimmed) values.add(trimmed);
    }
  }

  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (trimmed) values.add(trimmed);
  }

  headers.set("Vary", Array.from(values).join(", "));
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
}

function text(message, status, request) {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
  });

  if (ENABLE_CORS) {
    applyCorsHeaders(headers, request);
  }

  return new Response(message, { status, headers });
}
```

## Wrangler 配置

如果你用 Wrangler 部署，可以新建 `wrangler.toml`：

```toml
name = "reverse-proxy"
main = "worker.js"
compatibility_date = "2026-05-04"
workers_dev = true

[vars]
TARGET = "https://example.com"
# STRIP_PREFIX = "/proxy"
```

## 部署命令

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## 只代理 `/proxy/*`

如果你不想整个 Worker 域名都变成反代，只想让 `/proxy/*` 走代理：

```toml
[vars]
TARGET = "https://example.com"
STRIP_PREFIX = "/proxy"
```

访问：

```txt
https://你的-worker-域名/proxy/users?id=1
```

会转发到：

```txt
https://example.com/users?id=1
```

## CORS 携带 Cookie 的情况

如果前端请求使用了：

```js
fetch("https://你的-worker-域名/api", {
  credentials: "include",
});
```

那么不能使用：

```js
Access-Control-Allow-Origin: *
```

需要把代码里的配置改成：

```js
const CORS_ALLOW_CREDENTIALS = true;
const ALLOWED_ORIGINS = ["https://你的前端域名.com"];
```

## 常见问题

### 1. 登录后 Cookie 不生效

通常是因为源站返回的 Cookie 带了 `Domain=源站域名`。这份代码会删除 `Domain`，让浏览器把 Cookie 绑定到当前 Worker 域名。

### 2. 跳转后回到源站

通常是因为源站返回了：

```http
Location: https://example.com/login
```

这份代码会把同源跳转重写成 Worker 域名。

### 3. 代理到自己导致 508

不要把 `TARGET` 设置成 Worker 自己的域名，否则会无限循环。

### 4. 整站反代后页面资源加载异常

如果源站 HTML 里写死了绝对路径，例如：

```html
<script src="https://example.com/app.js"></script>
```

这类情况需要额外使用 `HTMLRewriter` 重写页面内容。API 反代一般不需要。

## 结语

这份代码更适合 API 反代或轻量站点反代。如果是完整网站镜像，尤其是带登录、静态资源、OAuth、支付回调的站点，还需要针对具体站点继续调整规则。
