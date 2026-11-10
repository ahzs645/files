# Historical BC Bid completion queue

`complete-historical.mjs` is a finite operator tool for an already authorized
public historical collection. It uses the existing Zoer catalog and registered
`scrape.details` and `documents.download.all` actions. It does not install a new
plugin, change schedules, create a database, or publish to Societyer.

The queue adopts the exact running historical collector and an optional current
25-notice detail/download batch. It refreshes captured legacy notices to full-tab
capture version 3, downloads expected public attachments in batches of at most
25 notices, and verifies saved originals by byte count and SHA-256. No-link
notices are counted separately; this does not prove the source has no external
or restricted documents. It leaves listing-only rows to the existing collector.
The existing bulk action owns its bounded transport recovery and cooldown.

The historical collector separately retries the native transport's exact typed
navigation timeout and network-error diagnostics with a 60-second backoff, under
the existing host limit on consecutive failures. It preserves the committed
listing/detail cursor. Unknown errors, changed control, and browser checks still
stop for review; a failed run must be inspected before creating its replacement
from the saved checkpoint and updating this queue's pinned run/package identity.

Run with Node 24 or Bun 1.4 using an explicitly reviewed configuration and an
existing private state file:

```sh
bun zoer/tools/complete-historical.mjs /private/config.json /private/state.json
```

Configuration fields:

```json
{
  "id": "operator-selected-run-id",
  "baseUrl": "https://your-zoer-host",
  "historicalRun": "workflow_run_existing",
  "documentBrowser": "br-existing",
  "browsers": [{"id": "br-existing", "controlRevision": "reviewed-revision"}],
  "pluginVersion": "reviewed-version",
  "pluginDigest": "reviewed-package-sha256",
  "filesDir": "/readonly-plugin-originals",
  "minFreeBytes": 10737418240
}
```

Include both collector and document browser identities in `browsers`. A fresh
state starts with `schemaVersion: 1`, the matching `configId`, `phase: "selecting"`,
`pending: null`, `completedBatches: 0`, `scanCursor: ""`, and `verifiedHashes: {}`.
To adopt a previously started action, `pending` must name its exact `action`,
`ids`, `runId`, and `phase: "running"` from its saved request/response receipt.
Do not adopt runs or browser profiles belonging to other tasks.

Only one process may own a state file. It takes an exclusive lock directory and
never steals a stale lock. For a cluster Job use `restartPolicy: Never`,
`backoffLimit: 0`, no service-account token, and the existing backend image.
Mount only the originals directory read-only, its dedicated state directory
read-write, and the reviewed script/config. No API, SharePoint, or Convex secrets
are needed by this queue. Keep the original catalog and browser volumes intact.

The queue waits through the host's explicit maintenance pause (`paused: true`,
`waiting_for_event`, `Paused for Zoer update`, and `paused-for-update` for a
resumable action). It keeps the same pending run and checks again once a minute;
it never restarts the collector or submits work during that pause. This is
different from a user pause, approval, browser check, or unknown event wait,
which still stops for review. A backend maintenance drain observed on November
10, 2026 resumed its collector automatically after 32 seconds; it must not stop
the independent completion queue.

It stops for changed plugin/browser identity, user control, challenges, failed
runs, unknown submission outcomes, incomplete captures, corrupt/missing saved
files, and truncated queries. It never changes an uncertain action's idempotency
key or automatically grants approval. After a crash, confirm the old process/Pod
has stopped and inspect any saved intent/run before removing its lock. Reuse the
same state and exact known run; do not create another batch to hide uncertainty.
At less than 10 GiB free (or 15% free), it pauses its resumable source collector
and stops for storage review, preserving all saved data.

Completion requires the original collector to finish, an empty checkpoint queue,
matching unique notice counts, all notices fully captured, and a fresh hash audit
of every expected original. The success state is `ready_for_final_publication`.
An operator must then publish/import the verified snapshot using the existing
protected publisher and confirm portal activation. Queue completion alone is
not evidence that the portal is current or that the global source catalog is
complete. Keep partial coverage labels honest during intermediate publications.

Affected checks: `npx vitest run tests/zoer-historical-completion.test.ts`.
These cover selection/integrity guards, ambiguous submission recovery, and
completion prerequisites; actual source/browser acceptance remains a live check.
