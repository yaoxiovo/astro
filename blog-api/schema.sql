-- ============================================================
-- Cloudflare D1 Database Schema for Zero-Knowledge Astro Blog
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

-- 5. 初始博主与客户端
INSERT OR IGNORE INTO users (id, username, email, role) 
VALUES ('user_admin_01', 'yaoxi', 'admin@yaoxi.wiki', 'admin');

INSERT OR IGNORE INTO oauth_clients (client_id, client_secret_hash, redirect_uri, name)
VALUES ('yaoxi-blog', 'hash_placeholder_for_client_secret', 'https://blog.yaoxi.wiki/admin/callback', 'Yaoxi Astro Blog');
