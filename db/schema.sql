-- D1 数据库 Moments 表结构
CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  published TEXT NOT NULL,
  author TEXT DEFAULT '瑶曦',
  pinned INTEGER DEFAULT 0,
  replyTo TEXT,
  media TEXT -- 媒体文件链接 JSON 数组，例如：'["https://..."]'
);
