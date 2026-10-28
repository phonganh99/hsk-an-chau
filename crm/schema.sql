PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lead_sources (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('direct','marketing','partner','staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO lead_sources(code,label,kind) VALUES
 ('direct','Landing HSK trực tiếp','direct'),
 ('marketing','Marketing An Châu','marketing');

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  program TEXT NOT NULL DEFAULT 'HSK',
  course TEXT NOT NULL CHECK(course IN ('hsk1','hsk2','hsk3','combo','unsure')),
  office TEXT NOT NULL CHECK(office IN ('hn','na')),
  preferred_slot TEXT NOT NULL DEFAULT '',
  previous_level TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','invited','deposit','enrolled','lost')),
  assigned_to TEXT NOT NULL DEFAULT '',
  first_source_code TEXT NOT NULL DEFAULT 'direct',
  last_source_code TEXT NOT NULL DEFAULT 'direct',
  privacy_notice_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(contact_id, program)
);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_office ON opportunities(office, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities(assigned_to, status);
CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  event_type TEXT NOT NULL,
  source_code TEXT NOT NULL DEFAULT 'direct',
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_opportunity ON lead_events(opportunity_id,created_at DESC);
