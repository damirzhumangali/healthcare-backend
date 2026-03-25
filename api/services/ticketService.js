const { db } = require("../db/sqlite");

const AVG_MINUTES_PER_PATIENT = Number(process.env.AVG_MINUTES_PER_PATIENT) || 3;
const DEFAULT_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || "default";

function nowIso() {
  return new Date().toISOString();
}

function queueDateFromNow() {
  return nowIso().slice(0, 10);
}

function queueKey(clinicId = DEFAULT_CLINIC_ID, queueDate = queueDateFromNow()) {
  return `${clinicId}:${queueDate}`;
}

function ensureQueueState(clinicId = DEFAULT_CLINIC_ID, qDate = queueDateFromNow()) {
  const qKey = queueKey(clinicId, qDate);
  const existing = db
    .prepare("SELECT * FROM queue_state WHERE queueKey = ?")
    .get(qKey);
  if (existing) return existing;

  const created = {
    queueKey: qKey,
    clinicId,
    queueDate: qDate,
    lastTicketNumber: 0,
    nowServingNumber: 0,
    updatedAt: nowIso(),
  };
  db.prepare(
    "INSERT INTO queue_state(queueKey, clinicId, queueDate, lastTicketNumber, nowServingNumber, updatedAt) VALUES (@queueKey, @clinicId, @queueDate, @lastTicketNumber, @nowServingNumber, @updatedAt)"
  ).run(created);
  return created;
}

function normalizeStatus(ticket, servingNow) {
  if (ticket.status === "cancelled" || ticket.status === "passed") return ticket.status;
  if (ticket.ticketNumber > servingNow) return "waiting";
  if (ticket.ticketNumber === servingNow) return "invited";
  return "passed";
}

function enrichTicket(ticket, state) {
  const servingNow = state?.nowServingNumber ?? 0;
  const status = normalizeStatus(ticket, servingNow);
  const peopleAhead = Math.max(0, ticket.ticketNumber - servingNow - 1);
  const etaMinutes = peopleAhead * AVG_MINUTES_PER_PATIENT;
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    status,
    createdAt: ticket.createdAt,
    servingNow,
    peopleAhead,
    etaMinutes,
  };
}

function getMyTicket(userId, clinicId = DEFAULT_CLINIC_ID) {
  const active = db
    .prepare(
      "SELECT * FROM tickets WHERE userId = ? AND clinicId = ? AND status IN ('waiting','invited') ORDER BY createdAt DESC LIMIT 1"
    )
    .get(userId, clinicId);

  const latest =
    active ||
    db.prepare("SELECT * FROM tickets WHERE userId = ? AND clinicId = ? ORDER BY createdAt DESC LIMIT 1").get(userId, clinicId);

  if (!latest) return null;
  const state = ensureQueueState(clinicId, latest.queueDate);
  return enrichTicket(latest, state);
}

const createOrGetMyTicketTx = db.transaction(
  (userId, clinicId = DEFAULT_CLINIC_ID, options = {}) => {
    const forceNew = Boolean(options.forceNew);
  const qDate = queueDateFromNow();
  const state = ensureQueueState(clinicId, qDate);

  const existing = db
    .prepare(
      "SELECT * FROM tickets WHERE userId = ? AND clinicId = ? AND queueDate = ? AND status IN ('waiting','invited') ORDER BY createdAt DESC LIMIT 1"
    )
    .get(userId, clinicId, qDate);

  if (existing && !forceNew) return { ticket: existing, state };

  if (existing && forceNew) {
    db.prepare(
      "UPDATE tickets SET status = 'cancelled', passedAt = COALESCE(passedAt, ?) WHERE id = ?"
    ).run(nowIso(), existing.id);
  }

  const nextNumber = state.lastTicketNumber + 1;
  const t = {
    id: globalThis.crypto.randomUUID(),
    userId,
    clinicId,
    queueDate: qDate,
    queueKey: state.queueKey,
    ticketNumber: nextNumber,
    status: "waiting",
    createdAt: nowIso(),
    calledAt: null,
    passedAt: null,
  };

  db.prepare(
    "INSERT INTO tickets(id, userId, clinicId, queueDate, queueKey, ticketNumber, status, createdAt, calledAt, passedAt) VALUES (@id, @userId, @clinicId, @queueDate, @queueKey, @ticketNumber, @status, @createdAt, @calledAt, @passedAt)"
  ).run(t);

  db.prepare(
    "UPDATE queue_state SET lastTicketNumber = ?, updatedAt = ? WHERE queueKey = ?"
  ).run(nextNumber, nowIso(), state.queueKey);

  const updatedState = db
    .prepare("SELECT * FROM queue_state WHERE queueKey = ?")
    .get(state.queueKey);
    return { ticket: t, state: updatedState };
  }
);

function createOrGetMyTicket(userId, clinicId = DEFAULT_CLINIC_ID, options = {}) {
  const { ticket, state } = createOrGetMyTicketTx(userId, clinicId, options);
  return enrichTicket(ticket, state);
}

const advanceQueueTx = db.transaction((clinicId = DEFAULT_CLINIC_ID) => {
  const qDate = queueDateFromNow();
  const state = ensureQueueState(clinicId, qDate);
  const nextServing = state.nowServingNumber + 1;
  const ts = nowIso();

  db.prepare("UPDATE queue_state SET nowServingNumber = ?, updatedAt = ? WHERE queueKey = ?").run(
    nextServing,
    ts,
    state.queueKey
  );

  db.prepare(
    "UPDATE tickets SET status = 'invited', calledAt = COALESCE(calledAt, ?) WHERE queueKey = ? AND ticketNumber = ? AND status IN ('waiting','invited')"
  ).run(ts, state.queueKey, nextServing);

  db.prepare(
    "UPDATE tickets SET status = 'passed', passedAt = COALESCE(passedAt, ?) WHERE queueKey = ? AND ticketNumber < ? AND status IN ('waiting','invited')"
  ).run(ts, state.queueKey, nextServing);

  return nextServing;
});

function advanceQueue(clinicId = DEFAULT_CLINIC_ID) {
  return advanceQueueTx(clinicId);
}

function passTicket(ticketId, clinicId = DEFAULT_CLINIC_ID) {
  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ? AND clinicId = ?").get(ticketId, clinicId);
  if (!ticket) return null;
  db.prepare("UPDATE tickets SET status = 'passed', passedAt = ? WHERE id = ?").run(nowIso(), ticketId);
  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
}

function getQueue(clinicId = DEFAULT_CLINIC_ID) {
  const qDate = queueDateFromNow();
  const state = ensureQueueState(clinicId, qDate);
  return {
    servingNow: state.nowServingNumber,
    lastTicketNumber: state.lastTicketNumber,
    updatedAt: state.updatedAt,
  };
}

module.exports = {
  createOrGetMyTicket,
  getMyTicket,
  getQueue,
  advanceQueue,
  passTicket,
  DEFAULT_CLINIC_ID,
};
