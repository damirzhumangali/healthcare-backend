CREATE TABLE IF NOT EXISTS device_pairings (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  poll_secret TEXT NOT NULL UNIQUE,
  session_token TEXT UNIQUE,
  device_id TEXT NOT NULL,
  patient_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','expired','closed')),
  expires_at TEXT NOT NULL,
  session_expires_at TEXT,
  claimed_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_pairings_device_status_created
  ON device_pairings(device_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_pairings_patient_created
  ON device_pairings(patient_id, created_at DESC);
