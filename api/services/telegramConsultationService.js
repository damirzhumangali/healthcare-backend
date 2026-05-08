const { randomUUID } = require("crypto");
const { db } = require("../db/sqlite");

const STATUSES = new Set(["new", "reviewed"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function createConsultation(input) {
  const createdAt = nowIso();
  const item = {
    id: randomUUID(),
    chat_id: normalizeText(input.chat_id),
    telegram_username: normalizeText(input.telegram_username),
    telegram_first_name: normalizeText(input.telegram_first_name),
    telegram_last_name: normalizeText(input.telegram_last_name),
    patient_name: normalizeText(input.patient_name),
    problem: normalizeText(input.problem),
    days: normalizeText(input.days),
    temperature: normalizeText(input.temperature),
    status: "new",
    created_at: createdAt,
    updated_at: createdAt,
  };

  if (!item.chat_id || !item.patient_name || !item.problem) {
    const error = new Error("missing_required_fields");
    error.statusCode = 400;
    throw error;
  }

  db.prepare(
    `INSERT INTO telegram_consultations(
      id,
      chat_id,
      telegram_username,
      telegram_first_name,
      telegram_last_name,
      patient_name,
      problem,
      days,
      temperature,
      status,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @chat_id,
      @telegram_username,
      @telegram_first_name,
      @telegram_last_name,
      @patient_name,
      @problem,
      @days,
      @temperature,
      @status,
      @created_at,
      @updated_at
    )`
  ).run(item);

  return item;
}

function listConsultations() {
  return db
    .prepare(
      `SELECT *
       FROM telegram_consultations
       ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, datetime(created_at) DESC`
    )
    .all();
}

function updateConsultationStatus(id, status) {
  const consultationId = normalizeText(id);
  const nextStatus = normalizeText(status);

  if (!consultationId) {
    const error = new Error("missing_consultation_id");
    error.statusCode = 400;
    throw error;
  }

  if (!STATUSES.has(nextStatus)) {
    const error = new Error("invalid_status");
    error.statusCode = 400;
    throw error;
  }

  const result = db
    .prepare("UPDATE telegram_consultations SET status = ?, updated_at = ? WHERE id = ?")
    .run(nextStatus, nowIso(), consultationId);

  if (result.changes === 0) return null;

  return db.prepare("SELECT * FROM telegram_consultations WHERE id = ?").get(consultationId);
}

module.exports = {
  createConsultation,
  listConsultations,
  updateConsultationStatus,
};
