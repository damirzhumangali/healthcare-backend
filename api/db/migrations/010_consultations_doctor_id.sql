ALTER TABLE telegram_consultations ADD COLUMN doctor_id TEXT;
ALTER TABLE doctors ADD COLUMN telegram_chat_id TEXT;
