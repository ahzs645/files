# Procurement review: Zoer → SharePoint → Societyer contract

One plugin source (this repo) serves two hosts:

| Host | Role | Build | UI kit | Capabilities |
| --- | --- | --- | --- | --- |
| Zoer | Collector + reviewer | `dist/zoer-bcbid` (native module + sandbox) | `@zoer/plugin-ui/*` supplied by Zoer | `collection: true, writes: true` |
| Societyer | Reviewer only | `dist/societyer-review` (self-contained ES module) | Societyer-styled controls bundled in | `collection: false, writes: false` |

The local Zoer instance publishes a snapshot of the plugin catalog to a
SharePoint folder. Each Societyer workspace points at its own folder and reads
that snapshot. Societyer never writes to the folder.

This file is the single source of truth. The Zoer publisher
(`zoer/packages/plugin-site`) and the Societyer host
(`societyer/src/features/procurementReview`) both implement against it.

## 1. Host capabilities

New bridge method: `host.capabilities` → `HostCapabilities`.

```ts
type HostCapabilities = {
  version: 1;
  surface: "zoer" | "societyer" | "site";
  /** Scraping, sources, schedules, collection runs, targeted refresh, bulk downloads, imports. */
  collection: boolean;
  /** Any write: stars, pursuits, triage decisions, profiles, prompts, AI review, catalog edits. */
  writes: boolean;
  /** AI model calls (records.review, evidence, models list). */
  ai: boolean;
  /** Human label for the data source, e.g. "Snapshot published 2026-10-18 09:00". */
  sourceLabel?: string;
};
```

If the host does not answer (an older Zoer, the method throws), the plugin
assumes `{ version: 1, surface: "zoer", collection: true, writes: true, ai: true }`.
When `collection` is false the plugin must not render collection navigation,
tabs, buttons or setup prompts. When `writes` is false, write controls are
hidden (not just disabled).

Plugin behaviour (`zoer/dashboard/capabilities.ts`):
- Asked once per mount, before the workspace renders; no answer within 5 s also
  means the Zoer fallback. Flags that are not booleans count as `true`.
- When `writes` is false the bridge refuses, before sending, every method outside
  §2 (and `models` unless `ai`), with the read-only message below. Collection runs
  are writes, so this covers them too.
- Without `collection`: no Sources section or BC Bid scraper pages, no Documents
  Download/History views (Documents opens on Files), no award-history or JSON
  import controls, no "collect from Sources" prompts, no attachment/retry buttons.
- Without `writes`: no Profiles section, AI workbench keeps only its Analysis view,
  and stars, hide/show, pursuit stages and notes, tasks, decisions, judgements,
  requirement matches, review accept/correct, change acknowledgement, tags, saved
  search edits, alerts, classification labels, place tagging, zip bundles and AI
  runs are hidden. Gated routes redirect (sections to `/home`, views to the
  section's first remaining view).
- Without `ai`: no model selectors and no `models` request.

## 2. Read-only bridge surface

The Societyer host answers these methods with the same response shapes as
`zoer/packages/plugin-site` (`src/shell/shell.js` `execute()` and
`src/catalog.ts` `ReadOnlyCatalog`), which is the reference implementation:

| Method | Notes |
| --- | --- |
| `host.capabilities` | §1 |
| `navigation.read` / `navigation.write` | `{ version: 1, location, baseUrl }`; location is the plugin-relative path (`/home`, `/opportunities/...`) |
| `appearance` | `{ dark, tokens }`, tokens are the 27 Zoer theme token names mapped from the host theme |
| `overlay` | `{ open, insets }` |
| `state` | idle run state: same shape plugin-site returns from `/api/workspace/state` for a frozen snapshot |
| `schedules.read` | `{ schedules: [] }` |
| `models` | `{ models: [], activeModelProfileId: null }` |
| `catalog.query` | `{ statement, parameters }` → same result as `runCatalogSelect` (`{ columns, rows, durationMs, ... }`). The statement must pass `validateCatalogSelect` semantics (single read-only SELECT/WITH). |
| `catalog.read` | `ReadOnlyCatalog.workspaceRead` |
| `catalog.workspace` | `ReadOnlyCatalog.workspaceState` |
| `catalog.history` | `ReadOnlyCatalog.historyRead` |
| `catalog.record` | `ReadOnlyCatalog.record` |
| `catalog.state` | `ReadOnlyCatalog.overview` |
| `catalog.preview` / `catalog.download` | document bytes from `files/<sha256>` (§3) |

Inputs the review-only UI sends (everything else is refused in the plugin first):
`navigation.write {location, mode: 'push'|'replace'}`; `state {summary: true}`;
`catalog.query {statement, parameters}`; `catalog.read` as `{ids: []}` (head: needs
`primary`, `revision`), `{ids: [...]}`, `{ids: [], revision}` (revision check),
`{kind, after, revision, limit}` (paging) and `{match: {kind, field, value}, limit}`;
`catalog.workspace {keys}`; `catalog.history {runId, after}`; `catalog.record {id}`;
`catalog.state` (no input; `{prompts, batches, tasks}`); `catalog.preview {id}` → `{url}`;
`catalog.download {id, name}`; `schedules.read`.

Every other method rejects with
`"This is a read-only published copy. Open the plugin inside Zoer to run actions or edit data."`
Events published to `subscribe` listeners: `navigation`, `appearance`, `overlay`.

## 3. SharePoint snapshot layout

Root: a per-workspace folder path relative to the drive root, for example
`Zoer/bc-bid-monitor/<workspace-slug>`. Folder paths are validated:
segments of `[A-Za-z0-9 ._-]`, no `.`/`..` segments, no leading/trailing `/`,
at most 400 characters.

```
<root>/
  manifest.json                         pointer, written LAST, overwritten each publish
  snapshots/<snapshotId>/catalog.part-000 gzip(catalog.sqlite) split into parts
  snapshots/<snapshotId>/catalog.part-001
  files/<sha256>                         document blob, raw bytes, when size <= PART_BYTES
  files/<sha256>.part-000 ...            document blob split into parts, when larger
```

`PART_BYTES = 7 * 1024 * 1024` (under Societyer's 8 MiB SharePoint file cap).
`snapshotId` = `<UTC yyyymmddThhmmssZ>-<first 12 hex of catalog sha256>`.

```ts
type SnapshotManifest = {
  format: "zoer-plugin-snapshot";
  formatVersion: 1;
  pluginId: "bc-bid-monitor";
  pluginVersion: string;           // manifest.json version of the plugin package
  snapshotId: string;
  publishedAt: string;             // ISO 8601
  publisher: { zoerVersion?: string; host?: string };
  catalog: {
    encoding: "gzip";
    sha256: string;                // of the UNCOMPRESSED catalog.sqlite
    bytes: number;                 // uncompressed size
    parts: { path: string; bytes: number; sha256: string }[]; // paths relative to <root>
  };
  files: Record<string, { bytes: number; parts: number }>; // sha256 -> size, 0 = single blob at files/<sha256>
  counts: Record<string, number>;  // records per kind, for the UI header
};
```

Publisher rules:
- Snapshot `catalog.sqlite` with the SQLite backup API or `VACUUM INTO` so the copy
  is consistent. Mark running batches stopped (same as `export-site-data.ts`).
- Upload content-addressed `files/` only when missing (check by path first).
- Upload all parts, verify, then overwrite `manifest.json`.
- Keep the newest 2 snapshot folders, delete older ones after the manifest is written.
- Auth: Entra app, client credentials, Graph application permission
  `Sites.Selected` granted `write` on the one site. Credentials come from env,
  never from the snapshot.

Reader rules (Societyer):
- Fetch `manifest.json`, reject unknown `format`/`formatVersion`.
- Fetch parts, check each part sha256, gunzip, check catalog sha256, open in wa-sqlite (in memory).
- Cache the decompressed catalog per `snapshotId` (IndexedDB) so reloads do not refetch.
- Fetch document blobs lazily on preview/download; check sha256.

## 4. Societyer build artifact

`bun run societyer:build` in this repo emits:

```
dist/societyer-review/
  index.js        self-contained ES module (bundles React 19, react-query, router, UI)
  style.css       scoped under .bcbid-native, colours from --zoer-* host variables
                  (zoer/dashboard/hosts/societyer/*, entry zoer/dashboard/societyer-entry.tsx)
  source.json     { pluginId, pluginVersion, commit, dirty, builtAt, sha256: { "index.js", "style.css" } }
```

```ts
export type ReviewHost = {
  request(method: string, input?: unknown): Promise<unknown>;
  subscribe(listener: (event: string, result: unknown) => void): () => void;
};
/** Mounts the review workspace into `element` with its own React root. Returns unmount. */
export function mount(element: HTMLElement, host: ReviewHost): () => void;
```

Societyer copies the artifact into `public/plugins/bc-bid-monitor/` with
`scripts/sync-procurement-review.ts` and pins the hashes from `source.json`.

The mount element must define these 27 custom properties (the Zoer theme tokens,
THEME_TOKENS in `zoer/packages/plugin-site/bin/export-site-data.ts`, prefixed
`--zoer-`), and keep them current across light/dark switches:

| Variable | Suggested Societyer source |
| --- | --- |
| `--zoer-surface-base` | `--bg-app` |
| `--zoer-surface-primary` | `--bg-panel` |
| `--zoer-surface-secondary` | `--bg-subtle` |
| `--zoer-surface-hover` | `--bg-hover` |
| `--zoer-surface-active` | `--bg-active` |
| `--zoer-border-default` | `--border` |
| `--zoer-border-muted` | `--border-alpha` |
| `--zoer-text-heading` | `--text-primary` |
| `--zoer-text-primary` | `--text-primary` |
| `--zoer-text-secondary` | `--text-secondary` |
| `--zoer-text-muted` | `--text-tertiary` |
| `--zoer-text-faint` | `--text-placeholder` |
| `--zoer-accent` | `--accent` |
| `--zoer-accent-hover` | `--accent-hover` |
| `--zoer-accent-subtle` | `--accent-soft` |
| `--zoer-accent-text` | `--accent-on` |
| `--zoer-input-bg` | `--bg-base` |
| `--zoer-input-border` | `--border-strong` |
| `--zoer-input-focus` | `--border-focus` |
| `--zoer-danger` | `--danger` |
| `--zoer-danger-hover` | `--danger` |
| `--zoer-danger-text` | `--accent-on` |
| `--zoer-scrollbar-thumb` | `--border-strong` |
| `--zoer-scrollbar-hover` | `--text-tertiary` |
| `--zoer-status-error` | `--danger` |
| `--zoer-status-success` | `--success` |
| `--zoer-status-warning` | `--warn` |

Inside its scope the bundle maps them to Zoer's own names (`--surface-base`, ...,
`--accent`, `--text-primary`, `--danger`). Some of those names are also Societyer
tokens, so Societyer-classed controls inside the plugin read the mapped values;
map them to the same Societyer colours to keep both consistent. While mounted,
`mount()` copies the 27 values onto `document.documentElement` (re-read on each
`appearance` event) for Zoer controls that portal to `document.body`; unmount
removes them. The element needs no other class; `mount()` renders its own
`.bcbid-native` root inside it, and Societyer-styled dialogs are native modal
`<dialog>`s inside that root (top layer, no z-index needed).

The host must load Societyer's global stylesheet (the bundle's CSS is
`@scope`d and its Tailwind is layered, so unlayered Societyer rules win). The
bundle requests nothing at load time beyond `host.capabilities`,
`navigation.read` and the reads above; it does not call `appearance`.

### UI kit

The Societyer build replaces the most visible `@zoer/plugin-ui` controls with
implementations that render Societyer markup and class names, so Societyer's
global stylesheet styles them (`btn`, `btn--*`, `card`, `badge`, `tabs`,
`modal`, `field`, `input`, `select` ... see `societyer/src/styles` and
`societyer/docs/design-system.md`). Controls keep the Zoer prop signatures so
plugin code does not change. Everything else is Zoer's implementation, restyled
through the Zoer theme variables, which the Societyer host maps from Societyer
tokens on the mount element.

Replaced (`zoer/dashboard/hosts/societyer/kit.tsx`, prop types taken from Zoer's
components): `Btn`, `buttonClassName` (so the source dashboard's `Button` too),
`Select` (a styled native `<select>`; `searchable`, `optionDetails`,
`presentation`, `dropdownWidth`, `iconOnly` and `placeholder` are accepted and
ignored), `Modal`, `PageTabs`, `StatusBadge`, `EmptyState`. The build aliases
`@zoer/plugin-ui/{controls,analysis,database,button}` to shims that re-export the
real Zoer module (as `@zoer/plugin-ui-host/*`) and override those names.
