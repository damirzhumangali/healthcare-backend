const express = require("express");
const { requireJwt } = require("../middleware/auth");
const measurementService = require("../services/measurementService");

const router = express.Router();

router.get("/my", requireJwt, (req, res, next) => {
  try {
    const items = measurementService.listMeasurementsForUser(req.user.id, {
      deviceId: req.query?.deviceId,
      limit: req.query?.limit,
    });
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireJwt, (req, res, next) => {
  try {
    const item = measurementService.createMeasurement({
      ...(req.body || {}),
      user_id: req.user.id,
    });
    return res.status(201).json({ item });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
