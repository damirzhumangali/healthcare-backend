const { randomBytes, timingSafeEqual } = require("crypto");
const { db } = require("../db/sqlite");

const PAIRING_STATUSES = new Set(["pending", "approved", "expired", "closed"]);

function nowIso() {
  return new Date().toISOString();
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function generateSecret(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function normalizeTtl(value, fallbackSeconds, maxSeconds) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds;
  return Math.min(maxSeconds, Math.floor(parsed));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function publicPairing(row, { includePollSecret = false, includeSession = false } = {}) {
  if (!row) return null;

  const pairing = {
    id: row.id,
    token: row.token,
    deviceId: row.device_id,
    patientId: row.patient_id || null,
    status: row.status,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includePollSecret) {
    pairing.pollSecret = row.poll_secret;
  }

  if (includeSession) {
    pairing.sessionToken = row.status === "approved" ? row.session_token || null : null;
    pairing.sessionExpiresAt = row.status === "approved" ? row.session_expires_at || null : null;
    pairing.closedAt = row.closed_at || null;
  }

  return pairing;
}

function publicSession(row) {
  if (!row || row.status !== "approved" || !row.session_token) return null;
  return {
    sessionToken: row.session_token,
    deviceId: row.device_id,
    patientId: row.patient_id,
    status: row.status,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    sessionExpiresAt: row.session_expires_at,
  };
}

function expireStaleRows() {
  const ts = nowIso();

  db.prepare(
    `UPDATE device_pairings
     SET status = 'expired', closed_at = COALESCE(closed_at, ?), updated_at = ?
     WHERE status = 'pending' AND expires_at <= ?`
  ).run(ts, ts, ts);

  db.prepare(
    `UPDATE device_pairings
     SET status = 'expired', closed_at = COALESCE(closed_at, ?), updated_at = ?
     WHERE status = 'approved'
       AND session_expires_at IS NOT NULL
       AND session_expires_at <= ?`
  ).run(ts, ts, ts);
}

function requireKnownStatus(status) {
  if (!PAIRING_STATUSES.has(status)) {
    throw createError("invalid_pairing_status");
  }
}

function getRowByToken(token) {
  expireStaleRows();
  return db.prepare("SELECT * FROM device_pairings WHERE token = ?").get(token);
}

function getRowBySessionToken(sessionToken) {
  expireStaleRows();
  return db
    .prepare("SELECT * FROM device_pairings WHERE session_token = ? AND status = 'approved'")
    .get(sessionToken);
}

function closeRowsByDevice(deviceId, status) {
  requireKnownStatus(status);
  const ts = nowIso();
  db.prepare(
    `UPDATE device_pairings
     SET status = 'closed', closed_at = COALESCE(closed_at, ?), updated_at = ?
     WHERE device_id = ? AND status = ?`
  ).run(ts, ts, deviceId, status);
}

function createPairing({ deviceId, pairingTtlSeconds, sessionTtlSeconds }) {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) {
    throw createError("device_id_required");
  }

  const normalizedPairingTtl = normalizeTtl(pairingTtlSeconds, 300, 600);
  const normalizedSessionTtl = normalizeTtl(sessionTtlSeconds, 600, 3600);
  const ts = nowIso();

  expireStaleRows();
  closeRowsByDevice(normalizedDeviceId, "pending");

  const row = {
    id: globalThis.crypto.randomUUID(),
    token: generateSecret(18),
    poll_secret: generateSecret(24),
    session_token: null,
    device_id: normalizedDeviceId,
    patient_id: null,
    status: "pending",
    expires_at: addSeconds(ts, normalizedPairingTtl),
    session_expires_at: addSeconds(ts, normalizedSessionTtl),
    claimed_at: null,
    closed_at: null,
    created_at: ts,
    updated_at: ts,
  };

  db.prepare(
    `INSERT INTO device_pairings(
      id,
      token,
      poll_secret,
      session_token,
      device_id,
      patient_id,
      status,
      expires_at,
      session_expires_at,
      claimed_at,
      closed_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @token,
      @poll_secret,
      @session_token,
      @device_id,
      @patient_id,
      @status,
      @expires_at,
      @session_expires_at,
      @claimed_at,
      @closed_at,
      @created_at,
      @updated_at
    )`
  ).run(row);

  return {
    ...publicPairing(row, { includePollSecret: true }),
    sessionTtlSeconds: normalizedSessionTtl,
  };
}

function getPairingForTablet(token, pollSecret) {
  const row = getRowByToken(String(token || "").trim());
  if (!row) return null;

  if (!safeEqual(row.poll_secret, pollSecret)) {
    throw createError("forbidden", 403);
  }

  return publicPairing(row, { includeSession: true });
}

function approvePairing(token, patientId, sessionTtlSeconds) {
  const normalizedToken = String(token || "").trim();
  const normalizedPatientId = String(patientId || "").trim();

  if (!normalizedPatientId) {
    throw createError("patient_id_required");
  }

  const existing = getRowByToken(normalizedToken);
  if (!existing) return null;

  if (existing.status === "expired") {
    throw createError("pairing_expired", 410);
  }

  if (existing.status === "closed") {
    throw createError("pairing_closed", 409);
  }

  if (existing.status === "approved") {
    if (existing.patient_id === normalizedPatientId) {
      return publicPairing(existing, { includeSession: true });
    }
    throw createError("pairing_already_used", 409);
  }

  const normalizedSessionTtl = normalizeTtl(sessionTtlSeconds, 600, 3600);
  const ts = nowIso();
  const sessionToken = generateSecret(30);

  closeRowsByDevice(existing.device_id, "approved");

  const result = db.prepare(
    `UPDATE device_pairings
     SET patient_id = ?,
         status = 'approved',
         session_token = ?,
         claimed_at = ?,
         session_expires_at = ?,
         updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(
    normalizedPatientId,
    sessionToken,
    ts,
    addSeconds(ts, normalizedSessionTtl),
    ts,
    existing.id
  );

  if (result.changes === 0) {
    throw createError("pairing_already_used", 409);
  }

  const approved = getRowByToken(normalizedToken);
  return publicPairing(approved, { includeSession: true });
}

function getSessionByToken(sessionToken) {
  const row = getRowBySessionToken(String(sessionToken || "").trim());
  return publicSession(row);
}

function getActiveSessionByDeviceId(deviceId) {
  expireStaleRows();
  const row = db
    .prepare(
      `SELECT *
       FROM device_pairings
       WHERE device_id = ? AND status = 'approved'
       ORDER BY claimed_at DESC, created_at DESC
       LIMIT 1`
    )
    .get(String(deviceId || "").trim());

  return publicSession(row);
}

function closeSession(sessionToken) {
  const normalizedToken = String(sessionToken || "").trim();
  if (!normalizedToken) return null;

  const ts = nowIso();
  const result = db.prepare(
    `UPDATE device_pairings
     SET status = 'closed', closed_at = COALESCE(closed_at, ?), updated_at = ?
     WHERE session_token = ? AND status = 'approved'`
  ).run(ts, ts, normalizedToken);

  if (result.changes === 0) return null;

  return db.prepare("SELECT * FROM device_pairings WHERE session_token = ?").get(normalizedToken);
}

module.exports = {
  approvePairing,
  createPairing,
  getActiveSessionByDeviceId,
  getPairingForTablet,
  getSessionByToken,
  closeSession,
};
