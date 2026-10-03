# CampAnalytics

An analytics platform for Wikimedia Commons photography campaigns, providing longitudinal contributor retention metrics, cross-campaign ecosystem influx, encyclopedic content utility, and regional health benchmarking.

[![Hosted on Wikimedia Toolforge](https://img.shields.io/badge/Hosted%20on-Wikimedia%20Toolforge-006699?style=flat-square&logo=wikipedia)](https://campanalytics.toolforge.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org/)
[![License: GPL-2.0+](https://img.shields.io/badge/License-GPL--2.0%2B-blue.svg?style=flat-square)](https://www.gnu.org/licenses/gpl-2.0.html)
[![Affiliation: Project Korikath](https://img.shields.io/badge/Affiliation-Project%20Korikath-183f54?style=flat-square)](https://meta.wikimedia.org/wiki/Project_Korikath)

---

## Overview

**CampAnalytics** is an open-source analytics platform developed for campaign organizers, Wikimedia affiliates, community researchers, and program evaluators. It analyzes international Wiki Loves photography campaigns by querying live metadata directly from Wikimedia Commons and Toolforge replica databases.

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

CampAnalytics is organized into five specialized analytical tools accessible via top navigation or programmatic JSON APIs:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CAMPANALYTICS ANALYTICAL SUITE                       │
├─────────────┬─────────────┬─────────────┬──────────────┬───────────────┤
│   Tool 01   │   Tool 02   │   Tool 03   │   Tool 04    │    Tool 05    │
│  Evaluation │  Retention  │   Influx    │   Utility    │    Quality    │
│  (/health)  │ (/retention)│  (/influx)  │  (/utility)  │   (/quality)  │
└─────────────┴─────────────┴─────────────┴──────────────┴───────────────┘
```

### 1. Health Evaluation (`/health`, `/api/health`)
Scores campaign editions on a 0–100 scale across five core dimensions grouped into three balanced pillars, benchmarked against regional peer thresholds:
* **Retention Index ($S_{\text{ret}}$, 25%)**: Percentage of prior-edition participants who returned.
* **Growth Capacity ($S_{\text{grow}}$, 25%)**: Proportion of active participants joining for the first time.
* **Content Utility ($S_{\text{util}}$, 20%)**: Uploads embedded across Wikipedia language editions (`prop=globalusage`).
* **Quality Recognition ($S_{\text{qual}}$, 15%)**: Share of uploads achieving Quality Image (QI), Featured Picture (FP), or Valued Image (VI) badges.
* **Contributor Diversity ($S_{\text{div}}$, 15%)**: Upload distribution equity (inverse top-10% uploader concentration).

**Interactive Visuals**:
* Responsive **SVG Spider Radar Chart** comparing the campaign's scores against regional and global benchmark polygons.
* Composite 4-tier grading badge:
  * ★★★★★ **Outstanding** (85.0–100.0)
  * ★★★★☆ **Strong** (70.0–84.9)
  * ★★★☆☆ **Moderate** (50.0–69.9)
  * ★★☆☆☆ **Emerging / Critical** (<50.0)

### 2. Contributor Retention (`/retention`, `/api/retention`)
* **Directional Persistence**: Evaluates exact retention between baseline and target editions ($A \to B$), preserving directional asymmetry:
  $$\text{Retention}(A \to B) = \left( \frac{|U_A \cap U_B|}{|U_A|} \right) \times 100\%$$
* **Multi-Cohort Matrices**: Compares multi-year editions across campaigns and countries with color-coded retention cells.
* **Global Choropleth Geovisualization**: Interactive Plotly map with regional filtering and participant density shading.
* **Pairwise Heatmap Charts**: Embedded SVG heatmaps illustrating cross-edition retention transitions.

### 3. Contributor Influx & Growth (`/influx`, `/api/influx`)
* **Dual-Axis Stacked Bar Chart**: Simultaneously visualizes annual active volumes (stacked newcomers $I_t$ + returning veterans $R_t$ on the left axis) and the de-duplicated **Cumulative Pool** trajectory ($P_t$ on the right axis).
* **True Newcomer Acquisition**: De-duplicates participants across chronological sequences to isolate genuine movement acquisition from inter-campaign migration.
* **Lifecycle Profiles**: Segments contributors into 1-time entrants, repeaters (2–3 editions), and core veterans (4+ editions).
* **Multi-Preset Quick Selectors**: 1-click loading for single-campaign sequences (e.g., `wlmde20` $\to$ `wlmde24`) or cross-campaign ecosystems (`allde20` $\to$ `allde24`).

### 4. Content Utility (`/utility`, `/api/utility`)
* **Live Encyclopedic Reuse**: Measures media integration across all Wikipedia language editions, Wikidata, Wikivoyage, and Commons galleries via `prop=globalusage`.
* **Summary Scorecards**: Displays Global Utility Rate, Total Global Embeds, Unique Articles Reached, and Top Consuming Project.
* **Live Media Articles Table**: Interactive table with search, column sorting, pagination, and multi-format exporters (CSV, JSON, Wikitext).
* **Photographer Utilization Leaderboard**: Ranks contributors whose uploads achieve the highest encyclopedic integration.

### 5. Quality Recognition (`/quality`, `/api/quality`)
* **Curatorial Peer-Reviewed Status**: Audits uploads for community distinction badges:
  * **Quality Images (QI)**: Technical excellence verified by Commons reviewers.
  * **Featured Pictures (FP)**: Finest photographic achievements chosen by community consensus.
  * **Valued Images (VI)**: Most valuable illustrations for encyclopedic subjects.
* **Documented Works Gallery**: Curatorial showcase with honor badges, contributor attribution, and direct Commons links.
* **Photographer Hall of Fame**: Contributor leaderboard tracking individual honor counts (QI, FP, VI).

---

## Programmatic REST API

All analytical modules provide direct RESTful JSON endpoints for programmatic integration, Wikimedia bots, and dashboard consumption:

### Endpoints

| Endpoint | Method | Key Parameters | Description |
|:---|:---:|:---|:---|
| `/api/health` | `GET` | `target_campaign` (e.g. `wlmde24`) | Returns 5-dimension health scores, benchmark comparisons, and composite rating. |
| `/api/retention` | `GET` | `target_campaigns` (e.g. `wlmde22 wlmde23 wlmde24`) | Computes full pairwise directional retention matrix and participant sets. |
| `/api/influx` | `GET` | `influx_codes` (e.g. `wlmde20 wlmde21 wlmde22 wlmde23 wlmde24`) | Returns year-over-year newcomer influx, veteran counts, cumulative pool, and lifecycle profile. |
| `/api/utility` | `GET` | `target_campaign` (e.g. `wlmde24`) | Returns global usage rates, article embed counts, wiki breakdown, and top utilized photographers. |
| `/api/quality` | `GET` | `target_campaign` (e.g. `wlmde24`) | Returns QI/FP/VI counts, distinction rates, documented files, and hall-of-fame leaderboard. |

### Example API Request & Response

```bash
curl -s "http://localhost:3000/api/health?target_campaign=wlmde24" | jq .
```

```json
{
  "target_campaign": "wlmde24",
  "health_results": [
    {
      "campaign": "wlmde24",
      "composite_score": 78.4,
      "tier": "Strong",
      "stars": "★★★★☆",
      "scores": {
        "retention": 72.5,
        "growth": 81.0,
        "utility": 76.2,
        "quality": 84.1,
        "diversity": 78.0
      },
      "benchmarks": {
        "region_name": "Northern & Western Europe",
        "retention_bm": 28.5,
        "growth_bm": 64.0,
        "utility_bm": 14.2,
        "quality_bm": 3.8,
        "diversity_bm": 68.0
      }
    }
  ]
}
```

---

## Technical Architecture

```
========================================================================================
                          CAMPANALYTICS — SYSTEM ARCHITECTURE
========================================================================================

       [ Wikimedia Community Analyst / Organiser Browser / API Client ]
                                      │
                                      ▼ (Port 3000)
       ┌────────────────────────────────────────────────────────────┐
       │                EXPRESS APPLICATION SERVER                  │
       │                        (server.ts)                         │
       ├────────────────────────────────────────────────────────────┤
       │  • Tool Routing & Middleware (Compression, JSON Parser)    │
       │  • RESTful API Endpoints (/api/health, /api/influx, ...)   │
       │  • Nunjucks SSR Engine with KaTeX Math Typesetting         │
       │  • Scope Enforcer & Cross-Country Validation Gate         │
       └──────────────────────────────┬─────────────────────────────┘
                                      │
                                      ▼
       ┌────────────────────────────────────────────────────────────┐
       │                  SHARED ANALYTICS ENGINE                   │
       │                     (src/analytics.ts)                     │
       ├────────────────────────────────────────────────────────────┤
       │  • Dual-Axis Influx & Cumulative Pool SVG Chart Generator │
       │  • 5-Dimension Spider Radar Chart SVG Generator            │
       │  • Directional Retention Matrix & Cohort Intersections     │
       │  • Content Utility & Quality Distinction Deep Evaluators   │
       │  • Empirical Bayesian Regularization & Regional Benchmarks │
       │  • In-Memory TTL Cache Layer & Wikimedia Bot Filter        │
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
* **Node.js** v18+ (v20 or v22 recommended)
* **npm** or **bun**

### Setup
```bash
git clone https://github.com/TanvirSdq/CampAnalytics.git
cd CampAnalytics
npm install
```

### Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build and Start for Production
```bash
npm run build
npm start
```

---

## Git & Deployment Workflow

### Safe Branching Workflow
If you are developing new features while your repository serves a live deployment:
1. **Always develop on a dedicated branch**:
   ```bash
   git checkout -b feature/analytics-enhancement
   git add .
   git commit -m "Enhance influx dual-axis chart and restore utility pipeline"
   git push -u origin feature/analytics-enhancement
   ```
2. **Review via Pull Request**: Open a PR into `main` to inspect diffs and test compatibility before merging to production.
3. **Production Branch**: Keep `main` (or a dedicated `production` branch) stable for live webhooks on Wikimedia Toolforge or container runtimes.

---

## License & Attribution

* **License**: [GNU General Public License v2.0 or later (GPL-2.0+)](https://www.gnu.org/licenses/gpl-2.0.html)
* **Affiliation**: Developed in support of [Project Korikath](https://meta.wikimedia.org/wiki/Project_Korikath)
* **Authors**: TanvirSdq & Kaim Amin
* **Data Attribution**: Metadata queried from [Wikimedia Commons](https://commons.wikimedia.org) under open Creative Commons and public domain licenses.
