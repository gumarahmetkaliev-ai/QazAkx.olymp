/**
 * AI Service for QazAkx.olymp Chemistry Olympiad Platform
 * Multi-provider execution engine supporting:
 * - Anthropic / OmniRoute (Claude, Gemini, etc.)
 * - Google Gemini API
 * - Groq API
 * - OpenRouter API
 * - OpenAI API
 *
 * All execution is strictly server-side.
 */

const fs = require("fs");
const path = require("path");

// Robust zero-dependency .env loader
function loadEnv() {
  const envFiles = [".env.local", ".env"];
  for (const file of envFiles) {
    const envPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          let trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          if (trimmed.startsWith("export ")) {
            trimmed = trimmed.slice(7).trim();
          }
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (!val.startsWith('"') && !val.startsWith("'") && val.includes("#")) {
              val = val.slice(0, val.indexOf("#")).trim();
            }
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key] || process.env[key].trim() === "") {
              process.env[key] = val;
            }
          }
        }
      } catch (e) {
        // Ignore env reading errors
      }
    }
  }
}

loadEnv();

function getApiKeys() {
  loadEnv();
  const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.OMNIROUTE_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.AI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAIKey = process.env.OPENAI_API_KEY;

  return {
    anthropicKey: anthropicKey && anthropicKey.trim() !== "" ? anthropicKey.trim() : null,
    geminiKey: geminiKey && geminiKey.trim() !== "" ? geminiKey.trim() : null,
    groqKey: groqKey && groqKey.trim() !== "" ? groqKey.trim() : null,
    openRouterKey: openRouterKey && openRouterKey.trim() !== "" ? openRouterKey.trim() : null,
    openAIKey: openAIKey && openAIKey.trim() !== "" ? openAIKey.trim() : null,
  };
}

/**
 * System prompt generator based on mode and language
 */
function buildSystemPrompt(mode = "analyze", lang = "ru", options = {}) {
  const languageInstructions = {
    ru: "Отвечай строго на РУССКОМ языке. Используй общепринятую химическую терминологию, формулы и номенклатуру IUPAC.",
    kz: "Жауапты қатаң түрде ҚАЗАҚ тілінде бер. Химиялық терминологияны, формулаларды және IUPAC номенклатурасын дұрыс қолдан.",
    en: "Respond strictly in ENGLISH. Use standard international chemical terminology, formulas, and IUPAC nomenclature.",
  };

  const selectedLangPrompt = languageInstructions[lang] || languageInstructions.ru;

  if (mode === "chat") {
    if (lang === "kz") {
      return `Сен — QazAkx.olymp білім беру платформасының химия олимпиадасы бойынша AI-тәлімгері және сарапшысысың (Қазақстан).
Сенің мақсатың: 7-11 сынып оқушыларына олимпиадалық химияны (ҚР Республикалық олимпиадасы, IZhO, Менделеев олимпиадасы, IChO) меңгеруге көмектесу.
Сен мына бөлімдерді жетік білесің:
- Бейорганикалық химия (Тотығу-тотықсыздану реакциялары, электронды-иондық баланс, кешенді қосылыстар, гидролиз);
- Физикалық химия (термодинамика, Гесс заңы, энтальпия, энтропия, Гиббс энергиясы, химиялық кинетика, Аррениус және Вант-Гофф теңдеулері, электрохимия, Нернст теңдеуі);
- Органикалық химия (реакциялар механизмдері, изомерия, сапалық реакциялар, синтез тізбектері);
- Аналитикалық химия (титрлеу, рН есептеу, буферлік ерітінділер, ерігіштік көбейтіндісі Ksp).

Жауап беру ережелері:
1. ${selectedLangPrompt}
2. Түсінікті, құрылымды, ғылыми дәл және пайдалы жауап бер.
3. Химиялық теңдеулерді нақты жаз (мысалы: 2KMnO4 + 16HCl -> 2KCl + 2MnCl2 + 5Cl2 + 8H2O).
4. Оқушы олимпиадалық есеп сұраса, бірден құрғақ жауап бермей, ойлау бағытын көрсет.`;
    }

    if (lang === "en") {
      return `You are an AI Mentor and Chemistry Olympiad Expert on the QazAkx.olymp platform (Kazakhstan).
Your goal is to help 7-11th grade students master chemistry olympiads (National Olympiads, IZhO, Mendeleev Olympiad, IChO).
You are an expert in:
- Inorganic Chemistry (Redox, ion-electron balance, coordination complexes, qualitative analysis);
- Physical Chemistry (Thermodynamics, Hess law, enthalpy, entropy, Gibbs energy, kinetics, Arrhenius & Van 't Hoff equations, electrochemistry, Nernst equation);
- Organic Chemistry (Reaction mechanisms, stereochemistry, isomerism, multistep synthesis);
- Analytical Chemistry (Titrations, pH calculations, buffer solutions, solubility product Ksp).

Rules for responses:
1. ${selectedLangPrompt}
2. Be structured, scientifically accurate, encouraging, and clear.
3. Write properly balanced chemical equations.
4. Encourage problem-solving methodology rather than just spitting out numerical answers.`;
    }

    return `Ты — AI-наставник и эксперт по олимпиадной химии образовательной платформы QazAkx.olymp (Казахстан).
Твоя цель: помогать школьникам 7-11 классов осваивать олимпиадную химию (Республиканская олимпиада РК, IZhO, Менделеевская олимпиада, IChO).
Ты отлично разбираешься в:
- Неорганической химии (ОВР, методы электронного и электронно-ионного баланса, свойства элементов и соединений, гидролиз, комплексные соединения);
- Физической химии (термодинамика, закон Гесса, энтальпия, энтропия, свободная энергия Гиббса, химическое равновесие, кинетика, уравнения Аррениуса и Вант-Гоффа, электрохимия, уравнение Нернста);
- Органической химии (механизмы реакций, изомерия, стереохимия, качественные реакции, цепочки превращений);
- Аналитической химии (титриметрия, расчет pH сильных и слабых кислот/оснований, буферные растворы, ПР / Ksp).

Правила ответов:
1. ${selectedLangPrompt}
2. Отвечай понятно, структурированно, научно строго, но доступно.
3. Форматируй химические уравнения с правильными индексами и коэффициентами (например: 2KMnO4 + 16HCl -> 2KCl + 2MnCl2 + 5Cl2 + 8H2O).
4. Если пользователь задает олимпиадную задачу, не давай сразу сухой ответ, а покажи логику рассуждений или задай наводящий вопрос, если уместно.`;
  }

  if (mode === "hint") {
    if (lang === "kz") {
      return `Сен — химия олимпиадасы қазылар алқасының жетекші сарапшысысың.
Сенің міндетің — оқушыға шешімнің ТОЛЫҚ ЖАУАБЫН БІРДЕН АЙТПАЙ, БАҒЫТ БЕРЕТІН КӨМЕКШІ НҰСҚАУЛАР (ПОДСКАЗКА) БЕРУ.

Нұсқау беру ережелері:
1. ${selectedLangPrompt}
2. Есеп шарты мен оқушы шешімін мұқият салыстыр.
3. Қай қадамда қате кеткенін анықта (стехиометрия, молярлық масса, тотығу дәрежесі, өлшем бірлігі, т.б.).
4. Мына құрылым бойынша нұсқау бер:
   - **1-деңгей (Тексеретін тұс):** Қай қадамға назар аудару керектігін айт.
   - **2-деңгей (Негізгі формула / Ереже):** Қажетті формуланы немесе заңды еске сал.
   - **3-деңгей (Келесі қадам):** Келесі логикалық әрекетті меңзе.
5. Соңғы сандық жауапты немесе заттың дайын формуласын жазба!`;
    }

    if (lang === "en") {
      return `You are a Senior Chemistry Olympiad Judge and Personal Tutor.
Your task is to provide progressive, Socratic HINTS to the student WITHOUT REVEALING THE FULL FINAL ANSWER OR SPOILER.

Hinting rules:
1. ${selectedLangPrompt}
2. Compare the problem statement with the student's solution steps.
3. Identify where the student went off track (stoichiometry, molar mass, oxidation state, thermodynamic sign, SI units).
4. Provide progressive hint levels:
   - **Level 1 (Where to look):** Point out which specific step contains a discrepancy.
   - **Level 2 (Key formula/rule):** Remind the student of the relevant chemical law or formula.
   - **Level 3 (Next step):** Provide a guiding clue toward the correct path.
5. Do NOT give away the final numerical answer or formula. The student should solve it!`;
    }

    return `Ты — ведущий эксперт жюри олимпиады по химии и персональный тьютор.
Твоя задача — дать УЧЕНИКУ ПОДСКАЗКУ к его решению, НЕ РАСКРЫВАЯ СРАЗУ ПОЛНОГО РЕШЕНИЯ И ОТВЕТА.

Правила подсказки:
1. ${selectedLangPrompt}
2. Внимательно сопоставь условие задачи и шаги решения ученика.
3. Определи, на каком шаге ученик сбился или допустил ошибку.
4. Дай 2-3 уровня подсказок:
   - **Уровень 1 (Наводящий вопрос / Где проверить):** Укажи, на какой этап решения стоит обратить внимание.
   - **Уровень 2 (Ключевая формула / Теоретическая подсказка):** Напомни ключевой закон или формулу.
   - **Уровень 3 (Шаг к правильному пути):** Подскажи следующий логический шаг.
5. НЕ пиши конечный численный ответ или готовую формулу. Ученик должен дойти до него сам!`;
  }

  // Default mode: "analyze" / task checking
  if (lang === "kz") {
    return `Сен — химия олимпиадалары қазылар алқасының төрағасысың.
Сенің міндетің — оқушының нақты бір олимпиадалық есепке берген шешімін тексеру.

Тексеру критерийлері:
1. ${selectedLangPrompt}
2. **Дұрыстығы (Correctness):** Физикалық және химиялық мағынасы.
3. **Химиялық теңдеулер мен формулалар:** Стехиометрия, коэффициенттер, фазалық күйлер.
4. **Есептеулер мен өлшем бірліктері:** Молярлық массалар, ХБЖ өлшем бірліктері, дөңгелектеу.
5. **Жіберілген қателер мен жетіспейтін қадамдар.**

ЖАУАП ҚҰРЫЛЫМЫ:

### 🎯 1. Вердикт және Баға
**Вердикт:** [Толықтай дұрыс / Жартылай дұрыс / Қате]
**Балл:** X / 10 (10 балдық шкала бойынша нақты балл)

### 📋 2. Не дұрыс орындалды (Күшті тұстары)
...

### 🔍 3. Анықталған қателер және түсіндірмесі
...

### 💡 4. Қалай түзетуге болады
...

### 📖 5. Дұрыс шешу жолы және толық талдау
...`;
  }

  if (lang === "en") {
    return `You are the Head of the Chemistry Olympiad Jury.
Your task is to thoroughly evaluate a student's answer to a specific Olympiad chemistry problem.

Evaluation criteria:
1. ${selectedLangPrompt}
2. **Correctness & Logic:** Scientific reasoning and methodology.
3. **Chemical Equations & Formulas:** Formula correctness, stoichiometric coefficients, oxidation numbers.
4. **Calculations & Units:** Molar masses, SI units, rounding precision, intermediate steps.
5. **Missing Steps & Identified Errors.**

RESPONSE STRUCTURE:

### 🎯 1. Overall Verdict & Score
**Verdict:** [Completely Correct / Partially Correct / Incorrect]
**Score:** X / 10 (explicit score out of 10)

### 📋 2. What Was Done Correctly (Strengths)
...

### 🔍 3. Identified Errors & Scientific Explanation
...

### 💡 4. How to Fix & Improve
...

### 📖 5. Step-by-Step Complete Solution & Guidance
...`;
  }

  return `Ты — председатель жюри олимпиад по химии и опытный тренер олимпийского резерва.
Твоя задача — провести всестороннюю, объективную и методически выверенную проверку решения конкретной олимпиадной задачи, предоставленного учеником.

Критерии проверки:
1. ${selectedLangPrompt}
2. **Корректность и логика:** Понимание сути задачи, научная строгость.
3. **Химические формулы и уравнения:** Стехиометрия, правильные коэффициенты, степени окисления.
4. **Расчетная часть и единицы измерения:** Молярные массы, единицы СИ, точность вычислений.
5. **Пропущенные шаги и выявленные ошибки.**

СТРУКТУРА ОТВЕТА (строго следуй этим разделам):

### 🎯 1. Общий вердикт и Оценка
**Вердикт:** [Решено полностью верно / Решено частично / Неверно]
**Оценка:** X / 10 (по 10-балльной шкале)

### 📋 2. Что выполнено правильно
...

### 🔍 3. Выявленные ошибки и их объяснение
...

### 💡 4. Как исправить и улучшить
...

### 📖 5. Подробный разбор и правильный подход
...`;
}

/**
 * Call Anthropic / OmniRoute API
 */
async function callAnthropic(apiKey, systemPrompt, userPrompt, options = {}) {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const model = options.model || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

  const url = `${baseUrl}/v1/messages`;
  const payload = {
    model,
    max_tokens: 3000,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(`Anthropic API Error: ${errorMsg}`);
  }

  const textBlock = data.content?.find((c) => c.type === "text") || data.content?.[0];
  const text = textBlock?.text;
  if (!text) throw new Error("Пустой ответ от Anthropic API.");

  return {
    text,
    model: data.model || model,
    provider: "anthropic",
  };
}

/**
 * Call Google Gemini API
 */
async function callGemini(apiKey, systemPrompt, userPrompt, model = null) {
  const configuredModel = process.env.GEMINI_MODEL || model || "gemini-2.5-flash";
  const candidateModels = [
    configuredModel,
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-2.5-pro",
    "gemini-1.5-pro",
  ];

  const modelsToTry = [...new Set(candidateModels)];
  let lastError = null;

  for (const currentModel of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const payload = {
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.95,
          maxOutputTokens: 3000,
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        const errorMsg = data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        lastError = new Error(`Gemini (${currentModel}): ${errorMsg}`);
        if (response.status === 404 || errorMsg.includes("not found") || errorMsg.includes("deprecated")) {
          continue;
        }
        if (response.status === 400 && errorMsg.toLowerCase().includes("key")) {
          throw new Error(`Invalid Gemini API Key: ${errorMsg}`);
        }
        if (response.status === 429) {
          throw new Error(`Gemini API Quota Exceeded (429): ${errorMsg}`);
        }
        continue;
      }

      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;

      if (!text) {
        if (candidate?.finishReason === "SAFETY") {
          throw new Error("Ответ заблокирован фильтром безопасности Gemini.");
        }
        throw new Error("Пустой ответ от Gemini API.");
      }

      return {
        text,
        model: currentModel,
        provider: "gemini",
      };
    } catch (err) {
      lastError = err;
      if (err.message.includes("Invalid Gemini API Key") || err.message.includes("Quota Exceeded")) {
        throw err;
      }
    }
  }

  throw lastError || new Error("Не удалось получить ответ от моделей Gemini API.");
}

/**
 * Call Groq API
 */
async function callGroq(apiKey, systemPrompt, userPrompt, model = null) {
  const chosenModel = process.env.GROQ_MODEL || model || "llama-3.3-70b-versatile";
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const payload = {
    model: chosenModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 3000,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `HTTP ${response.status}`;
    throw new Error(`Groq API Error: ${errorMsg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Пустой ответ от Groq API.");

  return {
    text,
    model: data.model || chosenModel,
    provider: "groq",
  };
}

/**
 * Call OpenRouter API
 */
async function callOpenRouter(apiKey, systemPrompt, userPrompt, model = null) {
  const chosenModel = process.env.OPENROUTER_MODEL || model || "google/gemini-2.5-flash";
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const payload = {
    model: chosenModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 3000,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://qazakxolymp.vercel.app",
      "X-Title": "QazAkx.olymp",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenRouter API Error: ${errorMsg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Пустой ответ от OpenRouter API.");

  return {
    text,
    model: data.model || chosenModel,
    provider: "openrouter",
  };
}

/**
 * Call OpenAI API
 */
async function callOpenAI(apiKey, systemPrompt, userPrompt, model = null) {
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const chosenModel = process.env.OPENAI_MODEL || model || "gpt-4o-mini";

  const payload = {
    model: chosenModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 3000,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI API Error: ${errorMsg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Пустой ответ от OpenAI API.");

  return {
    text,
    model: data.model || chosenModel,
    provider: "openai",
  };
}

/**
 * Main AI execution handler with multi-provider waterfall
 */
async function processAIRequest({ prompt, systemPrompt, mode = "analyze", language = "ru", options = {} }) {
  const { anthropicKey, geminiKey, groqKey, openRouterKey, openAIKey } = getApiKeys();

  if (!anthropicKey && !geminiKey && !groqKey && !openRouterKey && !openAIKey) {
    return {
      success: false,
      error: "AI_UNAVAILABLE",
      message: "AI временно недоступен. Попробуйте ещё раз.",
    };
  }

  const finalSystemPrompt = systemPrompt || buildSystemPrompt(mode, language, options);
  const errors = [];

  // Provider 1: Anthropic / OmniRoute (if configured)
  if (anthropicKey) {
    try {
      const result = await callAnthropic(anthropicKey, finalSystemPrompt, prompt, options);
      return { success: true, data: result };
    } catch (err) {
      console.warn("Anthropic provider attempt failed:", err.message);
      errors.push(`Anthropic: ${err.message}`);
    }
  }

  // Provider 2: Google Gemini (if configured)
  if (geminiKey) {
    try {
      const result = await callGemini(geminiKey, finalSystemPrompt, prompt, options.model);
      return { success: true, data: result };
    } catch (err) {
      console.warn("Gemini provider attempt failed:", err.message);
      errors.push(`Gemini: ${err.message}`);
    }
  }

  // Provider 3: Groq (if configured)
  if (groqKey) {
    try {
      const result = await callGroq(groqKey, finalSystemPrompt, prompt, options.model);
      return { success: true, data: result };
    } catch (err) {
      console.warn("Groq provider attempt failed:", err.message);
      errors.push(`Groq: ${err.message}`);
    }
  }

  // Provider 4: OpenRouter (if configured)
  if (openRouterKey) {
    try {
      const result = await callOpenRouter(openRouterKey, finalSystemPrompt, prompt, options.model);
      return { success: true, data: result };
    } catch (err) {
      console.warn("OpenRouter provider attempt failed:", err.message);
      errors.push(`OpenRouter: ${err.message}`);
    }
  }

  // Provider 5: OpenAI (if configured)
  if (openAIKey) {
    try {
      const result = await callOpenAI(openAIKey, finalSystemPrompt, prompt, options.model);
      return { success: true, data: result };
    } catch (err) {
      console.warn("OpenAI provider attempt failed:", err.message);
      errors.push(`OpenAI: ${err.message}`);
    }
  }

  return {
    success: false,
    error: "AI_CALL_FAILED",
    message: "Не удалось получить ответ от AI провайдеров. Попробуйте ещё раз позже.",
  };
}

/**
 * Check Chemistry Olympiad Solution (single generic problem check)
 */
async function checkChemistrySolution({
  problem,
  solution,
  mode = "analyze",
  language = "ru",
  grade = null,
  topic = null,
  question = null,
}) {
  if (!problem || !problem.trim()) {
    return {
      success: false,
      error: "MISSING_PROBLEM",
      message: "Пожалуйста, укажите условие задачи.",
    };
  }

  if (mode !== "hint" && (!solution || !solution.trim())) {
    return {
      success: false,
      error: "MISSING_SOLUTION",
      message: "Пожалуйста, введите ваше решение для проверки (или переключитесь в режим подсказки).",
    };
  }

  const metaContext = [];
  if (grade) metaContext.push(`Класс: ${grade}`);
  if (topic) metaContext.push(`Раздел химии: ${topic}`);

  let prompt = "";
  if (metaContext.length > 0) {
    prompt += `[КОНТЕКСТ ЗАДАЧИ: ${metaContext.join(", ")}]\n\n`;
  }

  prompt += `### УСЛОВИЕ ОЛИМПИАДНОЙ ЗАДАЧИ:\n${problem.trim()}\n\n`;

  if (solution && solution.trim()) {
    prompt += `### РЕШЕНИЕ УЧЕНИКА:\n${solution.trim()}\n\n`;
  } else {
    prompt += `### РЕШЕНИЕ УЧЕНИКА:\n(Ученик пока не предоставил полное решение и просит наводящую подсказку для начала)\n\n`;
  }

  if (question && question.trim()) {
    prompt += `### КОНКРЕТНЫЙ ВОПРОС УЧЕНИКА:\n${question.trim()}\n\n`;
  }

  const systemPrompt = buildSystemPrompt(mode, language, { grade, topic });

  return await processAIRequest({
    prompt,
    systemPrompt,
    mode,
    language,
    options: { grade, topic },
  });
}

/**
 * Check a Single Specific Olympiad Task with complete context & official solution
 */
async function checkOlympiadTask({
  olympiad = {},
  task = {},
  answers = {},
  answer = "",
  language = "ru",
}) {
  if (!task || (!task.text && !task.statement && !task.title)) {
    return {
      success: false,
      error: "MISSING_TASK",
      message: "Данные задачи отсутствуют.",
    };
  }

  // 1. Compose student solution across structured parts and general text
  let formattedStudentAnswer = "";
  if (answers && typeof answers === "object" && Object.keys(answers).length > 0) {
    const validParts = Object.entries(answers).filter(([_, val]) => val && String(val).trim());
    if (validParts.length > 0) {
      formattedStudentAnswer = validParts
        .map(([key, val]) => `[Пункт ${key}]\n${String(val).trim()}`)
        .join("\n\n");
    }
  }

  if (answer && String(answer).trim()) {
    if (formattedStudentAnswer) {
      formattedStudentAnswer += `\n\n[Общие расчеты / ход решения]\n${String(answer).trim()}`;
    } else {
      formattedStudentAnswer = String(answer).trim();
    }
  }

  if (!formattedStudentAnswer) {
    return {
      success: false,
      error: "MISSING_ANSWER",
      message: "Пожалуйста, введите ответ хотя бы на один пункт задачи.",
    };
  }

  // 2. Build task context
  const taskNumber = task.number || 1;
  const taskTitle = task.title || `Задача №${taskNumber}`;
  const taskStatement = task.statement || task.text || taskTitle;
  const subject = olympiad.subject || "Химия";
  const year = olympiad.year || "2024";
  const grade = olympiad.grade || "9";

  let prompt = `### КОНТЕКСТ ОЛИМПИАДЫ:\n`;
  prompt += `- Предмет: ${subject}\n`;
  prompt += `- Год: ${year}\n`;
  prompt += `- Класс: ${grade}\n`;
  prompt += `- Название задачи: ${taskTitle}\n\n`;

  prompt += `### УСЛОВИЕ ЗАДАЧИ:\n${taskStatement}\n\n`;

  if (task.parts && Array.isArray(task.parts) && task.parts.length > 0) {
    prompt += `### ПУНКТЫ ЗАДАЧИ:\n`;
    task.parts.forEach((p) => {
      prompt += `- Пункт ${p.label}: ${p.title || p.text}\n`;
    });
    prompt += "\n";
  }

  if (task.officialSolution && task.officialSolution.trim()) {
    prompt += `### ОФИЦИАЛЬНОЕ ЭТАЛОННОЕ РЕШЕНИЕ (Используй для точной сверки критериев и ответов):\n`;
    prompt += `${task.officialSolution.trim()}\n\n`;
  } else {
    prompt += `### ОФИЦИАЛЬНОЕ ЭТАЛОННОЕ РЕШЕНИЕ:\n(Официальное решение отсутствует. Проведи объективную проверку строго по химическим законам, стехиометрии и условию задачи).\n\n`;
  }

  prompt += `### ОТВЕТ УЧЕНИКА ДЛЯ ПРОВЕРКИ:\n${formattedStudentAnswer}\n\n`;
  prompt += `Проверь ответ ученика по 10-балльной шкале, укажи вердикт (Решено полностью верно / Решено частично / Неверно), разбери ошибки, отметь правильные шаги и покажи эталонный путь.`;

  const systemPrompt = buildSystemPrompt("analyze", language, { grade, topic: subject });

  const aiRes = await processAIRequest({
    prompt,
    systemPrompt,
    mode: "analyze",
    language,
    options: { grade, topic: subject },
  });

  if (!aiRes.success) {
    return aiRes;
  }

  const aiText = aiRes.data?.text || "";
  const { verdict, score, maxScore } = parseScoreAndVerdict(aiText);

  let finalAiText = aiText;
  if (!task.officialSolution) {
    const disclaimer =
      language === "kz"
        ? "\n\n> ℹ️ *Ресми шешім табылмады. Тексеру есептің шарты мен математикалық-химиялық логика негізінде жасалды.*"
        : language === "en"
        ? "\n\n> ℹ️ *Official solution not found. Verification performed based on problem statement and scientific logic.*"
        : "\n\n> ℹ️ *Официальное решение не найдено. Проверка выполнена по условию задачи и математико-химической логике.*";
    if (!finalAiText.includes("Официальное решение не найдено") && !finalAiText.includes("Ресми шешім табылмады") && !finalAiText.includes("Official solution not found")) {
      finalAiText += disclaimer;
    }
  }

  return {
    success: true,
    data: {
      text: finalAiText,
      verdict,
      score,
      maxScore,
      hasOfficialSolution: Boolean(task.officialSolution),
      timestamp: Date.now(),
      model: aiRes.data?.model,
      provider: aiRes.data?.provider,
    },
  };
}

/**
 * Score & Verdict Parser
 */
function parseScoreAndVerdict(aiText) {
  let verdict = "partially_correct";
  let score = 5;
  let maxScore = 10;

  const lower = (aiText || "").toLowerCase();

  // 1. Check explicit verdict
  if (
    lower.includes("полностью верно") ||
    lower.includes("completely correct") ||
    lower.includes("толықтай дұрыс") ||
    lower.includes("вердикт: [решено полностью верно]") ||
    lower.includes("вердикт: решено полностью верно")
  ) {
    verdict = "correct";
    score = 10;
  } else if (
    lower.includes("концептуальная ошибка") ||
    lower.includes("вердикт: неверно") ||
    lower.includes("вердикт: [неверно]") ||
    lower.includes("incorrect") ||
    lower.includes("қате бар") ||
    lower.includes("вердикт: қате")
  ) {
    verdict = "incorrect";
    score = 2;
  } else {
    verdict = "partially_correct";
    score = 6;
  }

  // 2. Parse explicit score like 8/10 or 10/10 or "Оценка:** 9 / 10"
  const scoreMatch = /(?:оценка|балл|score|ұпай)?[:\s*]*(\d{1,2})\s*(?:\/|из|out of)\s*(\d{1,2})/i.exec(aiText || "");
  if (scoreMatch) {
    const parsedSc = parseInt(scoreMatch[1], 10);
    const parsedMax = parseInt(scoreMatch[2], 10);
    if (!isNaN(parsedSc) && !isNaN(parsedMax) && parsedMax > 0 && parsedSc <= parsedMax) {
      score = parsedSc;
      maxScore = parsedMax;
      if (score >= maxScore * 0.85) verdict = "correct";
      else if (score <= maxScore * 0.35) verdict = "incorrect";
      else verdict = "partially_correct";
    }
  }

  return { verdict, score, maxScore };
}

/**
 * Chat conversation handler
 */
async function handleChat({ message, history = [], language = "ru", grade = null }) {
  if (!message || !message.trim()) {
    return {
      success: false,
      error: "MISSING_MESSAGE",
      message: "Сообщение не может быть пустым.",
    };
  }

  const systemPrompt = buildSystemPrompt("chat", language, { grade });

  let conversationText = "";
  if (Array.isArray(history) && history.length > 0) {
    conversationText += "История диалога:\n";
    const recentHistory = history.slice(-6);
    for (const h of recentHistory) {
      const role = h.role === "user" ? "Ученик" : "AI Наставник";
      conversationText += `${role}: ${h.text || h.content || ""}\n`;
    }
    conversationText += "\n";
  }

  conversationText += `Вопрос/Сообщение ученика: ${message.trim()}`;

  return await processAIRequest({
    prompt: conversationText,
    systemPrompt,
    mode: "chat",
    language,
    options: { grade },
  });
}

/**
 * Health check & configuration status
 */
function getAIHealth() {
  const { anthropicKey, geminiKey, groqKey, openRouterKey, openAIKey } = getApiKeys();
  const configured = Boolean(anthropicKey || geminiKey || groqKey || openRouterKey || openAIKey);

  let defaultModel = null;
  if (anthropicKey) {
    defaultModel = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
  } else if (geminiKey) {
    defaultModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  } else if (groqKey) {
    defaultModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  } else if (openRouterKey) {
    defaultModel = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
  } else if (openAIKey) {
    defaultModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  return {
    status: "ok",
    configured,
    providers: {
      anthropic: Boolean(anthropicKey),
      gemini: Boolean(geminiKey),
      groq: Boolean(groqKey),
      openrouter: Boolean(openRouterKey),
      openai: Boolean(openAIKey),
    },
    defaultModel,
    supportedLanguages: ["ru", "kz", "en"],
    supportedModes: ["analyze", "hint", "step_by_step", "chat"],
  };
}

module.exports = {
  loadEnv,
  getApiKeys,
  getApiKey: getApiKeys,
  buildSystemPrompt,
  processAIRequest,
  checkChemistrySolution,
  checkOlympiadTask,
  parseScoreAndVerdict,
  handleChat,
  getAIHealth,
};
