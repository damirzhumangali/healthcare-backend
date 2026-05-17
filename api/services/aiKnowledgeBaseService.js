const pgvector = require("pgvector");
const { diseases: diseaseSeedData, medicines: medicineSeedData } = require("../data/aiKnowledgeBase");
const { query } = require("../db/postgres");
const { AI_SEARCH_LIMIT, AI_SEARCH_MAX_DISTANCE } = require("./aiConfig");
const { generateEmbedding } = require("./aiOllamaService");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeMedicinePayload(payload = {}) {
  return {
    name: normalizeText(payload.name),
    category: normalizeOptionalText(payload.category),
    treats_diseases: normalizeStringArray(payload.treats_diseases),
    dosage_adult: normalizeOptionalText(payload.dosage_adult),
    dosage_child: normalizeOptionalText(payload.dosage_child),
    dosage_elderly: normalizeOptionalText(payload.dosage_elderly),
    contraindications: normalizeOptionalText(payload.contraindications),
    side_effects: normalizeOptionalText(payload.side_effects),
    compatible_with: normalizeStringArray(payload.compatible_with),
    incompatible_with: normalizeStringArray(payload.incompatible_with),
    description: normalizeOptionalText(payload.description),
  };
}

function normalizeDiseasePayload(payload = {}) {
  return {
    name: normalizeText(payload.name),
    icd10_code: normalizeOptionalText(payload.icd10_code),
    symptoms: normalizeStringArray(payload.symptoms),
    recommended_medicines: normalizeStringArray(payload.recommended_medicines),
    doctor_specialization: normalizeOptionalText(payload.doctor_specialization),
    urgency_level: normalizeOptionalText(payload.urgency_level),
    description: normalizeOptionalText(payload.description),
    treatment_protocol: normalizeOptionalText(payload.treatment_protocol),
  };
}

function assertRequiredName(itemType, value) {
  if (!value) {
    const error = new Error(`${itemType}_name_required`);
    error.statusCode = 400;
    throw error;
  }
}

function buildMedicineEmbeddingText(medicine) {
  return [
    `Название: ${medicine.name}`,
    medicine.category ? `Категория: ${medicine.category}` : "",
    medicine.treats_diseases.length
      ? `Применяется при: ${medicine.treats_diseases.join(", ")}`
      : "",
    medicine.dosage_adult ? `Дозировка взрослым: ${medicine.dosage_adult}` : "",
    medicine.dosage_child ? `Дозировка детям: ${medicine.dosage_child}` : "",
    medicine.dosage_elderly ? `Дозировка пожилым: ${medicine.dosage_elderly}` : "",
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
    .join("\n");
}

function buildDiseaseEmbeddingText(disease) {
  return [
    `Заболевание: ${disease.name}`,
    disease.icd10_code ? `Код МКБ-10: ${disease.icd10_code}` : "",
    disease.symptoms.length ? `Симптомы: ${disease.symptoms.join(", ")}` : "",
    disease.recommended_medicines.length
      ? `Рекомендуемые препараты: ${disease.recommended_medicines.join(", ")}`
      : "",
    disease.doctor_specialization ? `Специалист: ${disease.doctor_specialization}` : "",
    disease.urgency_level ? `Срочность: ${disease.urgency_level}` : "",
    disease.description ? `Описание: ${disease.description}` : "",
    disease.treatment_protocol ? `Протокол: ${disease.treatment_protocol}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeMedicineRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    treats_diseases: row.treats_diseases || [],
    dosage_adult: row.dosage_adult,
    dosage_child: row.dosage_child,
    dosage_elderly: row.dosage_elderly,
    contraindications: row.contraindications,
    side_effects: row.side_effects,
    compatible_with: row.compatible_with || [],
    incompatible_with: row.incompatible_with || [],
    description: row.description,
  };
}

function serializeDiseaseRow(row) {
  return {
    id: row.id,
    name: row.name,
    icd10_code: row.icd10_code,
    symptoms: row.symptoms || [],
    recommended_medicines: row.recommended_medicines || [],
    doctor_specialization: row.doctor_specialization,
    urgency_level: row.urgency_level,
    description: row.description,
    treatment_protocol: row.treatment_protocol,
  };
}

async function upsertMedicine(payload) {
  const medicine = normalizeMedicinePayload(payload);
  assertRequiredName("medicine", medicine.name);

  const embedding = await generateEmbedding(buildMedicineEmbeddingText(medicine), "search_document");
  const result = await query(
    `INSERT INTO medicines (
      name,
      category,
      treats_diseases,
      dosage_adult,
      dosage_child,
      dosage_elderly,
      contraindications,
      side_effects,
      compatible_with,
      incompatible_with,
      description,
      embedding
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    )
    ON CONFLICT (name) DO UPDATE SET
      category = EXCLUDED.category,
      treats_diseases = EXCLUDED.treats_diseases,
      dosage_adult = EXCLUDED.dosage_adult,
      dosage_child = EXCLUDED.dosage_child,
      dosage_elderly = EXCLUDED.dosage_elderly,
      contraindications = EXCLUDED.contraindications,
      side_effects = EXCLUDED.side_effects,
      compatible_with = EXCLUDED.compatible_with,
      incompatible_with = EXCLUDED.incompatible_with,
      description = EXCLUDED.description,
      embedding = EXCLUDED.embedding
    RETURNING
      id,
      name,
      category,
      treats_diseases,
      dosage_adult,
      dosage_child,
      dosage_elderly,
      contraindications,
      side_effects,
      compatible_with,
      incompatible_with,
      description`,
    [
      medicine.name,
      medicine.category,
      medicine.treats_diseases,
      medicine.dosage_adult,
      medicine.dosage_child,
      medicine.dosage_elderly,
      medicine.contraindications,
      medicine.side_effects,
      medicine.compatible_with,
      medicine.incompatible_with,
      medicine.description,
      pgvector.toSql(embedding),
    ]
  );

  return serializeMedicineRow(result.rows[0]);
}

async function upsertDisease(payload) {
  const disease = normalizeDiseasePayload(payload);
  assertRequiredName("disease", disease.name);

  const embedding = await generateEmbedding(buildDiseaseEmbeddingText(disease), "search_document");
  const result = await query(
    `INSERT INTO diseases (
      name,
      icd10_code,
      symptoms,
      recommended_medicines,
      doctor_specialization,
      urgency_level,
      description,
      treatment_protocol,
      embedding
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    )
    ON CONFLICT (name) DO UPDATE SET
      icd10_code = EXCLUDED.icd10_code,
      symptoms = EXCLUDED.symptoms,
      recommended_medicines = EXCLUDED.recommended_medicines,
      doctor_specialization = EXCLUDED.doctor_specialization,
      urgency_level = EXCLUDED.urgency_level,
      description = EXCLUDED.description,
      treatment_protocol = EXCLUDED.treatment_protocol,
      embedding = EXCLUDED.embedding
    RETURNING
      id,
      name,
      icd10_code,
      symptoms,
      recommended_medicines,
      doctor_specialization,
      urgency_level,
      description,
      treatment_protocol`,
    [
      disease.name,
      disease.icd10_code,
      disease.symptoms,
      disease.recommended_medicines,
      disease.doctor_specialization,
      disease.urgency_level,
      disease.description,
      disease.treatment_protocol,
      pgvector.toSql(embedding),
    ]
  );

  return serializeDiseaseRow(result.rows[0]);
}

async function listMedicines() {
  const result = await query(
    `SELECT
      id,
      name,
      category,
      treats_diseases,
      dosage_adult,
      dosage_child,
      dosage_elderly,
      contraindications,
      side_effects,
      compatible_with,
      incompatible_with,
      description
     FROM medicines
     ORDER BY name ASC`
  );
  return result.rows.map(serializeMedicineRow);
}

async function listDiseases() {
  const result = await query(
    `SELECT
      id,
      name,
      icd10_code,
      symptoms,
      recommended_medicines,
      doctor_specialization,
      urgency_level,
      description,
      treatment_protocol
     FROM diseases
     ORDER BY name ASC`
  );
  return result.rows.map(serializeDiseaseRow);
}

function keywordSetFromRow(row) {
  const tokens = [];
  tokens.push(row.name);

  if (Array.isArray(row.symptoms)) tokens.push(...row.symptoms);
  if (Array.isArray(row.recommended_medicines)) tokens.push(...row.recommended_medicines);
  if (Array.isArray(row.treats_diseases)) tokens.push(...row.treats_diseases);
  if (Array.isArray(row.compatible_with)) tokens.push(...row.compatible_with);
  if (Array.isArray(row.incompatible_with)) tokens.push(...row.incompatible_with);

  if (row.category) tokens.push(row.category);
  if (row.description) tokens.push(row.description);

  return tokens
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean);
}

function isRelevantToQuestion(question, row) {
  const normalizedQuestion = normalizeText(question).toLowerCase();
  if (!normalizedQuestion) return false;
  if (Number(row.distance) <= AI_SEARCH_MAX_DISTANCE) return true;

  return keywordSetFromRow(row).some((token) => {
    if (token.length < 3) return false;
    return normalizedQuestion.includes(token) || token.includes(normalizedQuestion);
  });
}

async function searchKnowledgeBase(questionEmbedding, question) {
  const embeddingSql = pgvector.toSql(questionEmbedding);
  const [medicinesResult, diseasesResult] = await Promise.all([
    query(
      `SELECT
        id,
        name,
        category,
        treats_diseases,
        dosage_adult,
        dosage_child,
        dosage_elderly,
        contraindications,
        side_effects,
        compatible_with,
        incompatible_with,
        description,
        embedding <-> $1 AS distance
       FROM medicines
       ORDER BY embedding <-> $1
       LIMIT $2`,
      [embeddingSql, AI_SEARCH_LIMIT]
    ),
    query(
      `SELECT
        id,
        name,
        icd10_code,
        symptoms,
        recommended_medicines,
        doctor_specialization,
        urgency_level,
        description,
        treatment_protocol,
        embedding <-> $1 AS distance
       FROM diseases
       ORDER BY embedding <-> $1
       LIMIT $2`,
      [embeddingSql, AI_SEARCH_LIMIT]
    ),
  ]);

  const medicines = medicinesResult.rows
    .filter((row) => isRelevantToQuestion(question, row))
    .map((row) => ({ ...serializeMedicineRow(row), distance: Number(row.distance) }));
  const diseases = diseasesResult.rows
    .filter((row) => isRelevantToQuestion(question, row))
    .map((row) => ({ ...serializeDiseaseRow(row), distance: Number(row.distance) }));

  return { medicines, diseases };
}

async function saveConversation({ patientId, question, answer, sourcesUsed }) {
  const result = await query(
    `INSERT INTO ai_conversations (patient_id, question, answer, sources_used)
     VALUES ($1, $2, $3, $4)
     RETURNING id, patient_id, question, answer, sources_used, created_at`,
    [
      normalizeOptionalText(patientId),
      normalizeText(question),
      normalizeText(answer),
      normalizeStringArray(sourcesUsed),
    ]
  );

  return result.rows[0];
}

async function listConversationHistory(patientId) {
  const result = await query(
    `SELECT id, patient_id, question, answer, sources_used, created_at
     FROM ai_conversations
     WHERE patient_id = $1
     ORDER BY created_at DESC`,
    [normalizeText(patientId)]
  );

  return result.rows.map((row) => ({
    id: row.id,
    patient_id: row.patient_id,
    question: row.question,
    answer: row.answer,
    sources_used: row.sources_used || [],
    created_at: row.created_at,
  }));
}

async function seedKnowledgeBase({ reset = false } = {}) {
  if (reset) {
    await query("TRUNCATE TABLE medicines, diseases RESTART IDENTITY CASCADE");
  }

  let medicineCount = 0;
  for (const medicine of medicineSeedData) {
    await upsertMedicine(medicine);
    medicineCount += 1;
  }

  let diseaseCount = 0;
  for (const disease of diseaseSeedData) {
    await upsertDisease(disease);
    diseaseCount += 1;
  }

  return {
    diseasesSeeded: diseaseCount,
    medicinesSeeded: medicineCount,
    totalSeeded: medicineCount + diseaseCount,
  };
}

module.exports = {
  buildDiseaseEmbeddingText,
  buildMedicineEmbeddingText,
  listConversationHistory,
  listDiseases,
  listMedicines,
  saveConversation,
  searchKnowledgeBase,
  seedKnowledgeBase,
  upsertDisease,
  upsertMedicine,
};
