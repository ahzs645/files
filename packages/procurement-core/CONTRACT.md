# Procurement review workspace — implementation contract

Status: working contract for implementing `~/Downloads/bid-review-plan` (IMPLEMENTATION-PLAN.md, INTERFACE-SPEC.md, BACKLOG.md) across two repositories:

- **files** (`~/github/files`): plugin `bc-bid-monitor`. Owns domain semantics (`packages/procurement-core`), prompts, and all UI (`zoer/dashboard`).
- **zoer** (`~/github/zoer`): host. Owns privileged execution: storage migrations, model calls, host actions (`backend/src/procurement/`).

Everything below is the agreed surface between the two. Change it here first if it must change.

## 0. Ground rules (from the plan)

- Unknown never becomes false/zero/"none". Keep `unknown`, `not_assessed`, `not_found_in_reviewed_material` distinct.
- A model output is never a verified fact. Machine items start `proposed` (grounded) or `ungrounded` (quote failed alignment).
- No auto-submit, no win probability, no score, no new DB/provider/queue.
- Evidence spans are **Unicode code point** offsets, half-open `[start,end)`, into an immutable extraction text identified by `text_sha256`.
- Existing tables (`records`, `documents`, `prompts`, `reviews`, `tags`, `batches`, `research_tasks`, `workspace_state`, `record_history`) are not renamed or reinterpreted. Pursuits stay in `workspace_state` key `procurement:pursuits` (existing `procurement.state` worker action).
- Code style: match surrounding code in each repo (host backend code is dense one-liners; keep it readable but consistent).

## 1. Shared package: `packages/procurement-core` (files repo)

Pure TypeScript, zero runtime dependencies, no DOM/Node APIs (must run in browser, Bun and the host). Import alias `@bcbid/procurement-core`. The host vendors a byte-identical copy of `src/` into `zoer/backend/src/procurement/core/` via `zoer/scripts/sync-procurement-core.ts`, which writes `CORE_VERSION` (sha256 of the concatenated sources) so both sides can report the contract version.

Modules (exact export names are binding for consumers). Imports inside `src/` are extensionless relative specifiers (resolved by Vite, vitest, tsc `Bundler` and Bun). `tsconfig.json` restricts `lib` to ES2022 with no `types`, so any DOM/Node API use fails typecheck.

- `contracts.ts` — string-literal unions + `const` arrays for every enum (`FACT_STATUSES`, `MODEL_FACT_STATUSES`, `DISCOVERY_STATES`, `EXTRACTION_STATUSES`, `ALIGNMENTS`, `REQUIREMENT_STRENGTHS`, `REQUIREMENT_CATEGORIES`, `FACT_FIELD_KEYS`, `FACT_SEMANTIC_TYPES`, `MONEY_KINDS`, `MONEY_BASES`, `TAX_BASES`, `DATE_PRECISIONS`, `DEADLINE_STATES`, `CLAIM_REVIEW_STATES`, `REVIEW_STATES`, `REVIEW_EVENTS`, `REQUIREMENT_MATCHES`, `GATE_ORIGINS`, `RELEVANCE_STATES`, `ELIGIBILITY_STATES`, `DELIVERY_STATES`, `RESPONSE_STATES`, `COMMERCIAL_STATES`, `FRESHNESS_STATES`, `SUGGESTED_ACTIONS`, `DECISIONS`, `TASK_KINDS`, `TASK_STATUSES`, `CHANGE_KINDS`, `STAGES`, `STAGE_RUN_STATUSES`, `STAGE_QUALITIES`, `TRIAGE_CLASSIFICATIONS`, `TRIAGE_RELEVANCE`, …), `isOneOf(values, v)`, and interfaces: `EvidenceSpan`, `Coverage` (+`CoverageGap`), `Fact`, `MoneyValue`, `Money`, `Requirement`, `CompanyProfile`, `CompanyProfileData`, `CompanyProfileVersion`, `ProfileEvidence`, `ProfilePartner`, `GateResult`, `Assessment`, `ReviewEvent`, `Decision`, `ReviewTask`, `ChangeEvent`, `DateValue`. `SCHEMA_VERSION = 1`, `POLICY_VERSION = 'procurement-policy-v1'`. Entities use the host's `recordId` (the plan's `noticeId`). `EvidenceSpan.start/end` are `null` only for `unverified` spans. `Coverage` = `{taskPurpose, discovery, sourceCompleteness, discovered|null, downloaded, usableText, processed, missing:[{id|null,name,reason,critical?}], limitations[]}`; a missing entry is critical unless `critical:false`.
- `text.ts` — `codePoints(s)`, `codePointLength(s)`, `utf16ToCodePoint(s, i)`, `codePointToUtf16(s, cp)` (both throw `RangeError` out of range), `sliceCodePoints(s, start, end?)` (clamped like `slice`).
- `evidence.ts` — `alignQuote(text, quote, hint?: number | {start}) -> {alignment:'exact'|'normalized_mapped'|'unverified', start, end, quote}`. Exact search first (nearest to `hint` when repeated); then a normalized search (NFC per base+combining-mark cluster, whitespace runs → one space, curly quotes/primes → straight, dashes/minus → `-`, `…` → `...`, ligatures, soft hyphen/zero-width removed) mapped back to **original** code point offsets; the returned `quote` is then the original source slice (so it validates). Case is never folded; nothing fuzzier. `validateSpan(span, source) -> boolean` checks recordId, lotId (null ≡ absent), extractionId, textSha256, `offsetUnit` (if present must be `unicode_code_point`), integer offsets `0 ≤ start < end ≤ len`, and exact quote equality.
- `money.ts` — `MONEY_KINDS`, `HEADLINE_MONEY_KINDS = ['buyer_budget','buyer_estimated_value']`, `MONEY_KIND_LABELS`, `MONEY_BASIS_LABELS`, `parseMoney(raw, {dollarCurrency?}) -> ParsedMoney | null` (`MoneyValue` + `isMaximum`; null when no amount; a bare `$` leaves `currency: null` unless `dollarCurrency` is passed; bare numbers count only in a money context), `partitionMoney(items) -> Array<{key, kind, currency, basis, taxBasis, items}>` — **also splits by `taxBasis`** (key `kind|currency|basis|taxBasis`, `unknown` for null currency), `summarizeMoney(group) -> {count, known, unknown, min, max, total|null, label, …}` (`total` only when every item is a point value; throws on a mixed group).
- `dates.ts` — `parseDeadline(raw, {defaultZone?}) -> DateValue {raw, precision:'instant'|'date'|'range'|'unknown', iso|null, date|null, zone|null, zoneBasis?:'stated'|'default'|null}`. Recognizes ISO with offset/Z (`zone` is then the offset string or `UTC`), BC Bid `YYYY-MM-DD h:mm:ss AM/PM [Pacific Time|PT|PST|PDT|IANA]`, `Mon D, YYYY [time]`, `D Mon YYYY [time]`, date-only, and two-date ranges (`date` = last date). Never falls back to `new Date(raw)`. `deadlineState(value, asOf) -> 'open'|'closing_today_time_unverified'|'closed'|'unknown'` (instant: closed when `iso ≤ asOf`; date/range: calendar day of `asOf` in the value zone — same day → `closing_today_time_unverified`, later → `closed`). Also `calendarDateInZone`, `zonedTimeToUtc`, `isValidTimeZone`, `DEFAULT_DEADLINE_ZONE`. Zone math uses `Intl` with IANA zones (default `America/Vancouver`); invalid `defaultZone` throws; invalid `asOf` throws.
- `policy.ts` — `nextAction(input)` (exact port of the reference rules) and `evaluateAssessment(input: AssessmentInput) -> AssessmentEvaluation` implementing IMPLEMENTATION-PLAN §8. Input: `{asOf, profileVersionId|null, profile?:{id, evidence[], proposalEffortDays?}, requirements:[{id,text,strength,category,requiredBy?,condition?,lotId?,grounding,reviewState?,evidenceIds?}], matches:[{requirementId,status,origin,companyEvidenceIds?,rationale?,remediable?,reviewed,applicabilityVerified?,viaPartner?,taskId?}], triage:{relevance,classification?}|null, coverage|null, deadline: DateValue|null, stale, conflicts?:[{description,material,resolved?}], sourceClosedConfirmed?, partnerScenarioConfirmed?, deliveryReview?:'feasible'|'conditional'|'not_feasible'|null, proposalEffortDays?, commercialReview?:'assessable'|'outside_policy'|null, money?: Money[], lotId?}`. Output: `{policyVersion, asOf, profileVersionId, lotId, freshness, relevance, eligibility, delivery, response, commercial, suggestedAction, gates: GateResult[], criticalUnknowns: string[], reasons: string[], decisionBasisEvidenceIds, deadlineState, taskScopeReady, tasks: GapTaskDraft[]}` — `reasons` are human-readable strings in evaluation order. Rules: mandatory + conditional requirements (and any requirement with an `internal_policy`/`reviewer_preference` match) are gates; no match → `unknown` (not failure); rejected/outdated requirements excluded; ungrounded or `needs_clarification` gating requirements are critical unknowns; company evidence not in the profile version or all expired → `unknown`; `viaPartner` → `remediable_gap` (`consider_partner` only with `partnerScenarioConfirmed`); `unmet` + `remediable:true` → `remediable_gap` with a `resolve_gap` task carrying the raw due point; missing/unprocessed sources, unknown coverage or incomplete attachment discovery are critical unknowns and block an eligibility pass; passed deadline or confirmed closure → `archive_or_monitor`. No triage → relevance `not_assessed` (an unrecognized triage value → `unknown`). No profile → eligibility/delivery/response/commercial `not_assessed`, action `needs_information`, reason "Choose a team to assess fit." Delivery `feasible` needs `deliveryReview:'feasible'`; response compares calendar days left with approved effort (`RESPONSE_BUFFER_DAYS = 2` → `tight`). Also `requirementTiming(requiredBy)`, `NO_PROFILE_REASON`.
- `verdict.ts` — `SUGGESTED_ACTIONS`, `SUGGESTED_ACTION_LABELS`, `VERDICT_TONES`, `verdictTone(value) -> 'supported'|'needs_information'|'blocker'|'neutral'|'stale'` mapping known enums; any unrecognized value (including different casing) is `neutral` (never green).
- `fingerprint.ts` — `stableStringify(value)` (sorted keys, no whitespace, JSON semantics for undefined/NaN/`toJSON`, `-0` → `0`, throws on cycles/BigInt), `fingerprintInput(parts)` returns the stable string (hashing is done by the caller with its platform sha256).
- `validate.ts` — `parseModelJson(raw)`, `validateExtractionOutput(raw) -> {ok, requirements[], facts[], coverage:{complete, note}, issues[]}` and `validateTriageOutput(raw) -> {ok, triage|null, issues[]}` for §4. Accepts an object, raw JSON, fenced JSON or JSON inside prose. `ok:false` only when the output is unusable (unparseable, non-object, non-array `requirements`/`facts`, neither present; triage: invalid `classification`). Invalid items are dropped into `issues[]` (`severity:'error'`, raw `item` kept); normalizations are `warning`s (unknown category/fieldKey → `other`, unknown basis/taxBasis/precision → `unknown`, unknown triage relevance → `unknown`). Enums are matched case-insensitively after trim. Quotes are required and kept verbatim. fieldKey/semanticType must agree (an insurance field never populates budget). Money: finite non-negative numbers (clean numeric strings coerced with a warning), lower ≤ upper, currency 3 letters (upper-cased) or null. Missing coverage → `complete:false`. No count caps; unknown extra fields are not carried.
- `templates.ts` — `TEMPLATES` metadata only (`{id:'procurement.<stage>', version:1, stage, purpose, inputScope, outputSchema, path}`), `templateById(id, version?)`, `TEMPLATE_STAGES`. Prompt bodies stay in `prompts/procurement/<stage>/v1.md`.
- `index.ts` re-exports all.

Host vendoring: `bun scripts/sync-procurement-core.ts [files-repo] [--check]` (zoer repo) copies `src/*.ts` (not tests) byte-for-byte into `backend/src/procurement/core/`, prompts into `backend/src/procurement/prompts/<stage>/v1.md`, and generates `core/version.ts` (`CORE_VERSION` = sha256 hex over files sorted by name, each `${name}\0${content}\0`; `PROMPTS_VERSION` likewise; `CORE_FILES`) and `prompts/index.ts` (`PROMPT_BODIES` keyed by template id). `--check` exits 1 when the vendored copy is stale.

Tests: `tests/procurement-core/*.test.ts` (vitest), including emoji/combining-character offsets, same-day date-only deadline, money partitions, and every policy rule in BACKLOG P5 acceptance.

## 2. Host storage (zoer `backend/src/procurement/schema.ts`)

Lazily migrated **only** in the `bc-bid-monitor`-style plugin catalogs that call procurement actions (never in the generic `PluginCatalog` constructor). Journal table plus numbered, checksummed, additive migrations applied in one transaction each; re-running is a no-op; a failed migration rolls back and is retried next call.

```sql
CREATE TABLE IF NOT EXISTS procurement_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL);
-- v1
CREATE TABLE procurement_extractions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,document_id TEXT,source_kind TEXT NOT NULL,-- 'notice'|'document'
  sha256 TEXT NOT NULL,-- notice: digest of notice view text; document: file sha256
  name TEXT NOT NULL,extractor_version TEXT NOT NULL,text TEXT NOT NULL,text_sha256 TEXT NOT NULL,code_points INTEGER NOT NULL,
  status TEXT NOT NULL,-- not_attempted|readable|partial|unreadable|unsupported
  blocks TEXT NOT NULL DEFAULT '[]',limitations TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,
  UNIQUE(record_id,source_kind,sha256,extractor_version));
CREATE INDEX procurement_extractions_record ON procurement_extractions(record_id);
CREATE TABLE procurement_bundles(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,purpose TEXT NOT NULL,manifest TEXT NOT NULL,coverage TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX procurement_bundles_record ON procurement_bundles(record_id,created_at);
CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,stage TEXT NOT NULL,-- triage|extract|assess|changes|question
  stage_key TEXT NOT NULL,bundle_id TEXT,template_id TEXT NOT NULL,template_version INTEGER NOT NULL,model TEXT,
  status TEXT NOT NULL,-- queued|running|succeeded|failed|cancelled|superseded
  quality TEXT,-- valid|needs_review|unsupported|stale
  is_current INTEGER NOT NULL DEFAULT 0,summary TEXT,output TEXT,coverage TEXT,usage TEXT,issues TEXT NOT NULL DEFAULT '[]',rejected_raw TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
CREATE INDEX procurement_stage_runs_record ON procurement_stage_runs(record_id,stage,is_current);
CREATE INDEX procurement_stage_runs_key ON procurement_stage_runs(stage_key,status);
CREATE TABLE procurement_requirements(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,
  strength TEXT NOT NULL,-- mandatory|preferred|conditional|informational
  category TEXT NOT NULL,actor TEXT,required_by TEXT,condition_text TEXT,grounding TEXT NOT NULL,-- exact|normalized_mapped|unverified
  supersedes TEXT NOT NULL DEFAULT '[]',conflicts TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE INDEX procurement_requirements_record ON procurement_requirements(record_id,stage_run_id);
CREATE TABLE procurement_facts(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,field_key TEXT NOT NULL,semantic_type TEXT NOT NULL,
  status TEXT NOT NULL,-- stated|explicitly_absent|not_found_in_reviewed_material|not_reviewed|conflicting|not_applicable
  value TEXT,grounding TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX procurement_facts_record ON procurement_facts(record_id,stage_run_id);
CREATE TABLE procurement_spans(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,target_type TEXT NOT NULL,-- requirement|fact|stage_run
  target_id TEXT NOT NULL,extraction_id TEXT NOT NULL,text_sha256 TEXT NOT NULL,start_cp INTEGER,end_cp INTEGER,quote TEXT NOT NULL,page INTEGER,heading TEXT,alignment TEXT NOT NULL);
CREATE INDEX procurement_spans_target ON procurement_spans(target_type,target_id);
CREATE TABLE procurement_review_events(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,event TEXT NOT NULL,-- accept|reject|correct|request_clarification|reconfirm
  reason TEXT NOT NULL,correction TEXT,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,occurred_at TEXT NOT NULL);
CREATE INDEX procurement_review_events_target ON procurement_review_events(target_type,target_id,revision);
CREATE TABLE procurement_review_state(target_type TEXT NOT NULL,target_id TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL,-- accepted|corrected|rejected|needs_clarification
  value TEXT,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(target_type,target_id));
CREATE TABLE procurement_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,draft TEXT NOT NULL,draft_version INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE procurement_profile_versions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,published_at TEXT NOT NULL,published_by TEXT NOT NULL,UNIQUE(profile_id,version));
CREATE TABLE procurement_matches(requirement_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,record_id TEXT NOT NULL,status TEXT NOT NULL,-- supported|remediable_gap|unmet|unknown|not_applicable
  origin TEXT NOT NULL,company_evidence TEXT NOT NULL DEFAULT '[]',rationale TEXT NOT NULL,remediable INTEGER,reviewed INTEGER NOT NULL DEFAULT 1,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(requirement_id,profile_version_id));
CREATE TABLE procurement_assessments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,bundle_id TEXT,profile_version_id TEXT,policy_version TEXT NOT NULL,as_of TEXT NOT NULL,
  freshness TEXT NOT NULL,-- current|stale|unknown
  relevance TEXT NOT NULL,eligibility TEXT NOT NULL,delivery TEXT NOT NULL,response TEXT NOT NULL,commercial TEXT NOT NULL,suggested_action TEXT NOT NULL,
  gates TEXT NOT NULL,critical_unknowns TEXT NOT NULL,reasons TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE INDEX procurement_assessments_record ON procurement_assessments(record_id,profile_version_id,is_current);
CREATE TABLE procurement_decisions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,assessment_id TEXT,decision TEXT NOT NULL,-- pursue|no_bid|monitor|defer
  note TEXT NOT NULL,actor TEXT NOT NULL,needs_reconfirmation INTEGER NOT NULL DEFAULT 0,stale_reason TEXT,created_at TEXT NOT NULL);
CREATE INDEX procurement_decisions_record ON procurement_decisions(record_id,created_at);
CREATE TABLE procurement_tasks(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,-- acquire_evidence|resolve_gap|reconfirm_change|decide|other
  linked_type TEXT,linked_id TEXT,owner TEXT,due_at TEXT,status TEXT NOT NULL,-- open|done|cancelled
  completion_note TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX procurement_tasks_record ON procurement_tasks(record_id,status);
CREATE TABLE procurement_changes(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,kind TEXT NOT NULL,-- document_added|document_modified|document_missing_in_check|notice_modified|profile_published
  detail TEXT NOT NULL,detected_at TEXT NOT NULL,acknowledged_at TEXT,acknowledged_by TEXT);
CREATE INDEX procurement_changes_record ON procurement_changes(record_id,acknowledged_at);
-- v2 (reviewer judgements; history rows go to procurement_review_events with target_type='judgement',
--     target_id='<record_id>|<profile_version_id>|<dimension>', event='set', reason=note, correction=JSON value)
CREATE TABLE procurement_judgements(record_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,dimension TEXT NOT NULL,-- delivery|response|commercial|partner_scenario
  value TEXT NOT NULL,note TEXT NOT NULL,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(record_id,profile_version_id,dimension));
```
`procurement_changes.detail` is JSON, shape by `kind` (produced by `backend/src/procurement/pipeline.ts` `detectChanges`; rendered by `zoer/dashboard/review-workspace/ChangesPanel.tsx` `ChangeDetail`):
- `document_added`: `{documentId, name, sha256}`.
- `document_modified`: `{documentId, name, previousSha256, sha256}`.
- `notice_modified`: `{previousSha256, sha256}` (digest of the saved-notice view text; no document identity).
- `document_missing_in_check`: from `repo.insertChange` call sites carrying `{documentId, name}` at minimum; `ChangeDetail` shows a fixed explanatory note for this kind regardless of fields present.
- `profile_published`: `{profileId, profileVersionId, version, previousProfileVersionIds, assessmentIds}`.
Only `profile_published`'s hypothetical `before`/`after` keys trigger `ChangeDetail`'s Before/After diff box; the four source-change kinds above never carry `before`/`after` (there is no human-readable "diff" of two sha256 digests) and so always render through the generic field list. `sha256`/`previousSha256`/`textSha256` values in that list are truncated to 12 hex characters (matching `EvidenceInspector.tsx`'s "file `<sha>`" convention) rather than shown as full 64-character digests.

JSON columns hold JSON text. Timestamps are ISO-8601 UTC. `workspace_state` is untouched. Backup/restore (`procurement-transfer.ts`) must include `procurement_%` tables when present and accept older backups without them. The dashboard reads these tables through the existing read-only `catalog.query` bridge (SELECT only; do **not** name any column `content`; allowed SQL functions: count/sum/avg/min/max/length/lower/upper/json_extract/coalesce/julianday/cast; 200-row pages).

## 3. Host actions (handlers) and plugin manifest actions

| Manifest action id | Host handler | Effect | Purpose |
|---|---|---|---|
| `procurement.workspace` | `procurement.workspace.v1` | local_write | Ensure migrations; return `{schemaVersion, coreVersion, capabilities:{reviewTasks,sourceSpanPreview,profileSupport,taskProgress}, counts}` |
| `procurement.pipeline` | `procurement.pipeline.v1` | local_write | Durable batch: `{recordIds(1–50), stage:'triage'|'extract', profileVersionId?, force?, resumeRunId?}` with hosted model |
| `procurement.pipeline.cli` | `procurement.pipeline.cli.v1` | local_write | Same via installed CLI (`computerId`, `cliSelection`) |
| `procurement.write` | `procurement.write.v1` | local_write | Non-model, version-checked writes, discriminated by `op` (below) |

`procurement.write` ops (all return `{ok:true, revision|version, ...}` or throw a message beginning `Conflict:` for stale expectations):

- `review.append` `{targetType:'requirement'|'fact', targetId, event, reason(≥3 chars for correct/reject), correction?, expectedRevision}` → appends event, updates `procurement_review_state`, returns new revision. Correction never edits the AI row or span.
- `match.set` `{requirementId, profileVersionId, status, origin, companyEvidenceIds[], rationale, remediable?, expectedRevision}` → then recomputes the record's assessment for that profile version.
- `assess` `{recordId, profileVersionId|null}` → deterministic `evaluateAssessment` over current extraction + review state + matches + decisions; marks prior current assessment for same (record, profile) `is_current=0`.
- `profile.save` `{profileId?, name, draft, expectedVersion}` → draft upsert.
- `profile.publish` `{profileId, expectedVersion}` → new immutable `procurement_profile_versions` row, a `profile_published` change event, returns `{profileVersionId, affectedAssessments}` (counts only; does not rerun extraction).
- `decision.record` `{recordId, assessmentId|null, decision, note}` → note required when overriding a blocker or when eligibility isn't supported. Never changes pursuits or submits anything.
- `task.create` / `task.update` `{taskId?, recordId, title, kind, linkedType?, linkedId?, owner?, dueAt?, status?, completionNote?, expectedVersion}`.
- `change.acknowledge` `{changeId}`.
- `judgement.set` `{recordId, profileVersionId (required; no judgement without a published profile), dimension, value, note(≥3 chars), expectedRevision}` → upserts `procurement_judgements`, appends a history event, then re-assesses that (record, profile version); returns `{revision, recordId, assessmentId, suggestedAction}`. Values: `delivery` feasible|conditional|not_feasible|unknown; `response` sufficient|tight|insufficient|unknown; `commercial` assessable|information_needed|outside_policy|unknown; `partner_scenario` confirmed_allowed|not_confirmed. Effects on `assess`: delivery is `feasible` only via an explicit `feasible` judgement (plus passing delivery gates); the computed response stands unless the judgement is stricter (sufficient < tight < unknown < insufficient) or the computed value is `unknown`; commercial `assessable`/`outside_policy` are passed to core, `information_needed` overrides a budget-derived `assessable`, `unknown` has no effect; `partner_scenario=confirmed_allowed` enables `consider_partner` only when the profile has a countable partner (§5.5). The suggested action is re-derived with core `nextAction` after these host rules.

Actor/reviewer identity: use the host-provided run identity/user when available, else `'operator'`.

Pipeline semantics (host `backend/src/procurement/pipeline.ts`):
1. Freeze a notice view (labelled fields, not `JSON.stringify(record).slice`) as a `source_kind='notice'` extraction; each downloaded document's current text as a `document` extraction (reuse by `(record, kind, sha256, extractor_version)`). Empty text → status `unreadable`, never `readable`.
2. Build a bundle manifest + coverage (`discovered`, `downloaded`, `usableText`, `processed`, `missing[]`, `limitations[]`, `sourceCompleteness:'unknown'`).
3. `triage` uses only the notice extraction (label "Based on the saved notice only"). `extract` chunks every included extraction by headings/paragraphs (≈12k code points, 400 overlap, recorded offsets) and calls the model once per chunk; every chunk is visited; no requirement cap.
4. Validate each chunk output with core `validateExtractionOutput`; align every quote with `alignQuote` against the chunk's extraction text; unaligned → `grounding='unverified'`; invalid JSON → one repair retry, then chunk marked failed with raw kept in `rejected_raw` (never promoted).
5. Consolidate deterministically: exact duplicate (normalized text + strength + actor + lot) merges spans; different qualifiers stay separate.
6. Commit atomically only if the stage_key's inputs are still current and the run wasn't cancelled; previous current run for (record, stage) → `is_current=0`. Detect changes vs the previous bundle (document added/modified/missing) → `procurement_changes`, mark current assessments `freshness='stale'`, decisions `needs_reconfirmation=1`.
7. After extract, run `assess` for `profileVersionId` (or null) automatically.
8. Usage: record provider usage when available, else `{"known":false}`.

Host implementation notes (binding clarifications of steps 1–8):
- Extractor versions: notice `notice-view-v1` (sha256 = digest of the view text); documents `host-text-v1`, status `readable`, `partial` (non-empty text with an extraction warning/truncation in `documents.error`; a "Refresh failed; previous file retained" note stays `readable` + limitation) or `unreadable` (empty). Extractions are immutable: if the same file sha256 is re-extracted to different text, the new row uses `extractor_version = 'host-text-v1+' + first 16 hex of text_sha256`.
- Bundle `id` = sha256 of `stableStringify(manifest)`; the manifest holds content identities only (kind, documentId, name, sha256, textSha256, extractorVersion, status; for `extract` also the discovery state, the notice's attachment list and every `documents` row `{documentId,name,url,status,sha256}`). A `triage` manifest contains only the notice, so triage never depends on files. Bundle `coverage` is the preparation-time view (`processed: 0`); the stage run's `coverage` is authoritative and adds `processed`, failed-chunk `missing[]` entries, `chunks:{total,succeeded,failed,reportedIncomplete}`, `scope` (`notice_only`|`notice_and_documents`), `failed` (download failures) and, for triage, `documentsOutOfScope`.
- `stage_key` = sha256 of `stableStringify({stage, template:[id,version], promptDigest (sha256 of shared+stage body), bundleId, selection (hosted `{profileId, model}` / CLI `{provider, model, effort}`), profileVersionId (triage only), chunker version (extract only)})`. A current `succeeded` run with the same key is reused unless `force`. A `running` run with the same key started < 6 h ago by another batch makes a new start skip that record (batch `partial`, note "already running"); rows from a resumed batch are marked `failed` ("Interrupted; resumed by …").
- Extract quality: `valid` only when every chunk succeeded, reported complete coverage, no item was dropped by validation and every item is grounded. Some chunks failed → `succeeded` + `needs_review`, promoted, with the failures in `error`, `coverage.missing` and `rejected_raw` (`[{chunk:"<extractionId>#<index>", attempt, raw|null, error}]`, repaired first attempts included) — except that such a run never displaces a current `valid` run of the same bundle. All chunks failed (or unusable triage output) → `failed` + `needs_review`, not current. Consolidation key also includes `requiredBy` and `condition` (the "qualifiers"); an unaligned duplicate of an anchored item is dropped from its spans.
- Budget: 250 model calls per batch (repairs included). Exhaustion stops the batch as `partial`; the record's stage run is `failed` with `error` starting `paused_budget:`; nothing is promoted; a resume (`resumeRunId`) reuses finished chunk checkpoints (`research_tasks` kind `procurement-chunk`/`procurement-triage`).
- Commit runs in one transaction: abort check, recomputed bundle id (changed → `superseded`, `is_current=0`), items/spans insert, change detection against the previous current run of the same stage (triage: `notice_modified` only; an identical unacknowledged change is not duplicated), `markRecordStale` when changes exist, promotion. `assess` then runs (after triage and extract, non-dry runs that were promoted) for `profileVersionId` and every other profile version with a current assessment of the record.
- Usage: `{known:true, requests, inputTokens, cachedInputTokens, outputTokens, reasoningTokens, quality, models}` only when every call of the stage run has a provider receipt (hosted metering / parsed CLI usage for this run id); otherwise `{known:false, requests, measuredRequests}`; no new calls → `{known:true, requests:0, …}`.

## 4. Stage output schemas (model JSON)

Triage:
```json
{"classification":"potentially_relevant|outside_stated_preferences|insufficient_information","relevance":"strong|possible|weak|unknown","workCategory":"string|null","route":"string|null","reasons":[{"text":"...","quote":"exact notice text or null"}],"missingInformation":["..."],"summary":"..."}
```
Extract (per chunk):
```json
{"requirements":[{"text":"atomic obligation","strength":"mandatory|preferred|conditional|informational","category":"eligibility|credential|insurance|experience|personnel|equipment|submission|technical|commercial|schedule|legal|other","actor":"string|null","requiredBy":"string|null (raw, e.g. 'at submission','at award')","condition":"string|null","lot":"string|null","quote":"exact passage"}],
 "facts":[{"fieldKey":"closing_date|budget|estimated_value|insurance_limit|bid_security|contract_duration|site_visit|questions_deadline|buyer|location|other","semanticType":"money:buyer_budget|money:buyer_estimated_value|money:insurance_limit|money:bid_security|money:award_value|money:funding_program_amount|date|duration|text","status":"stated|explicitly_absent","value":{},"quote":"exact passage"}],
 "coverage":{"complete":true,"note":"string|null"}}
```
Money fact `value`: `{"lower":n|null,"upper":n|null,"currency":"CAD|...|null","basis":"total_contract|annual|per_unit|unknown","taxBasis":"inclusive|exclusive|unknown","raw":"..."}`. Date fact `value`: `{"raw":"...","precision":"instant|date|range|unknown"}`.

Prompts live in the files repo `prompts/procurement/<stage>/v1.md` (shared policy + stage instructions, adapted from `~/Downloads/bid-review-plan/prompts/`); the host embeds its copy via the same sync script (`backend/src/procurement/prompts/index.ts` exports `PROMPT_BODIES`).

## 5. Dashboard (files repo) surface

- New code under `zoer/dashboard/review-workspace/`: `queries.ts` (SQL over §2 tables via bridge `catalog.query`, keyset pagination), `actions.ts` (bridge `action` calls to §3 with capability check), and views. Views degrade to a clear "Update Zoer to use the review workspace" state when `procurement.workspace` is unavailable or tables are missing, and all existing views keep working.
- Navigation (Shell.tsx): primary **Home, Opportunities, Pursuits, Evidence, Insights**; Configure: **AI workbench, Profiles, Sources**. Existing routes redirect to their matching views; award history lives under Insights.
- Copy rules: INTERFACE-SPEC §3 table is binding.

### 5.1 Pipeline dry runs (workbench)

`procurement.pipeline{,.cli}` accepts `dryRun: true`: the stage runs and is stored as a `procurement_stage_runs` row with `is_current=0` and `summary` prefixed `Test run:`; its requirements/facts/spans are stored (so the workbench can show them) but it never becomes current, never marks anything stale, never creates change events and never triggers `assess`.

### 5.2 Dashboard foundation (already written — build on it, don't fork it)

- `zoer/dashboard/review-workspace/actions.ts`: `useReviewWorkspace()` (capability handshake; `data.available` false → render the upgrade message in `data.reason`), `reviewWrite(op)` (typed `WriteOp` union for `procurement.write`), `startPipeline(input, model)`, `useReviewInvalidate()`, `REVIEW_KEY` (prefix every review-workspace react-query key with it).
- `zoer/dashboard/review-workspace/queries.ts`: `json()`, `placeholders()`, `readProfileVersions()`, `readCurrentAssessments(recordIds, profileVersionId)`, `readLatestDecisions(recordIds)`, `LABELS`/`label()`.
- `zoer/dashboard/review-workspace/profile-context.ts`: `useActiveProfile()` → `{profileVersionId, active, versions, setProfileVersionId}` (localStorage; missing → null → "Not assessed for this profile").
- Model choice: reuse `ReviewModelSelector` from `@zoer/plugin-ui/analysis` exactly as `zoer/dashboard/AiReview.tsx` does (hosted model → `modelProfileId`; CLI computer → `computerId` + `cliSelection`).
- Writes are durable runs (≈1–2 s). Show a pending state, then `useReviewInvalidate()`. Surface `Conflict:` errors as "Someone else changed this; reload and review it."

### 5.3 Routes and navigation

Primary tabs: **Home** (`/home`; `/` redirects here), **Opportunities** (`/procurement` review table with `view=matrix|compare`; the legacy grid `/opportunities` stays reachable as the "Grid" view), **Pursuits** (`/pursuits`), **Evidence** (`/evidence` cell grid; `/documents` is its "Files" view), **Insights** (`/insights` decision intelligence; `/analysis/*` and `/contract-awards` = "Award history"/market analysis). Configure group (visually secondary): **AI workbench** (`/ai-review`, with `/workbench` stage view), **Profiles** (`/profiles`), **Sources** (`/sources` and BC Bid subpages). Notice detail stays route-backed: `/procurement?notice=<id>&tab=decision|requirements|evidence|changes|activity|ai`.

### 5.4 Shared component interfaces

- `review-workspace/EvidenceInspector.tsx`: `export function EvidenceInspector(props: { recordId: string; target: { type: 'requirement' | 'fact'; id: string }; onClose(): void })` — loads its own data; shows value/interpretation, review history, accept/correct/reject/needs-clarification, and the immutable source passage highlighted by code-point span (or the named reason no quote exists).
- `review-workspace/DimensionChips.tsx`: `export function DimensionChips(props: { assessment: AssessmentRow | null; compact?: boolean })` — neutral grey unknown, amber needs info, green supported, red confirmed blocker, violet stale; always text + colour.
- `review-workspace/ProfilePicker.tsx`: `export function ProfilePicker()` — compact select bound to `useActiveProfile()`, with "No company profile" option and a link to `/profiles`.

### 5.5 Company profile draft shape (`procurement_profiles.draft`, `procurement_profile_versions.data`)

Written by `review-workspace/ProfileEditor.tsx` through `profile.save`; `profile.publish` copies the saved draft verbatim into `data`. The host `assess` op reads this shape. Source of truth: `zoer/dashboard/review-workspace/profile-types.ts` (`ProfileDraft`, `normalizeDraft`, `validateDraft`, `countablePartners`). Dates are `YYYY-MM-DD`; unknown is `null`, never `0` or `""`.

```ts
interface ProfileDraft {
  schemaVersion: 1;
  scenario: 'solo' | 'team' | 'partner';
  team: { name: string; role: string }[];            // named team (names/roles only)
  partners: { name: string; confirmed: boolean; responsibilities: string[] }[];
  serviceLines: string[];
  exclusions: string[];
  geography: string[];                                // areas served, as worded by the user
  evidence: {
    id: string;                                       // stable (crypto.randomUUID); referenced by procurement_matches.company_evidence
    capability: string;                               // credential/capability, insurance type, project/reference, equipment
    kind: 'credential' | 'insurance' | 'reference' | 'equipment' | 'other';
    holder: string | null;
    verification: 'self_declared' | 'reviewed';       // reviewed requires verifiedAt
    verifiedAt: string | null;
    expiresAt: string | null;
    sourceRef: string | null;                         // free-text source note (where the proof is)
    limit?: number | null; currency?: string | null;  // insurance only; ISO 4217
  }[];
  capacity: { from: string; to: string; hours: number }[];  // available delivery hours per period (inclusive)
  responseHours: number | null;                       // proposal hours available per response; null = unknown
  commercial: {                                       // optional internal policy; never buyer eligibility or buyer budget
    origin: 'internal_policy';
    currency: string | null; rateBasis: 'hourly' | 'daily' | null; rateLow: number | null; rateHigh: number | null;
    minContractValue: number | null; notes: string;
  };
}
```

Rules for consumers: a partner counts only when `scenario === 'partner'`, `confirmed === true` and `responsibilities` is non-empty (`countablePartners`). Evidence with `expiresAt` before the assessment's `as_of` must not support a match (treat as `unknown`, not `unmet`). Missing evidence is `unknown`, never a failure. `commercial` gates, if any, use origin `internal_policy`. Mapping to core `CompanyProfileData`: `geography`→`regions`, `responseHours` (hours) replaces `proposalEffortDays`, `capacity[]` generalizes `capacityPeriod`, partner `responsibilities`→`capabilities`, `commercial` replaces `commercialConstraints[]`; `normalizeDraft` reads older/partial drafts leniently.
