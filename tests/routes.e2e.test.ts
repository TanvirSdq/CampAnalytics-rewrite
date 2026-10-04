import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
let serverProcess: ChildProcess | null = null;

// Helper to make HTTP requests
async function makeRequest(
  route: string,
  options: RequestInit = {}
): Promise<{ status: number; headers: Headers; text: string; json: any }> {
  const url = route.startsWith('http') ? route : `${BASE_URL}${route}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'CampAnalytics-E2E-Tester/1.0',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let json = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    text,
    json
  };
}

// Wait for server to become responsive
async function waitForServer(url: string, maxAttempts = 20, delayMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

before(async () => {
  // Check if server is already running
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    if (res.ok) {
      console.log(`[E2E] Reusing existing server at ${BASE_URL}`);
      return;
    }
  } catch {
    // Server not running, spawn one
  }

  console.log(`[E2E] Spawning test server at ${BASE_URL}...`);
  const serverEntry = fs.existsSync(path.join(projectRoot, 'src/server.ts')) ? 'src/server.ts' : 'server.ts';
  const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  
  serverProcess = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '3000', HOST: '127.0.0.1' },
    stdio: 'pipe'
  });

  serverProcess.stdout?.on('data', (d) => {
    // optional logging if needed
  });
  serverProcess.stderr?.on('data', (d) => {
    console.error(`[Server STDERR] ${d.toString()}`);
  });

  const isReady = await waitForServer(BASE_URL);
  if (!isReady) {
    throw new Error(`[E2E] Server failed to start at ${BASE_URL} within timeout.`);
  }
  console.log(`[E2E] Server ready at ${BASE_URL}`);
});

after(async () => {
  if (serverProcess) {
    console.log('[E2E] Terminating spawned server process...');
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  }
});

// ============================================================================
// TIER 1: FEATURE COVERAGE (All Endpoints Happy Path & Template Integrity)
// ============================================================================
describe('Tier 1: Feature Coverage & Route Routing Integrity', () => {
  test('GET / - returns 200 OK and renders home tool directory', async () => {
    const res = await makeRequest('/');
    assert.equal(res.status, 200, 'Expected status 200 for /');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );
    assert.ok(
      res.text.includes('CampTools') || res.text.includes('Welcome to CampTools'),
      'Expected home page to contain CampTools branding'
    );
  });

  test('GET /tools - returns 200 OK and renders tools directory', async () => {
    const res = await makeRequest('/tools');
    assert.equal(res.status, 200, 'Expected status 200 for /tools');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );
    assert.ok(
      res.text.includes('CampTools') || res.text.includes('Welcome to CampTools'),
      'Expected /tools to render tools directory'
    );
  });

  test('GET /influx - returns Influx-specific HTML and NOT home page (R1 Acceptance)', async () => {
    const res = await makeRequest('/influx');
    assert.equal(res.status, 200, 'Expected status 200 for /influx');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );

    // Specific Influx markers mandated by requirement R1
    assert.ok(
      res.text.includes('id="influx-form"') || res.text.includes('#influx-form'),
      'Expected /influx to contain #influx-form'
    );
    assert.ok(
      res.text.includes('Year-over-Year New User Influx'),
      'Expected /influx to contain "Year-over-Year New User Influx"'
    );

    // Negative assertion: Must NOT serve home.html content
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'CRITICAL R1 DEFECT: /influx incorrectly served home.html ("Welcome to CampTools")'
    );
  });

  test('GET /health - returns Health-specific HTML and NOT home page (R1 Acceptance)', async () => {
    const res = await makeRequest('/health');
    assert.equal(res.status, 200, 'Expected status 200 for /health');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );

    // Specific Health markers mandated by requirement R1
    assert.ok(
      res.text.includes('id="health-form"') || res.text.includes('#health-form'),
      'Expected /health to contain #health-form'
    );
    assert.ok(
      res.text.includes('Evaluation'),
      'Expected /health to contain "Evaluation"'
    );
    assert.ok(
      res.text.includes('scorecard-grid'),
      'Expected /health to contain ".scorecard-grid"'
    );

    // Negative assertion: Must NOT serve home.html content
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'CRITICAL R1 DEFECT: /health incorrectly served home.html ("Welcome to CampTools")'
    );
  });

  test('GET /retention - returns Retention-specific HTML and NOT home page', async () => {
    const res = await makeRequest('/retention');
    assert.equal(res.status, 200, 'Expected status 200 for /retention');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );

    assert.ok(
      res.text.includes('id="retention-form"') || res.text.includes('#retention-form'),
      'Expected /retention to contain #retention-form'
    );
    assert.ok(
      res.text.includes('Retention Analysis'),
      'Expected /retention to contain "Retention Analysis"'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'Expected /retention not to serve home.html ("Welcome to CampTools")'
    );
  });

  test('GET /utility - returns Content Utility-specific HTML and NOT home page', async () => {
    const res = await makeRequest('/utility');
    assert.equal(res.status, 200, 'Expected status 200 for /utility');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );

    assert.ok(
      res.text.includes('id="utility-form"') || res.text.includes('#utility-form'),
      'Expected /utility to contain #utility-form'
    );
    assert.ok(
      res.text.includes('Content Utility'),
      'Expected /utility to contain "Content Utility"'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'Expected /utility not to serve home.html ("Welcome to CampTools")'
    );
  });

  test('GET /quality - returns Quality Recognition-specific HTML and NOT home page', async () => {
    const res = await makeRequest('/quality');
    assert.equal(res.status, 200, 'Expected status 200 for /quality');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );

    assert.ok(
      res.text.includes('id="quality-form"') || res.text.includes('#quality-form'),
      'Expected /quality to contain #quality-form'
    );
    assert.ok(
      res.text.includes('Quality Recognition'),
      'Expected /quality to contain "Quality Recognition"'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'Expected /quality not to serve home.html ("Welcome to CampTools")'
    );
  });

  test('GET /documentation - returns Documentation page', async () => {
    const res = await makeRequest('/documentation');
    assert.equal(res.status, 200, 'Expected status 200 for /documentation');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/html/,
      'Expected text/html content-type'
    );
    assert.ok(
      res.text.includes('Documentation') || res.text.includes('Info &amp; Documentation') || res.text.includes('Info & Documentation'),
      'Expected /documentation to contain Documentation content'
    );
  });

  test('GET /healthz - returns 200 OK liveness check', async () => {
    const res = await makeRequest('/healthz');
    assert.equal(res.status, 200, 'Expected status 200 for /healthz');
    assert.equal(res.text.trim(), 'OK', 'Expected body to equal "OK"');
  });

  test('GET /api/retention/heatmaps - returns valid JSON response with query params', async () => {
    const res = await makeRequest(
      '/api/retention/heatmaps?target_campaigns=wlmbd22+wlmbd23&offset=0&limit=6'
    );
    // Should be either 200 with heatmaps or handled cleanly with JSON
    assert.match(
      res.headers.get('content-type') || '',
      /application\/json/,
      'Expected application/json content-type'
    );
    assert.notEqual(res.json, null, 'Expected valid parsed JSON body');
    if (res.status === 200) {
      assert.ok('heatmaps' in res.json, 'Expected heatmaps property in JSON');
    }
  });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES
// ============================================================================
describe('Tier 2: Boundary & Corner Cases', () => {
  test('GET /api/retention/heatmaps without target_campaigns returns 400 Bad Request', async () => {
    const res = await makeRequest('/api/retention/heatmaps');
    assert.equal(res.status, 400, 'Expected status 400 when missing target_campaigns');
    assert.match(
      res.headers.get('content-type') || '',
      /application\/json/,
      'Expected JSON content-type'
    );
    assert.ok(res.json, 'Expected parsed JSON response');
    assert.match(
      res.json.error || '',
      /Missing target_campaigns parameter/i,
      'Expected error message for missing parameter'
    );
  });

  test('GET /api/retention/heatmaps with invalid campaign code returns 400 Bad Request', async () => {
    const res = await makeRequest('/api/retention/heatmaps?target_campaigns=invalid-code-999');
    assert.equal(res.status, 400, 'Expected status 400 for invalid campaign codes');
    assert.match(
      res.headers.get('content-type') || '',
      /application\/json/,
      'Expected JSON content-type'
    );
    assert.ok(res.json, 'Expected parsed JSON response');
    assert.match(
      res.json.error || '',
      /No valid campaign codes found/i,
      'Expected error message for invalid campaign codes'
    );
  });

  test('GET /?mode=Influx routes to Influx view', async () => {
    const res = await makeRequest('/?mode=Influx');
    assert.equal(res.status, 200, 'Expected status 200 for /?mode=Influx');
    assert.ok(
      res.text.includes('Year-over-Year New User Influx'),
      'Expected mode=Influx to render Influx content'
    );
  });

  test('GET /?mode=Health routes to Health Evaluation view', async () => {
    const res = await makeRequest('/?mode=Health');
    assert.equal(res.status, 200, 'Expected status 200 for /?mode=Health');
    assert.ok(
      res.text.includes('Evaluation'),
      'Expected mode=Health to render Health Evaluation content'
    );
  });

  test('GET /?mode=Retention routes to Retention view', async () => {
    const res = await makeRequest('/?mode=Retention');
    assert.equal(res.status, 200, 'Expected status 200 for /?mode=Retention');
    assert.ok(
      res.text.includes('Retention Analysis'),
      'Expected mode=Retention to render Retention content'
    );
  });

  test('GET /?mode=UnknownFallback safely defaults to home page', async () => {
    const res = await makeRequest('/?mode=NonExistentModeXYZ123');
    assert.equal(res.status, 200, 'Expected status 200 for unknown mode query');
    assert.ok(
      res.text.includes('CampTools') || res.text.includes('Welcome to CampTools'),
      'Expected fallback to home page'
    );
  });

  test('GET /nonexistent-endpoint-404 returns 404 Not Found', async () => {
    const res = await makeRequest('/nonexistent-endpoint-404');
    assert.equal(res.status, 404, 'Expected status 404 for nonexistent route');
  });

  test('GET /styles.css serves valid stylesheet', async () => {
    const res = await makeRequest('/styles.css');
    assert.equal(res.status, 200, 'Expected status 200 for /styles.css');
    assert.match(
      res.headers.get('content-type') || '',
      /text\/css/,
      'Expected text/css Content-Type'
    );
    assert.ok(
      res.text.includes(':root') || res.text.includes('var(--') || res.text.includes('body'),
      'Expected valid CSS stylesheet content'
    );
  });

  test('GET /plotly.min.js serves javascript asset', async () => {
    const res = await makeRequest('/plotly.min.js');
    assert.equal(res.status, 200, 'Expected status 200 for /plotly.min.js');
    assert.match(
      res.headers.get('content-type') || '',
      /javascript/,
      'Expected javascript Content-Type'
    );
    assert.ok(res.text.length > 1000, 'Expected non-empty script content');
  });

  test('GET documentation aliases /info and /methodology resolve correctly', async () => {
    const resInfo = await makeRequest('/info');
    assert.equal(resInfo.status, 200, 'Expected 200 for /info');
    assert.ok(
      resInfo.text.includes('Documentation') || resInfo.text.includes('Info &amp; Documentation'),
      'Expected /info to render documentation'
    );

    const resMeth = await makeRequest('/methodology');
    assert.equal(resMeth.status, 200, 'Expected 200 for /methodology');
    assert.ok(
      resMeth.text.includes('Documentation') || resMeth.text.includes('Info &amp; Documentation'),
      'Expected /methodology to render documentation'
    );
  });
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS & FORM SUBMISSIONS
// ============================================================================
describe('Tier 3: Cross-Feature Interactions & Parameter Combinations', () => {
  test('POST /influx form submission with builder parameters', async () => {
    const formBody = new URLSearchParams({
      influx_event_type: 'wlm',
      influx_country: 'bd',
      influx_yr_start: '2021',
      influx_yr_end: '2023'
    }).toString();

    const res = await makeRequest('/influx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    assert.equal(res.status, 200, 'Expected status 200 for POST /influx');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.ok(
      res.text.includes('id="influx-form"') || res.text.includes('#influx-form'),
      'Expected /influx response to contain #influx-form'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'POST /influx must NOT return home.html'
    );
  });

  test('POST /health form submission with target event and baseline mode', async () => {
    const formBody = new URLSearchParams({
      target_event: 'wlmbd23',
      comp_mode: 'Previous Year Baseline'
    }).toString();

    const res = await makeRequest('/health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    assert.equal(res.status, 200, 'Expected status 200 for POST /health');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.ok(
      res.text.includes('id="health-form"') || res.text.includes('#health-form'),
      'Expected /health response to contain #health-form'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'POST /health must NOT return home.html'
    );
  });

  test('POST /retention form submission with target campaign codes', async () => {
    const formBody = new URLSearchParams({
      target_campaigns: 'wlmbd22 wlmbd23',
      view_mode: 'Table'
    }).toString();

    const res = await makeRequest('/retention', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    assert.equal(res.status, 200, 'Expected status 200 for POST /retention');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.ok(
      res.text.includes('id="retention-form"') || res.text.includes('#retention-form'),
      'Expected /retention response to contain #retention-form'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'POST /retention must NOT return home.html'
    );
  });

  test('POST /utility form submission with event parameter', async () => {
    const formBody = new URLSearchParams({
      utility_event: 'wlmbd23'
    }).toString();

    const res = await makeRequest('/utility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    assert.equal(res.status, 200, 'Expected status 200 for POST /utility');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.ok(
      res.text.includes('id="utility-form"') || res.text.includes('#utility-form'),
      'Expected /utility response to contain #utility-form'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'POST /utility must NOT return home.html'
    );
  });

  test('POST /quality form submission with event parameter', async () => {
    const formBody = new URLSearchParams({
      quality_event: 'wlmbd23'
    }).toString();

    const res = await makeRequest('/quality', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    assert.equal(res.status, 200, 'Expected status 200 for POST /quality');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.ok(
      res.text.includes('id="quality-form"') || res.text.includes('#quality-form'),
      'Expected /quality response to contain #quality-form'
    );
    assert.ok(
      !res.text.includes('Welcome to CampTools'),
      'POST /quality must NOT return home.html'
    );
  });

  test('Adversarial input: HTML/XSS script injection in query parameter is safely escaped', async () => {
    const maliciousPayload = '<script>alert("xss")</script>';
    const res = await makeRequest(
      `/health?target_event=${encodeURIComponent(maliciousPayload)}`
    );

    assert.equal(res.status, 200, 'Expected status 200');
    // Ensure raw unescaped script tag is NOT reflected directly as HTML execution
    assert.ok(
      !res.text.includes('<script>alert("xss")</script>'),
      'Raw unescaped script execution tag must not be reflected in HTML response'
    );
  });

  test('Boundary stress: extreme-length input parameters do not crash the server', async () => {
    const hugeParam = 'a'.repeat(2000);
    const res = await makeRequest(`/influx?influx_codes=${hugeParam}`);
    assert.ok(
      res.status === 200 || res.status === 400,
      'Server must return 200 or 400 without crashing on extreme parameter length'
    );
  });
});

// ============================================================================
// TIER 4: REAL-WORLD SCENARIOS (Multi-Tool End-to-End User Workflows)
// ============================================================================
describe('Tier 4: Real-World Scenarios (Multi-Tool Workflow)', () => {
  test('Complete user journey: Landing -> Health -> Influx -> Heatmaps API -> Documentation -> Liveness', async () => {
    // Step 1: User lands on Home
    const step1 = await makeRequest('/');
    assert.equal(step1.status, 200, 'Step 1: Home page must respond 200');
    assert.ok(
      step1.text.includes('CampTools') || step1.text.includes('Welcome to CampTools'),
      'Step 1: Expected CampTools landing markup'
    );

    // Step 2: User navigates to Health Evaluation
    const step2 = await makeRequest('/health');
    assert.equal(step2.status, 200, 'Step 2: Health evaluation must respond 200');
    assert.ok(
      step2.text.includes('Evaluation'),
      'Step 2: Expected Evaluation content'
    );
    assert.ok(
      !step2.text.includes('Welcome to CampTools'),
      'Step 2: Health route must not serve home.html'
    );

    // Step 3: User transitions to YoY Influx Analysis
    const step3 = await makeRequest('/influx');
    assert.equal(step3.status, 200, 'Step 3: Influx must respond 200');
    assert.ok(
      step3.text.includes('Year-over-Year New User Influx'),
      'Step 3: Expected Influx title'
    );
    assert.ok(
      !step3.text.includes('Welcome to CampTools'),
      'Step 3: Influx route must not serve home.html'
    );

    // Step 4: User queries Retention Heatmaps API
    const step4 = await makeRequest('/api/retention/heatmaps');
    assert.equal(step4.status, 400, 'Step 4: Missing params in heatmaps API returns 400 Bad Request');
    assert.match(
      step4.headers.get('content-type') || '',
      /application\/json/,
      'Step 4: Expected JSON error response'
    );

    // Step 5: User opens Documentation for reference
    const step5 = await makeRequest('/documentation');
    assert.equal(step5.status, 200, 'Step 5: Documentation must respond 200');
    assert.ok(
      step5.text.includes('Documentation') || step5.text.includes('Info &amp; Documentation'),
      'Step 5: Expected Documentation content'
    );

    // Step 6: User queries healthz liveness endpoint
    const step6 = await makeRequest('/healthz');
    assert.equal(step6.status, 200, 'Step 6: Healthz check must respond 200');
    assert.equal(step6.text.trim(), 'OK', 'Step 6: Body must equal "OK"');
  });
});
