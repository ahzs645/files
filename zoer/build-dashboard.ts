import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root = resolve(import.meta.dir, '..');
const zoerRoot = resolve(process.env.ZOER_UI_ROOT || resolve(root, '../zoer'));
export const sharedUiSource = { repository:'https://github.com/ahzs645/zoer.git', commit:execFileSync('git',['rev-parse','HEAD'],{cwd:zoerRoot,encoding:'utf8'}).trim(), dirty:!!execFileSync('git',['status','--porcelain'],{cwd:zoerRoot,encoding:'utf8'}).trim(), entrypoint:'frontend/src/plugin-ui/database.ts' };
const result = await build({
  configFile: false, root: resolve(root, 'apps/dashboard'), plugins: [{
    name: 'zoer-source-select', enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.startsWith(resolve(root, 'apps/dashboard') + '/') && /^(?:\.\.\/)+ui\/Select$/.test(source)) return resolve(root, 'zoer/dashboard/SourceSelect.tsx');
    },
  }, tailwindcss(), react()],
  define: { 'import.meta.env.VITE_ZOER_PLUGIN': 'true' },
  resolve: { dedupe: ['react','react-dom'], alias: [
    { find: '@zoer/plugin-ui/database.css', replacement: resolve(zoerRoot, 'frontend/src/plugin-ui/database.css') },
    { find: '@zoer/plugin-ui/database', replacement: resolve(zoerRoot, 'frontend/src/plugin-ui/database.ts') },
    { find: '../components/layout/AppShell', replacement: resolve(root, 'zoer/dashboard/Shell.tsx') },
    { find: 'convex/react', replacement: resolve(root, 'zoer/dashboard/backend.tsx') },
    { find: '@convex/_generated/api', replacement: resolve(root, 'zoer/dashboard/api.ts') },
    { find: '@bcbid/shared', replacement: resolve(root, 'packages/shared/src/index.ts') },
  ] },
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
