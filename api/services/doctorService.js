const { db } = require("../db/sqlite");

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value || null;
}

function publicDoctor(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    email: row.email,
    name: row.name,
    specialty: row.specialty,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listDoctors({ includeInactive = false } = {}) {
  const rows = includeInactive
    ? db.prepare("SELECT * FROM doctors ORDER BY active DESC, name ASC").all()
    : db.prepare("SELECT * FROM doctors WHERE active = 1 ORDER BY name ASC").all();
  return rows.map(publicDoctor);
}

function createDoctor(input) {
  const ts = nowIso();
  const doctor = {
    id: globalThis.crypto.randomUUID(),
    user_id: null,
    email: normalizeEmail(input.email),
    name: String(input.name || "").trim(),
    specialty: String(input.specialty || "").trim(),
    active: input.active === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
  };

  if (!doctor.name || !doctor.specialty) {
    const error = new Error("missing_required_fields");
    error.statusCode = 400;
    throw error;
  }

  if (doctor.email) {
    const user = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(doctor.email);
    if (user) doctor.user_id = user.id;
  }

  db.prepare(
    "INSERT INTO doctors(id, user_id, email, name, specialty, active, created_at, updated_at) VALUES (@id, @user_id, @email, @name, @specialty, @active, @created_at, @updated_at)"
  ).run(doctor);

  if (doctor.user_id) {
    db.prepare("UPDATE users SET role = 'doctor', updated_at = ? WHERE id = ? AND role != 'admin'").run(ts, doctor.user_id);
  }

  return publicDoctor(doctor);
}

function updateDoctor(id, input) {
  const existing = db.prepare("SELECT * FROM doctors WHERE id = ?").get(id);
  if (!existing) return null;

  const ts = nowIso();
  const next = {
    ...existing,
    email: input.email === undefined ? existing.email : normalizeEmail(input.email),
    name: input.name === undefined ? existing.name : String(input.name || "").trim(),
    specialty: input.specialty === undefined ? existing.specialty : String(input.specialty || "").trim(),
    active: input.active === undefined ? existing.active : input.active ? 1 : 0,
    updated_at: ts,
  };

  if (!next.name || !next.specialty) {
    const error = new Error("missing_required_fields");
    error.statusCode = 400;
    throw error;
  }

  if (next.email) {
    const user = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(next.email);
    next.user_id = user?.id || next.user_id;
  }

  db.prepare(
    "UPDATE doctors SET user_id = @user_id, email = @email, name = @name, specialty = @specialty, active = @active, updated_at = @updated_at WHERE id = @id"
  ).run(next);

  if (next.user_id) {
    db.prepare("UPDATE users SET role = CASE WHEN ? = 1 THEN 'doctor' ELSE 'patient' END, updated_at = ? WHERE id = ? AND role != 'admin'").run(
      next.active,
      ts,
      next.user_id
    );
  }

  return publicDoctor(db.prepare("SELECT * FROM doctors WHERE id = ?").get(id));
}

function getDoctorForUser(user) {
  if (!user) return null;
  const byUser = db.prepare("SELECT * FROM doctors WHERE user_id = ? AND active = 1").get(user.id);
  if (byUser) return publicDoctor(byUser);
  const email = normalizeEmail(user.email);
  if (!email) return null;
  return publicDoctor(db.prepare("SELECT * FROM doctors WHERE lower(email) = ? AND active = 1").get(email));
}

module.exports = {
  listDoctors,
  createDoctor,
  updateDoctor,
  getDoctorForUser,
};
