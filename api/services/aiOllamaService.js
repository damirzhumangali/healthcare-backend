const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatOllama } = require("@langchain/ollama");
const {
  AI_EMBEDDING_DIMENSIONS,
  DISCLAIMER,
  NO_DATA_MESSAGE,
  OLLAMA_BASE_URL,
  OLLAMA_CHAT_MODEL,
  OLLAMA_EMBED_MODEL,
} = require("./aiConfig");

const SYSTEM_PROMPT = `Ты медицинский помощник больницы. Отвечай ТОЛЬКО на основе предоставленных данных из базы знаний. Не придумывай информацию которой нет в контексте. Не ставь диагноз. Отвечай на русском языке. Будь понятным и кратким. Если в контексте нет достаточной информации для ответа, ответь ровно: "${NO_DATA_MESSAGE}" В конце КАЖДОГО ответа обязательно добавляй: "${DISCLAIMER}"`;

const USER_PROMPT = `Контекст из базы знаний:
{context}

Вопрос пациента: {question}`;

let answerChain = null;

function normalizeEmbeddingLength(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Ollama returned an empty embedding.");
  }

  if (embedding.length === AI_EMBEDDING_DIMENSIONS) return embedding;
  if (embedding.length > AI_EMBEDDING_DIMENSIONS) {
    return embedding.slice(0, AI_EMBEDDING_DIMENSIONS);
  }

  throw new Error(
    `Embedding length ${embedding.length} is smaller than configured dimension ${AI_EMBEDDING_DIMENSIONS}.`
  );
}

function getAnswerChain() {
  if (!answerChain) {
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", SYSTEM_PROMPT],
      ["human", USER_PROMPT],
    ]);

    const model = new ChatOllama({
      baseUrl: OLLAMA_BASE_URL,
      model: OLLAMA_CHAT_MODEL,
      temperature: 0.2,
      numPredict: 350,
    });

    answerChain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  return answerChain;
}

function ensureDisclaimer(answer) {
  const cleaned = String(answer || "").trim();
  if (!cleaned) return DISCLAIMER;
  if (cleaned.endsWith(DISCLAIMER)) return cleaned;
  return `${cleaned}\n\n${DISCLAIMER}`;
}

async function generateEmbedding(text, prefix = "search_document") {
  const content = String(text || "").trim();
  if (!content) {
    throw new Error("Cannot generate an embedding for empty text.");
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: `${prefix}: ${content}`,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Ollama embedding request failed (${response.status}): ${details}`);
  }

  const data = await response.json();
  const rawEmbedding = Array.isArray(data?.embedding)
    ? data.embedding
    : Array.isArray(data?.embeddings?.[0])
      ? data.embeddings[0]
      : null;

  return normalizeEmbeddingLength(rawEmbedding);
}

async function generateMedicalAnswer({ context, question }) {
  const answer = await getAnswerChain().invoke({
    context: String(context || "").trim() || NO_DATA_MESSAGE,
    question: String(question || "").trim(),
  });

  return ensureDisclaimer(answer);
}

module.exports = {
  DISCLAIMER,
  NO_DATA_MESSAGE,
  ensureDisclaimer,
  generateEmbedding,
  generateMedicalAnswer,
};
