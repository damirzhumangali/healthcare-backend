const express = require("express");
const {
  listDiseases,
  listMedicines,
  seedKnowledgeBase,
  upsertDisease,
  upsertMedicine,
} = require("../services/aiKnowledgeBaseService");
const { askMedicalAssistant, getConversationHistory } = require("../services/aiRagService");
const { analyzeVitals } = require("../services/aiVitalsService");

const router = express.Router();

// POST /api/ai/vitals-advice
// Body: { tempC, hr, systolic, diastolic, spo2, medication: [{compartment, drug, dosage, instruction}] }
router.post("/vitals-advice", async (req, res, next) => {
  try {
    const { tempC, hr, systolic, diastolic, spo2, medication } = req.body || {};
    if (tempC == null && hr == null) {
      return res.status(400).json({ error: "Нужны хотя бы температура или пульс" });
    }
    const result = await analyzeVitals({ tempC, hr, systolic, diastolic, spo2, medication: medication ?? [] });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/ask", async (req, res, next) => {
  try {
    const { question, patient_id: patientId } = req.body || {};
    const result = await askMedicalAssistant({ patientId, question });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/history/:patient_id", async (req, res, next) => {
  try {
    const history = await getConversationHistory(req.params.patient_id);
    return res.json({ history, items: history });
  } catch (error) {
    return next(error);
  }
});

router.post("/seed", async (req, res, next) => {
  try {
    const result = await seedKnowledgeBase({
      reset: req.body?.reset === true,
    });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/medicines", async (req, res, next) => {
  try {
    const medicines = await listMedicines();
    return res.json({ medicines, items: medicines });
  } catch (error) {
    return next(error);
  }
});

router.get("/diseases", async (req, res, next) => {
  try {
    const diseases = await listDiseases();
    return res.json({ diseases, items: diseases });
  } catch (error) {
    return next(error);
  }
});

router.post("/medicines", async (req, res, next) => {
  try {
    const medicine = await upsertMedicine(req.body || {});
    return res.status(201).json({ medicine, item: medicine });
  } catch (error) {
    return next(error);
  }
});

router.post("/diseases", async (req, res, next) => {
  try {
    const disease = await upsertDisease(req.body || {});
    return res.status(201).json({ disease, item: disease });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
