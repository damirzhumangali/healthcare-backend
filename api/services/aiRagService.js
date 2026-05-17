const {
  listConversationHistory,
  saveConversation,
  searchKnowledgeBase,
} = require("./aiKnowledgeBaseService");
const { DISCLAIMER, NO_DATA_MESSAGE } = require("./aiConfig");
const { ensureDisclaimer, generateEmbedding, generateMedicalAnswer } = require("./aiOllamaService");

function buildContext({ medicines, diseases }) {
  const sections = [];

  if (medicines.length) {
    sections.push(
      [
        "Медикаменты:",
        ...medicines.map((medicine, index) =>
          [
            `${index + 1}. ${medicine.name}`,
            medicine.category ? `Категория: ${medicine.category}` : "",
            medicine.treats_diseases.length
              ? `Показания: ${medicine.treats_diseases.join(", ")}`
              : "",
            medicine.dosage_adult ? `Взрослым: ${medicine.dosage_adult}` : "",
            medicine.dosage_child ? `Детям: ${medicine.dosage_child}` : "",
            medicine.dosage_elderly ? `Пожилым: ${medicine.dosage_elderly}` : "",
            medicine.contraindications ? `Противопоказания: ${medicine.contraindications}` : "",
            medicine.side_effects ? `Побочные эффекты: ${medicine.side_effects}` : "",
            medicine.compatible_with.length
              ? `Совместимо с: ${medicine.compatible_with.join(", ")}`
              : "",
            medicine.incompatible_with.length
              ? `Несовместимо с: ${medicine.incompatible_with.join(", ")}`
              : "",
            medicine.description ? `Описание: ${medicine.description}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        ),
      ].join("\n\n")
    );
  }

  if (diseases.length) {
    sections.push(
      [
        "Заболевания:",
        ...diseases.map((disease, index) =>
          [
            `${index + 1}. ${disease.name}`,
            disease.icd10_code ? `МКБ-10: ${disease.icd10_code}` : "",
            disease.symptoms.length ? `Симптомы: ${disease.symptoms.join(", ")}` : "",
            disease.recommended_medicines.length
              ? `Рекомендуемые препараты: ${disease.recommended_medicines.join(", ")}`
              : "",
            disease.doctor_specialization
              ? `Специализация врача: ${disease.doctor_specialization}`
              : "",
            disease.urgency_level ? `Срочность: ${disease.urgency_level}` : "",
            disease.description ? `Описание: ${disease.description}` : "",
            disease.treatment_protocol ? `Протокол: ${disease.treatment_protocol}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        ),
      ].join("\n\n")
    );
  }

  return sections.join("\n\n");
}

function uniqueSources({ medicines, diseases }) {
  return [...new Set([...medicines.map((item) => item.name), ...diseases.map((item) => item.name)])];
}

function fallbackAnswer() {
  return ensureDisclaimer(NO_DATA_MESSAGE);
}

async function askMedicalAssistant({ patientId, question }) {
  const normalizedPatientId = String(patientId || "").trim();
  const normalizedQuestion = String(question || "").trim();
  if (!normalizedPatientId) {
    const error = new Error("patient_id_required");
    error.statusCode = 400;
    throw error;
  }
  if (!normalizedQuestion) {
    const error = new Error("question_required");
    error.statusCode = 400;
    throw error;
  }

  const questionEmbedding = await generateEmbedding(normalizedQuestion, "search_query");
  const searchResults = await searchKnowledgeBase(questionEmbedding, normalizedQuestion);
  const sources = uniqueSources(searchResults);

  if (sources.length === 0) {
    const answer = fallbackAnswer();
    await saveConversation({
      patientId: normalizedPatientId,
      question: normalizedQuestion,
      answer,
      sourcesUsed: [],
    });

    return {
      answer,
      disclaimer: DISCLAIMER,
      sources: [],
    };
  }

  const context = buildContext(searchResults);
  const answer = await generateMedicalAnswer({
    context,
    question: normalizedQuestion,
  });

  await saveConversation({
    patientId: normalizedPatientId,
    question: normalizedQuestion,
    answer,
    sourcesUsed: sources,
  });

  return {
    answer,
    disclaimer: DISCLAIMER,
    sources,
  };
}

async function getConversationHistory(patientId) {
  const normalizedPatientId = String(patientId || "").trim();
  if (!normalizedPatientId) {
    const error = new Error("patient_id_required");
    error.statusCode = 400;
    throw error;
  }

  const history = await listConversationHistory(normalizedPatientId);
  return history.map((item) => ({
    ...item,
    disclaimer: DISCLAIMER,
  }));
}

module.exports = {
  askMedicalAssistant,
  buildContext,
  getConversationHistory,
};
