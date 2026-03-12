# BC Bid Monitor

Self-hosted BC Bid monitoring stack built with:

- Convex self-hosted backend and admin dashboard
- Vite + React dashboard
- Playwright or Botright scraper worker
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

Optional local Botright dependencies:

```bash
pip3 install -r services/scraper/botright/requirements.txt
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

## Botright engine

The scraper supports two engines:

- `SCRAPER_ENGINE=playwright` keeps the existing TypeScript Playwright worker.
- `SCRAPER_ENGINE=botright` launches a Python Botright worker under the same start/stop/progress flow.

Local example:

```bash
SCRAPER_ENGINE=botright npm run dev:scraper
```

Local headed example:

```bash
SCRAPER_ENGINE=botright npm run scrape:live
```

Docker example:

```bash
SCRAPER_ENGINE=botright docker compose up --build
```

If your existing `scraper-data` volume was created by an older root-owned scraper container, recreate it before switching engines:

```bash
docker compose down -v
```

## Passing the BC Bid browser check

The containerized scraper path is still vulnerable to BC Bid's `/page.aspx/en/bas/browser_check` gate. When that page shows a captcha or the run fails with `Accessibility settings`, use the headed local Chrome flow instead of the container endpoint.

Run this from the repo root:

```bash
npm run scrape:live
```

If you changed the default local secrets or URLs, set them explicitly:

```bash
CONVEX_SITE_URL=http://127.0.0.1:3211 \
INGEST_SHARED_SECRET=replace-me \
npm run scrape:live
```

What this does:

1. Opens a visible Chrome session instead of headless Chromium.
2. Reuses the normal scraper profile at `services/scraper/.runtime/profile` by default, unless `SCRAPER_USER_DATA_DIR` is set.
3. Writes artifacts under `services/scraper/.runtime/artifacts/<runId>`.
4. Pushes progress and final results into the same Convex `scrapeRuns` records used by the dashboard.

Operator steps when the browser check appears:

1. Leave the opened Chrome window running.
2. If BC Bid redirects to `/page.aspx/en/bas/browser_check`, complete the captcha or continue flow in that window.
3. Wait until the browser lands on the public Opportunities page.
4. Do not close Chrome until the terminal prints the `finish` payload.

Notes:

- `npm run scrape:live` uses the local `chrome` browser channel by default, so Google Chrome needs to be installed on the machine running the command.
- Future headless runs can reuse the same profile, so a browser check solved once in the headed flow may also unblock later local headless runs until BC Bid challenges that profile again.
- If you want a clean browser session, delete `services/scraper/.runtime/profile` or point `SCRAPER_USER_DATA_DIR` at a different directory.
- The dashboard and Convex admin pages will still show live progress while this manual headed run is active.
- The internal `POST /internal/scrape` endpoint remains useful for unattended runs, but it can still fail when BC Bid challenges headless traffic.
- For local unattended runs, prefer the installed Chrome channel over bundled Chromium:

```bash
SCRAPER_BROWSER_CHANNEL=chrome npm run dev:scraper
```

If BC Bid challenges that local headless run, complete the check once with the same shared profile:

```bash
SCRAPER_BROWSER_CHANNEL=chrome npm run scrape:live
```

If you want to try Botright instead of the default Playwright path:

```bash
SCRAPER_ENGINE=botright npm run scrape:live
```

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

If that run fails at the BC Bid browser check, use the headed local fallback instead:

```bash
npm run scrape:live
```

To exercise the Botright worker in Docker instead of Playwright:

```bash
SCRAPER_ENGINE=botright docker compose up --build
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
