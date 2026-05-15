// @ts-nocheck
/**
 * HealthAssist Custom AI Engine
 * Медицинская экспертная система — без внешних API.
 * Анализирует показатели пациента и выдаёт рекомендации.
 */

// ─── 1. ПОРОГОВЫЕ ЗНАЧЕНИЯ ────────────────────────────────────────────────────

const THRESHOLDS = {
  temp: {
    hypothermia:   { max: 35.0,  label: "Гипотермия",         tone: "critical" },
    low_normal:    { min: 35.0,  max: 36.0, label: "Пониженная температура", tone: "warn" },
    normal:        { min: 36.0,  max: 37.5, label: "Норма",               tone: "ok" },
    subfebrile:    { min: 37.5,  max: 38.5, label: "Субфебрильная",        tone: "warn" },
    fever:         { min: 38.5,  max: 40.0, label: "Высокая температура",  tone: "critical" },
    hyperpyrexia:  { min: 40.0,             label: "Гиперпирексия",        tone: "critical" },
  },
  hr: {
    bradycardia_severe: { max: 40,   label: "Выраженная брадикардия",  tone: "critical" },
    bradycardia:        { min: 40,  max: 60,  label: "Брадикардия",          tone: "warn" },
    normal:             { min: 60,  max: 100, label: "Норма",                tone: "ok" },
    tachycardia:        { min: 100, max: 120, label: "Тахикардия",           tone: "warn" },
    tachycardia_severe: { min: 120,           label: "Выраженная тахикардия", tone: "critical" },
  },
  systolic: {
    shock:          { max: 80,   label: "Шоковое состояние",   tone: "critical" },
    hypotension:    { min: 80,  max: 90,  label: "Гипотония",            tone: "critical" },
    low_normal:     { min: 90,  max: 110, label: "Пониженное давление",  tone: "warn" },
    normal:         { min: 110, max: 140, label: "Норма",                tone: "ok" },
    prehypertension:{ min: 140, max: 160, label: "Предгипертония",       tone: "warn" },
    hypertension:   { min: 160, max: 180, label: "Гипертония",           tone: "critical" },
    crisis:         { min: 180,           label: "Гипертонический криз",  tone: "critical" },
  },
  spo2: {
    severe_hypoxia: { max: 90,  label: "Тяжёлая гипоксия", tone: "critical" },
    hypoxia:        { min: 90, max: 94, label: "Гипоксия",         tone: "critical" },
    low_normal:     { min: 94, max: 96, label: "Пониженный SpO₂",  tone: "warn" },
    normal:         { min: 96,          label: "Норма",             tone: "ok" },
  },
};

// ─── 2. АНАЛИЗ ОДНОГО ПОКАЗАТЕЛЯ ─────────────────────────────────────────────

function classifyVital(value, scale) {
  if (value == null || isNaN(value)) return null;
  for (const [key, range] of Object.entries(scale)) {
    const aboveMin = range.min == null || value >= range.min;
    const belowMax = range.max == null || value < range.max;
    if (aboveMin && belowMax) return { key, ...range, value };
  }
  return null;
}

function analyzeVitalSigns({ tempC, hr, systolic, diastolic, spo2 }) {
  return {
    temp:    classifyVital(tempC,    THRESHOLDS.temp),
    hr:      classifyVital(hr,       THRESHOLDS.hr),
    systolic:classifyVital(systolic, THRESHOLDS.systolic),
    spo2:    classifyVital(spo2,     THRESHOLDS.spo2),
  };
}

// ─── 3. ПАТТЕРН-МАТЧЕР (определяем состояния) ────────────────────────────────

const PATTERNS = [
  {
    id: "hypertensive_crisis",
    label: "Гипертонический криз",
    match: (v) => v.systolic?.key === "crisis",
    severity: "critical",
    doctor: "кардиолог",
    urgency: "срочно",
    drugs: ["Каптоприл", "Нифедипин"],
    actions: [
      "Уложить пациента с приподнятым изголовьем",
      "Вызвать врача немедленно",
      "Обеспечить покой и тишину",
      "Измерять давление каждые 5 минут",
    ],
  },
  {
    id: "shock",
    label: "Признаки шока",
    match: (v) => v.systolic?.key === "shock" && v.hr?.tone === "critical",
    severity: "critical",
    doctor: "реаниматолог",
    urgency: "срочно",
    drugs: [],
    actions: [
      "НЕМЕДЛЕННО вызвать реаниматолога",
      "Уложить пациента горизонтально, приподнять ноги",
      "Обеспечить венозный доступ",
      "Мониторинг каждые 2 минуты",
    ],
  },
  {
    id: "severe_hypoxia",
    label: "Тяжёлая гипоксия",
    match: (v) => v.spo2?.key === "severe_hypoxia",
    severity: "critical",
    doctor: "пульмонолог",
    urgency: "срочно",
    drugs: ["Сальбутамол"],
    actions: [
      "НЕМЕДЛЕННО вызвать врача",
      "Подать кислород",
      "Придать полусидячее положение",
    ],
  },
  {
    id: "hyperpyrexia",
    label: "Гиперпирексия (критическая температура)",
    match: (v) => v.temp?.key === "hyperpyrexia",
    severity: "critical",
    doctor: "инфекционист",
    urgency: "срочно",
    drugs: ["Парацетамол", "Ибупрофен", "Метамизол натрия"],
    actions: [
      "Вызвать врача срочно",
      "Физическое охлаждение (влажные простыни)",
      "Обильное питьё",
      "Контроль температуры каждые 30 минут",
    ],
  },
  {
    id: "fever_tachycardia",
    label: "Лихорадка с тахикардией (вероятная инфекция)",
    match: (v) =>
      (v.temp?.key === "fever" || v.temp?.key === "subfebrile") &&
      (v.hr?.key === "tachycardia" || v.hr?.key === "tachycardia_severe"),
    severity: "warn",
    doctor: "терапевт / инфекционист",
    urgency: "в течение дня",
    drugs: ["Парацетамол", "Ибупрофен"],
    actions: [
      "Назначить жаропонижающее",
      "Обеспечить обильное питьё",
      "Взять анализы крови",
      "Контроль температуры каждый час",
    ],
  },
  {
    id: "hypertension",
    label: "Гипертония",
    match: (v) => v.systolic?.key === "hypertension" || v.systolic?.key === "prehypertension",
    severity: "warn",
    doctor: "кардиолог",
    urgency: "в течение дня",
    drugs: ["Лизиноприл", "Амлодипин", "Бисопролол"],
    actions: [
      "Исключить физическую нагрузку",
      "Обеспечить покой",
      "Повторно измерить давление через 15 минут",
    ],
  },
  {
    id: "hypotension",
    label: "Гипотония",
    match: (v) => v.systolic?.key === "hypotension" || v.systolic?.key === "low_normal",
    severity: "warn",
    doctor: "терапевт",
    urgency: "в течение дня",
    drugs: ["Мидодрин"],
    actions: [
      "Уложить пациента горизонтально",
      "Дать обильное питьё",
      "Мониторинг каждые 15 минут",
    ],
  },
  {
    id: "bradycardia",
    label: "Брадикардия",
    match: (v) => v.hr?.key === "bradycardia" || v.hr?.key === "bradycardia_severe",
    severity: v => v.hr?.key === "bradycardia_severe" ? "critical" : "warn",
    doctor: "кардиолог",
    urgency: v => v.hr?.key === "bradycardia_severe" ? "срочно" : "в течение дня",
    drugs: ["Атропин"],
    actions: [
      "Записать ЭКГ",
      "Проверить принимаемые препараты",
      v => v.hr?.key === "bradycardia_severe" ? "Вызвать кардиолога немедленно" : "Направить к кардиологу",
    ],
  },
  {
    id: "hypoxia",
    label: "Гипоксия",
    match: (v) => v.spo2?.key === "hypoxia" || v.spo2?.key === "low_normal",
    severity: v => v.spo2?.key === "hypoxia" ? "warn" : "ok",
    doctor: "пульмонолог",
    urgency: v => v.spo2?.key === "hypoxia" ? "в течение дня" : "плановый",
    drugs: [],
    actions: [
      "Проверить проходимость дыхательных путей",
      v => v.spo2?.key === "hypoxia" ? "Подать увлажнённый кислород" : "Дыхательная гимнастика",
    ],
  },
  {
    id: "hypothermia",
    label: "Гипотермия",
    match: (v) => v.temp?.key === "hypothermia" || v.temp?.key === "low_normal",
    severity: v => v.temp?.key === "hypothermia" ? "critical" : "warn",
    doctor: "терапевт",
    urgency: v => v.temp?.key === "hypothermia" ? "срочно" : "в течение дня",
    drugs: [],
    actions: [
      "Согреть пациента (одеяло, тёплое питьё)",
      v => v.temp?.key === "hypothermia" ? "Вызвать врача немедленно" : "Контроль температуры",
    ],
  },
  {
    id: "normal",
    label: "Показатели в норме",
    match: (v) =>
      (v.temp == null || v.temp.tone === "ok") &&
      (v.hr == null || v.hr.tone === "ok") &&
      (v.systolic == null || v.systolic.tone === "ok") &&
      (v.spo2 == null || v.spo2.tone === "ok"),
    severity: "ok",
    doctor: "лечащий врач",
    urgency: "плановый",
    drugs: [],
    actions: ["Продолжить текущую терапию", "Плановый осмотр по расписанию"],
  },
];

// ─── 4. ДВИЖОК СОПОСТАВЛЕНИЯ ПАТТЕРНОВ ───────────────────────────────────────

function resolve(val, vitals) {
  return typeof val === "function" ? val(vitals) : val;
}

function matchPatterns(vitals) {
  const matched = PATTERNS.filter((p) => p.match(vitals));
  const nonNormal = matched.filter((p) => p.id !== "normal");
  if (nonNormal.length === 0) return [PATTERNS.find((p) => p.id === "normal")];
  return nonNormal;
}

// ─── 5. ФОРМИРОВАНИЕ РЕКОМЕНДАЦИЙ ────────────────────────────────────────────

function overallStatus(patterns, vitals) {
  const hasCritical = patterns.some((p) => resolve(p.severity, vitals) === "critical");
  const hasWarn = patterns.some((p) => resolve(p.severity, vitals) === "warn");
  if (hasCritical) return "критично";
  if (hasWarn) return "внимание";
  return "норма";
}

function buildConcerns(vitals) {
  const concerns = [];
  if (vitals.temp && vitals.temp.tone !== "ok")
    concerns.push(`Температура ${vitals.temp.value}°C — ${vitals.temp.label}`);
  if (vitals.hr && vitals.hr.tone !== "ok")
    concerns.push(`Пульс ${vitals.hr.value} уд/мин — ${vitals.hr.label}`);
  if (vitals.systolic && vitals.systolic.tone !== "ok")
    concerns.push(`АД ${vitals.systolic.value} мм рт.ст. — ${vitals.systolic.label}`);
  if (vitals.spo2 && vitals.spo2.tone !== "ok")
    concerns.push(`SpO₂ ${vitals.spo2.value}% — ${vitals.spo2.label}`);
  return concerns;
}

function buildSummary(patterns, vitals, status) {
  if (status === "норма") {
    return "Все показатели пациента в пределах нормы. Продолжить наблюдение в плановом режиме.";
  }
  const names = patterns.map((p) => p.label).join(", ");
  const urgencies = [...new Set(patterns.map((p) => resolve(p.urgency, vitals)))];
  return `Выявлено: ${names}. Требуется вмешательство: ${urgencies.join(", ")}.`;
}

// ─── 6. СОПОСТАВЛЕНИЕ С ЯЧЕЙКАМИ РОБОТА ──────────────────────────────────────

function matchMedsWithRobot(recommendedDrugs, robotSlots) {
  return recommendedDrugs.map((drugName) => {
    const slot = robotSlots.find(
      (s) => s.drug && s.drug.toLowerCase().includes(drugName.toLowerCase())
    );
    return {
      drug: drugName,
      compartment: slot?.compartment ?? null,
      dosage: slot?.dosage ?? "по назначению врача",
      available_in_robot: Boolean(slot),
      reason: "рекомендован по показателям",
    };
  });
}

// ─── 7. ГЛАВНАЯ ФУНКЦИЯ ───────────────────────────────────────────────────────

const DISCLAIMER =
  "Это автоматический анализ экспертной системы. Обязательно проконсультируйтесь с лечащим врачом.";

function analyzeVitals({ tempC, hr, systolic, diastolic, spo2, medication = [] }) {
  const vitals = analyzeVitalSigns({ tempC, hr, systolic, diastolic, spo2 });
  const patterns = matchPatterns(vitals);
  const status = overallStatus(patterns, vitals);

  // Собираем уникальных врачей и срочность (берём самую высокую)
  const urgencyRank = { "срочно": 3, "в течение дня": 2, "плановый": 1 };
  const allDoctors = [...new Set(patterns.map((p) => p.doctor))];
  const topUrgency = patterns.reduce((best, p) => {
    const u = resolve(p.urgency, vitals);
    return urgencyRank[u] > urgencyRank[best] ? u : best;
  }, "плановый");

  // Собираем рекомендуемые препараты
  const allDrugs = [...new Set(patterns.flatMap((p) => p.drugs ?? []))];
  const medications = matchMedsWithRobot(allDrugs, medication);

  // Собираем действия (убираем дубли)
  const allActions = [
    ...new Set(
      patterns.flatMap((p) =>
        (p.actions ?? []).map((a) => resolve(a, vitals)).filter(Boolean)
      )
    ),
  ];

  const concerns = buildConcerns(vitals);
  const summary = buildSummary(patterns, vitals, status);

  return {
    advice: {
      status,
      summary,
      concerns,
      doctor: allDoctors.join(" / "),
      doctor_urgency: topUrgency,
      medications,
      actions: allActions,
      patterns: patterns.map((p) => p.label),
    },
    disclaimer: DISCLAIMER,
    engine: "HealthAssist Custom AI Engine v1.0",
  };
}

module.exports = { analyzeVitals };
