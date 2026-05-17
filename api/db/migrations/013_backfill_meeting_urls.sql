-- Backfill meeting_url for appointments that don't have one yet
UPDATE appointments
SET meeting_url = 'https://meet.jit.si/healthassist-' || lower(hex(randomblob(7)))
WHERE meeting_url IS NULL OR meeting_url = '';
