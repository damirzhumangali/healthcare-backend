CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','done')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date
  ON appointments(doctor_id, date, time);

CREATE INDEX IF NOT EXISTS idx_appointments_patient_created
  ON appointments(patient_id, created_at DESC);
