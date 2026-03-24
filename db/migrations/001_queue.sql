CREATE TABLE IF NOT EXISTS queue_state (
  queueKey TEXT PRIMARY KEY,
  clinicId TEXT NOT NULL,
  queueDate TEXT NOT NULL,
  lastTicketNumber INTEGER NOT NULL DEFAULT 0,
  nowServingNumber INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  clinicId TEXT NOT NULL,
  queueDate TEXT NOT NULL,
  queueKey TEXT NOT NULL,
  ticketNumber INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','invited','passed','cancelled')),
  createdAt TEXT NOT NULL,
  calledAt TEXT,
  passedAt TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_queue_ticket_unique
  ON tickets(queueKey, ticketNumber);

CREATE INDEX IF NOT EXISTS idx_tickets_user_created
  ON tickets(userId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_status_created
  ON tickets(status, createdAt DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_user_active
  ON tickets(userId, clinicId, queueDate)
  WHERE status IN ('waiting', 'invited');
