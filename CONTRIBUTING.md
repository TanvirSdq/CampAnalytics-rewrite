# Contributing to CampTools

Thank you for your interest in contributing to **CampTools** (the high-performance TypeScript rewrite of CampAnalytics). CampTools provides Wikimedia organizers, affiliates, and researchers with reliable longitudinal analytics on contributor retention, participant influx dynamics, and encyclopedic media utility.

This guide outlines our development workflow, engineering standards, and quality gates for contributors.

---

## 1. Prerequisites & Environment Setup

CampTools runs on **Node.js 20 LTS** (or later) and **npm 10+**.

```bash
# 1. Clone the repository
git clone https://github.com/TanvirSdq/CampAnalytics-rewrite.git
cd CampAnalytics-rewrite

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
```

`PORT` defaults to `3000` if unspecified.

---

## 2. Development Workflow

```bash
# Start development server with live reload
npm run dev

# Compile TypeScript to dist/
npm run build

# Start production server
npm start
```

Once running, navigate to `http://localhost:3000` to access the local instance.

---

## 3. Project Structure

CampTools strictly decouples analytics algorithms, HTTP routing, and presentation:

- **`src/core/analytics.ts`**: Pure analytical engines (time-series computations, cohort matrices, Codex color assignment, summary stats). Zero dependencies on HTTP or DOM.
- **`src/core/types.ts`**: Strict TypeScript interfaces for all metrics, queries, and comparative payloads.
- **`src/routes/`**: Modular Express route controllers (one router per analytical tool: `influx.ts`, `retention.ts`, `health.ts`, `quality.ts`, `utility.ts`).
- **`templates/`**: Server-rendered Nunjucks templates extending `base.html`.
- **`public/`**: Static assets (`css/styles.css`, client SVG scripts, brand vectors).
- **`config.json`**: Campaign taxonomy, country code mappings, regional groups, and bot exclusion lists.

---

## 4. Design Standards & Architectural Invariants

All pull requests must adhere to our design invariants:

1. **Square-Cornered Geometry**: All cards, inputs, buttons, tables, and SVG rects must maintain sharp 90-degree corners (`border-radius: 0;`, `rx="0" ry="0"`).
2. **Zero Color Gradients**: Use solid Wikimedia Codex step palette colors; never introduce CSS linear or radial gradients.
3. **Separation of Formulations**: Observational data tools (`/influx`, `/retention`, `/quality`, `/utility`) show raw counts and indicator metadata only. Reserve mathematical formulas, LaTeX equations, and scoring weights strictly for the dedicated `/documentation` page and `METHODOLOGY.md`.
4. **Zero Dependency Client Charting**: Prefer server-rendered, pure-SVG visualizations with native CSS tooltips over bundling heavy third-party graphing libraries.
5. **No External Tracking Leaks**: Ensure no tracking, telemetry, or external platform names are introduced into template comments or code.

---

## 5. Testing & Quality Verification

Before submitting a pull request, verify that all test suites pass:

```bash
# Run End-to-End Route Tests (30 assertions)
npm test

# Run Comparative Unit Tests & Automated Quality Gates (32 assertions)
npx tsx --test tests/comparative.unit.test.ts tests/quality_gates.test.ts
```

Our automated quality gates assert:
- Zero brand leaks across templates and source files.
- Zero non-zero `border-radius` and zero CSS gradients.
- Header hygiene (no redundant subtitle copy under tool titles).
- Complete mathematical coherence across time-series and summary stats.

---

## 6. Submitting a Pull Request

1. Create a descriptive feature branch: `git checkout -b feat/your-feature-name` or `fix/your-bug-name`.
2. Make minimal, focused commits with concise commit messages.
3. Verify that your branch builds cleanly (`npm run build`) and all 62 tests pass.
4. Open a pull request against `main` explaining the problem solved and test coverage added.
