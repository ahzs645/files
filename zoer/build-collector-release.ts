import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name: string) => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--retained-package') && process.argv.includes('--output'), 'Pass --retained-package and --output');
const retained = resolve(option('--retained-package')), output = resolve(option('--output'));
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const baseCommit = 'feb431b6cfb532d70aaa0da0c82382aa70815baf';
const expected = {
  'source.json': 'a7e07982ecb16c81a0cda340801fdb4c3bb04f46b8bf9487227cbddfec24fb00',
  'README.md': '6abc68f280bc47a342358660bc4b8411f523c37d6cff55aef3adf4386e654ef2',
  'manifest.json': 'fcc23ae98d018d146d848d082aa561cb5d120f4009cca6508b9b16a93e4ec7d2',
  'native/index.js': '51f9bbe0e268f407d9fe60d43b14f15dc33818d62b6a73111c30e659256b0614',
  'native/style.css': 'ba724709e0acf1545faaf5220953dcd003aed1412e8e82733e76fd1057ca6460',
  'dashboard/index.html': '730190c0208147465f48007c2f54614a4ad36a2714c7d07562b8b30ba18b5889',
  'worker/worker.js': '07f8a848b90007e8631bc94fdba6126f8d8455b6abfba14cc64a039700cb3ded',
};
for (const [path, expectedSha] of Object.entries(expected)) assert.equal(sha(await readFile(join(retained, path))), expectedSha, `Retained ${path} changed`);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Build from the clean isolated release commit');
const commit = git('rev-parse', 'HEAD');
assert.equal(git('rev-parse', 'HEAD^'), baseCommit, 'The scoped release must directly extend the verified installed source commit');
const manifest = JSON.parse(await readFile(join(root, 'zoer/manifest.json'), 'utf8'));
const oldManifest = JSON.parse(await readFile(join(retained, 'manifest.json'), 'utf8'));
const comparable = structuredClone(manifest); comparable.version = oldManifest.version;
const award = comparable.integration.actions.find((action: any) => action.id === 'awards.import');
delete award.inputSchema.properties.records.items.properties.sourceId;
delete award.inputSchema.properties.records.items.properties.sourceAwardId;
assert.deepEqual(comparable, oldManifest, 'Only version and optional award source IDs may change in the manifest');
await mkdir(join(output, 'worker'), { recursive: true });
const result = await Bun.build({ entrypoints: [join(root, 'zoer/src/worker.ts')], outdir: join(output, 'worker'), target: 'bun', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Scoped collector worker build failed');
const retainedAssets = Object.fromEntries(Object.entries(expected).filter(([path]) => !['source.json', 'manifest.json', 'worker/worker.js'].includes(path)));
for (const path of Object.keys(retainedAssets)) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await copyFile(join(retained, path), join(output, path));
}
await copyFile(join(root, 'zoer/manifest.json'), join(output, 'manifest.json'));
const sourcePaths = git('diff', '--name-only', baseCommit, commit).split('\n');
const sourceFileHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(join(root, path)))])));
const source = JSON.parse(await readFile(join(retained, 'source.json'), 'utf8'));
const workerSha256 = sha(await readFile(join(output, 'worker/worker.js')));
const provenance = { repository: source.repository, commit, dirty: false, pluginDirectory: 'zoer',
  buildProfile: 'collector-correctness-retain-native-v1', pluginVersion: manifest.version,
  sharedUiSource: source.sharedUiSource,
  basedOn: { commit: baseCommit, pluginVersion: oldManifest.version, installedFilesSha256: expected },
  sourceFileHashes, worker: { sha256: workerSha256 }, retainedAssetsSha256: retainedAssets,
};
await writeFile(join(output, 'source.json'), JSON.stringify(provenance, null, 2) + '\n');
const files = Object.fromEntries(await Promise.all(Object.keys(expected).map(async path => [path, sha(await readFile(join(output, path)))])));
const changedPackageFiles = Object.keys(files).filter(path => files[path] !== expected[path as keyof typeof expected]);
assert.deepEqual(changedPackageFiles.sort(), ['manifest.json', 'source.json', 'worker/worker.js']);
const report = { commit, baseCommit, version: manifest.version, workerSha256, sourceFileHashes, files, retainedAssetsSha256: retainedAssets, changedPackageFiles };
await writeFile(output + '.manifest.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, commit, version: manifest.version, workerSha256, changedPackageFiles }, null, 2));
