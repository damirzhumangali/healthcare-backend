const express = require("express");
const { requireJwt } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/roles");
const { db } = require("../db/sqlite");
const doctorService = require("../services/doctorService");
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

  res.json({
    summary: {
      appointmentsToday,
      appointmentsTotal,
      pending,
      active,
      done,
      doctors,
      patients,
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

module.exports = router;
