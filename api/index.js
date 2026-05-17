// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
console.log('BOOT FILE:', __filename);
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const path = require("path");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { requireJwt } = require("./middleware/auth");
const { syncDoctorDirectory } = require("./services/doctorDirectoryService");
const { generateBodyTriageAnswer, hasClaudeTriageConfig } = require("./services/bodyTriageAiService");
const userService = require("./services/userService");
const { db } = require("./db/sqlite");
let ticketsRoutes = null;
let appointmentsRoutes = null;
let doctorsRoutes = null;
let adminRoutes = null;
let measurementsRoutes = null;
let devicePairingsRoutes = null;
let deviceRoutes = null;
let servoControlRoutes = null;
let aiRoutes = null;
let consultationsRoutes = null;
try { ticketsRoutes = require("./routes/tickets"); } catch(e) { console.error("tickets_load_error:", e.message); }
try { appointmentsRoutes = require("./routes/appointments"); } catch(e) { console.error("appointments_load_error:", e.message); }
try { doctorsRoutes = require("./routes/doctors"); } catch(e) { console.error("doctors_load_error:", e.message); }
try { adminRoutes = require("./routes/admin"); } catch(e) { console.error("admin_load_error:", e.message); }
try { measurementsRoutes = require("./routes/measurements"); } catch(e) { console.error("measurements_load_error:", e.message); }
try { devicePairingsRoutes = require("./routes/devicePairings"); } catch(e) { console.error("device_pairings_load_error:", e.message); }
try { deviceRoutes = require("./routes/device"); } catch(e) { console.error("device_load_error:", e.message); }
try { servoControlRoutes = require("./routes/servoControl"); } catch(e) { console.error("servo_control_load_error:", e.message); }
try { aiRoutes = require("./routes/ai"); } catch(e) { console.error("ai_load_error:", e.message); }
try { consultationsRoutes = require("./routes/consultations"); } catch(e) { console.error("consultations_load_error:", e.message); }

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
const PORT = Number(process.env.PORT) || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CORS_ORIGINS = String(
  process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "healthassist_token";
const AUTH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const authRateWindow = new Map();
const triageRateWindow = new Map();

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function cleanupRateWindow(store, now, windowMs) {
  for (const [key, entry] of store.entries()) {
    if (now - entry.startedAt >= windowMs) store.delete(key);
  }
}

function createRateLimiter({
  store,
  windowMs = RATE_LIMIT_WINDOW_MS,
  max,
  keyPrefix,
  message = "too_many_requests",
}) {
  return (req, res, next) => {
    const now = Date.now();
    cleanupRateWindow(store, now, windowMs);

    const key = `${keyPrefix}:${getClientIp(req)}`;
    const entry = store.get(key);
    if (!entry || now - entry.startedAt >= windowMs) {
      store.set(key, { count: 1, startedAt: now });
      return next();
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - entry.startedAt)) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: message });
    }

    entry.count += 1;
    return next();
  };
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setAuthCookie(res, token) {
  res.append(
    "Set-Cookie",
    serializeCookie(AUTH_COOKIE_NAME, token, {
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      httpOnly: true,
      sameSite: IS_PRODUCTION ? "None" : "Lax",
      secure: IS_PRODUCTION,
    })
  );
}

function clearAuthCookie(res) {
  res.append(
    "Set-Cookie",
    serializeCookie(AUTH_COOKIE_NAME, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: IS_PRODUCTION ? "None" : "Lax",
      secure: IS_PRODUCTION,
    })
  );
}

function applySecurityHeaders(req, res, next) {
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  res.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (IS_PRODUCTION) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

const authRateLimit = createRateLimiter({
  store: authRateWindow,
  max: 10,
  keyPrefix: "auth",
});

const triageRateLimit = createRateLimiter({
  store: triageRateWindow,
  windowMs: 5 * 60_000,
  max: 20,
  keyPrefix: "triage",
});

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  if (IS_PRODUCTION) return false;
  return (
    origin === "http://localhost" ||
    origin === "https://localhost" ||
    origin === "http://127.0.0.1" ||
    origin === "https://127.0.0.1" ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("https://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("https://127.0.0.1:")
  );
}

app.use(applySecurityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) return callback(null, true);
      return callback(new Error("cors_not_allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`
    );
  });
  next();
});

const redirectUri = `${process.env.FRONTEND_URL}/auth/callback`;

const oauthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

function isLocalDevRequest(req) {
  if (IS_PRODUCTION) return false;
  const values = [req.headers.origin, req.headers.referer, req.headers.host]
    .map((value) => String(value || "").toLowerCase());

  return values.some((value) => value.includes("localhost") || value.includes("127.0.0.1"));
}

app.get("/auth/google/url", (req, res) => {
  const url = oauthClient.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    access_type: "offline",
    prompt: "consent",
  });
  res.json({ url });
});

app.post(
  "/auth/google/exchange",
  authRateLimit,
  async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: "No code" });

      const { tokens } = await oauthClient.getToken(code);

      if (!tokens.id_token) {
        return res.status(500).json({ error: "No id_token returned" });
      }

      const ticket = await oauthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      const oauthUser = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      };

      const user = userService.upsertOAuthUser(oauthUser);
      const myToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });

      setAuthCookie(res, myToken);
      res.set("Cache-Control", "no-store");
      res.json({ token: myToken, user });
    } catch (e) {
      res.status(500).json({ error: "Auth failed" });
    }
  }
);

app.post("/auth/vk/session", authRateLimit, async (req, res) => {
  try {
    const accessToken = String(req.body?.access_token || "").trim();
    const vkAppId = Number(process.env.VK_APP_ID || 0);

    if (!accessToken) {
      return res.status(400).json({ error: "access_token_required" });
    }
    if (!Number.isFinite(vkAppId) || vkAppId <= 0) {
      return res.status(503).json({ error: "vk_auth_not_configured" });
    }

    const params = new URLSearchParams({
      client_id: String(vkAppId),
    });

    const vkRes = await fetch(`https://id.vk.ru/oauth2/user_info?${params.toString()}`, {
      method: "POST",
      body: new URLSearchParams({
        access_token: accessToken,
      }),
    });

    if (!vkRes.ok) {
      const body = await vkRes.text().catch(() => "");
      return res.status(502).json({ error: "vk_user_info_failed", details: body });
    }

    const data = await vkRes.json();
    const rawUser = data?.user || {};
    const userId = String(rawUser.user_id || "").trim();

    if (!userId) {
      return res.status(502).json({ error: "vk_user_id_missing" });
    }

    const email = String(rawUser.email || "").trim().toLowerCase() || `vkid-${userId}@id.vk.local`;
    const firstName = String(rawUser.first_name || "").trim();
    const lastName = String(rawUser.last_name || "").trim();
    const name = `${firstName} ${lastName}`.trim() || `VK User ${userId}`;
    const picture = String(rawUser.avatar || "").trim();

    const user = userService.upsertOAuthUser({
      id: `vk:${userId}`,
      email,
      name,
      picture,
    });

    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
    setAuthCookie(res, token);
    res.set("Cache-Control", "no-store");
    return res.json({ token, user });
  } catch (error) {
    return res.status(500).json({ error: "vk_auth_failed" });
  }
});

app.post("/auth/local/dev-token", authRateLimit, (req, res) => {
  if (!isLocalDevRequest(req)) {
    return res.status(404).json({ error: "not_found" });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || email.split("@")[0] || "Local User").trim();

  if (!email) {
    return res.status(400).json({ error: "email_required" });
  }

  const existingUser = db
    .prepare("SELECT id, email, name, picture FROM users WHERE lower(email) = ?")
    .get(email);

  const user = userService.upsertOAuthUser({
    id: existingUser?.id || `local:${email}`,
    email,
    name: existingUser?.name || name,
    picture: existingUser?.picture || "",
  });

  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
  setAuthCookie(res, token);
  res.set("Cache-Control", "no-store");
  return res.json({ token, user });
});

app.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.set("Cache-Control", "no-store");
  return res.status(204).end();
});

app.get("/api/me", requireJwt, (req, res) => {
  const user = userService.getUserById(req.user.id) || req.user;
  res.json({ user });
});

if (ticketsRoutes) app.use("/api/tickets", ticketsRoutes);
if (appointmentsRoutes) app.use("/api/appointments", appointmentsRoutes);
if (doctorsRoutes) app.use("/api/doctors", doctorsRoutes);
if (adminRoutes) app.use("/api/admin", adminRoutes);
if (consultationsRoutes) app.use("/api/consultations", consultationsRoutes);
if (measurementsRoutes) app.use("/api/measurements", measurementsRoutes);
if (devicePairingsRoutes) app.use("/api/device-pairings", devicePairingsRoutes);
if (deviceRoutes) app.use("/api/device", deviceRoutes);
if (servoControlRoutes) app.use("/api/servo-control", servoControlRoutes);
if (aiRoutes) app.use("/api/ai", aiRoutes);

try {
  const doctorSync = syncDoctorDirectory();
  console.log("doctor_directory_sync:", JSON.stringify(doctorSync));
} catch (error) {
  console.error("doctor_directory_sync_error:", error?.message || error);
}

app.get("/ai-chat", (req, res) => {
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.sendFile(path.join(__dirname, "public", "ai-chat.html"));
});

// ── Doctor portal ──────────────────────────────────────────────────────────

const DOCTOR_CALLBACK_PATH = "/doctor/callback";

function getDoctorOauthClient() {
  const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
  const redirectUri = `${serverUrl}${DOCTOR_CALLBACK_PATH}`;
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

app.get("/doctor", (req, res) => {
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.sendFile(path.join(__dirname, "public", "doctor.html"));
});

app.get("/doctor/auth/url", (req, res) => {
  const client = getDoctorOauthClient();
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    access_type: "offline",
    prompt: "consent",
  });
  res.json({ url });
});

app.get(DOCTOR_CALLBACK_PATH, async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`/doctor?auth_error=${encodeURIComponent(error || "no_code")}`);
  }
  try {
    const client = getDoctorOauthClient();
    const { tokens } = await client.getToken(String(code));
    if (!tokens.id_token) throw new Error("no_id_token");

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const oauthUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };

    const user = userService.upsertOAuthUser(oauthUser);
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
    setAuthCookie(res, token);
    res.redirect("/doctor");
  } catch (e) {
    console.error("doctor_oauth_error:", e?.message || e);
    res.redirect(`/doctor?auth_error=${encodeURIComponent("auth_failed")}`);
  }
});

// ── Patient cabinet ────────────────────────────────────────────────────────

const CABINET_CALLBACK_PATH = "/cabinet/callback";

function getCabinetOauthClient() {
  const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${serverUrl}${CABINET_CALLBACK_PATH}`
  );
}

app.get("/cabinet", (req, res) => {
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.sendFile(path.join(__dirname, "public", "cabinet.html"));
});

app.get("/cabinet/auth/url", (req, res) => {
  const client = getCabinetOauthClient();
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    access_type: "offline",
    prompt: "consent",
  });
  res.json({ url });
});

app.get(CABINET_CALLBACK_PATH, async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`/cabinet?auth_error=${encodeURIComponent(error || "no_code")}`);
  }
  try {
    const client = getCabinetOauthClient();
    const { tokens } = await client.getToken(String(code));
    if (!tokens.id_token) throw new Error("no_id_token");

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const user = userService.upsertOAuthUser({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
    setAuthCookie(res, token);
    res.redirect("/cabinet");
  } catch (e) {
    console.error("cabinet_oauth_error:", e?.message || e);
    res.redirect(`/cabinet?auth_error=${encodeURIComponent("auth_failed")}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────

const BODY_PART_LABELS = {
  head: "Голова",
  neck: "Шея",
  chest: "Грудь",
  belly: "Живот",
  back: "Спина",
  leftArm: "Левая рука",
  rightArm: "Правая рука",
  leftLeg: "Левая нога",
  rightLeg: "Правая нога",
  maleGroin: "Паховая область / мужские половые органы",
  breasts: "Молочные железы",
  femalePelvis: "Органы малого таза / гинекология",
};

function hasBreastComplaintSymptoms(symptoms) {
  const normalized = String(symptoms || "").toLowerCase();

  return [
    /молоч/u,
    /сос(ок|ки|ка)?/u,
    /лактац/u,
    /мастит/u,
    /уплотн/u,
    /выделен/u,
    /емшек/u,
    /с[үу]т без/u,
    /еміз/u,
    /nipple/u,
    /breast/u,
    /lump/u,
    /discharge/u,
    /mastitis/u,
    /lactat/u,
  ].some((pattern) => pattern.test(normalized));
}

function getTriageSpecialistRecommendation({ bodyPart, sex, pregnant, symptoms }) {
  if (sex === "female" && pregnant) {
    return {
      specialty: "Акушер-гинеколог",
      reason: "указана беременность",
    };
  }

  if (bodyPart === "maleGroin") {
    return {
      specialty: "Уролог",
      reason: "жалоба относится к паховой области или мочеполовой системе",
    };
  }

  if (bodyPart === "breasts") {
    return {
      specialty: "Маммолог / Гинеколог",
      reason: "жалоба относится к молочным железам",
    };
  }

  if (sex === "female" && bodyPart === "chest" && hasBreastComplaintSymptoms(symptoms)) {
    return {
      specialty: "Маммолог / Гинеколог",
      reason: "в симптомах есть признаки жалобы на молочные железы",
    };
  }

  if (bodyPart === "femalePelvis") {
    return {
      specialty: "Гинеколог",
      reason: "жалоба относится к органам малого таза",
    };
  }

  return null;
}

function getFallbackTriageAdvice(bodyPart, locale, symptoms, options = {}) {
  const { sex, pregnant } = options;
  const labels = {
    ru: {
      head: "голове",
      neck: "шее",
      chest: "груди",
      belly: "животе",
      back: "спине",
      leftArm: "левой руке",
      rightArm: "правой руке",
      leftLeg: "левой ноге",
      rightLeg: "правой ноге",
      maleGroin: "паховой области и половых органах",
      breasts: "молочных железах",
      femalePelvis: "области малого таза",
    },
    kk: {
      head: "баста",
      neck: "мойында",
      chest: "кеудеде",
      belly: "іште",
      back: "арқада",
      leftArm: "сол қолда",
      rightArm: "оң қолда",
      leftLeg: "сол аяқта",
      rightLeg: "оң аяқта",
      maleGroin: "шат аймағында және жыныс мүшелерінде",
      breasts: "сүт бездерінде",
      femalePelvis: "кіші жамбас аймағында",
    },
    en: {
      head: "head",
      neck: "neck",
      chest: "chest",
      belly: "belly",
      back: "back",
      leftArm: "left arm",
      rightArm: "right arm",
      leftLeg: "left leg",
      rightLeg: "right leg",
      maleGroin: "male groin or genitals",
      breasts: "breasts",
      femalePelvis: "female pelvis",
    },
  };

  const userSymptoms = String(symptoms || "").trim();
  const specialistRecommendation = getTriageSpecialistRecommendation({
    bodyPart,
    sex,
    pregnant,
    symptoms,
  });

  if (locale === "kk") {
    return `Сіз ${labels.kk[bodyPart]} ауырсынуды белгіледіңіз.${userSymptoms ? ` Көрсетілген симптомдар: ${userSymptoms}.` : ""}${specialistRecommendation ? ` Ұсынылатын маман: ${specialistRecommendation.specialty}.` : ""} Бұл диагноз емес: симптомдар күшейсе немесе басылмаса, дәрігерге көрініңіз. Қатты ентігу, кеуде ауыруы, есінен тану, құрысу, қан кету болса жедел жәрдем шақырыңыз. Қазір демалып, суды жеткілікті ішіп, дене қызуын және жалпы жағдайды бақылаңыз.`;
  }
  if (locale === "en") {
    return `You selected pain in the ${labels.en[bodyPart]}.${userSymptoms ? ` Reported symptoms: ${userSymptoms}.` : ""}${specialistRecommendation ? ` Suggested specialist: ${specialistRecommendation.specialty}.` : ""} This is not a diagnosis: if symptoms worsen or persist, contact a clinician. Seek emergency care immediately for severe chest pain, shortness of breath, fainting, seizures, or bleeding. For now, rest, hydrate, and monitor your temperature and overall condition.`;
  }
  return `Вы отметили боль в ${labels.ru[bodyPart]}.${userSymptoms ? ` Указанные симптомы: ${userSymptoms}.` : ""}${specialistRecommendation ? ` Рекомендуемый специалист: ${specialistRecommendation.specialty}.` : ""} Это не диагноз: если симптомы усиливаются или не проходят, обратитесь к врачу. Срочно вызывайте скорую при сильной боли в груди, одышке, потере сознания, судорогах или кровотечении. Пока наблюдайте за состоянием, пейте воду и по возможности ограничьте нагрузку.`;
}

app.post("/api/triage", triageRateLimit, async (req, res) => {
  let bodyPart = "head";
  let locale = "ru";
  try {
    ({ bodyPart, locale = "ru" } = req.body || {});
    const { symptoms = "", painLevel, patient_id, sex, pregnant } = req.body || {};
    const pain = Number.isFinite(Number(painLevel))
      ? Math.max(0, Math.min(10, Number(painLevel)))
      : null;
    const normalizedSex = sex === "female" || sex === "male" ? sex : null;
    const normalizedPregnant = normalizedSex === "female" && Boolean(pregnant);
    const specialistRecommendation = getTriageSpecialistRecommendation({
      bodyPart,
      sex: normalizedSex,
      pregnant: normalizedPregnant,
      symptoms,
    });

    if (!bodyPart || !BODY_PART_LABELS[bodyPart]) {
      return res.status(400).json({ error: "triage_failed" });
    }

    const bodyPartLabel = BODY_PART_LABELS[bodyPart];
    const questionParts = [`Беспокоит область: ${bodyPartLabel}.`];
    if (normalizedSex === "male") questionParts.push("Пол пациента: мужской.");
    if (normalizedSex === "female") questionParts.push("Пол пациента: женский.");
    if (normalizedPregnant) questionParts.push("Пациентка беременна.");
    if (pain !== null) questionParts.push(`Уровень боли: ${pain}/10.`);
    const trimmedSymptoms = String(symptoms).trim();
    if (trimmedSymptoms) questionParts.push(`Симптомы: ${trimmedSymptoms}.`);
    if (specialistRecommendation) {
      questionParts.push(`Предварительно подходит специалист: ${specialistRecommendation.specialty}.`);
    }
    questionParts.push("Что это может быть, какой специалист может подойти и какие препараты помогут?");
    const question = questionParts.join(" ");

    if (hasClaudeTriageConfig()) {
      try {
        const answer = await generateBodyTriageAnswer({
          bodyPartLabel,
          locale,
          symptoms,
          painLevel: pain,
          sex: normalizedSex,
          pregnant: normalizedPregnant,
          recommendedSpecialist: specialistRecommendation?.specialty || null,
        });

        return res.json({
          answer,
          source: "anthropic",
          sources: [],
          recommendedSpecialist: specialistRecommendation?.specialty || null,
          specialistReason: specialistRecommendation?.reason || null,
        });
      } catch (anthropicError) {
        console.error(
          "triage_anthropic_error:",
          anthropicError?.message || anthropicError,
          anthropicError?.cause?.message ? `cause: ${anthropicError.cause.message}` : ""
        );
      }
    }

    try {
      const patientId = String(patient_id || "guest").trim();
      const { askMedicalAssistant } = require("./services/aiRagService");
      const result = await askMedicalAssistant({ patientId, question });

      return res.json({
        answer: result.answer,
        source: "rag",
        sources: result.sources,
        recommendedSpecialist: specialistRecommendation?.specialty || null,
        specialistReason: specialistRecommendation?.reason || null,
      });
    } catch (ragError) {
      console.error(
        "triage_rag_error:",
        ragError?.message || ragError,
        ragError?.cause?.message ? `cause: ${ragError.cause.message}` : ""
      );
    }

    return res.json({
      answer: getFallbackTriageAdvice(bodyPart, locale, symptoms, {
        sex: normalizedSex,
        pregnant: normalizedPregnant,
      }),
      source: "fallback",
      recommendedSpecialist: specialistRecommendation?.specialty || null,
      specialistReason: specialistRecommendation?.reason || null,
    });
  } catch (e) {
    console.error(
      "triage_error:",
      e?.message || e,
      e?.cause?.message ? `cause: ${e.cause.message}` : ""
    );
    const symptoms = req.body?.symptoms || "";
    const sex = req.body?.sex;
    const pregnant = req.body?.pregnant;
    const specialistRecommendation = getTriageSpecialistRecommendation({
      bodyPart,
      sex: sex === "female" || sex === "male" ? sex : null,
      pregnant: sex === "female" && Boolean(pregnant),
      symptoms,
    });
    return res.json({
      answer: getFallbackTriageAdvice(bodyPart, locale, symptoms, {
        sex,
        pregnant,
      }),
      source: "fallback",
      recommendedSpecialist: specialistRecommendation?.specialty || null,
      specialistReason: specialistRecommendation?.reason || null,
    });
  }
});

// DEBUG: print registered routes
try {
  const routes = [];
  app._router?.stack?.forEach((l) => {
    if (l.route && l.route.path) {
      const methods = Object.keys(l.route.methods).join(",").toUpperCase();
      routes.push(`${methods} ${l.route.path}`);
    }
  });
  console.log("ROUTES:\n" + routes.join("\n"));
} catch (e) {
  console.log("ROUTES: cannot print", e?.message);
}

app.use((err, req, res, next) => {
  console.error("unhandled_error:", err?.message || err);
  if (res.headersSent) return next(err);
  if (err?.statusCode) {
    return res.status(err.statusCode).json({ error: err.message || "request_failed" });
  }
  return res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`Auth server running: http://localhost:${PORT}`);
});

app.get("/", (req, res) => { res.send("Backend works 🚀"); });
module.exports = app;
