import { build, type Alias } from 'vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { dashboardConfig, root, zoerRoot } from './dashboard-config';
import { DASHBOARD_COLORS, THEME_TOKENS } from './dashboard/hosts/societyer/tokens';

// Review-only workspace for Societyer (zoer/docs/societyer-review-contract.md §4). Societyer runs React 18 without
// react-query, so this bundle is self-contained: React 19, react-query, the router and Zoer's controls are all inside.
const output = resolve(root, 'dist/societyer-review');
const config = dashboardConfig();
const shims = resolve(root, 'zoer/dashboard/hosts/societyer');
const real = (file: string) => resolve(zoerRoot, 'frontend/src', file);
// The most visible controls render Societyer markup; the shims reach Zoer's real modules as `@zoer/plugin-ui-host/*`.
const shimmed: Record<string, string> = { '@zoer/plugin-ui/controls': 'controls.ts', '@zoer/plugin-ui/analysis': 'analysis.ts', '@zoer/plugin-ui/database': 'database.ts', '@zoer/plugin-ui/button': 'button.ts' };
const alias: Alias[] = [
  { find: '@zoer/plugin-ui-host/controls', replacement: real('plugin-ui/controls.ts') },
  { find: '@zoer/plugin-ui-host/analysis', replacement: real('plugin-ui/analysis.ts') },
  { find: '@zoer/plugin-ui-host/database', replacement: real('plugin-ui/database.ts') },
  { find: '@zoer/plugin-ui-host/button', replacement: real('components/ui/Btn.tsx') },
  ...(config.resolve?.alias as Alias[]).map(item => typeof item.find === 'string' && shimmed[item.find] ? { ...item, replacement: resolve(shims, shimmed[item.find]) } : item),
];
const result = await build({ ...config,
  resolve: { ...config.resolve, alias },
  // Bound host and explicit startWorkspace(), exactly like the native workspace.
  define: { ...config.define, 'import.meta.env.VITE_ZOER_NATIVE': 'true' },
  build: { write: false, minify: true, cssCodeSplit: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, rollupOptions: {
    input: resolve(root, 'zoer/dashboard/societyer-entry.tsx'), preserveEntrySignatures: 'strict',
    output: { inlineDynamicImports: true, format: 'es', entryFileNames: 'index.js', assetFileNames: '[name].[ext]' },
  } },
});
if (Array.isArray(result) || !('output' in result)) throw new Error('Unexpected Societyer build output.');
const chunks = result.output.filter(item => item.type === 'chunk'), assets = result.output.filter(item => item.type === 'asset');
const extra = assets.filter(item => !item.fileName.endsWith('.css')).map(item => item.fileName);
if (chunks.length !== 1 || extra.length) throw new Error(`Societyer package must be one index.js and one style.css; also got: ${[...chunks.slice(1).map(item => item.fileName), ...extra].join(', ')}`);
const js = chunks[0].code;
if (js.includes('/Users/') || js.includes('createRoot(document.getElementById')) throw new Error('Societyer package contains a host-specific path or standalone root.');
if (!/export\s*\{[^}]*\bmount\b/.test(js)) throw new Error('Societyer package does not export mount().');
const css = assets.map(item => String(item.source)).join('\n');
if (/@(?:theme|source)\b/.test(css) || !css.includes('.bg-surface-primary')) throw new Error('Shared UI styles were not compiled. Use the real database.css entry point.');
const tree = postcss.parse(css);
// Scope every rule (Tailwind preflight and utilities included) so the package never resets Societyer. Rules that
// cannot live inside @scope, or are global by nature, stay outside it.
const globals: string[] = [];
tree.walkAtRules(rule => { if (['property', 'keyframes', 'font-face'].includes(rule.name)) { globals.push(rule.toString()); rule.remove(); } });
tree.walkRules(rule => { rule.selector = rule.selector.replace(/:root|:host|(?<![\w.#=:-])(?:html|body)(?![\w-])/g, ':scope'); });
// Zoer controls that still portal to document.body (popovers, tooltips, their own dialogs) are scope roots too.
const roots = '.bcbid-native, body > [data-zoer-popover], body > .ui-tooltip, body > dialog';
// Tailwind sits in cascade layers, so Societyer's unlayered element resets (a, button, input) would beat every
// utility on plain elements. These scoped rules hand those properties back to the layers; Societyer classes such
// as .btn still win by specificity. They come first so the plugin's own unlayered element rules keep precedence.
const unreset = 'a{color:revert-layer;text-decoration:revert-layer}button{font-family:revert-layer;font-size:revert-layer;color:revert-layer;cursor:revert-layer;background:revert-layer;border:revert-layer;padding:revert-layer}input,textarea,select{font-family:revert-layer;font-size:revert-layer}';
const theme = THEME_TOKENS.map(token => `--${token}:var(--zoer-${token});`).join('') + Object.entries(DASHBOARD_COLORS).map(([target, source]) => `--color-${target}:var(--${source});`).join('');
const style = `${globals.join('\n')}\n@scope (${roots}) {\n${unreset}\n${tree}\n:scope{${theme}}\n:scope.bcbid-native{background:none;min-width:0;color:var(--text-primary)}\n}\n`;
const sha256 = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.js'), js);
await writeFile(resolve(output, 'style.css'), style);
await writeFile(resolve(output, 'source.json'), JSON.stringify({ pluginId: 'bc-bid-monitor', pluginVersion: JSON.parse(await readFile(resolve(root, 'zoer/manifest.json'), 'utf8')).version, commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'), builtAt: new Date().toISOString(), sha256: { 'index.js': sha256(js), 'style.css': sha256(style) } }, null, 2) + '\n');
console.log(`Societyer review package: ${output}`);
