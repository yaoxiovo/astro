-- ============================================================
-- 瑶曦评论系统 · D1 迁移 0001
--   comments       弹幕与评论统一存储（段落锚定 + 楼中楼两层 + SSO 身份绑定）
--   comment_events 全量审计流水（create/approve/reject/delete/restore/migrate）
--
-- 应用方式：
--   npx wrangler d1 migrations apply yaoxi-blog-d1 --remote
--   本地开发：npx wrangler d1 migrations apply yaoxi-blog-d1 --local
--
-- 说明：与 zk-bff 共享同一 D1 库（yaoxi-blog-d1），本表独立于 users 体系；
--       user_sub 对应认证中心 SSO 下发的 sub claim，username 为快照昵称。
-- ============================================================

CREATE TABLE IF NOT EXISTS comments (
	id          TEXT PRIMARY KEY,
	post        TEXT NOT NULL,
	kind        TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('danmaku', 'comment')),
	p           INTEGER,
	x           TEXT NOT NULL DEFAULT '',
	body        TEXT NOT NULL,
	author      TEXT NOT NULL DEFAULT '匿名',
	color       TEXT,
	user_sub    TEXT,
	username    TEXT,
	status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
	parent_id   TEXT,
	root_id     TEXT,
	ip_hash     TEXT,
	ua          TEXT,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER,
	reviewed_by TEXT,
	reviewed_at INTEGER
);

-- 文章页拉取（approved 按时间倒序）与计数
CREATE INDEX IF NOT EXISTS idx_comments_post_status ON comments (post, status, created_at DESC);
-- 管理端待审列表
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at DESC);
-- 楼中楼装配（按根批量拉回复）
CREATE INDEX IF NOT EXISTS idx_comments_root ON comments (root_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);
-- 读者撤回自己评论 / 未来读者中心
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments (user_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS comment_events (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	comment_id TEXT NOT NULL,
	action     TEXT NOT NULL CHECK (action IN ('create', 'approve', 'reject', 'delete', 'restore', 'migrate')),
	actor      TEXT NOT NULL DEFAULT 'system',
	meta       TEXT,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comment_events_comment ON comment_events (comment_id, created_at DESC);
