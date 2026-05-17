const { randomUUID } = require("crypto");
const { db } = require("../db/sqlite");
const bus = require("./eventBus");

const APPOINTMENT_EVENT = "appointment:changed";

const STATUSES = new Set(["pending", "active", "done"]);

function nowIso() {
  return new Date().toISOString();
}

function isValidStatus(status) {
  return STATUSES.has(status);
}

function buildJitsiUrl() {
  const slug = randomUUID().replace(/-/g, "").slice(0, 14);
  return `https://meet.jit.si/healthassist-${slug}`;
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeConsultationMode(value) {
  const normalized = String(value || "").trim();
  if (normalized === "online_home" || normalized === "online_ward" || normalized === "in_person") {
    return normalized;
  }
  if (normalized === "online") return "online_home";
  if (normalized === "ward") return "online_ward";
  return "in_person";
}

function createAppointment(input) {
  const consultationMode = normalizeConsultationMode(input.consultation_mode || input.consultationMode);
  const wantsOnline = consultationMode !== "in_person" || Boolean(input.wants_online || input.wantsOnline);
  const doctorId = String(input.doctor_id || input.doctorId || "").trim() || "pending";
  const time = String(input.time || "").trim() || "00:00";
  const shouldHaveMeetingLink = consultationMode === "online_home" && doctorId !== "pending";
  const appointment = {
    id: globalThis.crypto.randomUUID(),
    patient_id: String(input.patient_id || "").trim(),
    doctor_id: doctorId,
    date: String(input.date || "").trim(),
    time,
    reason: input.reason == null ? "" : String(input.reason).trim(),
    specialty_request: normalizeOptionalText(input.specialty_request || input.specialtyRequest),
    wants_online: wantsOnline ? 1 : 0,
    consultation_mode: consultationMode,
    ward_label: normalizeOptionalText(input.ward_label || input.wardLabel),
    bed_label: normalizeOptionalText(input.bed_label || input.bedLabel),
    room_label: normalizeOptionalText(input.room_label || input.roomLabel),
    status: input.status || "pending",
    meeting_url: normalizeOptionalText(input.meeting_url || input.meetingUrl) || (shouldHaveMeetingLink ? buildJitsiUrl() : null),
    meeting_at: normalizeOptionalText(input.meeting_at || input.meetingAt),
    meeting_notified: input.meeting_notified || input.meetingNotified ? 1 : 0,
    created_at: nowIso(),
  };

  const missingFields = [];
  if (!appointment.patient_id) missingFields.push("patient_id");
  if (!appointment.date) missingFields.push("date");
  if (!appointment.time) missingFields.push("time");

  if (missingFields.length > 0) {
    const error = new Error("missing_required_fields");
    error.statusCode = 400;
    error.details = { missingFields };
    throw error;
  }

  if (!isValidStatus(appointment.status)) {
    const error = new Error("invalid_status");
    error.statusCode = 400;
    throw error;
  }

  db.prepare(
    `INSERT INTO appointments(
      id, patient_id, doctor_id, date, time, reason, specialty_request, wants_online, consultation_mode,
      ward_label, bed_label, room_label, status, meeting_url, meeting_at, meeting_notified, created_at
    ) VALUES (
      @id, @patient_id, @doctor_id, @date, @time, @reason, @specialty_request, @wants_online, @consultation_mode,
      @ward_label, @bed_label, @room_label, @status, @meeting_url, @meeting_at, @meeting_notified, @created_at
    )`
  ).run(appointment);

  bus.emit(APPOINTMENT_EVENT, { type: "new_appointment", item: appointment });
  return appointment;
}

function listAppointments({ doctor_id, patient_id, date } = {}) {
  const doctorId = String(doctor_id || "").trim();
  const patientId = String(patient_id || "").trim();
  const appointmentDate = String(date || "").trim();

  if (appointmentDate && doctorId && patientId) {
    return db
      .prepare(
        "SELECT * FROM appointments WHERE doctor_id = ? AND patient_id = ? AND date = ? ORDER BY time ASC, created_at ASC"
      )
      .all(doctorId, patientId, appointmentDate);
  }

  if (appointmentDate && patientId) {
    return db
      .prepare(
        "SELECT * FROM appointments WHERE patient_id = ? AND date = ? ORDER BY time ASC, created_at ASC"
      )
      .all(patientId, appointmentDate);
  }

  if (appointmentDate) {
    if (!doctorId) {
      return db
        .prepare("SELECT * FROM appointments WHERE date = ? ORDER BY time ASC, created_at ASC")
        .all(appointmentDate);
    }

    return db
      .prepare(
        "SELECT * FROM appointments WHERE doctor_id = ? AND date = ? ORDER BY time ASC, created_at ASC"
      )
      .all(doctorId, appointmentDate);
  }

  if (!doctorId) {
    if (patientId) {
      return db
        .prepare("SELECT * FROM appointments WHERE patient_id = ? ORDER BY date ASC, time ASC, created_at ASC")
        .all(patientId);
    }

    return db
      .prepare("SELECT * FROM appointments ORDER BY date ASC, time ASC, created_at ASC")
      .all();
  }

  return db
    .prepare("SELECT * FROM appointments WHERE doctor_id = ? ORDER BY date ASC, time ASC, created_at ASC")
    .all(doctorId);
}

function updateAppointmentStatus(id, status) {
  const appointmentId = String(id || "").trim();
  const nextStatus = String(status || "").trim();

  if (!appointmentId) {
    const error = new Error("missing_appointment_id");
    error.statusCode = 400;
    throw error;
  }

  if (!isValidStatus(nextStatus)) {
    const error = new Error("invalid_status");
    error.statusCode = 400;
    throw error;
  }

  const result = db
    .prepare("UPDATE appointments SET status = ? WHERE id = ?")
    .run(nextStatus, appointmentId);

  if (result.changes === 0) return null;
  return db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId);
}

function assignAppointment(
  id,
  { doctor_id, date, time, meeting_url, meeting_at, meeting_notified, room_label } = {},
) {
  const appointmentId = String(id || "").trim();
  if (!appointmentId) {
    const error = new Error("missing_appointment_id");
    error.statusCode = 400;
    throw error;
  }

  const existing = db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId);
  if (!existing) return null;

  const next = {
    ...existing,
    doctor_id: doctor_id !== undefined ? String(doctor_id || "").trim() || "pending" : existing.doctor_id,
    date: date !== undefined ? String(date || "").trim() || existing.date : existing.date,
    time: time !== undefined ? String(time || "").trim() : existing.time,
    room_label: room_label !== undefined ? normalizeOptionalText(room_label) : existing.room_label,
    meeting_url:
      meeting_url !== undefined
        ? String(meeting_url || "").trim() || existing.meeting_url
        : existing.meeting_url || (normalizeConsultationMode(existing.consultation_mode) === "online_home" && String(doctor_id || "").trim() ? buildJitsiUrl() : null),
    meeting_at: meeting_at !== undefined ? normalizeOptionalText(meeting_at) : existing.meeting_at,
    meeting_notified:
      meeting_notified !== undefined
        ? (meeting_notified ? 1 : 0)
        : existing.meeting_notified || 0,
  };

  db.prepare(
    `UPDATE appointments
     SET doctor_id = @doctor_id,
         date = @date,
         time = @time,
         room_label = @room_label,
         meeting_url = @meeting_url,
         meeting_at = @meeting_at,
         meeting_notified = @meeting_notified
     WHERE id = @id`
  ).run({
    doctor_id: next.doctor_id,
    date: next.date,
    time: next.time,
    room_label: next.room_label,
    meeting_url: next.meeting_url,
    meeting_at: next.meeting_at,
    meeting_notified: next.meeting_notified,
    id: appointmentId,
  });

  const updated = db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId);
  bus.emit(APPOINTMENT_EVENT, { type: "appointment_assigned", item: updated });
  return updated;
}

module.exports = {
  createAppointment,
  listAppointments,
  updateAppointmentStatus,
  assignAppointment,
};
