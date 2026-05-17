const express = require("express");
const { requireJwt } = require("../middleware/auth");
const controller = require("../controllers/appointmentsController");
const appointmentService = require("../services/appointmentService");
const doctorService = require("../services/doctorService");
const userService = require("../services/userService");
const bus = require("../services/eventBus");
const { sendMeetingLink } = require("../services/emailService");

const router = express.Router();

router.post("/", requireJwt, controller.createAppointment);
router.get("/", requireJwt, controller.listAppointments);
router.patch("/:id/status", requireJwt, controller.updateAppointmentStatus);

// Admin/doctor: assign a doctor (and optionally time/meeting_url) to an appointment
router.patch("/:id/assign", requireJwt, (req, res, next) => {
  try {
    const { doctor_id, date, time, meeting_url, meeting_at, meeting_notified, room_label } = req.body ?? {};
    const appointment = appointmentService.assignAppointment(req.params.id, {
      doctor_id,
      date,
      time,
      meeting_url,
      meeting_at,
      meeting_notified,
      room_label,
    });
    if (!appointment) return res.status(404).json({ error: "not_found" });
    return res.json({ appointment, item: appointment });
  } catch (e) {
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    return next(e);
  }
});

// Patient-facing: own appointments with doctor info and meeting link
router.get("/my", requireJwt, (req, res, next) => {
  try {
    const appointments = appointmentService.listAppointments({ patient_id: req.user.id });
    const doctors = doctorService.listDoctors({ includeInactive: true });
    const doctorMap = Object.fromEntries(doctors.map(d => [d.id, d]));

    const items = appointments.map(a => ({
      ...a,
      doctor: doctorMap[a.doctor_id] || null,
    }));

    return res.json({ items, appointments: items });
  } catch (e) {
    return next(e);
  }
});

// Doctor-facing: appointments where doctor_id matches the logged-in doctor
// Also used by doctor portal to see their schedule with meeting links
router.get("/my-schedule", requireJwt, (req, res, next) => {
  try {
    const doctor = doctorService.getDoctorForUser(req.user);
    if (!doctor) return res.json({ items: [], appointments: [] });

    const sharedDoctorPortal = doctorService.shouldDoctorSeeAllAppointments(req.user);
    const appointments = sharedDoctorPortal
      ? appointmentService.listAppointments({})
      : appointmentService.listAppointments({ doctor_id: doctor.id });
    const patients = userService.listPatients ? userService.listPatients() : [];
    const patientMap = Object.fromEntries(patients.map(p => [p.id, p]));

    const items = appointments.map(a => ({
      ...a,
      patient_name: patientMap[a.patient_id]?.name || patientMap[a.patient_id]?.email || null,
    }));

    return res.json({ items, appointments: items });
  } catch (e) {
    return next(e);
  }
});

// SSE: doctor gets notified when a new appointment is assigned to them
router.get("/stream", requireJwt, (req, res, next) => {
  const doctor = doctorService.getDoctorForUser(req.user);
  const sharedDoctorPortal = doctorService.shouldDoctorSeeAllAppointments(req.user);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "connected" });

  const onChange = ({ type, item }) => {
    if (!sharedDoctorPortal && doctor && item?.doctor_id !== doctor.id) return;
    send({ type, appointment: item });
  };

  bus.on("appointment:changed", onChange);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off("appointment:changed", onChange);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
});

router.post("/:id/notify-online", requireJwt, async (req, res, next) => {
  try {
    const existing = appointmentService.listAppointments({}).find((item) => item.id === req.params.id);
    if (!existing) return res.status(404).json({ error: "not_found" });

    const meetingUrl = String(req.body?.meeting_url || "").trim() || existing.meeting_url;
    const meetingAt = String(req.body?.meeting_at || "").trim() || existing.meeting_at;
    const updated = appointmentService.assignAppointment(req.params.id, {
      meeting_url: meetingUrl,
      meeting_at: meetingAt,
      meeting_notified: true,
    });
    if (!updated) return res.status(404).json({ error: "not_found" });

    const doctor = updated.doctor_id ? doctorService.listDoctors({ includeInactive: true }).find((d) => d.id === updated.doctor_id) : null;
    const patientUser = updated.patient_id ? userService.getUserById(updated.patient_id) : null;

    const sharedArgs = {
      meetingUrl,
      meetingAt,
      doctorName: doctor?.name || updated.doctor_id || "Врач",
      patientName: patientUser?.name || patientUser?.email || updated.patient_id || "Пациент",
      problem: updated.reason || null,
      days: null,
      temperature: null,
    };

    let notified = false;
    const tasks = [];

    if (patientUser?.email && meetingUrl) {
      tasks.push(
        sendMeetingLink({
          ...sharedArgs,
          toEmail: patientUser.email,
          toName: sharedArgs.patientName,
          role: "patient",
        }).then(() => {
          notified = true;
        }),
      );
    }

    if (doctor?.email && meetingUrl) {
      tasks.push(
        sendMeetingLink({
          ...sharedArgs,
          toEmail: doctor.email,
          toName: doctor.name,
          role: "doctor",
        }).then(() => {
          notified = true;
        }),
      );
    }

    await Promise.allSettled(tasks);

    if (!notified) {
      const adminEmail = process.env.EMAIL_USER;
      if (adminEmail && meetingUrl) {
        await sendMeetingLink({
          ...sharedArgs,
          toEmail: adminEmail,
          toName: "Администратор",
          role: "doctor",
        }).catch(() => {});
      }
    }

    return res.json({
      item: updated,
      appointment: updated,
      notified,
      notify_error: notified ? null : "no_recipients_or_mail_failed",
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
