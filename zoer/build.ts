import { sharedUiSource } from './build-dashboard';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, '../dist/zoer-bcbid');
await mkdir(join(outdir, 'worker'), { recursive: true });
const result = await Bun.build({ entrypoints: [join(root, 'src/worker.ts')], outdir: join(outdir, 'worker'), target: 'bun', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'BC Bid plugin build failed');
await copyFile(join(root, 'manifest.json'), join(outdir, 'manifest.json'));
await copyFile(join(root, 'README.md'), join(outdir, 'README.md'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
await writeFile(join(outdir, 'source.json'), JSON.stringify({ repository: 'https://github.com/ahzs645/files.git', commit, dirty, pluginDirectory: 'zoer', sharedUiSource }, null, 2) + '\n');
console.log(outdir);
