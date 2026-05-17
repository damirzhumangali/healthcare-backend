const { db } = require("../db/sqlite");
const doctorsCatalog = require("../data/doctorsCatalog");

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value || null;
}

function toDoctorRow(doctor, existing, ts) {
  return {
    id: doctor.id,
    user_id: existing?.user_id || null,
    email:
      doctor.email !== undefined
        ? normalizeEmail(doctor.email)
        : normalizeEmail(existing?.email),
    name: String(doctor.name || existing?.name || "").trim(),
    specialty: String(doctor.specialty || existing?.specialty || "").trim(),
    telegram_chat_id: existing?.telegram_chat_id || null,
    active: doctor.active === false ? 0 : 1,
    created_at: existing?.created_at || ts,
    updated_at: ts,
  };
}

const findDoctorById = db.prepare("SELECT * FROM doctors WHERE id = ?");
const findUserByEmail = db.prepare("SELECT id, role FROM users WHERE lower(email) = ?");
const insertDoctor = db.prepare(
  "INSERT INTO doctors(id, user_id, email, name, specialty, telegram_chat_id, active, created_at, updated_at) VALUES (@id, @user_id, @email, @name, @specialty, @telegram_chat_id, @active, @created_at, @updated_at)"
);
const updateDoctor = db.prepare(
  `UPDATE doctors
   SET user_id = @user_id,
       email = @email,
       name = @name,
       specialty = @specialty,
       telegram_chat_id = @telegram_chat_id,
       active = @active,
       updated_at = @updated_at
   WHERE id = @id`
);
const linkDoctorToUser = db.prepare("UPDATE doctors SET user_id = ?, updated_at = ? WHERE id = ?");
const promoteUserToDoctor = db.prepare(
  "UPDATE users SET role = 'doctor', updated_at = ? WHERE id = ? AND role != 'admin'"
);

function rowsDiffer(existing, next) {
  return (
    existing.user_id !== next.user_id ||
    normalizeEmail(existing.email) !== normalizeEmail(next.email) ||
    String(existing.name || "") !== String(next.name || "") ||
    String(existing.specialty || "") !== String(next.specialty || "") ||
    String(existing.telegram_chat_id || "") !== String(next.telegram_chat_id || "") ||
    Number(existing.active || 0) !== Number(next.active || 0)
  );
}

const syncDoctorDirectoryTx = db.transaction(() => {
  const ts = nowIso();
  let inserted = 0;
  let updated = 0;
  let linked = 0;
  let promoted = 0;

  for (const doctor of doctorsCatalog) {
    const existing = findDoctorById.get(doctor.id);
    const next = toDoctorRow(doctor, existing, ts);

    if (!existing) {
      insertDoctor.run(next);
      inserted += 1;
      continue;
    }

    if (rowsDiffer(existing, next)) {
      updateDoctor.run(next);
      updated += 1;
    }
  }

  for (const doctor of doctorsCatalog) {
    const row = findDoctorById.get(doctor.id);
    const email = normalizeEmail(row?.email);
    if (!row || !email) continue;

    const user = findUserByEmail.get(email);
    if (!user) continue;

    if (row.user_id !== user.id) {
      linkDoctorToUser.run(user.id, ts, row.id);
      linked += 1;
    }

    if (user.role !== "admin" && user.role !== "doctor") {
      promoteUserToDoctor.run(ts, user.id);
      promoted += 1;
    }
  }

  return {
    totalDoctors: doctorsCatalog.length,
    inserted,
    updated,
    linked,
    promoted,
  };
});

function syncDoctorDirectory() {
  return syncDoctorDirectoryTx();
}

module.exports = {
  doctorsCatalog,
  syncDoctorDirectory,
};
