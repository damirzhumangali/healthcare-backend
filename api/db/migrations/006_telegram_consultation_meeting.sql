ALTER TABLE telegram_consultations ADD COLUMN wants_consultation INTEGER DEFAULT 0;
ALTER TABLE telegram_consultations ADD COLUMN meeting_url TEXT;
ALTER TABLE telegram_consultations ADD COLUMN meeting_at TEXT;
