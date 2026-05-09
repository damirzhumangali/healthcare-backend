const { randomUUID } = require("crypto");
const { db } = require("../db/sqlite");

const STATUSES = new Set(["new", "reviewed"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function buildJitsiUrl() {
  const slug = randomUUID().replace(/-/g, "").slice(0, 12);
  return `https://meet.jit.si/healthassist-${slug}`;
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
    wants_consultation: input.wants_consultation ? 1 : 0,
    requested_at: normalizeText(input.requested_at) || null,
    meeting_url: null,
    meeting_at: null,
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
      wants_consultation,
      requested_at,
      meeting_url,
      meeting_at,
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
      @wants_consultation,
      @requested_at,
      @meeting_url,
      @meeting_at,
      @created_at,
      @updated_at
    )`
  ).run(item);

  return item;
}

function acceptConsultation(id, meetingAt) {
  const consultationId = normalizeText(id);
  const at = normalizeText(meetingAt);

  if (!consultationId) {
    const error = new Error("missing_consultation_id");
    error.statusCode = 400;
    throw error;
  }

  if (!at) {
    const error = new Error("missing_meeting_at");
    error.statusCode = 400;
    throw error;
  }

  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error("invalid_meeting_at");
    error.statusCode = 400;
    throw error;
  }

  const existing = db
    .prepare("SELECT * FROM telegram_consultations WHERE id = ?")
    .get(consultationId);
  if (!existing) return null;

  const meetingUrl = existing.meeting_url || buildJitsiUrl();
  const meetingAtIso = parsed.toISOString();
  const updatedAt = nowIso();

  db.prepare(
    `UPDATE telegram_consultations
     SET meeting_url = ?, meeting_at = ?, status = 'reviewed', updated_at = ?
     WHERE id = ?`
  ).run(meetingUrl, meetingAtIso, updatedAt, consultationId);

  return db.prepare("SELECT * FROM telegram_consultations WHERE id = ?").get(consultationId);
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
  acceptConsultation,
};
