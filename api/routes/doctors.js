const express = require("express");
const { requireJwt } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/roles");
const doctorService = require("../services/doctorService");

const router = express.Router();

router.get("/", (req, res, next) => {
  try {
    const includeInactive = req.query?.includeInactive === "1" || req.query?.includeInactive === "true";
    if (includeInactive) {
      return requireJwt(req, res, () =>
        requireAdmin(req, res, () => {
          const doctors = doctorService.listDoctors({ includeInactive: true });
          res.json({ doctors, items: doctors });
        })
      );
    }

    const doctors = doctorService.listDoctors();
    return res.json({ doctors, items: doctors });
  } catch (e) {
    return next(e);
  }
});

router.post("/", requireJwt, requireAdmin, (req, res, next) => {
  try {
    const doctor = doctorService.createDoctor(req.body || {});
    return res.status(201).json({ doctor, item: doctor });
  } catch (e) {
    return next(e);
  }
});

router.patch("/:id", requireJwt, requireAdmin, (req, res, next) => {
  try {
    const doctor = doctorService.updateDoctor(req.params.id, req.body || {});
    if (!doctor) return res.status(404).json({ error: "not_found" });
    return res.json({ doctor, item: doctor });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
