import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "yaoxi-blog.sqlite");
const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
	fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[init-db] 正在初始化数据库: ${DB_PATH}`);
const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");

// 1. 执行 0001_comments.sql
const migrationFile = path.join(__dirname, "migrations", "0001_comments.sql");
if (fs.existsSync(migrationFile)) {
	console.log(`[init-db] 应用迁移: ${migrationFile}`);
	const ddl = fs.readFileSync(migrationFile, "utf-8");
	db.exec(ddl);
}

// 2. 初始化 _cf_kv_store 表
console.log("[init-db] 创建 _cf_kv_store 表...");
db.exec(`
	CREATE TABLE IF NOT EXISTS _cf_kv_store (
		namespace TEXT NOT NULL,
		key       TEXT NOT NULL,
		value     TEXT NOT NULL,
		metadata  TEXT,
		expires_at INTEGER,
		PRIMARY KEY (namespace, key)
	);
	CREATE INDEX IF NOT EXISTS idx_cf_kv_expire ON _cf_kv_store (expires_at);
`);

console.log("[init-db] ✅ 数据库结构初始化完成喵！");
