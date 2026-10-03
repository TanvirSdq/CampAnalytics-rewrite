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
│   ├── routes.e2e.test.ts # 28-assertion Node test suite
│   └── verify_routes.sh   # 16-assertion curl smoke tests
├── .github/workflows/ci.yml
├── Procfile               # web: node dist/server.js
└── tsconfig.json
```
