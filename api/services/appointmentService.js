const { db } = require("../db/sqlite");

const STATUSES = new Set(["pending", "active", "done"]);

function nowIso() {
  return new Date().toISOString();
}

function isValidStatus(status) {
  return STATUSES.has(status);
}

function createAppointment(input) {
  const appointment = {
    id: globalThis.crypto.randomUUID(),
    patient_id: String(input.patient_id || "").trim(),
    doctor_id: String(input.doctor_id || "").trim(),
    date: String(input.date || "").trim(),
    time: String(input.time || "").trim(),
    reason: input.reason == null ? "" : String(input.reason).trim(),
    status: input.status || "pending",
    created_at: nowIso(),
  };

  if (!appointment.patient_id || !appointment.doctor_id || !appointment.date || !appointment.time) {
    const error = new Error("missing_required_fields");
    error.statusCode = 400;
    throw error;
  }

  if (!isValidStatus(appointment.status)) {
    const error = new Error("invalid_status");
    error.statusCode = 400;
    throw error;
  }

  db.prepare(
    "INSERT INTO appointments(id, patient_id, doctor_id, date, time, reason, status, created_at) VALUES (@id, @patient_id, @doctor_id, @date, @time, @reason, @status, @created_at)"
  ).run(appointment);

  return appointment;
}

function listAppointments({ doctor_id, date } = {}) {
  const doctorId = String(doctor_id || "").trim();
  const appointmentDate = String(date || "").trim();

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

module.exports = {
  createAppointment,
  listAppointments,
  updateAppointmentStatus,
};
