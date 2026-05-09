const express = require("express");
const { requireJwt } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/roles");
const { db } = require("../db/sqlite");
const doctorService = require("../services/doctorService");
const telegramConsultationService = require("../services/telegramConsultationService");
const telegramNotifyService = require("../services/telegramNotifyService");
const userService = require("../services/userService");

const router = express.Router();

router.use(requireJwt, requireAdmin);

router.get("/summary", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const appointmentsToday = db
    .prepare("SELECT COUNT(*) AS value FROM appointments WHERE date = ?")
    .get(today).value;
  const appointmentsTotal = db.prepare("SELECT COUNT(*) AS value FROM appointments").get().value;
  const pending = db.prepare("SELECT COUNT(*) AS value FROM appointments WHERE status = 'pending'").get().value;
  const active = db.prepare("SELECT COUNT(*) AS value FROM appointments WHERE status = 'active'").get().value;
  const done = db.prepare("SELECT COUNT(*) AS value FROM appointments WHERE status = 'done'").get().value;
  const doctors = db.prepare("SELECT COUNT(*) AS value FROM doctors WHERE active = 1").get().value;
  const patients = userService.listPatients().length;
  const telegramNew = db
    .prepare("SELECT COUNT(*) AS value FROM telegram_consultations WHERE status = 'new'")
    .get().value;

  res.json({
    summary: {
      appointmentsToday,
      appointmentsTotal,
      pending,
      active,
      done,
      doctors,
      patients,
      telegramNew,
    },
  });
});

router.get("/patients", (req, res) => {
  const patients = userService.listPatients();
  res.json({ patients, items: patients });
});

router.get("/doctors", (req, res) => {
  const doctors = doctorService.listDoctors({ includeInactive: true });
  res.json({ doctors, items: doctors });
});

router.get("/telegram-consultations", (req, res) => {
  const items = telegramConsultationService.listConsultations();
  res.json({ items, consultations: items });
});

router.patch("/telegram-consultations/:id/status", (req, res, next) => {
  try {
    const item = telegramConsultationService.updateConsultationStatus(
      req.params.id,
      req.body?.status
    );

    if (!item) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.status(200).json({ item, consultation: item });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

router.post("/telegram-consultations/:id/accept", async (req, res, next) => {
  try {
    const item = telegramConsultationService.acceptConsultation(
      req.params.id,
      req.body?.meeting_at
    );

    if (!item) {
      return res.status(404).json({ error: "not_found" });
    }

    let notified = false;
    let notifyError = null;
    try {
      await telegramNotifyService.sendBotMessage(
        item.chat_id,
        telegramNotifyService.formatMeetingMessage({
          patientName: item.patient_name,
          meetingUrl: item.meeting_url,
          meetingAt: item.meeting_at,
        })
      );
      notified = true;
    } catch (error) {
      notifyError = error?.message || "telegram_send_failed";
      console.error("telegram_notify_failed:", notifyError, error?.details || "");
    }

    return res.status(200).json({ item, consultation: item, notified, notify_error: notifyError });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
