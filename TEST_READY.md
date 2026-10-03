# CampAnalytics E2E Test Suite Readiness & Verification

## Executive Summary
A comprehensive, opaque-box, requirement-driven E2E test suite has been implemented for the CampAnalytics rewrite. The suite validates full HTTP routing and behavior across four tiers (Tiers 1–4) and provides an automated curl verification script.

The test suite actively reproduces and catches the critical **R1 Routing Defect** where tool routes (`/influx`, `/health`, `/retention`, `/utility`, `/quality`) incorrectly serve `home.html` ("Welcome to CampTools") rather than their corresponding tool templates (`influx.html`, `health.html`, etc.).

---

## Deliverables & File Locations
1. **Automated E2E Test Suite (Node Native Runner)**:
   - Path: `/Users/tanvir/CampAnalytics-rewrite/tests/routes.e2e.test.ts`
   - Runner: `npx tsx --test tests/routes.e2e.test.ts`
2. **Curl-Based Route Verification Script**:
   - Path: `/Users/tanvir/CampAnalytics-rewrite/tests/verify_routes.sh`
   - Runner: `bash tests/verify_routes.sh [BASE_URL]` (default: `http://127.0.0.1:3000`)
3. **Test Readiness Documentation**:
   - `/Users/tanvir/CampAnalytics/.agents/teamwork/TEST_READY.md`
   - `/Users/tanvir/CampAnalytics-rewrite/TEST_READY.md`

---

## Test Architecture & Mechanics
- **Zero Heavy Test Dependencies**: Built using native Node.js test runner (`node:test`), strict assertions (`node:assert/strict`), and Node 26 native `fetch`.
- **Autonomous Server Lifecycle**: Tests can execute against an existing running server (`BASE_URL` env variable) or autonomously spawn a test instance via `before()` hook and tear it down cleanly via `after()` hook.
- **Opaque-Box Requirement Verification**: Tests inspect real HTTP response status codes, `Content-Type` headers, and HTML/JSON response bodies.

---

## Coverage Matrix (Tiers 1–4)

### Tier 1: Feature Coverage (Core Endpoints & Markup Contracts)
- **`GET /`**: 200 OK, `text/html`, contains `CampTools` branding/tool directory.
- **`GET /tools`**: 200 OK, `text/html`, renders tools directory.
- **`GET /influx`** *(R1 Acceptance)*: 200 OK, contains `#influx-form` and `Year-over-Year New User Influx`; MUST NOT contain `Welcome to CampTools`.
- **`GET /health`** *(R1 Acceptance)*: 200 OK, contains `#health-form`, `Evaluation`, `.scorecard-grid`; MUST NOT contain `Welcome to CampTools`.
- **`GET /retention`**: 200 OK, contains `#retention-form` and `Retention Analysis`; MUST NOT contain `Welcome to CampTools`.
- **`GET /utility`**: 200 OK, contains `#utility-form` and `Content Utility`; MUST NOT contain `Welcome to CampTools`.
- **`GET /quality`**: 200 OK, contains `#quality-form` and `Quality Recognition`; MUST NOT contain `Welcome to CampTools`.
- **`GET /documentation`**: 200 OK, contains `Documentation` or `Info & Documentation`.
- **`GET /healthz`**: 200 OK, text body `OK`.
- **`GET /api/retention/heatmaps`**: Returns valid JSON response.

### Tier 2: Boundary & Corner Cases
- **Missing query parameters**: `GET /api/retention/heatmaps` without `target_campaigns` returns 400 Bad Request with JSON `{ error: "Missing target_campaigns parameter" }`.
- **Invalid campaign codes**: `GET /api/retention/heatmaps?target_campaigns=invalid-code-999` returns 400 Bad Request with JSON `{ error: "No valid campaign codes found" }`.
- **Query Mode Routing**: `GET /?mode=Influx`, `GET /?mode=Health`, `GET /?mode=Retention`.
- **Unknown query mode**: `GET /?mode=NonExistentMode` safely defaults to home page (200 OK).
- **Non-existent endpoints**: `GET /nonexistent-endpoint-404` returns 404 Not Found.
- **Static assets**: `GET /styles.css` returns 200 OK with `text/css` and stylesheet rules; `GET /plotly.min.js` returns 200 OK with `javascript`.
- **Documentation aliases**: `GET /info` and `GET /methodology` return 200 OK with documentation content.

### Tier 3: Cross-Feature Interactions & Form Submissions
- **POST `/influx`**: Submits form parameters (`influx_event_type`, `influx_country`, `influx_yr_start`, `influx_yr_end`) -> 200 OK, Influx template.
- **POST `/health`**: Submits form parameters (`target_event`, `comp_mode`) -> 200 OK, Health template.
- **POST `/retention`**: Submits form parameters (`target_campaigns`, `view_mode`) -> 200 OK, Retention template.
- **POST `/utility`**: Submits form parameters (`utility_event`) -> 200 OK, Utility template.
- **POST `/quality`**: Submits form parameters (`quality_event`) -> 200 OK, Quality template.
- **Adversarial XSS Input**: Query parameter `target_event=<script>alert("xss")</script>` is safely escaped and does not reflect executable script blocks.
- **Resource Stress**: Extreme length query parameters (2000+ characters) do not crash or crash-loop the server.

### Tier 4: Real-World Scenarios
- **Complete End-to-End User Flow**:
  1. User visits `/` (Home landing) -> 200 OK.
  2. User navigates to `/health` (Health Evaluation) -> 200 OK, Health template.
  3. User navigates to `/influx` (YoY New User Influx) -> 200 OK, Influx template.
  4. User queries `/api/retention/heatmaps` -> Validates defensive 400 on missing params.
  5. User consults `/documentation` -> 200 OK, Documentation content.
  6. User queries `/healthz` -> 200 OK, Liveness confirmed.

---

## Execution Commands

### 1. Execute TypeScript E2E Test Suite
```bash
cd /Users/tanvir/CampAnalytics-rewrite
npx tsx --test tests/routes.e2e.test.ts
```
With verbose spec reporter:
```bash
npx tsx --test --test-reporter=spec tests/routes.e2e.test.ts
```

### 2. Execute Fast Curl Verification Script
```bash
cd /Users/tanvir/CampAnalytics-rewrite
./tests/verify_routes.sh http://127.0.0.1:3000
```

### 3. Type Check Test Suite
```bash
cd /Users/tanvir/CampAnalytics-rewrite
npx tsc --noEmit
```

---

## Initial Baseline Test Run Results (Pre-Refactor Codebase)

### 1. `tests/verify_routes.sh` Results
- **Total Tests**: 16
- **Passed**: 9
- **Failed**: 7
- **Pass Breakdown**:
  - `Liveness Check (/healthz)` -> PASS
  - `Home Landing Page (/)` -> PASS
  - `Tools Directory (/tools)` -> PASS
  - `Documentation Page (/documentation)` -> PASS
  - `Documentation Alias (/info)` -> PASS
  - `Heatmaps API Missing Params` -> PASS (400)
  - `Heatmaps API Invalid Code` -> PASS (400)
  - `Nonexistent Route (404)` -> PASS (404)
  - `Static CSS Stylesheet` -> PASS (200)
- **Fail Breakdown**:
  - `Influx Tool (/influx)` -> FAIL (Missing `Year-over-Year New User Influx`, found `Welcome to CampTools`)
  - `Health Tool (/health)` -> FAIL (Found `Welcome to CampTools`)
  - `Retention Tool (/retention)` -> FAIL (Missing `Retention Analysis`, found `Welcome to CampTools`)
  - `Content Utility Tool (/utility)` -> FAIL (Found `Welcome to CampTools`)
  - `Quality Recognition Tool (/quality)` -> FAIL (Found `Welcome to CampTools`)
  - `POST /influx` -> FAIL (Found `Welcome to CampTools`)
  - `POST /health` -> FAIL (Found `Welcome to CampTools`)

### 2. `tests/routes.e2e.test.ts` Results
- **Total Test Cases**: 26
- **Passed**: 13
- **Failed**: 13 (all corresponding to R1 template rendering failures on tool endpoints)

---

## Implementation Defects Escalated to Implementing Agents
The test suite has successfully verified the presence of the critical implementation defects identified in `ORIGINAL_REQUEST.md`:

1. **R1 Defect - Influx Route Serving Home Page**:
   - Location: `server.ts` lines 700 & 723
   - Issue: `res.render('home.html', ...)` is called on GET and POST `/influx` instead of rendering `influx.html`.
2. **R1 Defect - Health Route Serving Home Page**:
   - Location: `server.ts` lines 468 & 505
   - Issue: `res.render('home.html', ...)` is called on GET and POST `/health` instead of rendering `health.html`.
3. **R1 Defect - Retention Route Serving Home Page**:
   - Location: `server.ts` line 235
   - Issue: `res.render('home.html', ...)` is called on default `/retention` instead of `retention.html`.
4. **R1 Defect - Utility & Quality Routes Serving Home Page**:
   - Location: `server.ts` handleUtility and handleQuality
   - Issue: Both handlers default to rendering `home.html` instead of `utility.html` and `quality.html`.

Once the M1 implementation agents update route handlers in `src/routes/` to render their respective templates (`influx.html`, `health.html`, etc.), running `npx tsx --test tests/routes.e2e.test.ts` and `./tests/verify_routes.sh` will achieve 100% PASS.
