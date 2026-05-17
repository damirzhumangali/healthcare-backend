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

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// sendMeetingLink({ toEmail, toName, role, doctorName, patientName,
//                   meetingUrl, meetingAt, problem, days, temperature })
async function sendMeetingLink({ toEmail, toName, role, doctorName, patientName,
  meetingUrl, meetingAt, problem, days, temperature }) {
  const transport = createTransport();
  if (!transport || !toEmail) return;

  const isDoctor = role === "doctor";

  const dateStr = meetingAt
    ? new Date(meetingAt).toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  const subject = isDoctor
    ? `HealthAssist: новый пациент — ${esc(patientName)}`
    : `HealthAssist: консультация подтверждена`;

  // Patient info block (only shown to doctor)
  const patientInfoBlock = isDoctor ? `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin:16px 0">
      <div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">
        📋 Данные пациента
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:5px 0;color:#64748b;font-size:13px;width:140px">Пациент</td>
          <td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:600">${esc(patientName) || "—"}</td>
        </tr>
        ${problem ? `<tr>
          <td style="padding:5px 0;color:#64748b;font-size:13px;vertical-align:top">Жалоба</td>
          <td style="padding:5px 0;color:#0f172a;font-size:14px">${esc(problem)}</td>
        </tr>` : ""}
        ${days ? `<tr>
          <td style="padding:5px 0;color:#64748b;font-size:13px">Длительность</td>
          <td style="padding:5px 0;color:#0f172a;font-size:14px">${esc(days)} дн.</td>
        </tr>` : ""}
        ${temperature ? `<tr>
          <td style="padding:5px 0;color:#64748b;font-size:13px">Температура</td>
          <td style="padding:5px 0;color:#e11d48;font-size:14px;font-weight:600">${esc(temperature)}°</td>
        </tr>` : ""}
        ${dateStr ? `<tr>
          <td style="padding:5px 0;color:#64748b;font-size:13px">Время приёма</td>
          <td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:600">${esc(dateStr)}</td>
        </tr>` : ""}
      </table>
    </div>` : `
    <div style="margin:8px 0 16px">
      ${dateStr ? `<p style="color:#555;margin:0 0 6px;font-size:14px">🗓 <b>Дата и время:</b> ${esc(dateStr)}</p>` : ""}
      <p style="color:#555;margin:0 0 6px;font-size:14px">👨‍⚕️ <b>Врач:</b> ${esc(doctorName) || "—"}</p>
    </div>`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.06)">
  <div style="background:linear-gradient(135deg,#0f766e,#0d9488);padding:28px 32px">
    <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px">HealthAssist</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px">
      ${isDoctor ? "Кабинет врача" : "Кабинет пациента"}
    </div>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:17px;color:#0f172a;margin:0 0 4px;font-weight:700">
      ${isDoctor
        ? `Новый пациент на консультацию`
        : `Ваша консультация подтверждена ✅`}
    </p>
    <p style="font-size:14px;color:#64748b;margin:0 0 20px">
      Здравствуйте, <b>${esc(toName) || (isDoctor ? "Доктор" : "Пациент")}</b>!
    </p>

    ${patientInfoBlock}

    <div style="margin:24px 0;text-align:center">
      <a href="${meetingUrl}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:15px 36px;border-radius:10px;font-size:16px;font-weight:800;letter-spacing:-0.3px">
        🎥 Подключиться к консультации
      </a>
    </div>

    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;text-align:center">
      <div style="font-size:12px;color:#166534;margin-bottom:4px">Ссылка на встречу</div>
      <a href="${meetingUrl}" style="color:#0f766e;font-size:12px;word-break:break-all">${meetingUrl}</a>
    </div>
  </div>
  <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;color:#94a3b8;margin:0">HealthAssist — система управления клиникой</p>
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
