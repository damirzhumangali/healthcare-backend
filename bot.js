require("dotenv").config();

const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const telegramConsultationService = require("./api/services/telegramConsultationService");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

console.log("BOT STARTED");

const sessions = {};
const isRender = Boolean(process.env.RENDER);
const BOT_PORT = Number(process.env.BOT_PORT || (isRender ? process.env.PORT : 4016) || 4016);

function normalizeGatewayUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "telegram-bot",
        polling: true,
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.on("error", (error) => {
  if (error && (error.code === "EADDRINUSE" || error.code === "EPERM")) {
    console.warn("BOT WEB SERVICE DISABLED: " + error.code + " on port " + BOT_PORT);
    return;
  }

  throw error;
});

server.listen(BOT_PORT, () => {
  console.log("BOT WEB SERVICE READY: http://0.0.0.0:" + BOT_PORT);
});

const MAX_FIELD_LENGTH = 500;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const lastSubmissionAt = new Map();

const PROFANITY_PATTERNS = [
  /\bх[уyu]+[еeё]?[лвн]?[аоыя]?/i,
  /\bпизд[аеуыоиа]/i,
  /\bбл[яa][дtт]/i,
  /\bе[бb][аaеeуyё]/i,
  /\bму[дd]а[кg]/i,
  /\bговн[оаыe]/i,
  /\bдроч[иеа]/i,
  /\bсук[аи]\b/i,
  /\bпид[еоа]?р/i,
  /\bхрен[ьи]/i,
  /\bжоп[аыеу]/i,
  /\bхуй/i,
  /\bтвар[ьи]/i,
  /\bсцук/i,
  /\bёб/i,
  /\bgo+\s*f+u+c+k/i,
  /\bf+u+c+k/i,
  /\bsh+i+t\b/i,
  /\bbi+t+ch/i,
  /\basshol/i,
  /\bcunt/i,
  /\bdi+ck\b/i,
  /\bcock\b/i,
];

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/\s+/g, " ")
    .trim();
}

function containsProfanity(text) {
  const normalized = normalizeText(text);
  return PROFANITY_PATTERNS.some((re) => re.test(normalized));
}

function isMostlyGarbage(text) {
  const t = String(text || "").trim();
  if (t.length < 2) return true;
  if (/(.)\1{4,}/i.test(t)) return true;
  const letters = t.match(/[a-zA-Zа-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ]/g) || [];
  if (letters.length === 0) return true;
  const vowels = t.match(/[aeiouyаеёиоуыэюяәіөү]/gi) || [];
  if (letters.length >= 4 && vowels.length === 0) return true;
  const distinct = new Set(t.toLowerCase().replace(/\s/g, "")).size;
  if (t.length >= 6 && distinct <= 2) return true;
  return false;
}

const NAME_RE = /^[a-zA-Zа-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ\s\-']{2,50}$/;

function validateName(text) {
  const t = (text || "").trim();
  if (t.length < 2) return "Имя слишком короткое. Введите ваше настоящее имя.";
  if (t.length > 50) return "Имя слишком длинное. Сократите до 50 символов.";
  if (!NAME_RE.test(t)) return "Имя может содержать только буквы, пробелы и дефис.";
  if (containsProfanity(t)) return "Пожалуйста, без оскорблений. Введите ваше настоящее имя.";
  if (isMostlyGarbage(t)) return "Похоже на случайный набор символов. Введите настоящее имя.";
  return null;
}

function validateProblem(text) {
  const t = (text || "").trim();
  if (t.length < 10) return "Опишите проблему подробнее (минимум 10 символов).";
  if (t.length > MAX_FIELD_LENGTH) return `Слишком длинное описание. Сократите до ${MAX_FIELD_LENGTH} символов.`;
  if (containsProfanity(t)) return "Пожалуйста, опишите проблему без нецензурной лексики.";
  if (isMostlyGarbage(t)) return "Описание не похоже на медицинскую жалобу. Опишите словами.";
  const words = t.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 3) return "Опишите проблему хотя бы тремя словами (например: «болит горло, кашель, насморк»).";
  return null;
}

function parseDays(text) {
  const t = (text || "").trim();
  const match = t.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return { error: "Укажите количество дней числом, например: 3" };
  const num = Number(match[1].replace(",", "."));
  if (!Number.isFinite(num) || num < 0) return { error: "Число дней не может быть отрицательным." };
  if (num > 365) return { error: "Слишком большое значение. Укажите от 0 до 365 дней." };
  return { value: String(Math.round(num)) };
}

function parseTemperature(text) {
  const t = (text || "").trim().toLowerCase();
  if (/^(нет|жоқ|жок|no|none|нету|без|normal|норма|нормальн)/.test(t)) {
    return { value: "нет" };
  }
  const match = t.match(/(\d{2}(?:[.,]\d+)?)/);
  if (!match) return { error: "Укажите температуру числом (например 37.5) или напишите «нет»." };
  const num = Number(match[1].replace(",", "."));
  if (!Number.isFinite(num)) return { error: "Не удалось распознать температуру." };
  if (num < 30 || num > 45) return { error: "Температура вне разумного диапазона (30-45 °C)." };
  return { value: String(num) };
}

function rateLimitWaitMinutes(chatId) {
  const last = lastSubmissionAt.get(String(chatId));
  if (!last) return 0;
  const remaining = RATE_LIMIT_WINDOW_MS - (Date.now() - last);
  return remaining > 0 ? Math.ceil(remaining / 60000) : 0;
}

async function aiModerate(payload) {
  const apiKey = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { allow: true };

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        max_tokens: 4,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a strict moderator for a medical-clinic intake bot. Submissions are in Russian, Kazakh, or English.\n" +
              "Reply with exactly one digit and nothing else.\n" +
              "Reply 1 ONLY if ALL of these are true:\n" +
              "- 'Имя' looks like a real human name (no nicknames, no slogans, no random letters).\n" +
              "- 'Проблема' clearly describes a concrete physical or mental health symptom (pain, cough, fever, rash, anxiety, injury, etc.) with at least 3 meaningful words.\n" +
              "- The submission is in good faith and contains no profanity, sexual content, advertising, jokes, political statements, gibberish, or test data ('test', 'asdf', 'qwerty', '...', etc.).\n" +
              "- Days and temperature are plausible numeric values consistent with the complaint.\n" +
              "Reply 0 in ALL OTHER CASES, including ANY doubt. When uncertain, reply 0.",
          },
          {
            role: "user",
            content:
              `Имя: ${payload.patient_name}\n` +
              `Проблема: ${payload.problem}\n` +
              `Дней: ${payload.days}\n` +
              `Температура: ${payload.temperature}`,
          },
        ],
      }),
    });
    if (!res.ok) return { allow: true };
    const data = await res.json();
    const reply = String(data?.choices?.[0]?.message?.content || "").trim();
    return { allow: reply.startsWith("1") };
  } catch (error) {
    console.warn("ai_moderate_error:", error.message);
    return { allow: true };
  }
}

async function saveConsultation(payload) {
  const gatewayUrl = normalizeGatewayUrl(process.env.TELEGRAM_GATEWAY_URL);
  const gatewaySecret = String(
    process.env.TELEGRAM_GATEWAY_SECRET || process.env.TELEGRAM_INGEST_SECRET || ""
  ).trim();

  if (!gatewayUrl) {
    return telegramConsultationService.createConsultation(payload);
  }

  if (!gatewaySecret) {
    throw new Error("missing_gateway_secret");
  }

  const res = await fetch(`${gatewayUrl}/api/telegram/consultations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-secret": gatewaySecret,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway_save_failed:${res.status}${body ? `:${body}` : ""}`);
  }

  const data = await res.json();
  return data.item || data.consultation || payload;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const wait = rateLimitWaitMinutes(chatId);
  if (wait > 0) {
    bot.sendMessage(
      chatId,
      `Вы недавно отправили заявку. Попробуйте снова через ~${wait} мин.`
    );
    return;
  }

  sessions[chatId] = {
    step: "name",
    answers: {},
  };

  bot.sendMessage(chatId, "Здравствуйте! Как вас зовут?");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  if (text.length > MAX_FIELD_LENGTH) {
    bot.sendMessage(
      chatId,
      `Слишком длинное сообщение (макс. ${MAX_FIELD_LENGTH} символов). Сократите.`
    );
    return;
  }

  const session = sessions[chatId];

  if (!session) {
    bot.sendMessage(chatId, "Напишите /start чтобы начать консультацию.");
    return;
  }

  if (session.step === "name") {
    const error = validateName(text);
    if (error) {
      bot.sendMessage(chatId, error);
      return;
    }
    session.answers.name = text.trim();
    session.step = "problem";
    bot.sendMessage(chatId, "Опишите вашу проблему или симптомы.");
    return;
  }

  if (session.step === "problem") {
    const error = validateProblem(text);
    if (error) {
      bot.sendMessage(chatId, error);
      return;
    }
    session.answers.problem = text.trim();
    session.step = "days";
    bot.sendMessage(chatId, "Сколько дней это продолжается? (укажите число)");
    return;
  }

  if (session.step === "days") {
    const parsed = parseDays(text);
    if (parsed.error) {
      bot.sendMessage(chatId, parsed.error);
      return;
    }
    session.answers.days = parsed.value;
    session.step = "temperature";
    bot.sendMessage(chatId, "Есть ли температура? Укажите число (например 37.5) или напишите «нет».");
    return;
  }

  if (session.step === "temperature") {
    const parsed = parseTemperature(text);
    if (parsed.error) {
      bot.sendMessage(chatId, parsed.error);
      return;
    }
    session.answers.temperature = parsed.value;
    session.step = "consultation_choice";

    bot.sendMessage(chatId, "Хотите получить консультацию доктора по видеосвязи?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Да", callback_data: "consult:yes" },
            { text: "❌ Нет", callback_data: "consult:no" },
          ],
        ],
      },
    });
    return;
  }

  if (session.step === "consultation_choice") {
    bot.sendMessage(chatId, "Пожалуйста, выберите вариант кнопкой выше: Да или Нет.");
    return;
  }

  if (session.step === "moderating") {
    bot.sendMessage(chatId, "Проверяю заявку, подождите...");
    return;
  }

  if (session.step === "done") {
    bot.sendMessage(
      chatId,
      "Ваша заявка уже отправлена. Если хотите начать заново, напишите /start."
    );
  }
});

async function finalizeSubmission(chatId, msgFrom, wantsConsultation) {
  const session = sessions[chatId];
  if (!session) return;

  session.step = "moderating";

  try {
    const consultationPayload = {
      chat_id: String(chatId),
      telegram_username: msgFrom?.username || "",
      telegram_first_name: msgFrom?.first_name || "",
      telegram_last_name: msgFrom?.last_name || "",
      patient_name: session.answers.name,
      problem: session.answers.problem,
      days: session.answers.days,
      temperature: session.answers.temperature,
      wants_consultation: wantsConsultation,
    };

    const moderation = await aiModerate(consultationPayload);
    if (!moderation.allow) {
      console.log("MODERATION_REJECTED:", chatId, consultationPayload.problem);
      delete sessions[chatId];
      await bot.sendMessage(
        chatId,
        "Заявка отклонена модерацией: содержание не похоже на медицинскую жалобу. Напишите /start и попробуйте снова, описав реальный симптом."
      );
      return;
    }

    const consultation = await saveConsultation(consultationPayload);
    lastSubmissionAt.set(String(chatId), Date.now());
    session.step = "done";

    const summary =
      "Спасибо! Ваша заявка отправлена доктору.\n\n" +
      "Имя: " + session.answers.name + "\n" +
      "Проблема: " + session.answers.problem + "\n" +
      "Дней: " + session.answers.days + "\n" +
      "Температура: " + session.answers.temperature + "\n\n" +
      (wantsConsultation
        ? "Вы запросили видеоконсультацию. Доктор подтвердит время и пришлёт сюда ссылку на встречу."
        : "Ваша заявка передана доктору в письменном виде.");

    await bot.sendMessage(chatId, summary);

    console.log("NEW CONSULTATION REQUEST:");
    console.log(consultation);
  } catch (error) {
    console.error("telegram_consultation_save_error:", error.message);
    session.step = "consultation_choice";
    await bot.sendMessage(
      chatId,
      "Не удалось сохранить заявку. Попробуйте ещё раз через пару секунд."
    );
  }
}

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat?.id;
  const data = String(query.data || "");

  if (!chatId) {
    bot.answerCallbackQuery(query.id).catch(() => {});
    return;
  }

  const session = sessions[chatId];

  if (!session || session.step !== "consultation_choice") {
    await bot.answerCallbackQuery(query.id, {
      text: "Кнопка устарела. Напишите /start заново.",
      show_alert: false,
    }).catch(() => {});
    return;
  }

  if (data !== "consult:yes" && data !== "consult:no") {
    await bot.answerCallbackQuery(query.id).catch(() => {});
    return;
  }

  const wantsConsultation = data === "consult:yes";

  await bot.answerCallbackQuery(query.id, {
    text: wantsConsultation ? "Запрос на консультацию принят" : "Записано без консультации",
  }).catch(() => {});

  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    { chat_id: chatId, message_id: query.message.message_id }
  ).catch(() => {});

  await finalizeSubmission(chatId, query.from, wantsConsultation);
});
