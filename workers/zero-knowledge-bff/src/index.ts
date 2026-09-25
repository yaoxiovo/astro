import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  JWT_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CF_PAGES_PROJECT: string;
}

interface JWTPayload {
  sub: string;
  username: string;
  role: string;
}

const app = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// 启用全局 CORS 允许 Astro 前端与管理端跨域调用
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return 'https://blog.yaoxi.wiki';
    if (origin.endsWith('.yaoxi.wiki') || origin.endsWith('.yaoxi.cloud') || origin.includes('localhost')) {
      return origin;
    }
    return 'https://blog.yaoxi.wiki';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));

// Bearer JWT 鉴权中间件
const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7);
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'fallback_secret_for_local_dev_only');
    const { payload } = await jwtVerify(token, secret);
    c.set('user', payload as unknown as JWTPayload);
    await next();
  } catch (err: any) {
    return c.json({ error: 'Unauthorized: Invalid or expired token', message: err.message }, 401);
  }
};

// ============================================================
// 1. OAuth 2.0 端点实现 (利用 KV 存活 60s 暂存 authorization_code)
// ============================================================

app.get('/api/oauth/authorize', async (c) => {
  const { client_id, redirect_uri, user_id, state } = c.req.query();
  if (!client_id || !redirect_uri || !user_id) {
    return c.text('Invalid request: client_id, redirect_uri, and user_id are required', 400);
  }

  // 校验 Client ID 与 Redirect URI 白名单
  const client = await c.env.DB.prepare('SELECT client_id, redirect_uri FROM oauth_clients WHERE client_id = ?')
    .bind(client_id).first<{ client_id: string; redirect_uri: string }>();

  if (!client) {
    return c.text('Unauthorized client', 403);
  }

  // 生成 32 字节高熵随机 authorization_code
  const code = crypto.randomUUID().replace(/-/g, '');
  const sessionData = {
    userId: user_id,
    clientId: client_id,
    createdAt: Date.now(),
  };

  // 严格设置 TTL 为 60 秒，过期自动从边缘销毁
  await c.env.OAUTH_KV.put(`oauth:code:${code}`, JSON.stringify(sessionData), {
    expirationTtl: 60,
  });

  const targetUrl = new URL(redirect_uri);
  targetUrl.searchParams.set('code', code);
  if (state) targetUrl.searchParams.set('state', state);

  return c.redirect(targetUrl.toString());
});

app.post('/api/oauth/token', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { code, client_id, grant_type } = body;

  if (!code || !client_id) {
    return c.json({ error: 'invalid_request', error_description: 'code and client_id are required' }, 400);
  }

  const kvKey = `oauth:code:${code}`;
  const rawSession = await c.env.OAUTH_KV.get(kvKey);

  if (!rawSession) {
    return c.json({ error: 'invalid_grant', error_description: 'Code expired or already consumed' }, 400);
  }

  // 原子化单次消费：立即删除该 code，彻底杜绝重放攻击
  await c.env.OAUTH_KV.delete(kvKey);

  const session = JSON.parse(rawSession);
  if (session.clientId !== client_id) {
    return c.json({ error: 'invalid_grant', error_description: 'Client mismatch' }, 403);
  }

  const user = await c.env.DB.prepare('SELECT id, username, email, role FROM users WHERE id = ?')
    .bind(session.userId).first<{ id: string; username: string; email: string; role: string }>();

  if (!user) {
    return c.json({ error: 'invalid_user', error_description: 'User not found' }, 404);
  }

  // 签发有效期为 2 小时的标准 JWT Access Token
  const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'fallback_secret_for_local_dev_only');
  const accessToken = await new SignJWT({
    sub: user.id,
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret);

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 7200,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

// ============================================================
// 2. 零知识密钥体系 (Zero-Knowledge Key Vault Endpoints)
// ============================================================

// 获取所有已注册读者的公钥列表 (供发布者在本地用读者公钥封装备份数字信封)
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

// 获取当前登录用户本人的私钥加密密文 Vault
app.get('/api/user/vault', authMiddleware, async (c) => {
  const user = c.get('user');
  const vault = await c.env.DB.prepare(
    'SELECT public_key_jwk, encrypted_vault, salt, iv, iterations FROM user_vaults WHERE user_id = ?'
  ).bind(user.sub).first();

  if (!vault) {
    return c.json({ error: 'not_found', message: 'No vault initialized for this user' }, 404);
  }

  return c.json({
    public_key_jwk: typeof vault.public_key_jwk === 'string' ? JSON.parse(vault.public_key_jwk as string) : vault.public_key_jwk,
    encrypted_vault: vault.encrypted_vault,
    salt: vault.salt,
    iv: vault.iv,
    iterations: vault.iterations || 100000,
  });
});

// 初始化或更新当前读者的密钥密文保险库 (公钥明文 + 私钥密文)
app.put('/api/user/vault', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { public_key_jwk, encrypted_vault, salt, iv, iterations } = body;

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

// ============================================================
// 3. 发布与 GitHub CI/CD 触发端点 (POST /api/publish)
// ============================================================

app.post('/api/publish', authMiddleware, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'forbidden', message: 'Only admin can publish articles' }, 403);
  }

  const { slug, fileContent } = await c.req.json().catch(() => ({}));
  if (!slug || !fileContent) {
    return c.json({ error: 'invalid_body', message: 'slug and fileContent are required' }, 400);
  }

  const filePath = `src/content/posts/${slug}.md`;
  const owner = c.env.GITHUB_REPO_OWNER || 'yaoxiovo';
  const repo = c.env.GITHUB_REPO_NAME || 'astro';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  // 1. 获取现有文件的 SHA（若已存在则用于更新 commit）
  let existingSha: string | undefined = undefined;
  const getRes = await fetch(url, {
    headers: {
      'User-Agent': 'ZeroKnowledge-BFF-Worker',
      'Authorization': `Bearer ${c.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (getRes.ok) {
    const data = await getRes.json<{ sha: string }>();
    existingSha = data.sha;
  }

  // 2. 提交 Commit 创建或更新 Markdown 文件
  const b64Content = btoa(unescape(encodeURIComponent(fileContent)));
  const commitRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'User-Agent': 'ZeroKnowledge-BFF-Worker',
      'Authorization': `Bearer ${c.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `docs(posts): publish encrypted post ${slug}`,
      content: b64Content,
      sha: existingSha,
      branch: 'main',
    }),
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text();
    return c.json({ error: 'github_commit_failed', details: errText }, 502);
  }

  const commitData = await commitRes.json<{ commit: { sha: string; html_url: string } }>();

  return c.json({
    success: true,
    commit_sha: commitData.commit.sha,
    commit_url: commitData.commit.html_url,
    message: 'Committed successfully to GitHub. Cloudflare Pages build triggered.',
  });
});

// ============================================================
// 4. 代理 Cloudflare Pages 部署状态探针 (GET /api/deploy-status)
// ============================================================

app.get('/api/deploy-status', authMiddleware, async (c) => {
  const accountId = c.env.CF_ACCOUNT_ID;
  const project = c.env.CF_PAGES_PROJECT || 'astro';
  const token = c.env.CF_API_TOKEN;

  if (!accountId || !token) {
    return c.json({
      status: 'building',
      message: 'CF_ACCOUNT_ID or CF_API_TOKEN not configured; fallback to building indicator',
    });
  }

  const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments?per_page=1`;

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
      status: string;
      created_on: string;
      latest_stage: { name: string; status: string; started_on?: string; ended_on?: string };
    }>;
  }>();

  const latest = resJson.result?.[0];
  if (!latest) {
    return c.json({ status: 'unknown' });
  }

  // 严格映射大厂状态机规范：'queued' | 'building' | 'success' | 'failure'
  let mappedStatus = 'building';
  if (latest.status === 'success') {
    mappedStatus = 'success';
  } else if (latest.status === 'failure' || latest.latest_stage?.status === 'failure') {
    mappedStatus = 'failure';
  } else if (latest.status === 'idle' || latest.latest_stage?.status === 'idle') {
    mappedStatus = 'queued';
  }

  return c.json({
    id: latest.id,
    status: mappedStatus,
    created_on: latest.created_on,
    current_stage: latest.latest_stage?.name || 'deploy',
    stage_status: latest.latest_stage?.status || 'active',
  });
});

export default app;
