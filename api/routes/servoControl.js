const express = require("express");
const { requireJwt } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/roles");

const router = express.Router();

const deviceStates = new Map();   // deviceId → { isOpen, angle, updatedAt }
const pendingCommands = new Map(); // deviceId → "open" | "close"

function checkDeviceSecret(req) {
  const expected = String(process.env.SERVO_DEVICE_SECRET || "").trim();
  if (!expected) return false;
  const provided = String(
    req.headers["x-device-secret"] || req.query?.secret || ""
  ).trim();
  return provided === expected;
}

// Admin: get current state of all devices
router.get("/state", requireJwt, requireAdmin, (req, res) => {
  const states = {};
  for (const [id, state] of deviceStates.entries()) {
    states[id] = state;
  }
  return res.json({ states });
});

// Admin: queue a command for a device
router.post("/command", requireJwt, requireAdmin, (req, res) => {
  const deviceId = String(req.body?.deviceId || "").trim();
  const command = String(req.body?.command || "").trim();

  if (!deviceId) return res.status(400).json({ error: "device_id_required" });
  if (command !== "open" && command !== "close") {
    return res.status(400).json({ error: "invalid_command" });
  }

  pendingCommands.set(deviceId, command);
  return res.json({ ok: true, deviceId, command });
});

// ESP32: poll for a pending command (consumes it on read)
router.get("/poll", (req, res) => {
  if (!checkDeviceSecret(req)) return res.status(401).json({ error: "unauthorized" });

  const deviceId = String(req.query?.deviceId || "").trim();
  if (!deviceId) return res.status(400).json({ error: "device_id_required" });

  const command = pendingCommands.get(deviceId) || null;
  if (command) pendingCommands.delete(deviceId);

  return res.json({ command });
});

// ESP32: report current state after executing a command
router.post("/state", (req, res) => {
  if (!checkDeviceSecret(req)) return res.status(401).json({ error: "unauthorized" });

  const deviceId = String(req.body?.deviceId || "").trim();
  if (!deviceId) return res.status(400).json({ error: "device_id_required" });

  deviceStates.set(deviceId, {
    isOpen: Boolean(req.body?.isOpen),
    angle: Number(req.body?.angle ?? 0),
    updatedAt: new Date().toISOString(),
  });

  return res.json({ ok: true });
});

module.exports = router;
