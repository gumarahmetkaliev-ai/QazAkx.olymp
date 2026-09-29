/**
 * PHASE 1: PDF Extraction & Security Test
 * Tests extraction from local PDF files with security and caching verification
 */

const http = require("http");
const server = require("./server");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
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
            resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : {} });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, body: { raw } });
          }
        });
      }
    );
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runExtractTests() {
  console.log("\n🧪 PDF Extraction & Path Traversal Security Tests...\n");

  const testPort = 3002;
  const testServer = server.listen(testPort, async () => {
    try {
      console.log(`Test 1: Extract chem9-2024-round1-tasks-rus.pdf`);
      const t0 = Date.now();
      const extractRes = await makeRequest(testPort, "/api/extract-tasks", "POST", {
        file: "olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf"
      });
      const t1 = Date.now();

      assert(extractRes.status === 200, "HTTP 200 response");
      assert(extractRes.body.success === true, "success: true");
      assert(typeof extractRes.body.pages === "number" && extractRes.body.pages > 0, `pages > 0 (found ${extractRes.body.pages})`);
      assert(typeof extractRes.body.text === "string" && extractRes.body.text.length > 0, `text length > 0 (found ${extractRes.body.textLength} chars)`);
      assert(extractRes.body.text.includes("Константы") || extractRes.body.text.includes("моль−1") || extractRes.body.text.includes("Задача"), "contains chemistry constants / tasks");

      console.log(`\nTest 2: Caching performance on repeated extract`);
      const t2 = Date.now();
      const cachedRes = await makeRequest(testPort, "/api/extract-tasks", "POST", {
        file: "olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf"
      });
      const t3 = Date.now();
      assert(cachedRes.status === 200 && cachedRes.body.success === true, "Cached response succeeds");
      assert(t3 - t2 <= t1 - t0 + 10, `Cached call is fast (${t3 - t2}ms vs initial ${t1 - t0}ms)`);

      console.log(`\nTest 3: Security - Path Traversal Protection`);
      const testCases = [
        "../../../etc/passwd",
        "olympiads/chemistry/../../server.js",
        "/etc/shadow",
        "olympiads/..%2f..%2fserver.js",
        "package.json",
        "olympiads/chemistry/nonexistent.pdf"
      ];

      for (const tc of testCases) {
        const secRes = await makeRequest(testPort, "/api/extract-tasks", "POST", { file: tc });
        assert(secRes.status === 403 || secRes.status === 404, `Properly blocked or returned 404 for '${tc}' (got HTTP ${secRes.status})`);
      }

    } catch (error) {
      console.error("Test error:", error);
      failed++;
    } finally {
      testServer.close();

      console.log(`\n========================================`);
      console.log(`PDF Extraction Results: ${passed} passed, ${failed} failed`);
      console.log(`========================================\n`);

      process.exitCode = failed > 0 ? 1 : 0;
    }
  });
}

runExtractTests().catch((e) => {
  console.error("Fatal error:", e);
  process.exitCode = 1;
});
