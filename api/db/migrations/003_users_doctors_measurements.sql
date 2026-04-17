CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','doctor','admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  systolic INTEGER,
  diastolic INTEGER,
  temp_c REAL,
  hr INTEGER,
  spo2 INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS patient_notes (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(patient_id, doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_doctors_active_name
  ON doctors(active, name);

CREATE INDEX IF NOT EXISTS idx_measurements_user_created
  ON measurements(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_notes_patient
  ON patient_notes(patient_id, updated_at DESC);
