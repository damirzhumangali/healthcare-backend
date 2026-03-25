const express = require("express");
const { requireJwt } = require("../middleware/auth");
const { requireOperator } = require("../middleware/roles");
const controller = require("../controllers/ticketsController");

const router = express.Router();

router.post("/my", requireJwt, controller.createMyTicket);
router.get("/my", requireJwt, controller.getMyTicket);
router.get("/queue", requireJwt, controller.getQueue);
router.post("/advance", requireJwt, requireOperator, controller.advanceQueue);
router.post("/:id/pass", requireJwt, requireOperator, controller.passTicket);

module.exports = router;
