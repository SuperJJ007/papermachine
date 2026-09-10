CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  anonymous_id TEXT NOT NULL,
  event TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  app_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  source_id TEXT,
  duration_ms REAL,
  environment_id TEXT,
  phase TEXT,
  cancelled INTEGER,
  received_at TEXT NOT NULL
);
