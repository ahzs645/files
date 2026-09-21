# Developing the installed BC Bid plugin in Zoer

Open Repos → BC Bid. The attached development computer edits this checkout in /workspace.

1. Work on a branch; use Files, Chat and Terminal to edit and test.
2. Increment zoer/manifest.json version for a release. Review and commit the intended files.
3. Open Plugin update and choose Build committed version. Uncommitted files are excluded.
4. Wait for source tests, package build and native Zoer frontend build to pass.
5. Review the exact commit, version and permission changes, then deploy.
6. Open updated BC Bid from the successful receipt (a full document refresh).

The build computer has no access to the live catalog. Deployment retains the existing plugin ID,
bindings and database. A verified full SQLite and attachment recovery copy is saved before each
update. Code rollback retains all current data; it never restores an older database automatically.
Existing scrape/review jobs must finish before deployment. Failed or stale reviews cannot deploy.

The current recipe supports BC Bid on an operator-configured Zoer server-dev host. Native frontend
updates require that host's compatible reviewed Zoer source. Other plugin recipes are not yet available.
