/**
 * Complete AI Service & Endpoint Tests for QazAkx.olymp
 */

const http = require("http");
const { buildSystemPrompt, getAIHealth, checkChemistrySolution, checkOlympiadTask, handleChat } = require("./api/lib/ai-service");
const server = require("./server");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log("  ✓ PASS: " + message);
    passed++;
  } else {
    console.error("  ✗ FAIL: " + message);
    failed++;
  }
}

function makeRequest(port, path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, headers: res.headers, body: data, raw });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log("\n🧪 Running Complete AI Suite Tests...\n");

  // 1. Health check & security audit
  console.log("Test 1: Health check & security audit");
  const health = getAIHealth();
  assert(health.status === "ok", "Health status is ok");
  assert(health.configured === true, "AI provider is configured");
  assert(Array.isArray(health.supportedLanguages) && health.supportedLanguages.includes("kz"), "Kazakh language supported");
  assert(health.supportedModes.includes("hint") && health.supportedModes.includes("analyze"), "Modes hint and analyze supported");
  assert(!JSON.stringify(health).includes("AIza") && !JSON.stringify(health).includes("sk-") && !JSON.stringify(health).includes("ci_"), "Zero API key leakage in health response");

  // 2. System prompt generation & multi-language support
  console.log("\nTest 2: System prompt generation for RU, KZ, EN");
  const ruPrompt = buildSystemPrompt("analyze", "ru");
  assert(ruPrompt.includes("РУССКОМ") && ruPrompt.includes("жюри") && ruPrompt.includes("Вердикт") && ruPrompt.includes("Оценка"), "Russian analyze prompt includes jury, language mandate, and structured sections");

  const kzPrompt = buildSystemPrompt("analyze", "kz");
  assert(kzPrompt.includes("ҚАЗАҚ") && kzPrompt.includes("қазылар") && kzPrompt.includes("Вердикт"), "Kazakh analyze prompt includes Kazakh jury, instructions, and localized verdict/score headers");

  const enAnalyzePrompt = buildSystemPrompt("analyze", "en");
  assert(enAnalyzePrompt.includes("ENGLISH") && enAnalyzePrompt.includes("Jury") && enAnalyzePrompt.includes("Verdict") && enAnalyzePrompt.includes("Score"), "English analyze prompt includes English jury instructions and verdict/score markers");

  const enHintPrompt = buildSystemPrompt("hint", "en");
  assert(enHintPrompt.includes("ENGLISH") && (enHintPrompt.includes("HINTS") || enHintPrompt.includes("NOT REVEALING")), "English hint prompt works");

  const chatKzPrompt = buildSystemPrompt("chat", "kz");
  assert(chatKzPrompt.includes("ҚАЗАҚ") && chatKzPrompt.includes("QazAkx.olymp"), "Kazakh chat prompt contains platform identity");

  // 3. Validation on missing inputs
  console.log("\nTest 3: Input validation");
  const emptyProblem = await checkChemistrySolution({ problem: "", solution: "" });
  assert(!emptyProblem.success && emptyProblem.error === "MISSING_PROBLEM", "Empty problem is properly rejected");

  const emptySolution = await checkChemistrySolution({ problem: "Найдите условие", solution: "", mode: "analyze" });
  assert(!emptySolution.success && emptySolution.error === "MISSING_SOLUTION", "Empty solution in analyze mode is properly rejected");

  const emptyChat = await handleChat({ message: "" });
  assert(!emptyChat.success && emptyChat.error === "MISSING_MESSAGE", "Empty chat message is properly rejected");

  const emptyTask = await checkOlympiadTask({ task: null });
  assert(!emptyTask.success && emptyTask.error === "MISSING_TASK", "Empty task is rejected");

  // 4. HTTP Server endpoints testing
  console.log("\nTest 4: HTTP server endpoints testing");
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;

  try {
    // 4.1 GET /api/health
    const healthRes = await makeRequest(testPort, "/api/health");
    assert(healthRes.status === 200 && healthRes.body.status === "ok", "GET /api/health returns 200 OK");

    // 4.2 POST /api/chat with valid live request
    console.log("\nTest 5: Live Real AI Chat Request");
    const chatRes = await makeRequest(testPort, "/api/chat", "POST", {
      message: "Какова молярная масса воды H2O? Ответьте кратко числом с единицами измерения.",
      language: "ru",
      grade: 8,
    });
    assert(chatRes.status === 200 && chatRes.body.success === true, "POST /api/chat returns HTTP 200 with success: true");
    assert(chatRes.body.data?.text.includes("18"), "AI chat correctly stated 18 g/mol");

    // 4.3 POST /api/check-task (Task 1 Chemistry 2024 with official solution)
    console.log("\nTest 6: Live Task Check (RU) with official solution mapping");

    // First, ensure we have the tasks detected and mapped
    const extractRes = await makeRequest(testPort, "/api/extract-tasks", "POST", {
      file: "olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf"
    });
    assert(extractRes.status === 200 && extractRes.body.success === true, "PDF extraction succeeds");

    const detectReq = {
      method: "POST",
      body: { file: "olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf" }
    };
    let detectOutput = null;
    const detectResMock = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(payload) { detectOutput = JSON.parse(payload); }
    };
    await require("./api/detect-tasks")(detectReq, detectResMock);

    assert(detectOutput.success === true, "detect-tasks returned success: true");
    assert(detectOutput.solutionsMapped === true, "Solutions mapped successfully");

    // 4.4 POST /api/check-task without official solution (disclaimer check)
    console.log("\nTest 7: Live Task Check without official solution (disclaimer present)");
    const noSolTaskRes = await makeRequest(testPort, "/api/check-task", "POST", {
      olympiad: { subject: "Химия", year: 2024, grade: 9 },
      task: {
        number: 1,
        title: "Задача по энтальпии",
        statement: "Рассчитите уравнение реакции водорода при t°С = 100°C.",
        officialSolution: null
      },
      answer: "ΔH° реакции = -286 кДж",
      language: "ru"
    });
    assert(noSolTaskRes.status === 200 && noSolTaskRes.body.success === true, "Task check without official solution succeeded");
    assert(noSolTaskRes.body.data?.hasOfficialSolution === false, "Recorded hasOfficialSolution = false");
    assert(noSolTaskRes.body.data?.text.includes("Официальное решение не найдено") || noSolTaskRes.body.data?.text.includes("Official solution not found"), "Includes explicit disclaimer that official solution was not found");

    // 4.5 Multilingual checks: KZ and EN
    console.log("\nTest 8: Multilingual AI checks in KZ & EN");
    const kzCheckRes = await makeRequest(testPort, "/api/check-task", "POST", {
      olympiad: { subject: "Химия", year: 2024, grade: 9 },
      task: { number: 1, title: "1-есеп", statement: "Судың (H2O) 36 граммындагы зат молшерін есептениз." },
      answer: "n = 36 / 18 = 2 моль",
      language: "kz"
    });
    assert(kzCheckRes.status === 200 && kzCheckRes.body.success === true, "Kazakh task check succeeded");

    const enCheckRes = await makeRequest(testPort, "/api/check-task", "POST", {
      olympiad: { subject: "Chemistry", year: 2024, grade: 9 },
      task: { number: 1, title: "Problem 1", statement: "Calculate the molar mass of methane CH4." },
      answer: "M(CH4) = 12 + 4 = 16 g/mol",
      language: "en"
    });
    assert(enCheckRes.status === 200 && enCheckRes.body.success === true, "English task check succeeded");

  } finally {
    server.close();
  }

  console.log("\n========================================");
  console.log("AI Test Results: " + passed + " passed, " + failed + " failed");
  console.log("========================================\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests().catch((e) => {
  console.error("Test suite error:", e);
  process.exitCode = 1;
});
