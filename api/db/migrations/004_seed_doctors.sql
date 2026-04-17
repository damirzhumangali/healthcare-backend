INSERT OR IGNORE INTO doctors(id, user_id, email, name, specialty, active, created_at, updated_at)
VALUES
  ('doctor-001', NULL, NULL, 'Др. Айжан Нурбекова', 'Терапевт', 1, datetime('now'), datetime('now')),
  ('doctor-002', NULL, NULL, 'Др. Ерлан Садыков', 'Кардиолог', 1, datetime('now'), datetime('now')),
  ('doctor-003', NULL, NULL, 'Др. Мария Ким', 'Невролог', 1, datetime('now'), datetime('now'));
