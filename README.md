# BC Bid Monitor

Self-hosted BC Bid monitoring stack built with:

- Convex self-hosted backend and admin dashboard
- Vite + React dashboard
- Playwright scraper worker
- Shared TypeScript types and HTML parsers

## Workspace layout

```text
apps/web          Vite dashboard
convex/           Convex schema, queries, actions, and HTTP ingest routes
packages/shared   Shared types and parsers
services/scraper  Playwright worker + internal control endpoints
tests/            Parser, scraper, and dashboard tests
```

## Prerequisites

- Node.js 22+
- npm 11+
- Docker / Docker Compose

## Install

```bash
npm install
npm run install:browsers
npm run convex:codegen
```

## Self-hosted Convex bootstrap

1. Start the Convex backend and dashboard:

```bash
docker compose up backend dashboard
```

2. Generate an admin key:

```bash
docker compose exec backend ./generate_admin_key.sh
```

3. Copy `.env.example` to `.env.local` and set:

```bash
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<generated-admin-key>
VITE_CONVEX_URL=http://127.0.0.1:3210
```

4. Push Convex code and set function environment variables:

```bash
npx convex codegen
npx convex dev --once
npx convex env set SCRAPER_INTERNAL_BASE_URL http://scraper:3001
npx convex env set SCRAPER_INTERNAL_TOKEN replace-me
npx convex env set INGEST_SHARED_SECRET replace-me
```

## Local development

Run the dashboard:

```bash
npm run dev:web
```

Run the scraper service:

```bash
npm run dev:scraper
```

The scraper exposes:

- `GET /health`
- `POST /internal/scrape`
- `POST /internal/stop`

## Full Docker stack

```bash
docker compose up --build
```

Services:

- Dashboard UI: `http://127.0.0.1:4173`
- Convex backend: `http://127.0.0.1:3210`
- Convex HTTP actions: `http://127.0.0.1:3211`
- Convex admin dashboard: `http://127.0.0.1:6791`

## Tests

```bash
npm test
npm run typecheck
```

## Live smoke-run checklist

1. Start the full stack:

```bash
docker compose up --build
```

2. Open the dashboard UI at `http://127.0.0.1:4173` and the Convex admin dashboard at `http://127.0.0.1:6791`.
3. Trigger a manual scrape from the UI or call the scraper from inside the scraper container:

```bash
docker compose exec -T scraper sh -lc \
  "wget -qO- \
    --header='Content-Type: application/json' \
    --header='X-Internal-Token: replace-me' \
    --post-data='{\"trigger\":\"manual\"}' \
    http://localhost:3001/internal/scrape"
```

4. Confirm the dashboard shows a live phase, progress bar, heartbeat, and page/detail counters while the run is active.
5. Confirm the corresponding `scrapeRuns` record transitions through `running` or `stopping` and finishes as `succeeded`, `cancelled`, or `failed`.
6. Use the dashboard stop button or the internal stop endpoint if you want to interrupt the run:

```bash
docker compose exec -T scraper sh -lc \
  "wget -qO- \
    --header='Content-Type: application/json' \
    --header='X-Internal-Token: replace-me' \
    --post-data='{}' \
    http://localhost:3001/internal/stop"
```

7. Confirm opportunities load in the dashboard without a page refresh after the scrape finishes.
8. If the run fails, inspect scraper artifacts under the scraper data volume for saved HTML and screenshots.

## Notes

- The scraper targets the BC Bid public Opportunities page only.
- The dashboard is an operator console with manual start/stop controls and reactive scrape progress.
- Public file downloads are stored as metadata only in phase 1.
- The existing root JS files were a prototype and are not part of the new runtime.
