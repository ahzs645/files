# Scoped collector correctness release

This source commit extends the installed files commit `feb431b6cfb532d70aaa0da0c82382aa70815baf`. Its baseline worker was rebuilt with Bun 1.3.14 and exactly matched installed SHA-256 `07f8a848b90007e8631bc94fdba6126f8d8455b6abfba14cc64a039700cb3ded`.

The collector now parses raw money with explicit currency/scale/status, separates stable award identity from mutable source revisions, preserves physical legacy IDs and stars, fails on ambiguous multi-award anchors, and stamps existing versioned provisional buyer mappings. The manual award import accepts optional actual source namespaces/award IDs. These are the only manifest action changes; no permissions, sources, crawl policy, pipeline actions, capture actions or resumable policies change.

Legacy adoption uses a complete revision-checked identity index, read through the existing 200-row / byte-bounded catalog interface. The index retains identity-to-physical-ID references and is reused across captured pages within one worker action. Outside catalog revisions invalidate it. A real SQLite/JSON fixture with 21,877 awards, byte-limited pages, normalized legacy anchors and competing identities verifies this behavior. This does not update existing rows until their normal source save, resume paused work, or recollect any source.

The retained-asset release builder is frozen to commit `1d9d522a2d759bca9725df215c93a5b6f26eb329` and its direct parent `feb431b6cfb532d70aaa0da0c82382aa70815baf`. To reproduce that release, check out `1d9d522` in a clean checkout before running the command below. It intentionally rejects later main commits; normal future builds use the repository's ordinary build workflow.

Build from that clean release commit:

```sh
bun zoer/build-collector-release.ts --retained-package /private/path/to/verified-installed-package --output /private/path/to/new-package
```

The build verifies every retained package hash and rebuilds only the worker. It preserves the installed native JavaScript, CSS, sandbox entrypoint and README byte for byte. `source.json` pins the new clean collector source commit and hashes, while separately retaining the old native asset hashes and its original dirty shared-UI provenance. Only `manifest.json`, `source.json` and `worker/worker.js` change in the package. Hosted Societyer uses its own deployed native reader and does not execute these embedded plugin assets.

Checks:

```sh
npx vitest run tests/procurement-collector-correctness.test.ts
npm run typecheck --workspace @bcbid/shared
ZOER_SOURCE_ROOT=/absolute/path/to/zoer bun zoer/test-collector-inventory.ts
```

Use Zoer's existing staged-package upgrade API with the exact frozen package and fingerprint; no backend rollout is required. Stage and inspect the permission plan before upgrading, then explicitly enable and verify the loaded version. The package manager retains the previous tree for its separate fingerprint-bound rollback operation. Preserve the exact installed package archive as an additional rollback input. A plugin upgrade does not resume user-paused durable work; compatible read/local-write actions retain their declarations. Before any production change, independently qualify current execution/lease inventory and retain source checkpoint/batch hashes.
