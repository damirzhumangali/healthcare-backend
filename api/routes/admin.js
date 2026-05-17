const express = require("express");
const { requireJwt, requireJwtFromQuery } = require("../middleware/auth");
const { requireAdmin, isAdminUser } = require("../middleware/roles");
const { db } = require("../db/sqlite");
const doctorService = require("../services/doctorService");
const telegramConsultationService = require("../services/telegramConsultationService");
const appointmentService = require("../services/appointmentService");
const userService = require("../services/userService");
const bus = require("../services/eventBus");

const router = express.Router();

// SSE endpoint must be registered BEFORE the requireJwt middleware that
// expects Authorization headers, because EventSource cannot send headers —
// it uses ?token= query param instead.
router.get(
  "/telegram-consultations/stream",
  requireJwtFromQuery,
  (req, res) => {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ error: "forbidden" });
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: "connected", at: new Date().toISOString() });

    const onChange = (event) => send(event);
    bus.on("telegram_consultation:changed", onChange);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      bus.off("telegram_consultation:changed", onChange);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
  }
);

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
    const doctorId = String(req.body?.doctor_id || "").trim() || null;

    const item = telegramConsultationService.acceptConsultation(
      req.params.id,
      req.body?.meeting_at,
      doctorId
    );

    if (!item) {
      return res.status(404).json({ error: "not_found" });
    }

    // Create appointment so the doctor's schedule shows this slot as busy
    // Use the same meeting_url as the consultation so patient and doctor get identical link
    let appointment = null;
    if (doctorId && item.meeting_at) {
      try {
        const meetingDate = new Date(item.meeting_at);
        const dateStr = meetingDate.toISOString().slice(0, 10);
        const timeStr = meetingDate.toLocaleTimeString("ru-RU", {
          timeZone: "Asia/Almaty",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        appointment = appointmentService.createAppointment({
          patient_id: item.patient_id || `web_${item.chat_id}`,
          doctor_id: doctorId,
          date: dateStr,
          time: timeStr,
          reason: item.problem || "Онлайн-консультация",
          status: "active",
          meeting_url: item.meeting_url,
        });
      } catch (apptErr) {
        console.error("appointment_create_failed:", apptErr?.message || apptErr);
      }
    }

    return res.status(200).json({
      item,
      consultation: item,
      appointment,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
