const express = require("express");
const { timingSafeEqual } = require("crypto");
const telegramConsultationService = require("../services/telegramConsultationService");

const router = express.Router();

function safeSecretsEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireTelegramSecret(req, res, next) {
  const configuredSecret = String(process.env.TELEGRAM_INGEST_SECRET || "").trim();
  const incomingSecret = String(req.headers["x-bot-secret"] || "").trim();

  if (!configuredSecret) {
    return res.status(503).json({ error: "bot_ingest_not_configured" });
  }

  if (!safeSecretsEqual(incomingSecret, configuredSecret)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return next();
}

router.post("/consultations", requireTelegramSecret, (req, res, next) => {
  try {
    const body = req.body || {};
    const wantsConsultationRaw = body.wants_consultation;
    const wantsConsultation =
      wantsConsultationRaw === true ||
      wantsConsultationRaw === 1 ||
      wantsConsultationRaw === "1" ||
      wantsConsultationRaw === "true";

    const item = telegramConsultationService.createConsultation({
      ...body,
      wants_consultation: wantsConsultation,
      requested_at: body.requested_at,
    });
    return res.status(201).json({ item, consultation: item });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
