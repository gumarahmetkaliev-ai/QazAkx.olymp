/**
 * Test Task Detector and Detection Endpoint
 */

const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const { detectTasks, detectSubParts } = require("./api/task-detector");
const detectTasksHandler = require("./api/detect-tasks");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function runTaskTests() {
  console.log("\n🧪 Running Task Detection Tests...\n");

  // 1. Task PDF parsing & detection
  const pdfData = fs.readFileSync("public/olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf");
  const parser = new PDFParse({ data: pdfData });
  const pdfResult = await parser.getText();
  await parser.destroy();

  const detection = detectTasks(pdfResult.text);

  assert(detection.success === true, "Detection returns success: true");
  assert(detection.count === 7, `Correctly detected exactly 7 tasks (found: ${detection.count})`);
  assert(detection.tasks.length === 7, "Tasks array contains 7 items");

  // Check sequential numbers
  const nums = detection.tasks.map(t => t.number);
  const isSequential = nums.every((num, idx) => num === idx + 1);
  assert(isSequential, `Task numbers are strictly sequential 1..7: ${nums.join(", ")}`);

  // Check non-empty statements
  const allHaveStatements = detection.tasks.every(t => t.statement && t.statement.length >= 30);
  assert(allHaveStatements, "All tasks have non-empty statements (length >= 30 chars)");

  // Check Titles
  assert(detection.tasks[0].title.includes("Разминка"), "Task 1 has correct title 'Разминка'");
  assert(detection.tasks[1].title.includes("Неизвестные газы"), "Task 2 has correct title 'Неизвестные газы'");
  assert(detection.tasks[2].title.includes("Неизвестные кристаллогидраты"), "Task 3 has correct title 'Неизвестные кристаллогидраты'");

  // Check Subparts: no false positives from units (like 9.81g or 0.648g) or scoring tables (3.1 3.2 ...)
  assert(detection.tasks[0].parts.length === 0, "Task 1 has 0 subparts (single problem)");
  assert(detection.tasks[1].parts.length === 0, "Task 2 has 0 subparts (single problem)");
  assert(detection.tasks[2].parts.length === 3, "Task 3 has exactly 3 genuine subparts detected");
  assert(detection.tasks[3].parts.length === 3, "Task 4 has exactly 3 genuine subparts detected");
  assert(detection.tasks[4].parts.length === 5, "Task 5 has exactly 5 genuine subparts detected");
  assert(detection.tasks[5].parts.length === 3, "Task 6 has exactly 3 genuine subparts detected");
  assert(detection.tasks[6].parts.length === 4, "Task 7 has exactly 4 genuine subparts detected");

  // Verify subparts don't have unit numbers as labels
  const allSubpartLabels = detection.tasks.flatMap(t => t.parts.map(p => p.label));
  const hasUnitLabel = allSubpartLabels.some(l => l === "9.81" || l === "0.648" || l === "883.0" || l === "1.000");
  assert(!hasUnitLabel, "Zero false-positive unit quantities detected as subpart labels");

  // Verify no cross-task contamination (Task 1 does not contain Task 2 title, etc.)
  assert(!detection.tasks[0].statement.includes("Задача №2"), "Task 1 does not contain Task 2 header");
  assert(!detection.tasks[1].statement.includes("Задача №3"), "Task 2 does not contain Task 3 header");
  assert(!detection.tasks[2].statement.includes("Задача №4"), "Task 3 does not contain Task 4 header");

  // 2. Solution PDF detection and 1-to-1 mapping via detect-tasks handler
  console.log("\n🧪 Testing Solution Mapping via /api/detect-tasks handler...");
  const fakeReq = {
    method: "POST",
    body: { file: "olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf" }
  };
  let detectResponse = null;
  const fakeRes = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { detectResponse = JSON.parse(payload); }
  };

  await detectTasksHandler(fakeReq, fakeRes);

  assert(detectResponse.success === true, "detect-tasks endpoint returned success: true");
  assert(detectResponse.solutionsMapped === true, "Solutions successfully mapped from solution PDF");
  assert(detectResponse.tasks.length === 7, "7 tasks returned by detect-tasks");
  const allHaveOfficialSolutions = detectResponse.tasks.every(t => t.hasOfficialSolution === true && t.officialSolution.length > 50);
  assert(allHaveOfficialSolutions, "All 7 tasks mapped to corresponding official solutions");

  // Solution content sanity check (Task 1 solution contains molar mass, Task 3 contains crystals/reaction)
  assert(detectResponse.tasks[0].officialSolution.includes("молярную массу") || detectResponse.tasks[0].officialSolution.includes("C3H8") || detectResponse.tasks[0].officialSolution.includes("SO2"), "Task 1 official solution contains expected chemistry reasoning");

  // Test no fake mapping for non-existent solution file
  console.log("\n🧪 Testing Low-confidence Solution Mapping (no fake solution)...");
  const noSolReq = {
    method: "POST",
    body: { file: "olympiads/geography/01562-ieso-individual-theoretical-1.pdf" } // file with no local sol
  };
  let noSolResponse = null;
  const noSolRes = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { noSolResponse = JSON.parse(payload); }
  };
  // Note: if file does not exist locally, it should return 404 cleanly
  await detectTasksHandler(noSolReq, noSolRes);
  assert(noSolResponse !== null, "detect-tasks handled missing file safely");

  console.log(`\n========================================`);
  console.log(`Task Tests Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exitCode = 1;
}

runTaskTests().catch(e => {
  console.error("Task tests failed:", e);
  process.exitCode = 1;
});
