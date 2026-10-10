import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  JWT_SECRET: string;
  AUTH_SECRET?: string;
  SSO_SECRET?: string;
  GITHUB_TOKEN: string;       // GitHub Personal Access Token (repo 权限)
  GITHUB_REPO_OWNER: string;  // 例如 'yaoxiovo'
  GITHUB_REPO_NAME: string;   // 例如 'astro'
  GITHUB_BRANCH?: string;     // 默认 'main'
  CF_ACCOUNT_ID: string;      // Cloudflare Account ID
  CF_API_TOKEN: string;       // Cloudflare API Token (Pages:Read)
  CF_PAGES_PROJECT: string;   // Cloudflare Pages 项目名，例如 'astro'
  CF_ZONE_ID?: string;        // Cloudflare Zone ID
}

interface JWTPayload {
  sub: string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;              // 'admin' | 'member' | 'reader'
  roles?: string[];
  is_admin?: boolean;
  is_member?: boolean;
  platform_tokens?: Record<string, string>;
  github_pat?: string;
  github_token?: string;
  pat?: string;
  cf_token?: string;
  cloudflare_token?: string;
  cf_zone_id?: string;
  cf_zone?: string;
  [key: string]: unknown;
}

export type UserRole = 'admin' | 'member';

/**
 * 依据认证中心 (SSO / accounts.yaoxi.cloud) 下发的 Token 身份信息判断权限
 * 纯粹由认证中心下发的信息决定是【管理员】还是【成员】，绝不硬编码在博客代码内！
 */
export function getAuthCenterRole(user: JWTPayload): UserRole {
  if (!user) return 'member';
  const role = String(user.role || '').toLowerCase();
  const roles = Array.isArray(user.roles) ? user.roles.map((r: any) => String(r).toLowerCase()) : [];
  if (role === 'admin' || roles.includes('admin') || user.is_admin === true) {
    return 'admin';
  }
  return 'member';
}

const app = new Hono<{ Bindings: Env; Variables: { user: JWTPayload; userRole: UserRole } }>();

// 允许跨域的官方域名后缀（前导点保证 evil-yaoxi.wiki / yaoxi.wiki.attacker.com 不匹配）
const ALLOWED_ORIGIN_SUFFIXES = ['.yaoxi.wiki', '.yaoxi.cloud'];
// 本地调试主机白名单：必须整体相等，绝不做子串匹配
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_ORIGIN = 'https://blog.yaoxi.wiki';

/**
 * 解析请求 Origin，仅放行官方域名后缀与本地调试主机。
 * 先前使用 origin.includes('localhost') 会被 https://notlocalhost.evil.com 绕过，
 * 故此处改为解析 URL 后对 hostname 做精确比对。
 */
function resolveCorsOrigin(origin: string | undefined): string {
  if (!origin) return DEFAULT_ORIGIN;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'https:' && protocol !== 'http:') return DEFAULT_ORIGIN;
    if (ALLOWED_ORIGIN_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return origin;
    if (LOCAL_DEV_HOSTS.has(hostname)) return origin;
  } catch {
    // Origin 非法，回落到默认站点
  }
  return DEFAULT_ORIGIN;
}

// 启用全局 CORS 允许 Astro 前端及本地调试客户端安全跨域
app.use('*', cors({
  origin: (origin) => resolveCorsOrigin(origin),
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));

// ============================================================
// 1. 通用身份认证核心：校验认证中心密码学签名，提取下发的身份信息
// ============================================================
/** 认证失败的结构化原因，供中间件与内联校验共用 */
type AuthFailure =
  | { ok: false; status: 401 | 503; message: string }
  | { ok: true; user: JWTPayload; role: UserRole };

/**
 * 纯函数式验签：不写响应、不改上下文，仅返回结论。
 * 中间件与路由内联校验（如 /api/ddos 需在 demo 分支之后才校验）共用同一实现，
 * 避免两处鉴权逻辑各自漂移。
 */
async function authenticateRequest(c: any): Promise<AuthFailure> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: '缺少有效的 Authorization 认证头 喵！' };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Bearer Token 为空 喵！' };
  }

  const secretsToTry: string[] = [
    c.env.JWT_SECRET,
    c.env.AUTH_SECRET,
    c.env.SSO_SECRET,
  ].filter(Boolean);

  // 安全约束：未配置任何验签密钥时必须拒绝，绝不回退到硬编码常量。
  // 否则任何持有该公开常量的人都能伪造 role:"admin" 的 Token 取得完整管理员权限。
  if (secretsToTry.length === 0) {
    return {
      ok: false,
      status: 503,
      message: '服务端未配置验签密钥 (JWT_SECRET / AUTH_SECRET / SSO_SECRET)，拒绝所有请求 喵！',
    };
  }

  // 严格尝试密码学验签
  let user: JWTPayload | null = null;
  for (const s of secretsToTry) {
    try {
      const secretKey = new TextEncoder().encode(s);
      const { payload } = await jwtVerify(token, secretKey);
      user = payload as unknown as JWTPayload;
      break;
    } catch {
      // 秘钥不匹配，继续尝试下一个候选秘钥
    }
  }

  if (!user) {
    return { ok: false, status: 401, message: 'Token 密码学校验失败或签名无效，拒绝访问 喵！' };
  }

  // 时效强校验：拒绝无 exp 的永不过期凭证（与 blog-api/src/jwt.js 语义对齐）
  const now = Math.floor(Date.now() / 1000);
  const CLOCK_TOLERANCE_SEC = 60;
  if (typeof user.exp !== 'number' || now > user.exp + CLOCK_TOLERANCE_SEC) {
    return { ok: false, status: 401, message: 'Token 已过期或缺少 exp 时效声明，拒绝访问 喵！' };
  }
  if (typeof user.nbf === 'number' && now + CLOCK_TOLERANCE_SEC < user.nbf) {
    return { ok: false, status: 401, message: 'Token 尚未生效 (nbf)，拒绝访问 喵！' };
  }

  return { ok: true, user, role: getAuthCenterRole(user) };
}

/** 布尔式管理员判定，供不便使用中间件的路由内联调用 */
async function isAdminRequest(c: any): Promise<boolean> {
  const result = await authenticateRequest(c);
  return result.ok && result.role === 'admin';
}

// ============================================================
// 1.1 通用身份认证中间件：验签失败即返回对应错误
// ============================================================
const requireAuth = async (c: any, next: () => Promise<void>) => {
  const result = await authenticateRequest(c);
  if (result.ok === false) {
    return c.json(
      { error: result.status === 503 ? 'ServiceUnavailable' : 'Unauthorized', message: result.message },
      result.status,
    );
  }
  c.set('user', result.user);
  c.set('userRole', result.role);
  await next();
};

// ============================================================
// 2. 管理员专属中间件：由认证中心下发的信息决定是否具备 admin 权限
// ============================================================
const requireAdmin = async (c: any, next: () => Promise<void>) => {
  await requireAuth(c, async () => {
    const userRole = c.get('userRole');
    if (userRole !== 'admin') {
      return c.json({
        error: 'Forbidden',
        message: '权限不足：当前操作仅限认证中心授权的【管理员 (admin)】访问，【成员 (member)】无权执行此操作 喵！',
      }, 403);
    }
    await next();
  });
};

// ============================================================
// 1. 便捷文章发布端点 (POST /api/publish) - 仅限认证中心管理员
// ============================================================
app.post('/api/publish', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { title, slug, content, tags, description, category, image, draft, lang, fileContent, githubToken: bodyGithubToken } = body;

  if (!slug || (!content && !fileContent)) {
    return c.json({
      error: 'invalid_request',
      message: 'slug and content (or fileContent) are required',
    }, 400);
  }

  // 严格防范路径穿越：仅允许字母、数字、中文、中划线和下划线，严禁包含 '/'、'\' 或 '..'
  const cleanSlug = String(slug).trim().replace(/\.md$/, '').replace(/^\/+/, '');
  if (!cleanSlug || cleanSlug.includes('..') || cleanSlug.includes('/') || cleanSlug.includes('\\')) {
    return c.json({
      error: 'invalid_slug',
      message: 'Slug 包含非法路径穿越字符，严禁写入 喵！',
    }, 400);
  }

  if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(cleanSlug)) {
    return c.json({
      error: 'invalid_slug',
      message: 'Slug 仅支持字母、数字、中文、中划线及下划线 喵！',
    }, 400);
  }

  // 提取 GitHub Token（支持 Worker 环境变量或请求头 X-GitHub-Token / body 透传）
  const githubToken = c.req.header('X-GitHub-Token') || bodyGithubToken || c.env.GITHUB_TOKEN;
  if (!githubToken) {
    return c.json({
      error: 'missing_github_token',
      message: '未配置 GitHub Personal Access Token (PAT)',
      details: '发布到 GitHub 仓库需要 PAT 授权。请在 Worker 环境变量中配置 GITHUB_TOKEN Secret，或在 Admin 发布后台【鉴权凭据】中直接填入具备 repo 写入权限的 GitHub Token 喵！',
    }, 400);
  }

  // 1. 组装符合 Astro Content Collections 规范的 Markdown 正文与 Frontmatter
  let finalMarkdown: string;
  if (fileContent) {
    finalMarkdown = fileContent;
  } else {
    const postTitle = (title || cleanSlug).trim();
    const postDate = new Date().toISOString().split('T')[0];
    const postDesc = (description || postTitle).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
    const postCategory = (category || '技术分享').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
    const isDraft = Boolean(draft);
    const postLang = (lang || 'zh_CN').trim();

    // 标签解析与格式化
    let tagList: string[] = [];
    if (Array.isArray(tags)) {
      tagList = tags.map(t => String(t).trim()).filter(Boolean);
    } else if (typeof tags === 'string') {
      tagList = tags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    }
    if (tagList.length === 0) tagList = ['博客'];

    const tagsYaml = tagList.map(t => `  - ${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}`).join('\n');
    const imageYaml = image ? `image: "${String(image).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n` : '';

    finalMarkdown = `---
title: "${postTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
published: ${postDate}
description: "${postDesc}"
tags:
${tagsYaml}
category: "${postCategory}"
${imageYaml}draft: ${isDraft}
lang: "${postLang}"
---

${content.trim()}
`;
  }

  const filePath = `src/content/posts/${cleanSlug}.md`;
  const owner = c.env.GITHUB_REPO_OWNER || 'yaoxiovo';
  const repo = c.env.GITHUB_REPO_NAME || 'astro';
  const branch = c.env.GITHUB_BRANCH || 'main';
  const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  // 2. 检查现有文件是否存在以提取 SHA 实现幂等创建或更新
  let existingSha: string | undefined = undefined;
  const getRes = await fetch(`${githubApiUrl}?ref=${branch}`, {
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (getRes.status === 401) {
    return c.json({
      error: 'github_unauthorized',
      message: 'GitHub Token 校验未通过 (Bad credentials)',
      details: '提供的 GitHub Personal Access Token 无效或已过期，请在 GitHub Settings 检查 Token 是否有效 喵！',
    }, 401);
  }

  if (getRes.status === 403) {
    const errText = await getRes.text();
    return c.json({
      error: 'github_forbidden',
      message: 'GitHub Token 权限不足 (Permission denied)',
      details: errText.includes('rate limit')
        ? 'GitHub API 调用频率超限'
        : 'GitHub Token 缺少仓库 Contents 写入权限，请在 Token 权限中勾选 repo 或 contents:write 权限 喵！',
    }, 403);
  }

  if (getRes.ok) {
    const existingData = await getRes.json<{ sha: string }>();
    existingSha = existingData.sha;
  }

  // 3. 将 Markdown 完整内容编码为 UTF-8 Base64 并调用 GitHub Contents API
  //
  // 实现说明（勿改回 Buffer）：
  //   - 这里刻意只使用 Workers 运行时本身就保证存在的 TextEncoder + btoa（Web 标准 API），
  //     而不再探测 Node 的 Buffer。本 worker 是 ESM 模块，Buffer 并非 Web 标准 API，
  //     其可用性取决于 nodejs_compat 兼容标志；@cloudflare/workers-types 也刻意不声明
  //     任何 Node 全局量，因此使用 Buffer 会让 tsc 报 TS2591 且无法被 CI 守住。
  //   - 原实现为 Buffer.from(...) -> TextEncoder+btoa -> unescape(encodeURIComponent(...)) 三层回退。
  //     第一层与第二层对任意输入产出完全相同的标准 Base64；第二层在 Workers 上不会抛错，
  //     故第一层从未被实际命中，删除它不改变运行时行为。
  //   - 保留最外层 try/catch 作为最后兜底，行为与原先一致。
  let base64Content: string;
  try {
    const utf8Bytes = new TextEncoder().encode(finalMarkdown);
    let binary = '';
    const len = utf8Bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    base64Content = btoa(binary);
  } catch (e: any) {
    base64Content = btoa(unescape(encodeURIComponent(finalMarkdown)));
  }

  const commitMessage = existingSha
    ? `docs(post): update ${cleanSlug} via Admin Studio`
    : `docs(post): publish ${title || cleanSlug} via Admin Studio`;

  const commitRes = await fetch(githubApiUrl, {
    method: 'PUT',
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
      sha: existingSha,
      branch: branch,
    }),
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text();
    let errObj: any = {};
    try { errObj = JSON.parse(errText); } catch (e) {}

    return c.json({
      error: 'github_api_failed',
      message: `GitHub API 提交失败: ${errObj.message || 'HTTP ' + commitRes.status}`,
      details: errText,
    }, 502);
  }

  const commitData = await commitRes.json<{ commit: { sha: string; html_url: string } }>();

  return c.json({
    success: true,
    slug: cleanSlug,
    file_path: filePath,
    commit_sha: commitData.commit.sha,
    commit_url: commitData.commit.html_url,
    message: 'Article successfully committed. Cloudflare Pages build triggered.',
  });
});

// ============================================================
// 1.2 便捷文章删除端点 (DELETE /api/post/:slug) - 仅限管理员
// ============================================================
app.delete('/api/post/:slug', requireAdmin, async (c) => {
  const slug = c.req.param('slug');
  const cleanSlug = String(slug).trim().replace(/\.md$/, '').replace(/^\/+/, '');
  const githubToken = c.req.header('X-GitHub-Token') || c.env.GITHUB_TOKEN;
  if (!githubToken) {
    return c.json({ error: 'missing_github_token', message: '未配置 GitHub PAT' }, 400);
  }

  const filePath = `src/content/posts/${cleanSlug}.md`;
  const owner = c.env.GITHUB_REPO_OWNER || 'yaoxiovo';
  const repo = c.env.GITHUB_REPO_NAME || 'astro';
  const branch = c.env.GITHUB_BRANCH || 'main';
  const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  // 1. 获取现有文件的 sha
  const getRes = await fetch(`${githubApiUrl}?ref=${branch}`, {
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!getRes.ok) {
    return c.json({ error: 'file_not_found', message: `文章不存在或已被删除: ${cleanSlug}` }, 404);
  }

  const fileData = await getRes.json<{ sha: string }>();

  // 2. 发起 DELETE
  const delRes = await fetch(githubApiUrl, {
    method: 'DELETE',
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `docs(post): delete ${cleanSlug} via Admin Studio`,
      sha: fileData.sha,
      branch: branch,
    }),
  });

  if (!delRes.ok) {
    const errText = await delRes.text();
    return c.json({ error: 'delete_failed', message: `删除失败: ${errText}` }, 502);
  }

  const delData = await delRes.json<{ commit: { sha: string } }>();
  return c.json({
    success: true,
    commit_sha: delData.commit.sha,
    message: `文章 ${cleanSlug} 已从仓库删除`
  });
});

// ============================================================
// 1.5 便捷朋友圈动态与时间胶囊发布端点 (POST /api/publish-moment) - 仅限管理员
// ============================================================
app.post('/api/publish-moment', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { content, text, slug, author, source, images, videos, pinned, replyTo, capsule, githubToken: bodyGithubToken } = body;

  const momentText = (content || text || '').trim();
  if (!momentText) {
    return c.json({
      error: 'invalid_request',
      message: '动态正文内容不能为空 喵！',
    }, 400);
  }

  // 默认 slug 按时间戳生成：如 moment-20261003-163000
  const now = new Date();
  const defaultSlug = `moment-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const rawSlug = (slug || defaultSlug).trim().replace(/\.md$/, '').replace(/^\/+/, '');

  if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(rawSlug)) {
    return c.json({
      error: 'invalid_slug',
      message: 'Slug 仅支持字母、数字、中文、中划线及下划线 喵！',
    }, 400);
  }

  const githubToken = c.req.header('X-GitHub-Token') || bodyGithubToken || c.env.GITHUB_TOKEN;
  if (!githubToken) {
    return c.json({
      error: 'missing_github_token',
      message: 'Worker 未配置 GITHUB_TOKEN，且客户端未提供 X-GitHub-Token 头 喵！',
    }, 401);
  }

  const postDate = now.toISOString();
  const authorName = (author || '瑶曦').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const sourceName = (source || 'Astro Web Studio').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const isPinned = Boolean(pinned);

  let imageList: string[] = [];
  if (Array.isArray(images)) {
    imageList = images.map((img: any) => String(img).trim()).filter(Boolean);
  } else if (typeof images === 'string' && images.trim()) {
    imageList = images.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
  }

  let videoList: string[] = [];
  if (Array.isArray(videos)) {
    videoList = videos.map((v: any) => String(v).trim()).filter(Boolean);
  } else if (typeof videos === 'string' && videos.trim()) {
    videoList = videos.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
  }

  const imagesYaml = imageList.length > 0
    ? `images:\n${imageList.map(img => `  - "${img.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('\n')}\n`
    : '';

  const videosYaml = videoList.length > 0
    ? `videos:\n${videoList.map(v => `  - "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('\n')}\n`
    : '';

  const capsuleYaml = capsule ? `capsule: ${new Date(capsule).toISOString()}\n` : '';
  const replyToYaml = replyTo ? `replyTo: "${String(replyTo).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n` : '';

  const finalMarkdown = `---
published: ${postDate}
author: "${authorName}"
source: "${sourceName}"
pinned: ${isPinned}
${capsuleYaml}${replyToYaml}${imagesYaml}${videosYaml}---

${momentText}
`;

  const filePath = `src/content/moments/${rawSlug}.md`;
  const owner = c.env.GITHUB_REPO_OWNER || 'yaoxiovo';
  const repo = c.env.GITHUB_REPO_NAME || 'astro';
  const branch = c.env.GITHUB_BRANCH || 'main';
  const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  // 检查已有文件 SHA
  let existingSha: string | undefined;
  const getRes = await fetch(`${githubApiUrl}?ref=${branch}`, {
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (getRes.ok) {
    const existingData = await getRes.json<{ sha: string }>();
    existingSha = existingData.sha;
  }

  let base64Content: string;
  try {
    const utf8Bytes = new TextEncoder().encode(finalMarkdown);
    let binary = '';
    for (let i = 0; i < utf8Bytes.byteLength; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    base64Content = btoa(binary);
  } catch {
    base64Content = btoa(unescape(encodeURIComponent(finalMarkdown)));
  }

  const commitMessage = existingSha
    ? `feat(moment): update ${rawSlug} via Web Studio`
    : `feat(moment): publish ${rawSlug} via Web Studio`;

  const commitRes = await fetch(githubApiUrl, {
    method: 'PUT',
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
      branch,
      sha: existingSha,
    }),
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text();
    let errObj: any = {};
    try { errObj = JSON.parse(errText); } catch {}
    return c.json({
      error: 'github_api_failed',
      message: `GitHub API 提交朋友圈动态失败: ${errObj.message || 'HTTP ' + commitRes.status}`,
      details: errText,
    }, 502);
  }

  const commitData = await commitRes.json<{ commit: { sha: string; html_url: string } }>();

  return c.json({
    success: true,
    slug: rawSlug,
    file_path: filePath,
    commit_sha: commitData.commit.sha,
    commit_url: commitData.commit.html_url,
    message: 'Moment successfully committed. Cloudflare Pages build triggered.',
  });
});

// ============================================================
// 2. 认证中心凭据自动下发端点 (GET /api/credentials) - 仅限认证中心管理员
// 随统一认证中心登录状态一并下发操作密钥，免除站长每次手动填写 Token 喵！
// ============================================================
app.get('/api/credentials', requireAdmin, async (c) => {
  const user = c.get('user');
  const platformTokens = (user.platform_tokens as Record<string, string>) || {};
  const githubToken = platformTokens.github || user.github_pat || user.github_token || user.pat || c.env.GITHUB_TOKEN || null;
  const cfToken = platformTokens.cloudflare || user.cf_token || user.cloudflare_token || c.env.CF_API_TOKEN || null;
  const cfZoneId = platformTokens.cloudflare_zone || user.cf_zone_id || user.cf_zone || c.env.CF_ZONE_ID || null;

  return c.json({
    success: true,
    user: {
      sub: user.sub,
      role: c.get('userRole'),
      name: user.name || user.username || user.sub,
    },
    credentials: {
      github_pat: githubToken,
      cf_token: cfToken,
      cf_zone_id: cfZoneId,
      cf_account_id: c.env.CF_ACCOUNT_ID || null,
      platform_tokens: {
        github: githubToken,
        cloudflare: cfToken,
        cloudflare_zone: cfZoneId,
      },
      api_endpoint: 'https://zk-api.yaoxi.cloud',
    },
    message: '博主操作凭据已随认证中心登录态成功一并下发喵！',
  });
});

// ============================================================
// 3. DDoS 告警与实时安全防御日志 (GET /api/ddos)
// ============================================================
app.get('/api/ddos', async (c) => {
  const hours = Math.min(168, Math.max(1, parseInt(c.req.query('hours') || '24', 10)));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const isDemo = c.req.query('demo') === 'true' || c.req.query('demo') === '1';
  const targetDomain = c.req.query('domain') || 'blog.yaoxi.wiki';

  if (isDemo) {
    const now = Date.now();
    return c.json({
      status: 'attack',
      hasAttack: true,
      isDemo: true,
      target: targetDomain,
      zone: 'yaoxi.wiki',
      activeAttacks: 3,
      totalEvents: 148,
      peakRate: '18,450 req/s',
      timeRange: {
        since: new Date(now - hours * 3600 * 1000).toISOString(),
        until: new Date(now).toISOString(),
        hours,
      },
      summary: {
        dropped: 92,
        blocked: 44,
        challenged: 12,
        topCountries: [
          { name: 'United States', code: 'US', count: 68, percentage: 46 },
          { name: 'China', code: 'CN', count: 35, percentage: 24 },
          { name: 'Germany', code: 'DE', count: 21, percentage: 14 },
          { name: 'Netherlands', code: 'NL', count: 14, percentage: 9 },
          { name: 'Others', code: 'UN', count: 10, percentage: 7 },
        ],
        topASNs: [
          { asn: 'AS13335', desc: 'CLOUDFLARENET', count: 52 },
          { asn: 'AS4134', desc: 'CHINANET-BACKBONE', count: 35 },
          { asn: 'AS16509', desc: 'AMAZON-02', count: 28 },
          { asn: 'AS24940', desc: 'HETZNER-AS', count: 21 },
        ],
        topTargets: [
          { path: '/api/moments.json', count: 76 },
          { path: '/', count: 48 },
          { path: '/api/newsletter/subscribe', count: 24 },
        ],
      },
      events: [
        {
          id: 'cf-ray-8ccd1049281a',
          timestamp: new Date(now - 2 * 60 * 1000).toISOString(),
          action: 'drop',
          source: 'l7ddos',
          ruleId: 'cloudflare-http-ddos-mitigation-standard',
          rayId: '8ccd1049281a',
          ip: '198.51.100.***',
          country: 'United States',
          countryCode: 'US',
          asn: 'AS13335',
          asnDesc: 'CLOUDFLARENET',
          method: 'GET',
          host: targetDomain,
          path: '/api/moments.json',
          ua: 'Go-http-client/1.1 (Flood-Botnet/2.4)',
          attackType: 'HTTP Flood (Layer 7)',
        },
        {
          id: 'cf-ray-8ccd0f93a11b',
          timestamp: new Date(now - 5 * 60 * 1000).toISOString(),
          action: 'block',
          source: 'rateLimit',
          ruleId: 'rate-limit-sensitive-endpoints',
          rayId: '8ccd0f93a11b',
          ip: '114.248.***.***',
          country: 'China',
          countryCode: 'CN',
          asn: 'AS4134',
          asnDesc: 'CHINANET-BACKBONE',
          method: 'POST',
          host: targetDomain,
          path: '/api/newsletter/subscribe',
          ua: 'python-requests/2.31.0',
          attackType: 'Rate Limit Triggered (API Abuse)',
        },
        {
          id: 'cf-ray-8ccd0e88c03c',
          timestamp: new Date(now - 9 * 60 * 1000).toISOString(),
          action: 'drop',
          source: 'l7ddos',
          ruleId: 'cloudflare-http-ddos-mitigation-high-rate',
          rayId: '8ccd0e88c03c',
          ip: '54.210.***.***',
          country: 'United States',
          countryCode: 'US',
          asn: 'AS16509',
          asnDesc: 'AMAZON-02',
          method: 'GET',
          host: targetDomain,
          path: '/',
          ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) (Bot Attack Engine)',
          attackType: 'Volumetric HTTP Flood',
        },
      ],
      cfConnected: true,
      updatedAt: new Date().toISOString(),
    });
  }

  // 安全约束：真实查询会消耗本 Worker 自身的 Cloudflare 凭据，必须要求管理员身份，
  // 否则任何匿名访客都能借本站配额去查询 Cloudflare 安全日志。
  // 演示模式 (demo=true) 返回合成数据，无需鉴权。
  if (!(await isAdminRequest(c))) {
    return c.json({
      error: 'Unauthorized',
      message: '真实 DDoS 日志查询需要管理员权限；如需查看演示数据请加 ?demo=true',
    }, 401);
  }

  const clientToken = c.req.header('x-cf-token') || c.req.header('cf-api-token');
  const clientZoneId = c.req.header('x-cf-zone-id') || c.req.header('cf-zone-id');
  const token = clientToken || c.env.CF_API_TOKEN;
  let zoneId = clientZoneId || c.env.CF_ZONE_ID;

  if (!token) {
    return c.json({
      status: 'normal',
      hasAttack: false,
      isDemo: false,
      target: targetDomain,
      zone: 'yaoxi.wiki',
      activeAttacks: 0,
      totalEvents: 0,
      timeRange: {
        since: new Date(Date.now() - hours * 3600 * 1000).toISOString(),
        until: new Date().toISOString(),
        hours,
      },
      summary: { dropped: 0, blocked: 0, challenged: 0, topCountries: [], topASNs: [], topTargets: [] },
      events: [],
      cfConnected: false,
      message: 'Cloudflare credentials not set in BFF Worker',
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    let targetZones: Array<{ id: string; name: string }> = [];
    if (zoneId) {
      targetZones = [{ id: zoneId, name: targetDomain }];
    } else {
      try {
        const zoneRes = await fetch('https://api.cloudflare.com/client/v4/zones?status=active', {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (zoneRes.ok) {
          const zJson: any = await zoneRes.json();
          if (Array.isArray(zJson.result) && zJson.result.length > 0) {
            targetZones = zJson.result.map((z: any) => ({ id: z.id, name: z.name }));
          }
        }
      } catch (e) {
        console.warn('[BFF ddos] 获取活跃 Zone 列表失败:', e);
      }

      if (targetZones.length === 0) {
        try {
          const fallbackRes = await fetch('https://api.cloudflare.com/client/v4/zones?name=yaoxi.wiki', {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (fallbackRes.ok) {
            const fbJson: any = await fallbackRes.json();
            if (fbJson.result?.[0]?.id) {
              targetZones = [{ id: fbJson.result[0].id, name: fbJson.result[0].name || 'yaoxi.wiki' }];
            }
          }
        } catch (e) {
          console.warn('[BFF ddos] 回退获取 yaoxi.wiki 失败:', e);
        }
      }
    }

    if (targetZones.length === 0) {
      return c.json({
        status: 'normal',
        hasAttack: false,
        isDemo: false,
        target: targetDomain,
        zone: '未知',
        activeAttacks: 0,
        totalEvents: 0,
        summary: { dropped: 0, blocked: 0, challenged: 0, topCountries: [], topASNs: [], topTargets: [] },
        events: [],
        cfConnected: false,
        message: 'Could not resolve any active Cloudflare Zone IDs',
        updatedAt: new Date().toISOString(),
      });
    }

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const until = new Date().toISOString();

    const gqlQuery = `
      query GetSecurityEvents($zoneTag: String!, $since: String!, $until: String!, $limit: Int!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            securityEventsAdaptive(
              filter: {
                datetime_geq: $since,
                datetime_leq: $until
              },
              limit: $limit,
              orderBy: [datetime_DESC]
            ) {
              action
              clientASNDescription
              clientAsn
              clientCountryName
              clientIP
              clientRequestHTTPHost
              clientRequestHTTPMethodName
              clientRequestHTTPProtocol
              clientRequestPath
              datetime
              rayName
              ruleId
              source
              userAgent
            }
          }
        }
      }
    `;

    const isMitigationEvent = (e: any) => {
      const a = String(e.action || '').toLowerCase();
      const s = String(e.source || '').toLowerCase();
      if (a === 'allow' || a === 'log' || a === 'skip' || a === 'bypass') return false;
      if (
        a.includes('drop') ||
        a.includes('block') ||
        a.includes('challenge') ||
        a.includes('close') ||
        a.includes('mitigate')
      ) {
        return true;
      }
      if (
        s.includes('ddos') ||
        s.includes('dos') ||
        s.includes('rate') ||
        s.includes('waf') ||
        s.includes('securitylevel') ||
        s.includes('underattack') ||
        s.includes('botmanagement')
      ) {
        return true;
      }
      return false;
    };

    const zoneQueries = targetZones.slice(0, 5).map(async (zone) => {
      try {
        const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: gqlQuery, variables: { zoneTag: zone.id, since, until, limit } }),
        });
        if (!cfRes.ok) return [];
        const cfData: any = await cfRes.json();
        const raw = cfData?.data?.viewer?.zones?.[0]?.securityEventsAdaptive || [];
        return raw.map((e: any) => ({ ...e, zoneName: zone.name }));
      } catch (err) {
        console.warn(`[BFF ddos] 请求 Zone ${zone.name} 失败:`, err);
        return [];
      }
    });

    const zoneResults = await Promise.all(zoneQueries);
    const allRawEvents = zoneResults.flat();
    const ddosEvents = allRawEvents.filter(isMitigationEvent);
    ddosEvents.sort((a: any, b: any) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

    const getAttackType = (e: any) => {
      const s = String(e.source || '').toLowerCase();
      const a = String(e.action || '').toLowerCase();
      if (s.includes('rate')) return '频率限制熔断 (Rate Limit)';
      if (s.includes('l7ddos') || s.includes('ddos')) return 'HTTP DDoS 自动清洗';
      if (s.includes('securitylevel') || s.includes('underattack')) return 'Under Attack 攻击防御模式';
      if (s.includes('waf')) return 'WAF 规则拦截防护';
      if (s.includes('bot')) return '恶意爬虫检测拦截';
      if (a.includes('challenge')) return '验证码/质询防御 (Challenge)';
      if (a.includes('drop')) return '流量静默丢弃 (Drop)';
      if (a.includes('block')) return 'IP/访问阻断 (Block)';
      return '边缘防御拦截 (Edge Mitigation)';
    };

    const formattedEvents = ddosEvents.map((e: any, idx: number) => {
      let maskedIp = '未知';
      if (e.clientIP && e.clientIP.includes('.')) {
        const parts = e.clientIP.split('.');
        if (parts.length === 4) maskedIp = `${parts[0]}.${parts[1]}.***.${parts[3]}`;
      }
      return {
        id: e.rayName || `event-${idx}`,
        timestamp: e.datetime,
        action: e.action || 'drop',
        source: e.source || 'l7ddos',
        ruleId: e.ruleId || 'Cloudflare DDoS Mitigation',
        rayId: e.rayName || '',
        ip: maskedIp,
        country: e.clientCountryName || '未知国家/地区',
        countryCode: 'UN',
        asn: e.clientAsn ? `AS${e.clientAsn}` : '未知网络',
        asnDesc: e.clientASNDescription || '',
        method: e.clientRequestHTTPMethodName || 'GET',
        host: e.clientRequestHTTPHost || (e.zoneName ? `*.${e.zoneName}` : targetDomain),
        path: e.clientRequestPath || '/',
        ua: e.userAgent || '',
        attackType: getAttackType(e),
      };
    });

    const nowMs = Date.now();
    let activeAttacks = 0;
    for (const ev of formattedEvents) {
      if (nowMs - new Date(ev.timestamp).getTime() <= 15 * 60 * 1000) {
        activeAttacks++;
      }
    }

    const targetDisplay = targetZones.map((z) => z.name).join(', ');
    return c.json({
      status: activeAttacks > 0 ? 'attack' : (formattedEvents.length > 0 ? 'elevated' : 'normal'),
      hasAttack: formattedEvents.length > 0,
      isDemo: false,
      target: targetDisplay,
      zone: targetDisplay,
      activeAttacks,
      totalEvents: formattedEvents.length,
      timeRange: { since, until, hours },
      summary: {
        dropped: formattedEvents.filter((e: any) => e.action.includes('drop')).length,
        blocked: formattedEvents.filter((e: any) => e.action.includes('block')).length,
        challenged: formattedEvents.filter((e: any) => e.action.includes('challenge')).length,
        topCountries: [],
        topASNs: [],
        topTargets: [],
      },
      events: formattedEvents,
      cfConnected: true,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({
      status: 'normal',
      hasAttack: false,
      isDemo: false,
      target: targetDomain,
      zone: 'yaoxi.wiki',
      activeAttacks: 0,
      totalEvents: 0,
      events: [],
      summary: { dropped: 0, blocked: 0, challenged: 0, topCountries: [], topASNs: [], topTargets: [] },
      cfConnected: false,
      error: err.message,
      updatedAt: new Date().toISOString(),
    });
  }
});

// ============================================================
// 3. 部署构建监听状态端点 (GET /api/deploy-status) - 仅限管理员
// ============================================================
app.get('/api/deploy-status', requireAdmin, async (c) => {
  const commitParam = c.req.query('commit')?.trim();
  const accountId = c.env.CF_ACCOUNT_ID;
  const project = c.env.CF_PAGES_PROJECT || 'astro';
  const token = c.env.CF_API_TOKEN;

  if (!accountId || !token) {
    return c.json({
      status: 'active',
      stage: 'build',
      preview_url: `https://${project}.pages.dev`,
      message: 'Cloudflare credentials not fully set; returned simulation active status',
    });
  }

  const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments?per_page=10`;

  const cfRes = await fetch(cfApiUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!cfRes.ok) {
    const errDetail = await cfRes.text();
    return c.json({ error: 'cloudflare_api_failed', details: errDetail }, 502);
  }

  const resJson = await cfRes.json<{
    result: Array<{
      id: string;
      url: string;
      aliases?: string[];
      status: string;
      environment: string;
      created_on: string;
      deployment_trigger?: {
        metadata?: {
          commit_hash?: string;
          commit_message?: string;
        };
      };
      latest_stage: {
        name: string;
        status: string;
        started_on?: string;
        ended_on?: string;
      };
    }>;
  }>();

  const deployments = resJson.result || [];
  if (deployments.length === 0) {
    return c.json({ status: 'queued', stage: 'queued', message: 'No deployments found yet' });
  }

  // 1. 如果指定了 commit hash，在最近 10 次部署中匹配对应的 commit
  let targetDeployment = deployments[0];
  if (commitParam) {
    const matched = deployments.find((d) => {
      const hash = d.deployment_trigger?.metadata?.commit_hash;
      return hash && (hash === commitParam || hash.startsWith(commitParam) || commitParam.startsWith(hash));
    });

    if (matched) {
      targetDeployment = matched;
    } else {
      // 若 GitHub Webhook 还在通信中，Pages 尚未生成该 commit 的记录，返回 queued 阶段
      return c.json({
        status: 'queued',
        stage: 'queued',
        commit_hash: commitParam,
        message: 'Waiting for Cloudflare Pages to receive webhook and queue deployment...',
        created_on: new Date().toISOString(),
      });
    }
  }

  // 2. 映射大厂标准状态：'queued' | 'active' | 'success' | 'failure'
  let mappedStatus: 'queued' | 'active' | 'success' | 'failure' = 'active';
  const rawStatus = targetDeployment.status;
  const stageStatus = targetDeployment.latest_stage?.status;

  if (rawStatus === 'success') {
    mappedStatus = 'success';
  } else if (rawStatus === 'failure' || stageStatus === 'failure') {
    mappedStatus = 'failure';
  } else if (rawStatus === 'idle' || stageStatus === 'idle' || stageStatus === 'queued') {
    mappedStatus = 'queued';
  } else {
    mappedStatus = 'active'; // 包含 building, deploying, cloning 等
  }

  // 3. 提取最友好的预览 URL
  const previewUrl = targetDeployment.aliases?.[0] || targetDeployment.url || `https://${project}.pages.dev`;

  return c.json({
    success: true,
    deployment_id: targetDeployment.id,
    commit_hash: targetDeployment.deployment_trigger?.metadata?.commit_hash || commitParam,
    status: mappedStatus,
    stage: targetDeployment.latest_stage?.name || 'deploy',
    stage_status: stageStatus || 'active',
    preview_url: previewUrl,
    environment: targetDeployment.environment,
    created_on: targetDeployment.created_on,
  });
});

// ============================================================
// 3. 当前登录用户身份与角色查询端点 (GET /api/auth/me)
// ============================================================
app.get('/api/auth/me', requireAuth, async (c) => {
  const user = c.get('user');
  const userRole = c.get('userRole');
  return c.json({
    sub: user.sub,
    username: user.username || user.name || user.sub,
    email: user.email || '',
    role: userRole,
    isAdmin: userRole === 'admin',
    isMember: userRole === 'member',
  });
});

// ============================================================
// 4. 零知识公私钥 Vault 端点 (成员与管理员通用权限)
// ============================================================
app.get('/api/user/keys', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT v.user_id AS id, COALESCE(u.username, v.user_id) AS username, v.public_key_jwk FROM user_vaults v LEFT JOIN users u ON u.id = v.user_id'
  ).all();

  return c.json({
    users: results.map((r: any) => ({
      id: r.id,
      username: r.username,
      public_key_jwk: typeof r.public_key_jwk === 'string' ? JSON.parse(r.public_key_jwk) : r.public_key_jwk,
    })),
  });
});

app.get('/api/user/vault', requireAuth, async (c) => {
  const user = c.get('user');
  const vault = await c.env.DB.prepare(
    'SELECT public_key_jwk, encrypted_vault, salt, iv, iterations FROM user_vaults WHERE user_id = ?'
  ).bind(user.sub).first();

  if (!vault) return c.json({ error: 'not_found', message: 'No vault initialized' }, 404);

  return c.json({
    public_key_jwk: typeof vault.public_key_jwk === 'string' ? JSON.parse(vault.public_key_jwk as string) : vault.public_key_jwk,
    encrypted_vault: vault.encrypted_vault,
    salt: vault.salt,
    iv: vault.iv,
    iterations: vault.iterations || 100000,
  });
});

app.put('/api/user/vault', requireAuth, async (c) => {
  const user = c.get('user');
  const userRole = c.get('userRole') || 'member';
  const { public_key_jwk, encrypted_vault, salt, iv, iterations } = await c.req.json().catch(() => ({}));

  if (!public_key_jwk || !encrypted_vault || !salt || !iv) {
    return c.json({ error: 'invalid_body', message: 'Missing required vault fields' }, 400);
  }

  const jwkStr = typeof public_key_jwk === 'string' ? public_key_jwk : JSON.stringify(public_key_jwk);
  const safeUsername = String(user.username || user.name || `user_${user.sub}`);
  const safeEmail = String(user.email || `${user.sub}@accounts.yaoxi.cloud`);

  // 保证 users 表记录存在并同步最新角色（避免外键约束报错与 INNER JOIN 遗漏）
  try {
    await c.env.DB.prepare(`
      INSERT INTO users (id, username, email, role, created_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        email = excluded.email,
        role = excluded.role
    `).bind(user.sub, safeUsername, safeEmail, userRole).run();
  } catch {
    try {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, username, email, role, created_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `).bind(user.sub, `${safeUsername}_${user.sub.slice(0, 6)}`, `${user.sub}@accounts.yaoxi.cloud`, userRole).run();
    } catch {}
  }

  await c.env.DB.prepare(`
    INSERT INTO user_vaults (user_id, public_key_jwk, encrypted_vault, salt, iv, iterations, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      public_key_jwk = excluded.public_key_jwk,
      encrypted_vault = excluded.encrypted_vault,
      salt = excluded.salt,
      iv = excluded.iv,
      iterations = excluded.iterations,
      updated_at = unixepoch()
  `).bind(user.sub, jwkStr, encrypted_vault, salt, iv, iterations || 100000).run();

  return c.json({ success: true, message: 'Vault saved successfully' });
});

export default app;
