ALTER TABLE telegram_consultations ADD COLUMN patient_id TEXT;
CREATE INDEX IF NOT EXISTS idx_telegram_consultations_patient_id ON telegram_consultations(patient_id, created_at DESC);
