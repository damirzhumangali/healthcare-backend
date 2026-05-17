const DISCLAIMER =
  "Проконсультируйтесь с врачом перед применением любого лекарства.";

const NO_DATA_MESSAGE =
  "К сожалению, информации по вашему вопросу нет в нашей базе знаний. Обратитесь к врачу.";

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const AI_SEARCH_LIMIT = toPositiveNumber(process.env.AI_SEARCH_LIMIT, 3);
const AI_SEARCH_MAX_DISTANCE = Number.isFinite(Number(process.env.AI_SEARCH_MAX_DISTANCE))
  ? Number(process.env.AI_SEARCH_MAX_DISTANCE)
  : 1.25;
const AI_EMBEDDING_DIMENSIONS = toPositiveNumber(process.env.AI_EMBEDDING_DIMENSIONS, 768);
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim();
const OLLAMA_CHAT_MODEL = String(process.env.OLLAMA_CHAT_MODEL || "llama3").trim();
const OLLAMA_EMBED_MODEL = String(process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text").trim();

module.exports = {
  AI_EMBEDDING_DIMENSIONS,
  AI_SEARCH_LIMIT,
  AI_SEARCH_MAX_DISTANCE,
  DISCLAIMER,
  NO_DATA_MESSAGE,
  OLLAMA_BASE_URL,
  OLLAMA_CHAT_MODEL,
  OLLAMA_EMBED_MODEL,
};
