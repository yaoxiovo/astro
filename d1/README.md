# d1/ · 共享 D1 数据库 `yaoxi-blog-d1`

本目录存放 **Cloudflare D1 数据库 `yaoxi-blog-d1` 的唯一权威 schema**。

> `schema.sql` 是该数据库的唯一真相来源（single source of truth）。
> 历史上仓库里还有一份重复且已漂移的 `blog-api/schema.sql`，现已删除。**请勿再新建第二份副本。**

## 一、谁绑定了这个数据库

同一个 D1 库被两个 Worker 绑定，两边的 binding 名都是 `DB`：

| Worker | 绑定声明 | 线上域名 |
| --- | --- | --- |
| `blog-api` | `blog-api/wrangler.jsonc` → `d1_databases[0]` | `blog-api.yaoxi.cloud` |
| `workers/zero-knowledge-bff` | `workers/zero-knowledge-bff/wrangler.jsonc` → `d1_databases[0]` | `zk-api.yaoxi.cloud` |

两个配置里的 `database_id` 目前都是 `REPLACE_WITH_D1_DATABASE_ID` 占位值，由 `.github/workflows/deploy-blog-api.yml`
在部署时按名字 `yaoxi-blog-d1` 查询或创建后回填（`sed` 替换）。

因此：**任何一侧的表结构变更，都会同时影响另一个 Worker。**

## 二、schema 如何应用

`d1/schema.sql` 不会被任何 CI 工作流自动执行，需要手动应用：

```bash
# 远程（生产库）
npx wrangler d1 execute yaoxi-blog-d1 --remote --file=./d1/schema.sql

# 本地开发
npx wrangler d1 execute yaoxi-blog-d1 --local --file=./d1/schema.sql
```

文件内全部使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `INSERT OR IGNORE`，
**可重复执行**：重复跑不会因主键或唯一约束报错，也不会产生重复行。

## 三、评论表由谁负责

`comments` 与 `comment_events` **不在** `d1/schema.sql` 中定义，它们以 D1 migration 的形式
追加到同一个数据库：

- 定义文件：`blog-api/migrations/0001_comments.sql`
- 应用方式：由 `.github/workflows/deploy-blog-api.yml` 的 *Apply D1 migrations* 步骤自动执行
  `npx wrangler d1 migrations apply yaoxi-blog-d1 --remote`

分工边界：

| 责任方 | 负责的表 |
| --- | --- |
| `d1/schema.sql`（本目录） | `users`、`user_vaults`、`oauth_clients` |
| `blog-api/migrations/` | `comments`、`comment_events` |

两边作用于同一个数据库，改动任一侧前先确认不会与另一侧冲突（例如不要重复建同名表/索引）。

## 四、修改 schema 的注意事项

1. **列名被代码直接依赖，不能随手改。**
   `workers/zero-knowledge-bff/src/index.ts` 使用原生 SQL 读写 `users` 与 `user_vaults`，
   包括 `SELECT v.user_id AS id, COALESCE(u.username, v.user_id) AS username, v.public_key_jwk FROM user_vaults v LEFT JOIN users u ON u.id = v.user_id`、
   `INSERT INTO users (id, username, email, role, created_at)`、
   `INSERT INTO user_vaults (user_id, public_key_jwk, encrypted_vault, salt, iv, iterations, updated_at) ... ON CONFLICT(user_id) DO UPDATE` 等。
   改动 `users` / `user_vaults` 的列名或类型，必须同步修改该 Worker 代码，否则运行时报错。
2. **`oauth_clients` 目前仓库内无读取方。**
   全仓库检索不到引用该表的代码/脚本/工作流；它的预期使用方是外部认证中心
   `accounts.yaoxi.cloud`。**不要因为"没人用"就删表。**
3. **不要提交真实凭据。**
   `oauth_clients.client_secret_hash` 的种子值是必须替换的占位串
   `REPLACE_WITH_BCRYPT_HASH_OF_CLIENT_SECRET`，不是可用的 bcrypt hash。
   生成与写入方法见 `schema.sql` 内该 INSERT 上方的注释；明文密钥只应保存在外部认证中心，
   严禁提交进本仓库。
4. **`user_vaults` 是零知识存储。**
   只允许存放密文（`encrypted_vault`）、公钥 JWK（`public_key_jwk`）、PBKDF2 盐与 IV；
   严禁写入明文私钥或主密码 hash。
5. **保持幂等。**
   新增语句请沿用 `IF NOT EXISTS` / `INSERT OR IGNORE`，让 schema 文件可以安全地重复执行。
