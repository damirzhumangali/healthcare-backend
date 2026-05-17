const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 700;
const DISCLAIMER =
  "Проконсультируйтесь с врачом перед применением любого лекарства.";

function hasClaudeTriageConfig() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim());
}

function getClient() {
  if (!hasClaudeTriageConfig()) {
    const error = new Error("anthropic_api_key_missing");
    error.statusCode = 503;
    throw error;
  }

  return new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

function getLanguageInstruction(locale) {
  if (locale === "kk") return "Отвечай на казахском языке.";
  if (locale === "en") return "Reply in English.";
  return "Отвечай на русском языке.";
}

function getSexLabel(sex, locale) {
  if (sex === "female") {
    return locale === "en" ? "female" : locale === "kk" ? "әйел" : "женский";
  }
  if (sex === "male") {
    return locale === "en" ? "male" : locale === "kk" ? "ер" : "мужской";
  }
  return locale === "en" ? "not specified" : locale === "kk" ? "көрсетілмеген" : "не указан";
}

function ensureDisclaimer(answer) {
  const cleaned = String(answer || "").trim();
  if (!cleaned) return DISCLAIMER;
  if (cleaned.endsWith(DISCLAIMER)) return cleaned;
  return `${cleaned}\n\n${DISCLAIMER}`;
}

async function generateBodyTriageAnswer({
  bodyPartLabel,
  locale = "ru",
  symptoms = "",
  painLevel = null,
  sex = null,
  pregnant = false,
  recommendedSpecialist = null,
}) {
  const client = getClient();
  const normalizedSymptoms = String(symptoms || "").trim() || "не указаны";
  const normalizedPain =
    Number.isFinite(Number(painLevel)) ? `${Math.max(0, Math.min(10, Number(painLevel)))}/10` : "не указан";

  const systemPrompt = [
    "Ты медицинский AI-помощник для первичной навигации пациента.",
    "Не ставь окончательный диагноз и не утверждай то, в чем не уверен.",
    "Дай краткий, понятный и практичный ответ для пациента.",
    "Используй 3 коротких раздела в таком формате:",
    "**Что это может быть**: 1-2 предложения.",
    "**Что можно сделать сейчас**: 2-4 коротких пункта.",
    "**Когда нужен врач**: 2-4 коротких пункта.",
    "Если уместно, отдельно упомяни, к какому специалисту лучше обратиться.",
    "Не используй markdown кроме указанных заголовков и коротких списков с '- '.",
    getLanguageInstruction(locale),
  ].join(" ");

  const userPrompt = [
    `Зона боли: ${bodyPartLabel}.`,
    `Пол: ${getSexLabel(sex, locale)}.`,
    sex === "female" ? `Беременность: ${pregnant ? "да" : "нет"}.` : "",
    `Симптомы: ${normalizedSymptoms}.`,
    `Уровень боли: ${normalizedPain}.`,
    recommendedSpecialist
      ? `Предпочтительный специалист для маршрутизации: ${recommendedSpecialist}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const answer = message.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!answer) {
    throw new Error("anthropic_empty_triage_answer");
  }

  return ensureDisclaimer(answer);
}

module.exports = {
  generateBodyTriageAnswer,
  hasClaudeTriageConfig,
};
