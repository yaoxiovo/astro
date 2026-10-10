-- ============================================================
-- yaoxi-blog-d1 · 唯一权威 Schema（Single Authoritative Schema）
-- ============================================================
--
-- 【所有权声明】
-- 本文件是 Cloudflare D1 数据库 `yaoxi-blog-d1` 的唯一权威 schema 来源
-- （the single authoritative schema / single source of truth）。
-- 该数据库被以下两个 Worker 同时绑定（两者的 binding 名均为 `DB`）：
--   1. blog-api                   —— https://blog-api.yaoxi.cloud
--   2. workers/zero-knowledge-bff —— https://zk-api.yaoxi.cloud
--
-- 【如何应用】
--   远程： npx wrangler d1 execute yaoxi-blog-d1 --remote --file=./d1/schema.sql
--   本地： npx wrangler d1 execute yaoxi-blog-d1 --local  --file=./d1/schema.sql
--   本文件全部使用 IF NOT EXISTS / INSERT OR IGNORE，可重复执行（幂等）。
--
-- 【评论相关表由谁负责】
--   `comments` / `comment_events` 等评论表**不在本文件中定义**。
--   它们由 blog-api 以 D1 migration 的形式追加到同一个数据库：
--     blog-api/migrations/0001_comments.sql
--   并由 .github/workflows/deploy-blog-api.yml 在部署时自动应用：
--     npx wrangler d1 migrations apply yaoxi-blog-d1 --remote
--   => 分工：本文件负责 users / user_vaults / oauth_clients；
--            blog-api/migrations/ 负责 comments / comment_events。
--   两者作用于同一个数据库，修改任一侧前请先确认不会与另一侧冲突。
--
-- 【修改注意事项】
--   users / user_vaults 的列名被 workers/zero-knowledge-bff/src/index.ts 中的
--   原生 SQL 直接依赖（SELECT / INSERT ... ON CONFLICT / UPDATE），
--   改动列名或类型必须同步修改该 Worker 代码，否则会在运行时直接报错。
--
-- 【历史说明】
--   仓库中曾存在一份重复且已漂移的副本 blog-api/schema.sql，现已删除，
--   以避免出现"两个真相来源"。请勿再新建第二份 schema 副本。
-- ============================================================

-- 1. 用户基础表 (Users)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'reader', -- 'admin' | 'reader'
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 2. 零知识密钥保险库 (Zero-Knowledge Vaults)
-- 严禁存储明文私钥或主密码 Hash！
-- encrypted_vault 是由用户本地 Master Password 通过 PBKDF2(100k, SHA-256) 派生的 AES-GCM-256 密钥加密的私钥 JWK 密文
CREATE TABLE IF NOT EXISTS user_vaults (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key_jwk TEXT NOT NULL,         -- RSA-OAEP 公钥 (明文 JWK 格式，供博主加密 CEK 数字信封)
    encrypted_vault TEXT NOT NULL,        -- 本地 AES-GCM 加密后的私钥 JWK 密文 (Base64)
    salt TEXT NOT NULL,                   -- PBKDF2 随机盐值 (16 bytes, Base64)
    iv TEXT NOT NULL,                     -- AES-GCM 初始化向量 (12 bytes, Base64)
    iterations INTEGER NOT NULL DEFAULT 100000,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 3. OAuth 客户端登记表 (OAuth Clients)
-- ⚠️ 本表在当前仓库内【没有任何读取方】（全仓库检索不到引用它的代码/脚本/工作流）。
--    它的预期使用方是外部认证中心 accounts.yaoxi.cloud（OAuth 授权服务）：
--    由该服务读取 client_id / client_secret_hash / redirect_uri 完成客户端校验。
--    保留此表是为了让外部认证中心的客户端登记与本库保持一致，
--    请勿因为"仓库内无引用"而删除它。
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 4. 索引优化 (Indexes)
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_vaults_updated ON user_vaults(updated_at);

-- 5. 初始化系统内置博主账号与默认 OAuth 客户端
-- 幂等保证：以下语句均使用 INSERT OR IGNORE，
-- 重复执行本文件不会因主键/唯一约束报错，也不会产生重复行。
INSERT OR IGNORE INTO users (id, username, email, role)
VALUES ('user_admin_01', 'yaoxi', 'admin@yaoxi.wiki', 'admin');

-- ⚠️ 下面 client_secret_hash 的值是**必须替换的占位串**，不是可用的凭据。
--    这里刻意写入一眼可辨的占位符，而不是任何"看起来像真值"的 bcrypt hash，
--    以免被误认为客户端密钥已经配置完成。
--    生成真实值（bcrypt，cost=10）。注意 bcryptjs 并非本仓库依赖，
--    因此下面的命令通过 npx 临时获取，无需改 package.json：
--      npx --yes bcryptjs "客户端明文密钥"        # 输出形如 $2b$10$...
--    写入数据库（把 <BCRYPT_HASH> 换成上一步的输出）：
--      npx wrangler d1 execute yaoxi-blog-d1 --remote --command "UPDATE oauth_clients SET client_secret_hash='<BCRYPT_HASH>' WHERE client_id='yaoxi-blog'"
--    明文密钥只应保存在外部认证中心（accounts.yaoxi.cloud）的密钥管理中，
--    严禁提交进本仓库。
INSERT OR IGNORE INTO oauth_clients (client_id, client_secret_hash, redirect_uri, name)
VALUES ('yaoxi-blog', 'REPLACE_WITH_BCRYPT_HASH_OF_CLIENT_SECRET', 'https://blog.yaoxi.wiki/admin/callback', 'Yaoxi Astro Blog');
