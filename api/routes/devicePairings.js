const express = require("express");
const { requireJwt } = require("../middleware/auth");
const devicePairingService = require("../services/devicePairingService");
const userService = require("../services/userService");

const router = express.Router();

function getFrontUrl(token) {
  const base = String(process.env.FRONTEND_URL || "").trim();
  if (!base) return `/pair?token=${encodeURIComponent(token)}`;
  return `${base.replace(/\/$/, "")}/pair?token=${encodeURIComponent(token)}`;
}

function readPollSecret(req) {
  return String(
    req.headers["x-pairing-secret"] ||
      req.query?.pollSecret ||
      req.query?.poll_secret ||
      req.body?.pollSecret ||
      req.body?.poll_secret ||
      ""
  ).trim();
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

function toPatientApprovePayload(pairing) {
  if (!pairing) return null;
  return {
    id: pairing.id,
    token: pairing.token,
    deviceId: pairing.deviceId,
    patientId: pairing.patientId,
    status: pairing.status,
    expiresAt: pairing.expiresAt,
    claimedAt: pairing.claimedAt,
    createdAt: pairing.createdAt,
    updatedAt: pairing.updatedAt,
    sessionExpiresAt: pairing.sessionExpiresAt || null,
  };
}

router.post("/", (req, res, next) => {
  try {
    const pairing = devicePairingService.createPairing({
      deviceId: req.body?.deviceId,
      pairingTtlSeconds: req.body?.pairingTtlSeconds ?? process.env.DEVICE_PAIRING_TTL_SECONDS,
      sessionTtlSeconds: req.body?.sessionTtlSeconds ?? process.env.DEVICE_SESSION_TTL_SECONDS,
    });

    return res.status(201).json({
      pairing: {
        ...pairing,
        pairingUrl: getFrontUrl(pairing.token),
      },
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

router.get("/:token", (req, res, next) => {
  try {
    const pollSecret = readPollSecret(req);
    if (!pollSecret) {
      return res.status(400).json({ error: "poll_secret_required" });
    }

    const pairing = devicePairingService.getPairingForTablet(req.params.token, pollSecret);
    if (!pairing) {
      return res.status(404).json({ error: "not_found" });
    }

    const patient = pairing.patientId ? toPatientSummary(userService.getUserById(pairing.patientId)) : null;

    return res.json({
      pairing,
      patient,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

router.post("/:token/approve", requireJwt, (req, res, next) => {
  try {
    const pairing = devicePairingService.approvePairing(
      req.params.token,
      req.user.id,
      req.body?.sessionTtlSeconds ?? process.env.DEVICE_SESSION_TTL_SECONDS
    );

    if (!pairing) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({
      pairing: toPatientApprovePayload(pairing),
      patient: toPatientSummary(userService.getUserById(req.user.id) || req.user),
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
