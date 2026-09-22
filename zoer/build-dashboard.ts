import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertZoerCheckout, dashboardConfig, root, zoerRoot } from './dashboard-config';
assertZoerCheckout();
export const sharedUiSource = { repository:'https://github.com/ahzs645/zoer.git', commit:execFileSync('git',['rev-parse','HEAD'],{cwd:zoerRoot,encoding:'utf8'}).trim(), dirty:!!execFileSync('git',['status','--porcelain'],{cwd:zoerRoot,encoding:'utf8'}).trim(), entrypoint:'frontend/src/plugin-ui/database.ts' };
const result = await build({
  ...dashboardConfig(),
  build: { write: false, minify: true, cssCodeSplit: false, rollupOptions: {
    input: resolve(root, 'zoer/dashboard/main.tsx'), output: { inlineDynamicImports: true, format: 'iife' },
  } },
});
if (Array.isArray(result) || !('output' in result)) throw new Error('Unexpected dashboard build output.');
const scripts = result.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
const css = result.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n');
if (/@(?:theme|source)\b/.test(css) || !css.includes('.bg-surface-primary')) throw new Error('Shared UI styles were not compiled. Use the real database.css entry point.');
const html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.replaceAll('</style', '<\\/style')}</style><div id="root"></div><script>${scripts.replaceAll('</script', '<\\/script')}</script>`;
await mkdir(resolve(root, 'dist/zoer-bcbid/dashboard'), { recursive: true });
await writeFile(resolve(root, 'dist/zoer-bcbid/dashboard/index.html'), html);
console.log(`Bundled source dashboard: ${Buffer.byteLength(html)} bytes`);
