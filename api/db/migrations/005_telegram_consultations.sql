CREATE TABLE IF NOT EXISTS telegram_consultations (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  patient_name TEXT NOT NULL,
  problem TEXT NOT NULL,
  days TEXT,
  temperature TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_consultations_status_created
  ON telegram_consultations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_consultations_chat_id
  ON telegram_consultations(chat_id, created_at DESC);
