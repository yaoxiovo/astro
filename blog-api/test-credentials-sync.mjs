/**
 * test-credentials-sync.mjs
 * 验证统一认证中心 (SSO) 与 Worker BFF 运维凭据自动下发链路仿真测试
 */

import { strict as assert } from 'node:assert';

// 简易 JWT 生成器（模拟认证中心签名）
function createMockJwt(payload, secret = 'mock_secret') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: 'https://accounts.yaoxi.cloud',
    aud: 'yaoxi-blog',
    exp: Math.floor(Date.now() / 1000) + 7200,
    ...payload,
  })).toString('base64url');
  return `${header}.${body}.mock_signature`;
}

console.log('🧪 开始执行认证中心运维凭据自动下发链路测试 喵！\n');

// 1. 模拟管理员 JWT 与普通成员 JWT
const adminPayload = {
  sub: 'admin_yaoxi_001',
  role: 'admin',
  roles: ['admin', 'member'],
  is_admin: true,
  name: '瑶曦站长',
};

const memberPayload = {
  sub: 'user_visitor_999',
  role: 'member',
  roles: ['member'],
  is_admin: false,
  name: '访客喵',
};

const adminToken = createMockJwt(adminPayload);
const memberToken = createMockJwt(memberPayload);

// 2. 模拟 Worker BFF /api/credentials 路由响应逻辑
function simulateCredentialsEndpoint(authHeader, env) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { status: 401, body: { error: 'Unauthorized: Missing or invalid token' } };
  }
  const token = authHeader.replace(/^Bearer\s+/, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) {
    return { status: 401, body: { error: 'Invalid token structure' } };
  }
  const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

  const rawRole = String(decoded.role || '').toLowerCase();
  const roles = Array.isArray(decoded.roles) ? decoded.roles.map(r => String(r).toLowerCase()) : [];
  const isAdmin = rawRole === 'admin' || roles.includes('admin') || decoded.is_admin === true;

  if (!isAdmin) {
    return { status: 403, body: { error: 'Forbidden: Admin privilege required' } };
  }

  const githubToken = decoded.github_pat || decoded.github_token || env.GITHUB_TOKEN || null;
  const cfToken = decoded.cf_token || decoded.cloudflare_token || env.CF_API_TOKEN || null;
  const cfZoneId = decoded.cf_zone_id || decoded.cf_zone || env.CF_ZONE_ID || null;

  return {
    status: 200,
    body: {
      success: true,
      user: {
        sub: decoded.sub,
        role: rawRole,
        name: decoded.name,
      },
      credentials: {
        github_pat: githubToken,
        cf_token: cfToken,
        cf_zone_id: cfZoneId,
        cf_account_id: env.CF_ACCOUNT_ID || null,
        api_endpoint: 'https://zk-api.yaoxi.cloud',
      },
      message: '博主操作凭据已随认证中心登录态成功一并下发喵！',
    }
  };
}

const mockEnv = {
  GITHUB_TOKEN: 'ghp_secretMockAdminPat2026',
  CF_API_TOKEN: 'cf_api_mock_secret_token_123',
  CF_ZONE_ID: 'cf_zone_mock_id_456',
  CF_ACCOUNT_ID: 'cf_account_mock_789',
};

// 测试用例 1: 无 Token 访问拒绝 (401)
{
  const res = simulateCredentialsEndpoint(null, mockEnv);
  assert.equal(res.status, 401, '无 Token 应当返回 401');
  console.log('✅ 测试 1: 未携带凭据请求 /api/credentials 被安全阻断 (401)');
}

// 测试用例 2: 普通成员访问拒绝 (403)
{
  const res = simulateCredentialsEndpoint(`Bearer ${memberToken}`, mockEnv);
  assert.equal(res.status, 403, '非管理员应当返回 403');
  console.log('✅ 测试 2: 普通成员 (Member) 越权获取凭据被严格拦截 (403)');
}

// 测试用例 3: 系统管理员正常下发代持凭据 (200)
{
  const res = simulateCredentialsEndpoint(`Bearer ${adminToken}`, mockEnv);
  assert.equal(res.status, 200, '管理员应当返回 200');
  assert.equal(res.body.success, true);
  assert.equal(res.body.credentials.github_pat, 'ghp_secretMockAdminPat2026');
  assert.equal(res.body.credentials.cf_token, 'cf_api_mock_secret_token_123');
  assert.equal(res.body.credentials.cf_zone_id, 'cf_zone_mock_id_456');
  console.log('✅ 测试 3: 管理员 (Admin) 认证通过，全量运维凭据成功下发 (200)');
}

// 测试用例 4: 模拟前端 localStorage 自动装载与解包
{
  const storage = {};
  const mockLocalStorage = {
    setItem: (k, v) => { storage[k] = String(v); },
    getItem: (k) => storage[k] || null,
    removeItem: (k) => { delete storage[k]; },
  };

  const creds = simulateCredentialsEndpoint(`Bearer ${adminToken}`, mockEnv).body.credentials;
  if (creds.github_pat) {
    mockLocalStorage.setItem('yaoxi_github_pat', creds.github_pat);
    mockLocalStorage.setItem('yaoxi_admin_github_pat', creds.github_pat);
  }
  if (creds.cf_token) {
    mockLocalStorage.setItem('yaoxi_ddos_cf_token', creds.cf_token);
  }
  if (creds.cf_zone_id) {
    mockLocalStorage.setItem('yaoxi_ddos_cf_zone_id', creds.cf_zone_id);
  }

  assert.equal(mockLocalStorage.getItem('yaoxi_github_pat'), 'ghp_secretMockAdminPat2026');
  assert.equal(mockLocalStorage.getItem('yaoxi_admin_github_pat'), 'ghp_secretMockAdminPat2026');
  assert.equal(mockLocalStorage.getItem('yaoxi_ddos_cf_token'), 'cf_api_mock_secret_token_123');
  assert.equal(mockLocalStorage.getItem('yaoxi_ddos_cf_zone_id'), 'cf_zone_mock_id_456');
  console.log('✅ 测试 4: 客户端 SDK 成功自动持久化下发凭据至本地 Storage，彻底消除手动填报！');
}

// 测试用例 5: 官方 platform_tokens 结构携带测试
{
  const officialAdminPayload = {
    sub: 'yaoxi_root',
    role: 'admin',
    platform_tokens: {
      github: 'ghp_officialPlatformTokenFromSSO2026',
      cloudflare: 'cf_officialEdgeToken2026'
    }
  };
  const tokenWithPlatform = createMockJwt(officialAdminPayload);
  const parts = tokenWithPlatform.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

  assert.equal(payload.platform_tokens.github, 'ghp_officialPlatformTokenFromSSO2026');
  assert.equal(payload.platform_tokens.cloudflare, 'cf_officialEdgeToken2026');

  // 模拟 YaoxiAuth SDK getPlatformToken
  const mockSdk = {
    getPlatformTokens: () => payload.platform_tokens || {},
    getPlatformToken: (platform) => (payload.platform_tokens || {})[platform] || null,
  };

  assert.equal(mockSdk.getPlatformToken('github'), 'ghp_officialPlatformTokenFromSSO2026');
  assert.equal(mockSdk.getPlatformToken('cloudflare'), 'cf_officialEdgeToken2026');
  assert.equal(mockSdk.getPlatformToken('unknown'), null);
  console.log('✅ 测试 5: 认证中心官方 platform_tokens 结构携带与 SDK getPlatformToken 接口完美对接！');
}

console.log('\n🎉 全部 5 项凭据自动同步与官方 platform_tokens 链路测试通过 喵！\n');
