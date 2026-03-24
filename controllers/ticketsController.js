const ticketService = require("../services/ticketService");

function getClinicId(req) {
  return req.body?.clinicId || req.query?.clinicId || ticketService.DEFAULT_CLINIC_ID;
}

function createMyTicket(req, res, next) {
  try {
    const ticket = ticketService.createOrGetMyTicket(req.user.id, getClinicId(req), {
      forceNew: Boolean(req.body?.forceNew),
    });
    return res.status(200).json({ ticket });
  } catch (e) {
    if (String(e?.message || "").includes("idx_tickets_user_active")) {
      return res.status(409).json({ error: "active_ticket_conflict" });
    }
    return next(e);
  }
}

function getMyTicket(req, res, next) {
  try {
    const ticket = ticketService.getMyTicket(req.user.id, getClinicId(req));
    return res.status(200).json({ ticket: ticket || null });
  } catch (e) {
    return next(e);
  }
}

function getQueue(req, res, next) {
  try {
    const queue = ticketService.getQueue(getClinicId(req));
    return res.status(200).json(queue);
  } catch (e) {
    return next(e);
  }
}

function advanceQueue(req, res, next) {
  try {
    const servingNow = ticketService.advanceQueue(getClinicId(req));
    return res.status(200).json({ servingNow });
  } catch (e) {
    return next(e);
  }
}

function passTicket(req, res, next) {
  try {
    const ticket = ticketService.passTicket(req.params.id, getClinicId(req));
    if (!ticket) return res.status(404).json({ error: "not_found" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  createMyTicket,
  getMyTicket,
  getQueue,
  advanceQueue,
  passTicket,
};
