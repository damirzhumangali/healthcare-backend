CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS medicines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100),
  treats_diseases TEXT[] DEFAULT '{}',
  dosage_adult VARCHAR(255),
  dosage_child VARCHAR(255),
  dosage_elderly VARCHAR(255),
  contraindications TEXT,
  side_effects TEXT,
  compatible_with TEXT[] DEFAULT '{}',
  incompatible_with TEXT[] DEFAULT '{}',
  description TEXT,
  embedding vector(__EMBEDDING_DIMENSIONS__)
);

CREATE TABLE IF NOT EXISTS diseases (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  icd10_code VARCHAR(20),
  symptoms TEXT[] DEFAULT '{}',
  recommended_medicines TEXT[] DEFAULT '{}',
  doctor_specialization VARCHAR(100),
  urgency_level VARCHAR(20),
  description TEXT,
  treatment_protocol TEXT,
  embedding vector(__EMBEDDING_DIMENSIONS__)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id SERIAL PRIMARY KEY,
  patient_id VARCHAR(255),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources_used TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_conversations_patient_created_idx
  ON ai_conversations (patient_id, created_at DESC);
