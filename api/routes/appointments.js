const express = require("express");
const { requireJwt } = require("../middleware/auth");
const controller = require("../controllers/appointmentsController");

const router = express.Router();

router.post("/", requireJwt, controller.createAppointment);
router.get("/", requireJwt, controller.listAppointments);
router.patch("/:id/status", requireJwt, controller.updateAppointmentStatus);

module.exports = router;
