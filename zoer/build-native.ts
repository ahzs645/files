import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { dashboardConfig, root } from './dashboard-config';

// Reviewed build-time dependency. Never load this artifact from an installed ZIP at runtime.
const output = resolve(root, 'dist/zoer-native');
const config = dashboardConfig();
const external = (id: string) => /^(react(?:\/.*)?|react-dom(?:\/.*)?|@tanstack\/react-query|@zoer\/plugin-ui\/.*)$/.test(id);
const result = await build({ ...config,
  resolve: { ...config.resolve, alias: (config.resolve?.alias as {find:string;replacement:string}[]).filter(item => !external(item.find)) },
  define: { ...config.define, 'import.meta.env.VITE_ZOER_NATIVE': 'true' },
  build: { write: false, minify: false, cssCodeSplit: false, rollupOptions: {
    input: resolve(root, 'zoer/dashboard/native-entry.tsx'), external, preserveEntrySignatures: 'strict',
    output: { inlineDynamicImports: true, format: 'es', entryFileNames: 'index.js', assetFileNames: '[name].[ext]' },
  } },
});
if (Array.isArray(result) || !('output' in result)) throw new Error('Unexpected native build output.');
const js = result.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
if (js.includes('/Users/') || js.includes('createRoot(document.getElementById')) throw new Error('Native package contains a host-specific path or standalone root.');
const css = result.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n');
const tree = postcss.parse(css);
// Scope every dashboard rule, including Tailwind utilities/preflight, so loading the
// package never recolours or resets the host. Property declarations remain global.
const globals: string[] = [];
tree.walkAtRules('property', rule => { globals.push(rule.toString()); rule.remove(); });
tree.walkRules(rule => { rule.selector = rule.selector.replace(/:root|:host|\bhtml\b|\bbody\b/g, ':scope'); });
const tokens: Record<string,string> = { 'bg-base':'surface-base','bg-surface':'surface-primary','bg-surface-strong':'surface-secondary','bg-subtle':'surface-hover','bg-hover':'surface-hover','border-default':'border-default','border-strong':'input-border','border-subtle':'border-muted','text-primary':'text-primary','text-secondary':'text-secondary','text-tertiary':'text-muted','accent':'accent','accent-strong':'accent-hover','accent-muted':'accent-subtle','green':'status-success','red':'status-error','orange':'status-warning','yellow':'status-warning' };
const inputsSha256: Record<string,string> = {};
const inputs = new Set([resolve(root,'zoer/build-native.ts'), ...result.output.flatMap(item => item.type === 'chunk' ? Object.keys(item.modules) : [])]);
for (const path of inputs) if (path.startsWith(root + '/') && !path.includes('/node_modules/') && !path.includes('?')) {
  try { inputsSha256[path.slice(root.length + 1)] = new Bun.CryptoHasher('sha256').update(await readFile(path)).digest('hex'); } catch { /* Virtual module. */ }
}
const theme = Object.entries(tokens).map(([target,source]) => `--color-${target}:var(--${source});`).join('');
await mkdir(output, { recursive: true });
await writeFile(resolve(output,'index.js'), js);
await writeFile(resolve(output,'style.css'), `${globals.join('\n')}\n@scope (.bcbid-native) {\n${tree}\n:scope{${theme}background:none;min-width:0;color:var(--text-primary)}\n}\n`);
await writeFile(resolve(output,'index.d.ts'), `import type { ComponentType } from 'react';\nexport type NativeHost = { request(method: string, input?: unknown): Promise<any>; subscribe(listener: (event: string, result: any) => void): () => void };\ndeclare const Workspace: ComponentType<{host: NativeHost}>;\nexport default Workspace;\n`);
await writeFile(resolve(output,'source.json'), JSON.stringify({ repository:'https://github.com/ahzs645/files', commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), patchSha256: new Bun.CryptoHasher('sha256').update(execFileSync('git',['diff','HEAD','--','apps/dashboard','zoer','package.json'],{cwd:root})).digest('hex'), dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(), pluginVersion:JSON.parse(await readFile(resolve(root,'zoer/manifest.json'),'utf8')).version, entrypoint:'zoer/dashboard/native-entry.tsx', inputsSha256 },null,2)+'\n');
console.log(`Native workspace package: ${output}`);
