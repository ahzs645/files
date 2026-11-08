# Validation scope and local commands

Feature work is checked on pull requests; main retains integration validation. Release events stay in zoer-plugin-release.yml. The qualified Zoer host stays optional for check.yml when its source token is absent, with the existing explicit skipped-host report. Convex generated types and browser prerequisites remain unchanged.

## Local entry points

```sh
npm ci --ignore-scripts
npm run typecheck
npx playwright install chromium
npm test
# Qualified host present: also use the existing zoer:typecheck, zoer:test:catalog and zoer:test:worker commands.
```

Feature branches without an open PR use local commands. A local pass does not replace validation of the submitted revision. Main/release publication keeps the workflow's existing authorization and artifact conditions.

CI optimization batch: November 7, 2026. Workflow syntax and focused orchestration/selection checks are separate from complete application, native-platform and research validation.
