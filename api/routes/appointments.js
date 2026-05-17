const express = require("express");
const { requireJwt } = require("../middleware/auth");
const controller = require("../controllers/appointmentsController");
const appointmentService = require("../services/appointmentService");
const doctorService = require("../services/doctorService");
const userService = require("../services/userService");
const bus = require("../services/eventBus");

const router = express.Router();

router.post("/", requireJwt, controller.createAppointment);
router.get("/", requireJwt, controller.listAppointments);
router.patch("/:id/status", requireJwt, controller.updateAppointmentStatus);

// Admin/doctor: assign a doctor (and optionally time/meeting_url) to an appointment
router.patch("/:id/assign", requireJwt, (req, res, next) => {
  try {
    const { doctor_id, time, meeting_url } = req.body ?? {};
    const appointment = appointmentService.assignAppointment(req.params.id, { doctor_id, time, meeting_url });
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

    const appointments = appointmentService.listAppointments({ doctor_id: doctor.id });
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
    if (doctor && item?.doctor_id !== doctor.id) return;
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

module.exports = router;
