// @ts-nocheck
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

const DISCLAIMER =
  "Это автоматический анализ. Обязательно проконсультируйтесь с лечащим врачом перед применением любых препаратов.";

function buildVitalsPrompt({ tempC, hr, systolic, diastolic, spo2, medication }) {
  const vitalsText = [
    tempC != null ? `Температура: ${tempC}°C` : null,
    hr != null ? `Пульс: ${hr} уд/мин` : null,
    systolic != null && diastolic != null ? `Давление: ${systolic}/${diastolic} мм рт.ст.` : null,
    spo2 != null ? `SpO₂: ${spo2}%` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const medText =
    medication && medication.length > 0
      ? medication
          .map((m) => `  Ячейка ${m.compartment}: ${m.drug} ${m.dosage} (${m.instruction || "по назначению"})`)
          .join("\n")
      : "  (лекарства не заданы)";

  return `Ты — медицинский ИИ-ассистент в системе HealthAssist. Пациент находится в больничной палате.

Текущие показатели пациента:
${vitalsText}

Лекарства в ячейках робота AIMAR (уже находятся у кровати):
${medText}

На основе показателей дай краткий структурированный анализ в формате JSON:
{
  "status": "норма | внимание | критично",
  "summary": "2-3 предложения об общем состоянии пациента",
  "concerns": ["список конкретных отклонений от нормы, если есть"],
  "doctor": "специализация врача которого нужно вызвать/к которому записаться",
  "doctor_urgency": "срочно | в течение дня | плановый",
  "medications": [
    {
      "compartment": "номер ячейки из списка выше или null",
      "drug": "название препарата",
      "dosage": "доза",
      "reason": "зачем принять",
      "available_in_robot": true или false
    }
  ],
  "actions": ["список немедленных действий для медперсонала"]
}

Отвечай ТОЛЬКО валидным JSON без markdown, без комментариев.`;
}

async function analyzeVitals({ tempC, hr, systolic, diastolic, spo2, medication }) {
  const prompt = buildVitalsPrompt({ tempC, hr, systolic, diastolic, spo2, medication });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content?.[0]?.text ?? "";

  let advice;
  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    advice = JSON.parse(clean);
  } catch {
    advice = {
      status: "внимание",
      summary: raw,
      concerns: [],
      doctor: "терапевт",
      doctor_urgency: "в течение дня",
      medications: [],
      actions: [],
    };
  }

  return { advice, disclaimer: DISCLAIMER };
}

module.exports = { analyzeVitals };
