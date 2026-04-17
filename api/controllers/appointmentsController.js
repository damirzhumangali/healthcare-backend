const appointmentService = require("../services/appointmentService");

function handleServiceError(error, next, res) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  return next(error);
}

function createAppointment(req, res, next) {
  try {
    const appointment = appointmentService.createAppointment({
      ...req.body,
      doctor_id: req.body?.doctor_id || req.body?.doctorId,
      patient_id: req.body?.patient_id || req.user.id,
    });
    return res.status(201).json({ appointment, item: appointment });
  } catch (e) {
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

    const appointments = appointmentService.listAppointments({
      doctor_id: req.query?.doctor_id || req.query?.doctorId || (canSeeAll ? null : req.user.id),
      date: req.query?.date,
    });
    return res.status(200).json({ appointments, items: appointments });
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
