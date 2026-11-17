# Deploying deferred text extraction (host `1a84ff7a`, Procurement 0.41.0)

Deployed to OTE on November 16, 2026 (Vancouver). The live health endpoint reported host commit
`1a84ff7a`, and the enabled Procurement extension reported version `0.41.0`. The ten backend
files below were layered onto the site's existing `dev-1794885905-fec3f15-dirty` image after
checking their base hashes. The image retains the dirty build flag to reflect the site's other
changes. The production image passed the backend typecheck.

The catalog reported `deferredExtraction: true`. The live Documents interface showed the Processing
tab and an empty queue. A bounded extraction run succeeded with zero files selected. The upgrade
added one local extraction action and requested no additional permissions, network hosts or
capabilities. All ten schedules retained their settings. The verified SQLite and attachment
recovery copy is under `/data/backups/procurement-0410-before-aeb57bf` (2,921 files).

The steps below are the original rollout procedure. References to the previous version or
connectivity describe the pre-deployment checks.

## What ships

| Part | Source | Artifact |
|---|---|---|
| Host backend | `ahzs645/zoer`, branch `feat/deferred-document-extraction`, commit `1a84ff7a2d27bfdd9821b4fdeff18ef5d05bbe18` (local, not pushed) | Ten files under `backend/src` layered on the live backend image |
| Plugin | this repository, branch `feat/native-database-setup`, commit `ddb1e37` (local, not pushed) | `dist/procurement-0.41.0.zip`, package digest `2284f6a512e31b075e9ed462d633ef8ce28b6bea7f9d5418f023cb28759f2777`, file SHA-256 `f290ac1a8187e96f0f7dbfca9cff4bcebb367e2fda34de915df32e727eb179e3` |

No frontend image, browser-runtime image, database migration or Convex function changes. The plugin's
native UI is inside the package.

Backend files that differ from the live `4f7eb40a` image (`git diff --name-only 4f7eb40a 1a84ff7a -- backend/src`, tests excluded):

```
backend/src/integration-host-actions.ts
backend/src/plugins/plugin-catalog.ts
backend/src/plugins/plugin-document-extraction.ts   (new)
backend/src/plugins/plugin-document-pending.ts      (new)
backend/src/plugins/plugin-document-versions.ts
backend/src/plugins/plugin-download-missing.ts
backend/src/plugins/plugin-research.ts
backend/src/procurement-evidence.ts
backend/src/procurement/pipeline.ts
backend/src/workflows/workflow-dispatcher.ts
```

In the image they live under `/app/backend/src/…`.

## Order and preconditions

1. **Host first, plugin second.** Plugin 0.41.0 binds the host handler
   `documents.extract.pending.v1`; the live host does not have it, so the package's upgrade plan is
   expected to be blocked until the host is rolled out.
2. **No active Procurement runs for the plugin upgrade.** The upgrade refuses while any run is not
   in a final state. At 23:25 UTC on 2026-11-16 `scrape.full` was running,
   `procurement.collect` was waiting to retry and `procurement.alerts` was pending. Either wait for
   them, or freeze and resume the scrape as the 0.40.1 rollout did.
3. **Node access.** SSH to `ubuntu@10.70.20.50` with the operator key. On 2026-11-16 over the
   WireGuard tunnel the TCP port answered and key authentication succeeded, but the session never
   returned a shell (three attempts, up to about three minutes). Confirm a working shell before
   starting; do not begin a rollout over a session that stalls.

## Host backend rollout

1. On the build machine, from the host checkout at `1a84ff7a` (clean tree), copy the ten files above
   into a context directory as `context/backend/app/backend/src/<same relative path>`, and copy that
   directory with `image-layer.py` to a new working directory on the node.
2. On the node, record the live images for rollback:
   `sudo k3s kubectl -n zoer get deploy zoer-backend zoer-frontend -o jsonpath='{range .items[*]}{.metadata.name}={.spec.template.spec.containers[0].image}{"\n"}{end}'`.
   The backend was `docker.io/zoer-local/backend:attachment-4f7eb40a` after the last rollout.
3. Build the layered image (base = the live backend image, runtime = the live browser-runtime image
   recorded in the backend's `BROWSER_RUNTIME_IMAGE`):
   `python3 image-layer.py backend <live backend image> docker.io/zoer-local/backend:extraction-1a84ff7a 1a84ff7a2d27bfdd9821b4fdeff18ef5d05bbe18 <live browser-runtime image>`.
4. Before switching, typecheck the new image's backend source in a container of that image (the
   playbook's narrow-repair rule: explicit Node heap limit, core dumps off).
5. Back up the Procurement catalog and attachments as before each plugin update.
6. Roll out with the maintenance drain, as `rollout.sh` did: probe, drain, wait until safe, patch
   the backend deployment's image and its `PLUGIN_RUNNER_CONTAINER_IMAGE` to the new tag (leave the
   frontend and browser-runtime images as they are), wait for the rollout, check health, resume.
   On any failure after the switch, patch back to the recorded previous image.
7. Verify: `curl -s https://zoer.k8s.overtheedgepaper.ca/api/health` reports
   `build.commit` `1a84ff7a2d27bfdd9821b4fdeff18ef5d05bbe18`, and
   `GET /api/extensions/bc-bid-monitor/workspace/catalog` reports `"deferredExtraction": true`
   (with plugin 0.40.1 still installed nothing else changes: its manifest declares no deferral
   default, so its downloads keep extracting inline).

## Plugin upgrade

1. Stage `dist/procurement-0.41.0.zip` as a development package
   (`POST /api/plugin-packages/stage-zip` with a label such as
   `Procurement 0.41.0 deferred text extraction · ddb1e37`), or stage it in Extensions.
2. Read the upgrade plan. Expected: from 0.40.1 to 0.41.0, no added permissions, network hosts or
   capabilities, no blockers. The plan lists the new action `documents.extract.pending` and the
   changed input schemas of the three download actions; if the host asks for re-approval of the
   plugin or of its schedules, review and approve them there.
3. With no active runs, apply the upgrade with the plan's fingerprint, enable the plugin and confirm
   `GET /api/extensions/bc-bid-monitor` reports version `0.41.0`, status `active`.

## Acceptance checks (REQ-014)

- AC-017: `/api/health` reports commit `1a84ff7a…`.
- AC-018: the extension reports `0.41.0`, `active`.
- AC-026: the workspace catalog reports `deferredExtraction: true`.
- AC-027: `https://zoer.k8s.overtheedgepaper.ca/#/plugins/bc-bid-monitor/documents` shows the
  Processing tab, and starting **Extract text now** is accepted by the host (the action's plan
  resolves; with nothing pending the button is disabled, so check after one deferred download).

A first real check worth doing: download one small notice, confirm its files appear as
"Text pending" at once, then run Processing and confirm they become "Readable".

## Rollback

- Host: patch the backend deployment (image and `PLUGIN_RUNNER_CONTAINER_IMAGE`) back to the image
  recorded in step 2. Files saved as pending while the new host ran stay saved; on the old host they
  show the warning "Text extraction pending." and can be read with **Re-extract**.
- Plugin: stage and upgrade to the previous 0.40.1 package. Do this before rolling the host back.
