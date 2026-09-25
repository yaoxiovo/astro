import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  JWT_SECRET: string;
  ADMIN_SUB?: string;         // 博主专属 sub 标识，例如 'yaoxi'
  GITHUB_TOKEN: string;       // GitHub Personal Access Token (repo 权限)
  GITHUB_REPO_OWNER: string;  // 例如 'yaoxiovo'
  GITHUB_REPO_NAME: string;   // 例如 'astro'
  GITHUB_BRANCH?: string;     // 默认 'main'
  CF_ACCOUNT_ID: string;      // Cloudflare Account ID
  CF_API_TOKEN: string;       // Cloudflare API Token (Pages:Read)
  CF_PAGES_PROJECT: string;   // Cloudflare Pages 项目名，例如 'astro'
}

interface JWTPayload {
  sub: string;
  username: string;
  role: string;
  [key: string]: unknown;
}

const app = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 启用全局 CORS 允许 Astro 前端及任意调试客户端安全跨域
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return 'https://blog.yaoxi.wiki';
    if (
      origin.endsWith('.yaoxi.wiki') ||
      origin.endsWith('.yaoxi.cloud') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return origin;
    }
    return 'https://blog.yaoxi.wiki';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));

// ============================================================
// JWT 鉴权中间件：严格校验 Bearer Token 合法性且 sub 属于博主本人
// ============================================================
const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7);
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'fallback_secret_for_local_dev_only');
    const { payload } = await jwtVerify(token, secret);
    const user = payload as unknown as JWTPayload;

    // 校验 sub 是否属于博主本人，或具备 admin 权限
    const expectedSub = c.env.ADMIN_SUB || 'yaoxi';
    if (user.sub !== expectedSub && user.role !== 'admin' && user.username !== 'yaoxi') {
      return c.json({
        error: 'Forbidden',
        message: `Token sub (${user.sub}) is not authorized as blog owner`,
      }, 403);
    }

    c.set('user', user);
    await next();
  } catch (err: any) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or expired JWT token', details: err.message }, 401);
  }
};

// ============================================================
// 1. 便捷文章发布端点 (POST /api/publish)
// ============================================================
app.post('/api/publish', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { title, slug, content, tags, description, category, image, draft, lang, fileContent } = body;

  if (!slug || (!content && !fileContent)) {
    return c.json({
      error: 'invalid_request',
      message: 'slug and content (or fileContent) are required',
    }, 400);
  }

  // 1. 组装符合 Astro Content Collections 规范的 Markdown 正文与 Frontmatter
  let finalMarkdown: string;
  if (fileContent) {
    finalMarkdown = fileContent;
  } else {
    const postTitle = (title || slug).trim();
    const postDate = new Date().toISOString().split('T')[0];
    const postDesc = (description || postTitle).replace(/"/g, '\\"').trim();
    const postCategory = (category || '技术分享').trim();
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

    const tagsYaml = tagList.map(t => `  - ${t}`).join('\n');
    const imageYaml = image ? `image: "${image}"\n` : '';

    finalMarkdown = `---
title: "${postTitle.replace(/"/g, '\\"')}"
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

  const cleanSlug = slug.trim().replace(/\.md$/, '').replace(/^\/+/, '');
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
      'Authorization': `Bearer ${c.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (getRes.ok) {
    const existingData = await getRes.json<{ sha: string }>();
    existingSha = existingData.sha;
  }

  // 3. 将 Markdown 完整内容编码为 UTF-8 Base64 并调用 GitHub Contents API
  const base64Content = btoa(unescape(encodeURIComponent(finalMarkdown)));
  const commitMessage = existingSha
    ? `docs(post): update ${cleanSlug} via Admin Studio`
    : `docs(post): publish ${title || cleanSlug} via Admin Studio`;

  const commitRes = await fetch(githubApiUrl, {
    method: 'PUT',
    headers: {
      'User-Agent': 'Astro-Publisher-Worker/1.0',
      'Authorization': `Bearer ${c.env.GITHUB_TOKEN}`,
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
    return c.json({
      error: 'github_api_failed',
      message: 'Failed to commit file to GitHub repository',
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
// 2. 部署构建监听状态端点 (GET /api/deploy-status)
// ============================================================
app.get('/api/deploy-status', authMiddleware, async (c) => {
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
// 3. 兼容保留 OAuth 与零知识公私钥 Vault 端点
// ============================================================
app.get('/api/user/keys', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT u.id, u.username, v.public_key_jwk FROM users u JOIN user_vaults v ON u.id = v.user_id'
  ).all();

  return c.json({
    users: results.map((r: any) => ({
      id: r.id,
      username: r.username,
      public_key_jwk: typeof r.public_key_jwk === 'string' ? JSON.parse(r.public_key_jwk) : r.public_key_jwk,
    })),
  });
});

app.get('/api/user/vault', authMiddleware, async (c) => {
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

app.put('/api/user/vault', authMiddleware, async (c) => {
  const user = c.get('user');
  const { public_key_jwk, encrypted_vault, salt, iv, iterations } = await c.req.json().catch(() => ({}));

  if (!public_key_jwk || !encrypted_vault || !salt || !iv) {
    return c.json({ error: 'invalid_body', message: 'Missing required vault fields' }, 400);
  }

  const jwkStr = typeof public_key_jwk === 'string' ? public_key_jwk : JSON.stringify(public_key_jwk);

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
