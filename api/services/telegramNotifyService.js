async function sendBotMessage(chatId, text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    const error = new Error("missing_telegram_bot_token");
    error.statusCode = 503;
    throw error;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId),
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const error = new Error(`telegram_send_failed:${res.status}`);
    error.statusCode = 502;
    error.details = body;
    throw error;
  }

  return res.json();
}

function formatMeetingMessage({ patientName, meetingUrl, meetingAt }) {
  const when = new Date(meetingAt);
  const formatted = Number.isNaN(when.getTime())
    ? meetingAt
    : when.toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const greeting = patientName ? `Здравствуйте, ${patientName}!` : "Здравствуйте!";

  return (
    `${greeting}\n\n` +
    `Доктор подтвердил вашу консультацию.\n\n` +
    `🕐 Время: <b>${formatted}</b> (Алматы)\n` +
    `🔗 Ссылка: ${meetingUrl}\n\n` +
    `Откройте ссылку в браузере за 2-3 минуты до начала. Камеру и микрофон разрешите по запросу.`
  );
}

function formatDoctorMeetingMessage({ patientName, problem, meetingUrl, meetingAt }) {
  const when = new Date(meetingAt);
  const formatted = Number.isNaN(when.getTime())
    ? meetingAt
    : when.toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const patient = patientName ? `<b>${patientName}</b>` : "пациент";
  const complaint = problem ? `\n📋 Жалоба: ${problem}` : "";

  return (
    `👨‍⚕️ Новая онлайн-консультация назначена.\n\n` +
    `Пациент: ${patient}${complaint}\n\n` +
    `🕐 Время: <b>${formatted}</b> (Алматы)\n` +
    `🔗 Ссылка: ${meetingUrl}\n\n` +
    `Откройте ссылку за 2-3 минуты до начала.`
  );
}

module.exports = { sendBotMessage, formatMeetingMessage, formatDoctorMeetingMessage };
