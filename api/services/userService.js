const { db } = require("../db/sqlite");

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

function resolveRole(email) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail && adminEmails().includes(normalizedEmail)) return "admin";

  const doctor = normalizedEmail
    ? db.prepare("SELECT id FROM doctors WHERE lower(email) = ? AND active = 1").get(normalizedEmail)
    : null;
  if (doctor) return "doctor";

  return "patient";
}

function upsertOAuthUser(profile) {
  const ts = nowIso();
  const email = normalizeEmail(profile.email);
  const role = resolveRole(email);
  const user = {
    id: String(profile.id || "").trim(),
    email,
    name: String(profile.name || "").trim(),
    picture: String(profile.picture || "").trim(),
    role,
    created_at: ts,
    updated_at: ts,
  };

  db.prepare(
    `INSERT INTO users(id, email, name, picture, role, created_at, updated_at)
     VALUES (@id, @email, @name, @picture, @role, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       role = excluded.role,
       updated_at = excluded.updated_at`
  ).run(user);

  if (role === "doctor" && email) {
    db.prepare("UPDATE doctors SET user_id = ?, updated_at = ? WHERE lower(email) = ?").run(user.id, ts, email);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
  };
}

function getUserById(id) {
  return db.prepare("SELECT id, email, name, picture, role FROM users WHERE id = ?").get(id);
}

function listPatients() {
  const users = db
    .prepare(
      `SELECT
        u.id,
        u.email,
        u.name,
        u.picture,
        u.role,
        u.created_at,
        MAX(a.created_at) AS last_appointment_at,
        COUNT(a.id) AS appointment_count
       FROM users u
       LEFT JOIN appointments a ON a.patient_id = u.id
       WHERE u.role = 'patient'
       GROUP BY u.id
       ORDER BY COALESCE(MAX(a.created_at), u.created_at) DESC`
    )
    .all();

  const knownIds = new Set(users.map((user) => user.id));
  const appointmentOnly = db
    .prepare(
      `SELECT
        a.patient_id AS id,
        NULL AS email,
        NULL AS name,
        NULL AS picture,
        'patient' AS role,
        MIN(a.created_at) AS created_at,
        MAX(a.created_at) AS last_appointment_at,
        COUNT(a.id) AS appointment_count
       FROM appointments a
       GROUP BY a.patient_id
       ORDER BY MAX(a.created_at) DESC`
    )
    .all()
    .filter((patient) => !knownIds.has(patient.id));

  return [...users, ...appointmentOnly].map((patient) => ({
    id: patient.id,
    email: patient.email,
    name: patient.name || patient.email || `Пациент ${String(patient.id || "").slice(-4)}`,
    picture: patient.picture,
    role: patient.role,
    created_at: patient.created_at,
    last_appointment_at: patient.last_appointment_at,
    appointment_count: Number(patient.appointment_count || 0),
  }));
}

module.exports = {
  resolveRole,
  upsertOAuthUser,
  getUserById,
  listPatients,
};
