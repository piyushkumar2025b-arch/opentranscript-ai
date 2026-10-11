-- OpenTranscript AI - Cloudflare D1 Database Schema
-- Replaces Firebase Firestore for data persistence

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Users table (replaces Firebase Auth user data)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  photo_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Saved Lists (replaces Firestore 'lists' collection)
CREATE TABLE IF NOT EXISTS saved_lists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'general' CHECK(category IN ('general', 'videos', 'reading', 'study', 'favorites')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- List Items (replaces Firestore 'lists/{listId}/items' subcollection)
CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  item_type TEXT DEFAULT 'note' CHECK(item_type IN ('video', 'summary', 'book', 'article', 'note')),
  title TEXT NOT NULL,
  url TEXT DEFAULT '',
  subtitle TEXT DEFAULT '',
  content TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (list_id) REFERENCES saved_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Saved Summaries (replaces Firestore 'summaries' collection)
CREATE TABLE IF NOT EXISTS saved_summaries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  video_id TEXT,
  video_url TEXT,
  video_title TEXT NOT NULL,
  author_name TEXT DEFAULT 'YouTube',
  summary_type TEXT DEFAULT 'massive',
  markdown TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Custom Resources / Exact Resources (replaces Firestore 'resources' collection)
CREATE TABLE IF NOT EXISTS custom_resources (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  video_id TEXT,
  title TEXT NOT NULL,
  resource_type TEXT DEFAULT 'Custom Resource',
  description TEXT DEFAULT '',
  primary_url TEXT NOT NULL,
  author_or_creator TEXT,
  formatted_time TEXT,
  exact_quote TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Activity History (replaces local storage for activity tracking)
CREATE TABLE IF NOT EXISTS activity_history (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('video', 'summary', 'word_lookup', 'research_search', 'transcript_search', 'ai_question', 'artifact_saved', 'audio_narration')),
  query_or_title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  url TEXT DEFAULT '',
  video_id TEXT,
  date_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Rate Limiting tracking (server-side)
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  route_type TEXT NOT NULL CHECK(route_type IN ('general', 'llm')),
  request_count INTEGER DEFAULT 1,
  window_start TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(ip_address, route_type, window_start)
);

-- API Keys cache / User sessions (optional, for authentication)
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_lists_owner ON saved_lists(owner_id);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_owner ON list_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_saved_summaries_owner ON saved_summaries(owner_id);
CREATE INDEX IF NOT EXISTS idx_saved_summaries_video ON saved_summaries(video_id);
CREATE INDEX IF NOT EXISTS idx_custom_resources_owner ON custom_resources(owner_id);
CREATE INDEX IF NOT EXISTS idx_activity_history_owner ON activity_history(owner_id);
CREATE INDEX IF NOT EXISTS idx_activity_history_date ON activity_history(date_key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON rate_limits(ip_address, route_type, window_start);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
