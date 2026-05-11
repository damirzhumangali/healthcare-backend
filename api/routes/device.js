const express = require("express");
const devicePairingService = require("../services/devicePairingService");
const measurementService = require("../services/measurementService");
const userService = require("../services/userService");

const router = express.Router();

function readDeviceSessionToken(req) {
  return String(
    req.headers["x-device-session"] ||
      req.query?.sessionToken ||
      req.query?.session_token ||
      req.body?.sessionToken ||
      req.body?.session_token ||
      ""
  ).trim();
}

function readDeviceSecret(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return String(req.headers["x-device-secret"] || bearer || req.body?.deviceSecret || "").trim();
}

function toPatientSummary(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || "",
    name: user.name || user.email || `Пациент ${String(user.id || "").slice(-4)}`,
    picture: user.picture || "",
    role: user.role || "patient",
  };
}

function buildSessionPayload(session, limit) {
  const patient = userService.getUserById(session.patientId);
  const measurements = measurementService.listMeasurementsForUser(session.patientId, {
    deviceId: session.deviceId,
    limit,
  });

  return {
    session,
    patient: toPatientSummary(patient),
    measurements,
  };
}

function requireDeviceSession(req, res, next) {
  const sessionToken = readDeviceSessionToken(req);
  if (!sessionToken) {
    return res.status(401).json({ error: "device_session_required" });
  }

  const session = devicePairingService.getSessionByToken(sessionToken);
  if (!session) {
    return res.status(401).json({ error: "invalid_device_session" });
  }

  req.deviceSession = session;
  return next();
}

router.get("/session", requireDeviceSession, (req, res, next) => {
  try {
    return res.json(buildSessionPayload(req.deviceSession, req.query?.limit));
  } catch (error) {
    return next(error);
  }
});

router.delete("/session", requireDeviceSession, (req, res, next) => {
  try {
    devicePairingService.closeSession(req.deviceSession.sessionToken);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post("/measurements", (req, res, next) => {
  try {
    const expectedSecret = String(process.env.DEVICE_INGEST_SECRET || "").trim();
    if (!expectedSecret) {
      return res.status(503).json({ error: "device_ingest_not_configured" });
    }

    if (readDeviceSecret(req) !== expectedSecret) {
      return res.status(401).json({ error: "invalid_device_secret" });
    }

    const requestedDeviceId = String(req.body?.deviceId || req.body?.device_id || "").trim();
    const sessionToken = readDeviceSessionToken(req);
    const session = sessionToken
      ? devicePairingService.getSessionByToken(sessionToken)
      : devicePairingService.getActiveSessionByDeviceId(requestedDeviceId);

    if (!session) {
      return res.status(409).json({ error: "no_active_device_session" });
    }

    if (requestedDeviceId && requestedDeviceId !== session.deviceId) {
      return res.status(400).json({ error: "device_id_mismatch" });
    }

    const item = measurementService.createMeasurement({
      ...(req.body || {}),
      user_id: session.patientId,
      device_id: session.deviceId,
    });

    return res.status(201).json({
      item,
      ...buildSessionPayload(session, 10),
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
