/**
 * Canonical populations: what every count on Home, Status, Sources, Documents, Opportunities and Insights counts.
 * Reuse these definitions (and the code each names) instead of writing another predicate, and label a number with its
 * population (`label`) and, where it has one, its window or source ("Closing within 3 days (all sources)").
 * Audit 2026-11-27 (`numbers.md` §5) gives the live values quoted in `example`.
 *
 * - Saved notices: opportunity records counted once per notice across sources (canonical.ts `canonicalNoticeSql`,
 *   `crossSource: 'exclude'`), open and closed. A per-source figure keeps that source's copies of BC Bid notices and
 *   says "incl. N also on BC Bid" (INVENTORY_SQL `linked`).
 * - Stored rows: every opportunity row incl. superseded CanadaBuys amendments and cross-source copies. Diagnostics
 *   only, never shown as "notices".
 * - Open notices: saved notices whose source status accepts bids and whose closing date has not passed in
 *   America/Vancouver (unknown and placeholder dates stay open), minus notices hidden as not relevant
 *   (queue.ts `openSql` + home-data.ts `openWork`). "Open BC Bid notices" is the same rule restricted to BC Bid.
 * - Closing within N days: open notices with a readable closing date from today through today+N (Vancouver calendar
 *   days). Always state N and the source in the label (format.ts `windowEnd` gives the last day).
 * - Open BC Bid notices with links: open BC Bid notices whose saved details list at least one attachment link. The
 *   complement with captured details and no links is "open BC Bid notices with no public files".
 * - Linked files: distinct attachments of those notices, identified by file identity (document-identity.ts: BC Bid
 *   file GUID / `bcbid:file:<guid>` key, other sources the URL with sorted query parameters).
 * - Saved files (linked): linked files with a downloaded copy matched by file identity. Complete notice: every linked
 *   file saved.
 * - Missing files: linked files not saved, split only into the host queue's buckets (`catalog.documentQueue`, the
 *   downloader's own plan): never tried, ready to retry, scheduled for retry, waiting for a browser check, skipped,
 *   unavailable, retry limit reached (status-checklist.ts `missingFileParts`).
 * - Files saved (all): every downloaded document of an existing notice, open or closed, any source; split into
 *   readable by AI, text pending, extraction failed and no text.
 * - Failed download rows: `documents` rows with status 'failed'. Diagnostics only, not a count of missing files; the
 *   failure queue counts files not saved after an attempt (source-health.ts `failedFiles`).
 * - Attachment discovery not checked: no attachment list saved and no file downloaded (queue.ts
 *   `acquireParts.unchecked`), for every source.
 * - Notices needing evidence (Acquire): open notices with no attachment list, no file saved yet, or only unreadable
 *   saved files (queue.ts `queueSql('acquire')`). Not the same as "a linked file is missing" (Status).
 * - Running: a batch whose workflow run is active in the host's run list (source-health.ts `activeBatches`); Zoer can
 *   leave a stopped run's batch marked running.
 */
export interface Population { label: string; definition: string; code: string; example?: string }

export const POPULATIONS = {
  savedNotices: { label: 'Saved notices', definition: 'Opportunity records counted once per notice across sources, open and closed.', code: 'canonical.ts canonicalNoticeSql({ crossSource: "exclude" }); home-data.ts opportunityScope', example: '7,148' },
  storedRows: { label: 'Stored rows', definition: 'Every opportunity row, including superseded amendments and cross-source copies. Diagnostics only.', code: "records WHERE kind='opportunity'", example: '7,549' },
  openNotices: { label: 'Open opportunities (all sources)', definition: 'Saved notices accepting bids whose closing date has not passed (Vancouver), unknown dates kept, hidden notices left out.', code: 'queue.ts openSql; home-data.ts openWork', example: '1,568 (BC Bid only: 689)' },
  closingWithin: { label: 'Closing within N days', definition: 'Open notices with a readable closing date from today through today+N (Vancouver calendar days).', code: 'queue.ts deadlineWindowSql; today-data.ts readClosingSoon; format.ts windowEnd', example: '148 within 3 days (all sources)' },
  openBcBidWithLinks: { label: 'Open BC Bid notices with attachment links', definition: 'Open BC Bid notices whose saved details list at least one attachment link.', code: 'status-data.ts openBcBidScope; host coverage.withLinks', example: '466' },
  linkedFiles: { label: 'Linked files', definition: 'Distinct attachments of open BC Bid notices with links, one per file identity.', code: 'document-identity.ts documentFileKey / distinctFiles; host coverage.files', example: '3,359' },
  savedLinkedFiles: { label: 'Linked files saved', definition: 'Linked files with a downloaded copy matched by file identity; a notice is complete when all are saved.', code: 'document-identity.ts matchDocuments; host coverage.saved / fullySaved', example: '2,371 files; 367 of 466 notices complete' },
  missingFiles: { label: 'Linked files missing', definition: "Linked files not saved, split only into the host queue's buckets.", code: 'status-checklist.ts missingFileParts; host catalog.documentQueue', example: '988 (451 never tried)' },
  filesSavedAll: { label: 'Files saved (all notices)', definition: 'Every downloaded document of an existing notice, open or closed, any source.', code: "documents WHERE status='downloaded' AND record_id IN (records)", example: '6,027' },
  failedDownloadRows: { label: 'Failed download rows', definition: "documents rows with status 'failed', any notice. Not a count of missing files.", code: 'document-processing.ts DOCUMENT_STATS_SQL; source-health.ts failedFiles (files not saved after an attempt)', example: '1,174 rows; 1,093 files' },
  notChecked: { label: 'Attachment discovery not checked', definition: 'No attachment list saved and no file downloaded, for every source.', code: 'queue.ts acquireParts.unchecked; source-health.ts ATTACHMENT_SQL', example: '0' },
  acquire: { label: 'Open notices needing evidence', definition: 'Open notices with no attachment list, no file saved yet, or only unreadable saved files.', code: "queue.ts queueSql('acquire')", example: '480' },
  running: { label: 'Running', definition: "A batch whose workflow run is active in the host's run list.", code: 'source-health.ts activeBatches; home-data.ts readSourceHealth', example: '0 (2 stale batches from Nov 21 are not counted)' },
} as const satisfies Record<string, Population>;
