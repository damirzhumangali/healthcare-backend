ALTER TABLE appointments ADD COLUMN specialty_request TEXT;
ALTER TABLE appointments ADD COLUMN wants_online INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN consultation_mode TEXT NOT NULL DEFAULT 'in_person';
ALTER TABLE appointments ADD COLUMN ward_label TEXT;
ALTER TABLE appointments ADD COLUMN bed_label TEXT;
ALTER TABLE appointments ADD COLUMN room_label TEXT;
ALTER TABLE appointments ADD COLUMN meeting_at TEXT;
ALTER TABLE appointments ADD COLUMN meeting_notified INTEGER NOT NULL DEFAULT 0;
