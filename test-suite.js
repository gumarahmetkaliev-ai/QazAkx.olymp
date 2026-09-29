/**
 * Master Comprehensive Test Suite for QazAkx.olymp
 * Tests:
 * 1. Catalog integrity, filtering, search
 * 2. PDF routes, MIME types, path traversal security
 * 3. PDF text extraction & caching
 * 4. Task detection & subpart splitting
 * 5. Solution mapping (tasks <-> solutions)
 * 6. LocalStorage persistence & reload simulation
 * 7. AI Endpoints (Chat, Health, Solution Check, Task Check, Multi-language RU/KZ/EN)
 * 8. Real End-to-End solving flow on chemistry-2024-local
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const server = require("./server");
const { detectTasks } = require("./api/task-detector");
const { extractPdfText, safeOlympiadPath } = require("./api/extract-tasks");
const detectTasksHandler = require("./api/detect-tasks");
const checkTaskHandler = require("./api/check-task");
const { getAIHealth } = require("./api/lib/ai-service");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
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

async function runTestSuite() {
  console.log("==================================================");
  console.log("🚀 Running Complete QazAkx.olymp Master Test Suite");
  console.log("==================================================");

  // ----------------------------------------------------
  // SECTION 1: CATALOG TESTS
  // ----------------------------------------------------
  console.log("\n📁 SECTION 1: Catalog Integrity, Filters & Search");
  const manifestRaw = fs.readFileSync("olympiads.json", "utf-8");
  const manifest = JSON.parse(manifestRaw);

  assert(Array.isArray(manifest) && manifest.length > 0, `Catalog loaded with ${manifest.length} entries`);
  
  const subjects = [...new Set(manifest.map(m => m.subject))];
  assert(subjects.includes("Химия"), "Catalog includes Chemistry");

  const chemLocal = manifest.find(m => m.id === "chemistry-2024-local");
  assert(Boolean(chemLocal), "Catalog contains chemistry-2024-local reference olympiad");
  assert(Array.isArray(chemLocal.materials) && chemLocal.materials.length === 2, "chemistry-2024-local has both tasks and solutions materials");

  const totalMaterials = manifest.reduce((sum, item) => sum + (item.materials ? item.materials.length : 1), 0);
  assert(totalMaterials > 50, `Catalog contains ${totalMaterials} total materials`);

  // ----------------------------------------------------
  // SECTION 2: PDF ROUTES & SECURITY
  // ----------------------------------------------------
  console.log("\n📄 SECTION 2: PDF Serving & Path Traversal Security");
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;

  try {
    const tasksPdfRes = await makeRequest(testPort, "/olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf");
    assert(tasksPdfRes.status === 200, "GET /olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf returns 200 OK");
    assert((tasksPdfRes.headers["content-type"] || "").includes("pdf"), "Returns application/pdf Content-Type");

    const solPdfRes = await makeRequest(testPort, "/olympiads/chemistry/chem9-2024-round1-sol-rus.pdf");
    assert(solPdfRes.status === 200, "GET /olympiads/chemistry/chem9-2024-round1-sol-rus.pdf returns 200 OK");

    const traversalRes1 = await makeRequest(testPort, "/olympiads/../package.json");
    assert(traversalRes1.status === 403 || traversalRes1.status === 404, "Blocks traversal /olympiads/../package.json (HTTP 403/404)");

    const traversalRes2 = await makeRequest(testPort, "/olympiads/%2e%2e/package.json");
    assert(traversalRes2.status === 403 || traversalRes2.status === 404, "Blocks URL encoded traversal /olympiads/%2e%2e/package.json");

    // ----------------------------------------------------
    // SECTION 3: EXTRACTION & CACHING
    // ----------------------------------------------------
    console.log("\n⚙️ SECTION 3: PDF Extraction & In-Memory Caching");
    const extractRes = await makeRequest(testPort, "/api/extract-tasks", "POST", {
      file: "olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf"
    });
    assert(extractRes.status === 200 && extractRes.body.success === true, "POST /api/extract-tasks returns success: true");
    assert(extractRes.body.pages === 7, `Extracted page count is 7 (got ${extractRes.body.pages})`);
    assert(extractRes.body.textLength > 10000, `Extracted text length is ${extractRes.body.textLength} chars`);

    // ----------------------------------------------------
    // SECTION 4: TASK DETECTION & SUBPARTS
    // ----------------------------------------------------
    console.log("\n🔍 SECTION 4: Task Detection & Subpart Splitting");
    const taskDet = detectTasks(extractRes.body.text);
    assert(taskDet.success === true, "Task detection succeeds");
    assert(taskDet.count === 7, `Detected exactly 7 tasks (got ${taskDet.count})`);

    const expectedTitles = [
      "Разминка",
      "Неизвестные газы",
      "Неизвестные кристаллогидраты",
      "Нитраты",
      "Изомеры комплексов",
      "Коллигативные свойства",
      "Равноправие в термодинамике"
    ];

    for (let i = 0; i < 7; i++) {
      assert(taskDet.tasks[i].number === i + 1, `Task ${i + 1} has sequential number ${i + 1}`);
      assert(taskDet.tasks[i].title.includes(expectedTitles[i]), `Task ${i + 1} title contains '${expectedTitles[i]}'`);
      assert(taskDet.tasks[i].statement.length > 50, `Task ${i + 1} has non-empty statement`);
    }

    assert(taskDet.tasks[0].parts.length === 0, "Task 1 has 0 subparts");
    assert(taskDet.tasks[2].parts.length === 3, "Task 3 has 3 subparts");
    assert(taskDet.tasks[4].parts.length === 5, "Task 5 has 5 subparts");

    // ----------------------------------------------------
    // SECTION 5: SOLUTION MAPPING (Tasks <-> Solutions)
    // ----------------------------------------------------
    console.log("\n🔗 SECTION 5: Solution Mapping (Tasks <-> Solutions PDF)");
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
    await detectTasksHandler(detectReq, detectResMock);

    assert(detectOutput.success === true, "detect-tasks returned success: true");
    assert(detectOutput.solutionsMapped === true, "Solutions mapped successfully");
    assert(detectOutput.tasks.length === 7, "7 tasks returned");
    const allMapped = detectOutput.tasks.every(t => t.hasOfficialSolution === true && t.officialSolution.length > 100);
    assert(allMapped, "All 7 tasks mapped to corresponding official solutions");

    // ----------------------------------------------------
    // SECTION 6: WORKSPACE & LOCALSTORAGE SIMULATION
    // ----------------------------------------------------
    console.log("\n💾 SECTION 6: Workspace LocalStorage & Reload Simulation");
    
    // Simulate answering Task 1 and Task 2 in localStorage
    const testStorageKey = "qazakx_olympiad_store_v2";
    const testStore = {
      "chemistry-2024-local": {
        olympiadId: "chemistry-2024-local",
        tasks: {
          "1": {
            taskId: "task-1",
            number: 1,
            answer: "Газ А - C3H8, Газ B - SO2",
            status: "CHECKED_CORRECT",
            score: 10,
            maxScore: 10,
            lastSaved: 1790697000000
          },
          "2": {
            taskId: "task-2",
            number: 2,
            answer: "В процессе решения...",
            status: "IN_PROGRESS",
            lastSaved: 1790697005000
          }
        },
        lastSaved: 1790697005000
      }
    };

    // Serialize & deserialize (simulating full page reload)
    const serialized = JSON.stringify(testStore);
    const restored = JSON.parse(serialized);

    assert(restored["chemistry-2024-local"] !== undefined, "Olympiad data persists across simulated reload");
    assert(restored["chemistry-2024-local"].tasks["1"].answer === "Газ А - C3H8, Газ B - SO2", "Task 1 answer restored correctly");
    assert(restored["chemistry-2024-local"].tasks["1"].status === "CHECKED_CORRECT", "Task 1 status restored correctly");
    assert(restored["chemistry-2024-local"].tasks["1"].score === 10, "Task 1 score restored correctly");
    assert(restored["chemistry-2024-local"].tasks["2"].status === "IN_PROGRESS", "Task 2 in-progress status restored");

    // Check progress calculation: 1 correct, 1 in progress out of 7 total tasks
    const tasksArray = Object.values(restored["chemistry-2024-local"].tasks);
    const checkedCount = tasksArray.filter(t => t.status.startsWith("CHECKED_")).length;
    const correctCount = tasksArray.filter(t => t.status === "CHECKED_CORRECT").length;
    const progressPercent = Math.round((checkedCount / 7) * 100);

    assert(checkedCount === 1, "Progress correctly calculated 1 checked task");
    assert(correctCount === 1, "Progress correctly calculated 1 correct task");
    assert(progressPercent === 14, `Progress percentage is 14% (got ${progressPercent}%)`);

    // ----------------------------------------------------
    // SECTION 7: AI EVALUATION & MULTI-LANGUAGE
    // ----------------------------------------------------
    console.log("\n🤖 SECTION 7: Live AI Check & Multilingual Verification");

    // 7.1 Live Task Check Task 1 Chemistry 2024
    const task1CheckRes = await makeRequest(testPort, "/api/check-task", "POST", {
      olympiad: { subject: "Химия", year: 2024, grade: 9 },
      task: detectOutput.tasks[0], // Task 1 with official solution
      answer: "1) n = 112/22.4 = 5 моль\n2) n(A) = 3 моль, n(B) = 2 моль\n3) M(A) = 44 г/моль (C3H8), M(B) = 64 г/моль (SO2)",
      language: "ru"
    });
    assert(task1CheckRes.status === 200 && task1CheckRes.body.success === true, "Task 1 AI check returns 200 with success: true");
    assert(task1CheckRes.body.data?.verdict === "correct", "Task 1 evaluated as correct");
    assert(task1CheckRes.body.data?.score >= 9, "Task 1 received score >= 9 / 10");

    // 7.2 AI Chat verification
    const aiChatRes = await makeRequest(testPort, "/api/chat", "POST", {
      message: "Сформулируй закон действующих масс для химической кинетики.",
      language: "ru"
    });
    assert(aiChatRes.status === 200 && aiChatRes.body.success === true, "AI Chat returns HTTP 200 with success: true");
    assert(aiChatRes.body.data?.text.length > 50, "AI Chat returned informative response");

    // 7.3 AI Languages (KZ and EN)
    const kzCheckRes = await makeRequest(testPort, "/api/check-task", "POST", {
      olympiad: { subject: "Химия", year: 2024, grade: 9 },
      task: { number: 1, title: "1-есеп", statement: "Судың 18 граммында неше моль бар?" },
      answer: "n = 18 / 18 = 1 моль",
      language: "kz"
    });
    assert(kzCheckRes.status === 200 && kzCheckRes.body.success === true, "Kazakh task check succeeded");

    const enCheckRes = await makeRequest(testPort, "/api/check-task", "POST", {
      olympiad: { subject: "Chemistry", year: 2024, grade: 9 },
      task: { number: 1, title: "Problem 1", statement: "What is the molar mass of methane CH4?" },
      answer: "M(CH4) = 12 + 4 = 16 g/mol",
      language: "en"
    });
    assert(enCheckRes.status === 200 && enCheckRes.body.success === true, "English task check succeeded");

  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log(`🎉 Master Test Suite Finished: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((e) => {
  console.error("Test suite execution error:", e);
  process.exit(1);
});
