const { db } = require("../db/sqlite");

function nowIso() {
  return new Date().toISOString();
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readOptionalNumber(value, { integer = false, field }) {
  if (value === undefined || value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createError(`invalid_${field}`);
  }

  if (integer && !Number.isInteger(parsed)) {
    throw createError(`invalid_${field}`);
  }

  return parsed;
}

function normalizeCreatedAt(value) {
  if (value === undefined || value === null || value === "") return nowIso();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError("invalid_created_at");
  }
  return parsed.toISOString();
}

function publicMeasurement(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    systolic: row.systolic,
    diastolic: row.diastolic,
    tempC: row.temp_c,
    hr: row.hr,
    spo2: row.spo2,
    note: row.note || "",
  };
}

function normalizeMeasurementInput(input) {
  const measurement = {
    id: globalThis.crypto.randomUUID(),
    user_id: String(input.user_id || input.userId || "").trim(),
    device_id: String(input.device_id || input.deviceId || "").trim(),
    created_at: normalizeCreatedAt(input.created_at || input.createdAt),
    systolic: readOptionalNumber(input.systolic, { integer: true, field: "systolic" }),
    diastolic: readOptionalNumber(input.diastolic, { integer: true, field: "diastolic" }),
    temp_c: readOptionalNumber(input.temp_c ?? input.tempC, { field: "temp_c" }),
    hr: readOptionalNumber(input.hr, { integer: true, field: "hr" }),
    spo2: readOptionalNumber(input.spo2, { integer: true, field: "spo2" }),
    note: input.note == null ? "" : String(input.note).trim(),
  };

  if (!measurement.user_id) {
    throw createError("user_id_required");
  }

  if (!measurement.device_id) {
    throw createError("device_id_required");
  }

  const hasAnyMetric =
    measurement.systolic !== null ||
    measurement.diastolic !== null ||
    measurement.temp_c !== null ||
    measurement.hr !== null ||
    measurement.spo2 !== null;

  if (!hasAnyMetric) {
    throw createError("measurement_value_required");
  }

  return measurement;
}

function createMeasurement(input) {
  const measurement = normalizeMeasurementInput(input);

  db.prepare(
    `INSERT INTO measurements(
      id,
      user_id,
      device_id,
      created_at,
      systolic,
      diastolic,
      temp_c,
      hr,
      spo2,
      note
    ) VALUES (
      @id,
      @user_id,
      @device_id,
      @created_at,
      @systolic,
      @diastolic,
      @temp_c,
      @hr,
      @spo2,
      @note
    )`
  ).run(measurement);

  return publicMeasurement(measurement);
}

function normalizeLimit(value, fallback = 20, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function listMeasurementsForUser(userId, { deviceId, limit } = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return [];

  const normalizedLimit = normalizeLimit(limit, 20);
  const normalizedDeviceId = String(deviceId || "").trim();

  const rows = normalizedDeviceId
    ? db
        .prepare(
          `SELECT *
           FROM measurements
           WHERE user_id = ? AND device_id = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(normalizedUserId, normalizedDeviceId, normalizedLimit)
    : db
        .prepare(
          `SELECT *
           FROM measurements
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(normalizedUserId, normalizedLimit);

  return rows.map(publicMeasurement);
}

module.exports = {
  createMeasurement,
  listMeasurementsForUser,
  normalizeLimit,
  publicMeasurement,
};
