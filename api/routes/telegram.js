const express = require("express");
const telegramConsultationService = require("../services/telegramConsultationService");

const router = express.Router();

function requireTelegramSecret(req, res, next) {
  const configuredSecret = String(process.env.TELEGRAM_INGEST_SECRET || "").trim();
  const incomingSecret = String(req.headers["x-bot-secret"] || "").trim();

  if (!configuredSecret) {
    return res.status(503).json({ error: "bot_ingest_not_configured" });
  }

  if (!incomingSecret || incomingSecret !== configuredSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return next();
}

router.post("/consultations", requireTelegramSecret, (req, res, next) => {
  try {
    const item = telegramConsultationService.createConsultation(req.body || {});
    return res.status(201).json({ item, consultation: item });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
