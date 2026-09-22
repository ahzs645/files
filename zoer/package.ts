// One-command release: check the Zoer checkout, build the plugin, run Zoer's package conformance test and
// write a versioned ZIP ready to stage in Extensions.
//   bun zoer/package.ts            build, test and pack
//   bun zoer/package.ts --check    only report whether the Zoer checkout is ready
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, zoerRoot } from './dashboard-config';

const required: [path: string, fix: string][] = [
  ['frontend/src/plugin-ui/database.ts', `Point ZOER_UI_ROOT at a Zoer checkout (currently ${zoerRoot}).`],
  ['frontend/node_modules/@tanstack/react-query', `cd ${resolve(zoerRoot, 'frontend')} && bun install`],
  ['node_modules', `cd ${zoerRoot} && bun install`],
  ['backend/node_modules/@zoer/api-types', `cd ${zoerRoot} && git submodule update --init && cd backend && bun install`],
  ['packages/plugin-cli/src/cli.ts', 'Update the Zoer checkout; its plugin CLI is missing.'],
];
const missing = required.filter(([path]) => !existsSync(resolve(zoerRoot, path)));
if (!existsSync(resolve(root, 'node_modules'))) missing.unshift(['node_modules', `cd ${root} && npm ci --ignore-scripts`]);
if (missing.length) {
  console.error(`Not ready to build. Missing:\n${missing.map(([path, fix]) => `  - ${path}\n      ${fix}`).join('\n')}`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`Ready. Zoer checkout: ${zoerRoot}`);
  process.exit(0);
}

const { version } = await Bun.file(resolve(root, 'zoer/manifest.json')).json() as { version: string };
const packageDir = resolve(root, 'dist/zoer-bcbid');
const zip = resolve(root, `dist/zoer-bcbid-${version}.zip`);
const cli = resolve(zoerRoot, 'packages/plugin-cli/src/cli.ts');

await $`bun ${resolve(root, 'zoer/build.ts')}`.cwd(root);
await $`bun ${cli} test ${packageDir}`.cwd(zoerRoot);
const packed = JSON.parse(await $`bun ${cli} pack ${packageDir} --output ${zip}`.cwd(zoerRoot).text()) as { digestSha256: string };
const source = await Bun.file(resolve(packageDir, 'source.json')).json() as { commit: string; dirty: boolean; sharedUiSource: { commit: string; dirty: boolean } };
console.log(`\nBC Bid Monitor ${version}\n  ZIP:    ${zip}\n  SHA256: ${packed.digestSha256}\n  Plugin: ${source.commit.slice(0, 12)}${source.dirty ? ' (uncommitted changes)' : ''}\n  Zoer:   ${source.sharedUiSource.commit.slice(0, 12)}${source.sharedUiSource.dirty ? ' (uncommitted changes)' : ''}`);
console.log('Stage the ZIP in Zoer → Extensions, review the upgrade plan, upgrade, then enable. Zoer rejects re-uploading the same version; bump zoer/manifest.json first.');
