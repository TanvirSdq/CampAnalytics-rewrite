# CampTools — Architecture Specification

## Stack Rationale

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 (LTS) | Toolforge buildservice natively supports Node; no custom container needed |
| Language | TypeScript (strict) | Full type safety prevents the class of runtime bugs that caused the Python rewrite |
| Framework | Express 4 | Minimal, battle-tested, and idiomatic for modular route controllers |
| Templating | Nunjucks | 1:1 compatible with Jinja2 — preserves all existing templates from the Python version |
| Build | `tsc` (NodeNext ESM) | Zero-dependency compilation to `dist/`, fast cold-starts on Toolforge |

## Why This Stack Prevents Another Rewrite

The legacy Python/Flask version was inflexible because:
1. It used a single monolithic route handler with a `mode` string to serve all tools from one template file.
2. Business logic, routing, and rendering were entangled in a single file.

This rewrite separates them permanently:
- **`src/core/`** — Pure analytics logic with no HTTP or rendering dependencies.
- **`src/routes/`** — One Express router file per tool. Adding a new tool means adding one file.
- **`templates/`** — One HTML template per tool, extending `base.html`.

## Concurrency & Performance

- Express handles HTTP/1.1 keep-alive connections and can be clustered via `node:cluster` if needed.
- Static assets (`public/css/`, `public/js/`) are served with `Cache-Control: max-age=86400` headers.
- Nunjucks templates are compiled and cached in production (`cache: true`).
- Data-heavy endpoints (Retention, Influx) can be extended with a Redis cache layer without changing routing contracts.

## Deployment (Toolforge)

```
toolforge build start https://github.com/TanvirSdq/CampAnalytics-rewrite
toolforge webservice buildservice start --mount=all
```

Live URL: https://camptools.toolforge.org

## Directory Layout

```
CampAnalytics-rewrite/
├── src/
│   ├── core/
│   │   ├── analytics.ts   # All domain analytics algorithms
│   │   ├── context.ts     # Global Nunjucks context builder
│   │   └── types.ts       # All TypeScript interfaces
│   ├── routes/
│   │   ├── index.ts       # Home page
│   │   ├── health.ts      # Health Evaluation tool
│   │   ├── retention.ts   # Retention Analytics tool
│   │   ├── influx.ts      # Participant Influx tool
│   │   ├── utility.ts     # Content Utility tool
│   │   ├── quality.ts     # Quality Recognition tool
│   │   ├── documentation.ts
│   │   └── healthz.ts     # Kubernetes liveness probe
│   └── server.ts          # Express app entry point
├── templates/             # Nunjucks HTML templates
├── public/
│   └── css/styles.css     # Compiled static styles
├── tests/
│   ├── routes.e2e.test.ts # End-to-end route test suite
│   ├── comparative.unit.test.ts # Unit tests for analytics calculations
│   └── quality_gates.test.ts    # Automated brand, geometry & hygiene gates
├── config.json            # Campaign taxonomy, region maps, and bot filters
├── toolinfo.json          # Wikimedia Toolhub crawler manifest
├── toolhub.yaml           # Wikimedia Toolhub configuration
├── CONTRIBUTING.md        # Contributor guide and environment setup
├── METHODOLOGY.md         # Mathematical formulations and peer benchmarks
├── .github/workflows/ci.yml
├── Procfile               # web: npm start
└── tsconfig.json
```

## Configuration & Toolhub Metadata

- **`config.json`**: Domain reference data and campaign taxonomy:
  - `EVENT_MAP` & `EVENT_DISPLAY_MAP`: Short codes to official campaign names (`wlm`, `wle`, `wlf`, `wla`, `wlb`).
  - `EVENT_COUNTRY_SCOPE`: Geographic scope rules (e.g. continental restrictions for Wiki Loves Africa).
  - `KNOWN_BOTS` & `BOT_REGEX`: Automated maintenance bot and upload wizard accounts excluded from contributor counts.
  - `COUNTRY_MAP` & `REGION_COUNTRY_MAPPING`: ISO 3166-1 alpha-2 country mappings and regional benchmark clusters.
  *(Contains strictly public taxonomy data with zero credentials or tokens).*
- **`metadata.json`**: Application manifest describing runtime capabilities and description.
- **`toolinfo.json` & `toolhub.yaml`**: Official Wikimedia Toolhub metadata manifests for indexing `camptools` on [toolhub.wikimedia.org](https://toolhub.wikimedia.org/).
