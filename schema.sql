-- Indus Agent - Cloudflare D1 Database Schema
-- Database: indus-agent-db

-- 1. Users table (Stores Google authenticated accounts)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- Google user ID (sub)
  email TEXT NOT NULL,               -- User email address
  name TEXT NOT NULL,                -- User display name
  picture TEXT,                      -- User profile picture URL
  created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  last_login_at INTEGER NOT NULL     -- Unix timestamp (ms)
);

-- 2. Sessions table (Stores user authentication sessions)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,            -- High-entropy crypto session token
  user_id TEXT NOT NULL,             -- Foreign key to users(id)
  created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  expires_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Chats table (Chat conversations)
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,               -- UUID of the chat thread
  user_id TEXT NOT NULL,             -- Owner user ID
  title TEXT NOT NULL,               -- Conversation title (e.g. auto-generated or user edited)
  model TEXT NOT NULL DEFAULT 'meta-llama/llama-3.3-70b-instruct', -- OpenRouter model ID
  created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  updated_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Messages table (Individual chat turns)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,               -- UUID of message
  chat_id TEXT NOT NULL,             -- Foreign key to chats(id)
  role TEXT NOT NULL,                -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,             -- Message text content (Markdown)
  created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

-- Indexes for lightning fast queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at ASC);
