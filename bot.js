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

  sessions[chatId] = {
    step: "name",
    answers: {},
  };

  bot.sendMessage(chatId, "Здравствуйте! Как вас зовут?");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text === "/start") return;

  const session = sessions[chatId];

  if (!session) {
    bot.sendMessage(chatId, "Напишите /start чтобы начать консультацию.");
    return;
  }

  if (session.step === "name") {
    session.answers.name = text;
    session.step = "problem";
    bot.sendMessage(chatId, "Опишите вашу проблему или симптомы.");
    return;
  }

  if (session.step === "problem") {
    session.answers.problem = text;
    session.step = "days";
    bot.sendMessage(chatId, "Сколько дней это продолжается?");
    return;
  }

  if (session.step === "days") {
    session.answers.days = text;
    session.step = "temperature";
    bot.sendMessage(chatId, "Есть ли температура? Если да, какая?");
    return;
  }

  if (session.step === "temperature") {
    session.answers.temperature = text;
    session.step = "done";

    try {
      const consultationPayload = {
        chat_id: String(chatId),
        telegram_username: msg.from?.username || "",
        telegram_first_name: msg.from?.first_name || "",
        telegram_last_name: msg.from?.last_name || "",
        patient_name: session.answers.name,
        problem: session.answers.problem,
        days: session.answers.days,
        temperature: session.answers.temperature,
      };

      const consultation = await saveConsultation(consultationPayload);

      const summary =
        "Спасибо! Ваша заявка отправлена доктору.\n\n" +
        "Имя: " + session.answers.name + "\n" +
        "Проблема: " + session.answers.problem + "\n" +
        "Дней: " + session.answers.days + "\n" +
        "Температура: " + session.answers.temperature;

      await bot.sendMessage(chatId, summary);

      console.log("NEW CONSULTATION REQUEST:");
      console.log(consultation);
      return;
    } catch (error) {
      console.error("telegram_consultation_save_error:", error.message);
      session.step = "temperature";
      await bot.sendMessage(
        chatId,
        "Не удалось сохранить заявку. Попробуйте ещё раз через пару секунд."
      );
      return;
    }
  }

  if (session.step === "done") {
    bot.sendMessage(
      chatId,
      "Ваша заявка уже отправлена. Если хотите начать заново, напишите /start."
    );
  }
});
