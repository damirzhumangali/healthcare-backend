const appointmentService = require("../services/appointmentService");
const doctorService = require("../services/doctorService");
const userService = require("../services/userService");

function handleServiceError(error, next, res) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  return next(error);
}

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function resolveAuthUserId(user) {
  if (!user) return "";

  return (
    normalizeText(user.id) ||
    normalizeText(user.user_id) ||
    normalizeText(user.userId) ||
    normalizeText(user.sub) ||
    normalizeText(user.email)
  );
}

function resolvePatientId(req) {
  return (
    normalizeText(req.body?.patient_id) ||
    normalizeText(req.body?.patientId) ||
    resolveAuthUserId(req.user)
  );
}

function createAppointment(req, res, next) {
  try {
    const appointment = appointmentService.createAppointment({
      ...req.body,
      doctor_id: req.body?.doctor_id || req.body?.doctorId,
      patient_id: resolvePatientId(req),
    });
    return res.status(201).json({ appointment, item: appointment });
  } catch (e) {
    if (e?.statusCode === 400) {
      console.warn(
        "appointment_create_rejected:",
        JSON.stringify({
          error: e.message,
          details: e.details || null,
          hasResolvedPatientId: Boolean(resolvePatientId(req)),
          hasDate: Boolean(normalizeText(req.body?.date)),
          hasTime: Boolean(normalizeText(req.body?.time)),
          userKeys: Object.keys(req.user || {}),
        })
      );
    }
    return handleServiceError(e, next, res);
  }
}

function listAppointments(req, res, next) {
  try {
    const canSeeAll =
      req.user?.role === "admin" ||
      req.user?.role === "operator" ||
      String(process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
        .includes(String(req.user?.email || "").toLowerCase());

    const doctor = req.user?.role === "doctor" ? doctorService.getDoctorForUser(req.user) : null;
    const sharedDoctorPortal =
      req.user?.role === "doctor" && doctorService.shouldDoctorSeeAllAppointments(req.user);
    const authUserId = resolveAuthUserId(req.user);
    const doctorId =
      req.query?.doctor_id ||
      req.query?.doctorId ||
      (canSeeAll || sharedDoctorPortal ? null : doctor?.id || null);
    const patientId =
      req.query?.patient_id ||
      req.query?.patientId ||
      (canSeeAll || doctor || sharedDoctorPortal ? null : authUserId || null);

    const appointments = appointmentService.listAppointments({
      doctor_id: doctorId,
      patient_id: patientId,
      date: req.query?.date,
    });
    const patients = userService.listPatients ? userService.listPatients() : [];
    const patientMap = new Map(
      patients.map((patient) => [
        patient.id,
        {
          name: patient.name || null,
          email: patient.email || null,
        },
      ])
    );
    const items = appointments.map((appointment) => {
      const patient = patientMap.get(appointment.patient_id);
      return {
        ...appointment,
        patient_name: patient?.name || patient?.email || appointment.patient_name || null,
      };
    });
    return res.status(200).json({ appointments: items, items });
  } catch (e) {
    return handleServiceError(e, next, res);
  }
}

function updateAppointmentStatus(req, res, next) {
  try {
    const appointment = appointmentService.updateAppointmentStatus(
      req.params.id,
      req.body?.status
    );
    if (!appointment) return res.status(404).json({ error: "not_found" });
    return res.status(200).json({ appointment, item: appointment });
  } catch (e) {
    return handleServiceError(e, next, res);
  }
}

module.exports = {
  createAppointment,
  listAppointments,
  updateAppointmentStatus,
};
