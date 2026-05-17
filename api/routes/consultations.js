const express = require("express");
const { requireJwt } = require("../middleware/auth");
const telegramConsultationService = require("../services/telegramConsultationService");
const bus = require("../services/eventBus");
const { db } = require("../db/sqlite");

const router = express.Router();

router.use(requireJwt);

router.post("/", (req, res, next) => {
  try {
    const { problem, days, temperature, wants_consultation, requested_at } = req.body || {};

    if (!problem || String(problem).trim().length < 5) {
      return res.status(400).json({ error: "problem_required" });
    }

    const item = telegramConsultationService.createConsultation({
      chat_id: req.user.id,
      patient_id: req.user.id,
      patient_name: req.user.name || req.user.email || "Пациент",
      problem: String(problem).trim(),
      days: days != null ? String(days).trim() : "",
      temperature: temperature != null ? String(temperature).trim() : "",
      wants_consultation: wants_consultation ? true : false,
      requested_at: requested_at || null,
    });

    return res.status(201).json({ item, consultation: item });
  } catch (e) {
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    return next(e);
  }
});

router.get("/my", (req, res, next) => {
  try {
    const items = db
      .prepare(
        `SELECT * FROM telegram_consultations
         WHERE patient_id = ?
         ORDER BY datetime(created_at) DESC`
      )
      .all(req.user.id);
    return res.json({ items, consultations: items });
  } catch (e) {
    return next(e);
  }
});

// SSE: patient subscribes and gets notified the moment admin accepts their consultation
router.get("/stream", requireJwt, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "connected" });

  const patientId = req.user.id;

  const onChange = ({ type, item }) => {
    if (item?.patient_id !== patientId) return;
    send({ type, consultation: item });
  };

  bus.on("telegram_consultation:changed", onChange);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off("telegram_consultation:changed", onChange);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
});

module.exports = router;
