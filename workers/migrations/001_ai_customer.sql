-- AN CHAU AI CUSTOMER PLATFORM V1 - ADDITIVE MIGRATION.
-- Run against a copy/staging first. No destructive changes to existing CRM.
CREATE TABLE IF NOT EXISTS ai_sessions (
 id TEXT PRIMARY KEY,
 channel TEXT NOT NULL CHECK(channel IN ('web','zalo')),
 external_id TEXT,
 secret_hash TEXT,
 state TEXT NOT NULL DEFAULT 'ai' CHECK(state IN ('ai','human')),
 message_count INTEGER NOT NULL DEFAULT 0,
 last_message_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_session_channel_uid ON ai_sessions(channel,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_session_recent ON ai_sessions(updated_at);
CREATE TABLE IF NOT EXISTS ai_messages (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES ai_sessions(id),
 role TEXT NOT NULL CHECK(role IN ('user','assistant','system_event')),
 content TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_messages_recent ON ai_messages(session_id,created_at);
CREATE TABLE IF NOT EXISTS ai_webhook_events (
 event_key TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_zalo_outbox (
 id TEXT PRIMARY KEY,
 event_key TEXT UNIQUE NOT NULL,
 chat_id TEXT NOT NULL,
 text TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','dead')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_zalo_outbox_pending ON ai_zalo_outbox(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS ai_rate_limits (
 bucket TEXT PRIMARY KEY,
 count INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_handoffs (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL UNIQUE REFERENCES ai_sessions(id),
 lead_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 assigned_to TEXT NOT NULL DEFAULT '',
 summary TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_sale_roster (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 office TEXT NOT NULL DEFAULT 'all',
 courses TEXT NOT NULL DEFAULT 'all',
 capacity INTEGER NOT NULL DEFAULT 15,
 assigned_count INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_automation_outbox (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','dead')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_automation_outbox_pending ON ai_automation_outbox(status,next_attempt_at);
INSERT OR IGNORE INTO lead_sources(code,label,kind,is_active,created_at)
VALUES ('web_ai','HSK AI Web Chat','marketing',1,datetime('now')),
       ('zalo_ai','HSK AI Zalo Bot','marketing',1,datetime('now'));
