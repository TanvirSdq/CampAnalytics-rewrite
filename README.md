# CampTools

An analytics platform for Wikimedia Commons photography campaigns, providing multi-country longitudinal comparative analytics, contributor retention matrices, participant influx dynamics, encyclopedic content utility, and regional health benchmarking.

[![Hosted on Wikimedia Toolforge](https://img.shields.io/badge/Hosted%20on-Wikimedia%20Toolforge-006699?style=flat-square&logo=wikipedia)](https://camptools.toolforge.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org/)
[![License: GPL-2.0+](https://img.shields.io/badge/License-GPL--2.0%2B-blue.svg?style=flat-square)](https://www.gnu.org/licenses/gpl-2.0.html)
[![Affiliation: Project Korikath](https://img.shields.io/badge/Affiliation-Project%20Korikath-183f54?style=flat-square)](https://meta.wikimedia.org/wiki/Project_Korikath)

---

## Overview

**CampTools** is an open-source analytics platform developed for campaign organizers, Wikimedia affiliates, community researchers, and program evaluators. It analyzes international Wiki Loves photography campaigns by querying live metadata directly from Wikimedia Commons and Toolforge replica databases.

> **Production Deployment**: CampTools is deployed live on Wikimedia Toolforge at [`https://camptools.toolforge.org/`](https://camptools.toolforge.org/). The legacy Python suite continues to run concurrently at [`https://campanalytics.toolforge.org/`](https://campanalytics.toolforge.org/) for comparative reference.

### Supported Campaigns

| Code | Campaign | Focus | Commons Category Pattern |
|:---|:---|:---|:---|
| `wlm` | **Wiki Loves Monuments** | Built and architectural cultural heritage | `Images_from_Wiki_Loves_Monuments_YYYY_in_Country` |
| `wle` | **Wiki Loves Earth** | Natural heritage and protected biodiversity areas | `Images_from_Wiki_Loves_Earth_YYYY_in_Country` |
| `wlf` | **Wiki Loves Folklore** | Intangible culture, folk traditions, and festivals | `Images_from_Wiki_Loves_Folklore_YYYY_in_Country` |
| `wla` | **Wiki Loves Africa** | African cultural expressions and daily life | `Images_from_Wiki_Loves_Africa_YYYY_in_Country` |
| `wlb` | **Wiki Loves Bangla** | Regional cultural, linguistic, and ecological heritage | `Images_from_Wiki_Loves_Bangla_YYYY` |
| `all` | **All Campaigns** | Ecosystem combination per country | Scoped aggregate across active campaigns for target country |

---

## Core Analytical Modules

CampTools is organized into five specialized analytical tools accessible via top navigation, sidebar drawer, or programmatic JSON APIs:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      CAMPTOOLS ANALYTICAL SUITE                        │
├─────────────┬─────────────┬─────────────┬──────────────┬───────────────┤
│   Tool 01   │   Tool 02   │   Tool 03   │   Tool 04    │    Tool 05    │
│  Evaluation │  Retention  │   Influx    │   Utility    │    Quality    │
│  (/health)  │ (/retention)│  (/influx)  │  (/utility)  │   (/quality)  │
└─────────────┴─────────────┴─────────────┴──────────────┴───────────────┘
```

### 1. Campaign Performance Dynamics (`/health`, `/api/health`)
Provides empirical, non-imputed visibility into volunteer mobilization, multi-year longitudinal trajectories, and Year-over-Year (YoY) velocity without subjective scores, arbitrary weights, or automated advice:
* **Community Scale**: Total unique human uploaders submitting $\ge 1$ eligible photograph, with YoY velocity delta ($\Delta = U_t - U_{t-1}$).
* **Contributor Retention**: Percentage of baseline-edition participants who returned in the target edition ($R = \frac{|U_t \cap U_{t-1}|}{|U_{t-1}|} \times 100\%$).
* **Contributor Expansion**: Direct first-time newcomer recruitment yield ($N_t = |U_t \setminus \bigcup_{k < t} U_k|$) alongside net community size progression.
* **Content Utility**: Downstream encyclopedic utilization across Wikipedia language editions and Wikidata via `prop=globalusage`.
* **Quality Recognition**: Peer-reviewed Wikimedia Commons distinctions (Quality Images, Featured Pictures, Valued Images).
* **Contributor Diversity**: Grassroots participation equity measured by inverse top-10% uploader volume concentration.

**Zero-Synthetic Data & Unheld Campaign Policy**:
* 100% live Wikimedia Commons & Toolforge data with zero synthetic cohort generators or mock fallbacks.
* Unheld editions (e.g. `wlmbd21`, `wlmfr23`) are explicitly flagged as unheld and cannot be evaluated, receiving neither a 0 nor a regional average, and are excluded from peer benchmark groups.

**Interactive Manipulative Visuals (Plotly.js)**:
* **Multi-Year Longitudinal Trajectory**: Interactive dual-axis visualizer tracking active uploader volume, submissions, and quality honors across up to 5 consecutive editions.
* **Cohort Retention & Newcomer Waterfall**: Stacked breakdown illustrating the operational balance between returning volunteers and recruited newcomers.
* **Regional Peer Context Comparison**: Interactive bar chart comparing the campaign against active regional peers across selectable metrics.
* **Year-over-Year Velocity Pills**: Distinct delta indicators ($\Delta$ and $\Delta\%$) showing exact gains or declines across every dimension.

### 2. Contributor Retention (`/retention`, `/api/retention`, `/api/comparative`)
* **Directional Persistence**: Evaluates exact retention between baseline and target editions ($A \to B$), preserving directional asymmetry:
  $$\text{Retention}(A \to B) = \left( \frac{|U_A \cap U_B|}{|U_A|} \right) \times 100\%$$
* **Multi-Country Longitudinal Comparison**: Compare retention trajectories across multiple countries side-by-side.
* **Multi-Cohort Matrices**: Compares multi-year editions across campaigns and countries with color-coded retention cells.
* **Interactive Views**: Switch seamlessly between **Line** (multi-country time series), **Table** (sortable cohort tables with CSV/Wikitext export), and **Map** (global choropleth projection).
* **Pairwise Heatmaps**: Embedded SVG heatmaps illustrating cross-edition retention transitions.

### 3. Participant Influx (`/influx`, `/api/influx`, `/api/comparative`)
* **Dual-Axis Stacked Bar Chart**: Simultaneously visualizes annual active volumes (stacked newcomers $I_t$ + returning veterans $R_t$ on the left axis) and the de-duplicated **Cumulative Pool** trajectory ($P_t$ on the right axis).
* **Multi-Country Comparative Influx**: Track first-time uploader trends and community pool expansion across multiple nations.
* **True Newcomer Acquisition**: De-duplicates participants across chronological sequences to isolate genuine movement acquisition from inter-campaign migration.
* **Lifecycle Profiles**: Segments contributors into 1-time entrants, repeaters (2–3 editions), and core veterans (4+ editions).
* **Multi-Preset Quick Selectors**: 1-click loading for single-campaign sequences or cross-campaign national ecosystems.

### 4. Content Utility (`/utility`, `/api/utility`, `/api/comparative`)
* **Live Encyclopedic Reuse**: Measures media integration across all Wikipedia language editions, Wikidata, Wikivoyage, and Commons galleries via `prop=globalusage`.
* **Multi-Country Comparative Reuse**: Compare global utility rates and embed counts across campaign countries over time.
* **Summary Scorecards**: Displays Global Utility Rate, Total Global Embeds, Unique Articles Reached, and Top Consuming Project.
* **Live Media Articles Table**: Interactive table with search, column sorting, pagination, and multi-format exporters (CSV, Wikitext, JSON).
* **Photographer Utilization Leaderboard**: Ranks contributors whose uploads achieve the highest encyclopedic integration.

### 5. Quality Recognition (`/quality`, `/api/quality`, `/api/comparative`)
* **Curatorial Peer-Reviewed Status**: Audits uploads for community distinction badges:
  * **Quality Images (QI)**: Technical excellence verified by Commons reviewers.
  * **Featured Pictures (FP)**: Finest photographic achievements chosen by community consensus.
  * **Valued Images (VI)**: Most valuable illustrations for encyclopedic subjects.
* **Multi-Country Comparative Honors**: Longitudinal line charts tracking quality image counts and rates across nations.
* **Documented Works Gallery**: Gallery with quality badges, contributor attribution, and direct Commons links.
* **Top Contributing Photographers**: Contributor leaderboard tracking individual award counts (QI, FP, VI).

---

## Multi-Country Comparative Analytics Features

The analytical modules feature an integrated comparative visualization engine:

1. **Pure SVG Time Series (`Line` view)**:
   - High-contrast Wikimedia Codex solid palette with square data points (`rx="0" ry="0"`).
   - Direct line-end country labels and interactive hover tooltips with edition headers and exact values.
   - Zero heavyweight client-side charting libraries for instantaneous page rendering.
2. **Interactive Entity Selection Drawer**:
   - Sliding panel triggered by "Edit countries and regions" with real-time text search.
   - Dynamic sorting (alphabetical or metric-ranked).
   - Instant "Select all" and "Clear" actions with dynamic selection counter badges.
3. **Interactive Timeline Scrubber**:
   - Positioned beneath comparative charts with play/pause playback controls and a draggable range slider.
4. **Cross-Sectional Cohort Tables (`Table` view)**:
   - Sortable multi-country matrix with one-click **CSV** and **Wikitext** copy/download export options.
5. **Indicator Metadata Cards**:
   - Structured methodology panels displaying indicator definition, data source, metric unit, temporal coverage, CC BY-SA 4.0 license, and collapsible calculation notes.

---

## Programmatic REST API

All analytical modules provide direct RESTful JSON endpoints for programmatic integration, Wikimedia bots, and research workflows:

### Endpoints

| Endpoint | Method | Key Parameters | Description |
|:---|:---:|:---|:---|
| `/api/comparative` | `GET` | `module`, `event`, `countries`, `start_year`, `end_year`, `metric_key` | Computes multi-country longitudinal time series, summary statistics, cohort cross-sectional tables, and timeline points. |
| `/api/health` | `GET` | `target_campaign` (e.g. `wlmde24`) | Returns empirical dimensions, Year-over-Year velocity deltas, multi-year historical series, and regional peer distributions. |
| `/api/retention` | `GET` | `target_campaigns` (e.g. `wlmde22 wlmde23 wlmde24`) | Computes full pairwise directional retention matrix and participant sets. |
| `/api/influx` | `GET` | `influx_codes` (e.g. `wlmde20 wlmde21 wlmde22 wlmde23 wlmde24`) | Returns newcomer influx, veteran counts, cumulative pool, and lifecycle profiles. |
| `/api/utility` | `GET` | `target_campaign` (e.g. `wlmde24`) | Returns global usage rates, article embed counts, wiki breakdown, and top utilized photographers. |
| `/api/quality` | `GET` | `target_campaign` (e.g. `wlmde24`) | Returns QI/FP/VI counts, quality rates, documented files, and top photographers leaderboard. |

### Example Comparative API Request

```bash
curl -s "http://localhost:3000/api/comparative?module=influx&event=wlm&countries=de,it,in&start_year=2021&end_year=2025" | jq .
```

---

## Technical Architecture

```
========================================================================================
                            CAMPTOOLS — SYSTEM ARCHITECTURE
========================================================================================

       [ Wikimedia Community Analyst / Organiser Browser / API Client ]
                                      │
                                      ▼ (Port 3000)
       ┌────────────────────────────────────────────────────────────┐
       │                EXPRESS APPLICATION SERVER                  │
       │                        (server.ts)                         │
       ├────────────────────────────────────────────────────────────┤
       │  • Modular Routing Architecture (src/routes/)              │
       │    - /health, /retention, /influx, /utility, /quality      │
       │    - /api/comparative, /api/health, /api/retention, ...    │
       │  • Nunjucks SSR Engine with KaTeX Mathematical Typesetting │
       │  • Compression, Security Headers & Sub-Millisecond Profiler│
       └──────────────────────────────┬─────────────────────────────┘
                                      │
                                      ▼
       ┌────────────────────────────────────────────────────────────┐
       │                 SHARED ANALYTICS CORE                      │
       │                 (src/core/analytics.ts)                    │
       ├────────────────────────────────────────────────────────────┤
       │  • Multi-Country Longitudinal Comparative Engine           │
       │  • Dual-Axis Influx & Cumulative Pool Generator            │
       │  • Directional Retention Matrix & Cohort Intersections     │
       │  • Content Utility & Quality Recognition Evaluators        │
       │  • Empirical Bayesian Regional Benchmark Models            │
       │  • In-Memory TTL Cache Layer & Bot Filter                  │
       └──────────────────────────────┬─────────────────────────────┘
                                      │
                      ┌───────────────┴───────────────┐
                      ▼                               ▼
       ┌────────────────────────────┐  ┌────────────────────────────┐
       │ Wikimedia Commons APIs/DB  │  │        config.json         │
       │ (Uploads, GlobalUsage, QI) │  │  5 Campaigns · 51 Nations  │
       │                            │  │  9 Regional Benchmark Sets │
       └────────────────────────────┘  └────────────────────────────┘
========================================================================================
```

---

## Design System & UI Invariants

CampTools enforces publication-grade data interface standards:
* **Zero Color Gradients**: Solid, high-contrast surfaces adhering strictly to the Wikimedia Codex design system.
* **Square-Cornered Geometry**: 100% sharp 90-degree rectangle geometry (`border-radius: 0;`, `rx="0" ry="0"`) across cards, badges, inputs, pills, tabs, and SVG charts.
* **Symmetrical 50/50 Desktop Form Grid**: Country selectors and Year Range inputs maintain normalized heights (`40px`) and identical horizontal baselines with elevated SPAN controls.
* **Full-Width Empty States**: Clean, legible guidance prompts centered across panels without column wrapping.

---

## Campaign Query Codes

Campaigns are referenced using standard three-segment codes: `[event][country][YY]`

| Code | Campaign | Country | Year |
|:---|:---|:---|:---|
| `wlmde24` | Wiki Loves Monuments | Germany (`de`) | 2024 |
| `wleua21` | Wiki Loves Earth | Ukraine (`ua`) | 2021 |
| `wlfin22` | Wiki Loves Folklore | India (`in`) | 2022 |
| `wlang23` | Wiki Loves Africa | Nigeria (`ng`) | 2023 |
| `wlmbd24` | Wiki Loves Monuments | Bangladesh (`bd`) | 2024 |
| `allde24` | All Campaigns (Combined Ecosystem) | Germany (`de`) | 2024 |

**51 Supported Countries**:  
`ar`, `at`, `au`, `bd`, `be`, `br`, `ca`, `ch`, `cl`, `co`, `cz`, `de`, `dz`, `eg`, `es`, `fi`, `fr`, `gh`, `gr`, `hu`, `id`, `in`, `it`, `ke`, `lk`, `ma`, `mx`, `my`, `ng`, `nl`, `no`, `np`, `nz`, `pe`, `ph`, `pk`, `pl`, `pt`, `ro`, `rs`, `ru`, `se`, `th`, `tn`, `tr`, `tz`, `ua`, `uk`, `us`, `ve`, `za`.

---

## Installation & Local Development

### Prerequisites
* **Node.js** v20+ (Node.js 20 or 22 recommended)
* **npm**

### Setup
```bash
git clone https://github.com/TanvirSdq/CampAnalytics-rewrite.git
cd CampAnalytics-rewrite
npm install
```

### Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Run Tests
```bash
npm test                 # E2E route test suite
npm run test:curl        # Shell / curl integration checks
npx tsx --test tests/comparative.unit.test.ts tests/quality_gates.test.ts
```

### Build and Start for Production
```bash
npm run build
npm start
```

---

## License & Attribution

* **License**: [GNU General Public License v2.0 or later (GPL-2.0+)](https://www.gnu.org/licenses/gpl-2.0.html)
* **Affiliation**: Developed in support of [Project Korikath](https://meta.wikimedia.org/wiki/Project_Korikath)
* **Authors**: TanvirSdq & Kaim Amin
* **Data Attribution**: Metadata queried from [Wikimedia Commons](https://commons.wikimedia.org) under open Creative Commons and public domain licenses.
