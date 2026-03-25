// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
console.log('BOOT FILE:', __filename);
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const Anthropic = require("@anthropic-ai/sdk");
const { requireJwt } = require("../middleware/auth");
const ticketsRoutes = require("./routes/tickets");

dotenv.config();

const app = express();
app.use(express.json());
const PORT = Number(process.env.PORT) || 4000;
const CORS_ORIGINS = String(
  process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (CORS_ORIGINS.includes(origin)) return callback(null, true);
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const TRIAGE_MAX_TOKENS = Number(process.env.TRIAGE_MAX_TOKENS) || 900;

app.get("/auth/google/url", (req, res) => {
  const url = oauthClient.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    access_type: "offline",
    prompt: "consent",
  });
  res.json({ url });
});

app.post("/auth/google/exchange", async (req, res) => {
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

    const user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };

    const myToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ token: myToken, user });
  } catch (e) {
    res.status(500).json({ error: "Auth failed" });
  }
});

// ===== Measurements (demo device -> server) =====
const measurements = [];

app.get("/api/measurements/my", requireJwt, (req, res) => {
  const my = measurements
    .filter((m) => m.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ items: my });
});

app.post("/api/measurements", requireJwt, (req, res) => {
  const { deviceId = "device-001" } = req.body || {};
  const now = new Date().toISOString();

  const m = {
    id: globalThis.crypto.randomUUID(),
    userId: req.user.id,
    deviceId,
    createdAt: now,
    systolic: 110 + Math.floor(Math.random() * 25),
    diastolic: 70 + Math.floor(Math.random() * 15),
    tempC: Math.round((36.2 + Math.random() * 1.6) * 10) / 10,
    hr: 60 + Math.floor(Math.random() * 35),
    spo2: 95 + Math.floor(Math.random() * 5),
    note: "Симуляция измерения от устройства",
  };

  measurements.push(m);
  res.json({ item: m });
});

app.use("/api/tickets", ticketsRoutes);

const BODY_PART_LABELS = {
  head: "Head",
  neck: "Neck",
  chest: "Chest",
  belly: "Belly",
  back: "Back",
  leftArm: "Left arm",
  rightArm: "Right arm",
  leftLeg: "Left leg",
  rightLeg: "Right leg",
};

function getLocaleInstruction(locale) {
  if (locale === "kk") return "Respond in Kazakh language.";
  if (locale === "en") return "Respond in English language.";
  return "Respond in Russian language.";
}

function getLanguageName(locale) {
  if (locale === "kk") return "Kazakh";
  if (locale === "en") return "English";
  return "Russian";
}

function getFallbackTriageAdvice(bodyPart, locale, symptoms) {
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
    },
  };

  const userSymptoms = String(symptoms || "").trim();

  if (locale === "kk") {
    return `Сіз ${labels.kk[bodyPart]} ауырсынуды белгіледіңіз.${userSymptoms ? ` Көрсетілген симптомдар: ${userSymptoms}.` : ""} Бұл диагноз емес: симптомдар күшейсе немесе басылмаса, дәрігерге көрініңіз. Қатты ентігу, кеуде ауыруы, есінен тану, құрысу, қан кету болса жедел жәрдем шақырыңыз. Қазір демалып, суды жеткілікті ішіп, дене қызуын және жалпы жағдайды бақылаңыз.`;
  }
  if (locale === "en") {
    return `You selected pain in the ${labels.en[bodyPart]}.${userSymptoms ? ` Reported symptoms: ${userSymptoms}.` : ""} This is not a diagnosis: if symptoms worsen or persist, contact a clinician. Seek emergency care immediately for severe chest pain, shortness of breath, fainting, seizures, or bleeding. For now, rest, hydrate, and monitor your temperature and overall condition.`;
  }
  return `Вы отметили боль в ${labels.ru[bodyPart]}.${userSymptoms ? ` Указанные симптомы: ${userSymptoms}.` : ""} Это не диагноз: если симптомы усиливаются или не проходят, обратитесь к врачу. Срочно вызывайте скорую при сильной боли в груди, одышке, потере сознания, судорогах или кровотечении. Пока наблюдайте за состоянием, пейте воду и по возможности ограничьте нагрузку.`;
}

function buildTriagePrompt({
  localeInstruction,
  locale,
  selectedBodyPart,
  symptoms,
  painLevel,
}) {
  return [
    "User asks for initial medical triage guidance.",
    localeInstruction,
    `Selected body part: ${selectedBodyPart}`,
    `Pain level: ${
      painLevel !== null && painLevel !== undefined ? `${painLevel}/10` : "Not provided"
    }`,
    `Symptoms: ${String(symptoms).trim() || "Not provided"}`,
    "",
    "Requirements:",
    "- This is NOT a diagnosis.",
    `- Output language must be strictly ${getLanguageName(locale)} only. Do not mix with other languages.`,
    "- Keep response practical and structured with short sections/bullets.",
    "- Keep total response under 1600 characters and ensure the final sentence is complete (no cut-off endings).",
    "- Include: likely non-emergency possibilities (without certainty), immediate self-care steps for the next 24 hours, what to avoid.",
    "- Include gentle home exercises/mobility suggestions ONLY if generally safe for this complaint.",
    "- Include OTC medicine options for adults when appropriate (examples only), with major safety cautions/contraindications and a note to follow package instructions.",
    "- Do NOT provide prescription-only treatment plans and do NOT present medication as guaranteed cure.",
    "- Mention warning red flags and when to seek urgent/emergency care.",
    "- Suggest what to monitor and which specialist to contact next.",
    "- Keep tone calm, supportive, and safety-first.",
  ].join("\n");
}

async function askClaude(prompt) {
  const response = await anthropic.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest",
    max_tokens: TRIAGE_MAX_TOKENS,
    temperature: 0.2,
    system:
      "You are a cautious medical triage assistant. You provide safety-first guidance, never claim definitive diagnosis, and avoid unsafe prescribing.",
    messages: [{ role: "user", content: prompt }],
  });

  return (
    response.content
      ?.map((chunk) => (chunk.type === "text" ? chunk.text : ""))
      .join("\n")
      .trim() || ""
  );
}

async function askGemini(prompt, apiKey) {
  const candidateModels = [
    GEMINI_MODEL,
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ];

  // Try to discover available models for this key/project first.
  try {
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      const discovered = (listData?.models || [])
        .filter((m) =>
          Array.isArray(m?.supportedGenerationMethods)
            ? m.supportedGenerationMethods.includes("generateContent")
            : false
        )
        .map((m) => String(m.name || "").replace(/^models\//, ""))
        .filter(Boolean);

      if (discovered.length > 0) {
        // Put discovered models first, keep existing fallbacks after.
        for (const model of [...discovered, ...candidateModels]) {
          if (!candidateModels.includes(model)) candidateModels.push(model);
        }
      }
    }
  } catch {
    // Ignore discovery errors and continue with static fallback models.
  }

  let lastError = "unknown";

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: TRIAGE_MAX_TOKENS,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      lastError = `model=${model} status=${response.status} body=${errText}`;
      // Try next model on 404/400. Keep last error for final throw.
      if (response.status === 404 || response.status === 400) continue;
      throw new Error(`Gemini API ${lastError}`);
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("\n")
        .trim() || "";
    if (text) return text;
    lastError = `model=${model} returned empty text`;
  }

  throw new Error(`Gemini API failed for all models: ${lastError}`);
}

async function askGroq(prompt, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: TRIAGE_MAX_TOKENS,
      messages: [
        {
          role: "system",
          content:
            "You are a cautious medical triage assistant. You provide safety-first guidance, never claim definitive diagnosis, and avoid unsafe prescribing.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

app.post("/api/triage", async (req, res) => {
  let bodyPart = "head";
  let locale = "ru";
  try {
    ({ bodyPart, locale = "ru" } = req.body || {});
    const { symptoms = "", painLevel } = req.body || {};
    const pain = Number.isFinite(Number(painLevel))
      ? Math.max(0, Math.min(10, Number(painLevel)))
      : null;

    if (!bodyPart || !BODY_PART_LABELS[bodyPart]) {
      return res.status(400).json({ error: "triage_failed" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("Missing ANTHROPIC_API_KEY");
      return res.json({
        answer: getFallbackTriageAdvice(bodyPart, locale, symptoms),
        source: "fallback",
      });
    }

    const localeInstruction = getLocaleInstruction(locale);
    const selectedBodyPart = BODY_PART_LABELS[bodyPart];

    const prompt = buildTriagePrompt({
      localeInstruction,
      locale,
      selectedBodyPart,
      symptoms,
      painLevel: pain,
    });

    let answer = "";
    // Route provider by key prefix
    if (apiKey.startsWith("AIza")) {
      answer = await askGemini(prompt, apiKey);
    } else if (apiKey.startsWith("gsk_")) {
      answer = await askGroq(prompt, apiKey);
    } else {
      // Otherwise assume Anthropic key format (sk-ant-...).
      answer = await askClaude(prompt);
    }

    if (!answer) {
      return res.json({
        answer: getFallbackTriageAdvice(bodyPart, locale, symptoms),
        source: "fallback",
      });
    }

    return res.json({ answer, source: "ai" });
  } catch (e) {
    console.error(
      "triage_error:",
      e?.message || e,
      e?.cause?.message ? `cause: ${e.cause.message}` : ""
    );
    const symptoms = req.body?.symptoms || "";
    return res.json({
      answer: getFallbackTriageAdvice(bodyPart, locale, symptoms),
      source: "fallback",
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
  return res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`Auth server running: http://localhost:${PORT}`);
});

module.exports = app;
