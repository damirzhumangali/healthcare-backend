const nodemailer = require("nodemailer");

function createTransport() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

async function sendMeetingLink({ toEmail, toName, role, doctorName, patientName, meetingUrl, meetingAt }) {
  const transport = createTransport();
  if (!transport || !toEmail) return;

  const isDoctor = role === "doctor";
  const subject = isDoctor
    ? `HealthAssist: новая запись на приём — ${patientName}`
    : `HealthAssist: ваша консультация подтверждена`;

  const dateStr = meetingAt
    ? new Date(meetingAt).toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <div style="background:#0f766e;padding:24px 28px">
    <div style="color:#fff;font-size:20px;font-weight:700">HealthAssist</div>
  </div>
  <div style="padding:28px">
    <p style="font-size:16px;color:#111;margin:0 0 16px">
      ${isDoctor
        ? `Здравствуйте, <b>${toName || "Доктор"}</b>! У вас новая запись.`
        : `Здравствуйте, <b>${toName || "Пациент"}</b>! Ваша консультация подтверждена.`}
    </p>
    ${dateStr ? `<p style="color:#555;margin:0 0 8px">🗓 <b>Дата и время:</b> ${dateStr}</p>` : ""}
    ${isDoctor
      ? `<p style="color:#555;margin:0 0 16px">👤 <b>Пациент:</b> ${patientName || "—"}</p>`
      : `<p style="color:#555;margin:0 0 16px">👨‍⚕️ <b>Врач:</b> ${doctorName || "—"}</p>`}
    <div style="margin:20px 0;text-align:center">
      <a href="${meetingUrl}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700">
        🎥 Подключиться к консультации
      </a>
    </div>
    <p style="font-size:12px;color:#aaa;margin:16px 0 0">Или скопируйте ссылку: <a href="${meetingUrl}" style="color:#0f766e">${meetingUrl}</a></p>
  </div>
</div>`;

  try {
    await transport.sendMail({
      from: `"HealthAssist" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject,
      html,
    });
    console.log(`email_sent to=${toEmail} role=${role}`);
  } catch (e) {
    console.error("email_send_error:", e?.message || e);
  }
}

module.exports = { sendMeetingLink };
