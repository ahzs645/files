import type { InlineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dir, '..');
export const zoerRoot = resolve(process.env.ZOER_UI_ROOT || resolve(root, '../zoer'));

/** Vite configuration shared by the packaged build (`build-dashboard.ts`) and the local dev server (`dev-dashboard.ts`). */
export function dashboardConfig(): InlineConfig {
  return {
    configFile: false, root: resolve(root, 'apps/dashboard'), plugins: [{
      name: 'zoer-source-select', enforce: 'pre',
      resolveId(source, importer) {
        if (importer === resolve(zoerRoot, 'frontend/src/components/database/ResourceDataGrid.tsx') && source === '../../lib/queries/databases') return resolve(root, 'zoer/dashboard/grid-query-keys.ts');
        if (importer && source.endsWith('/ui/Button') && (importer.startsWith(resolve(root, 'apps/dashboard') + '/') || importer.startsWith(resolve(root, 'zoer/dashboard') + '/'))) return resolve(root, 'zoer/dashboard/SourceButton.tsx');
        if (importer?.startsWith(resolve(root, 'apps/dashboard') + '/') && /^(?:\.\.\/)+ui\/Select$/.test(source)) return resolve(root, 'zoer/dashboard/SourceSelect.tsx');
        if (importer?.startsWith(resolve(root, 'apps/dashboard') + '/') && /^(?:\.\.\/)+ui\/Modal$/.test(source)) return resolve(root, 'zoer/dashboard/SourceModal.tsx');
      },
    }, tailwindcss(), react()],
    define: { 'import.meta.env.VITE_ZOER_PLUGIN': 'true' },
    resolve: { dedupe: ['react','react-dom'], alias: [
      { find: '@tanstack/react-query', replacement: resolve(zoerRoot, 'frontend/node_modules/@tanstack/react-query') },
      { find: '@zoer/plugin-ui/controls', replacement: resolve(zoerRoot, 'frontend/src/plugin-ui/controls.ts') },
      { find: '@zoer/plugin-ui/analysis', replacement: resolve(zoerRoot, 'frontend/src/plugin-ui/analysis.ts') },
      { find: '@zoer/plugin-ui/button', replacement: resolve(zoerRoot, 'frontend/src/components/ui/Btn.tsx') },
      { find: '@zoer/plugin-ui/database.css', replacement: resolve(zoerRoot, 'frontend/src/plugin-ui/database.css') },
      { find: '@zoer/plugin-ui/database', replacement: resolve(zoerRoot, 'frontend/src/plugin-ui/database.ts') },
      { find: '../components/layout/AppShell', replacement: resolve(root, 'zoer/dashboard/Shell.tsx') },
      { find: 'convex/react', replacement: resolve(root, 'zoer/dashboard/backend.tsx') },
      { find: '@convex/_generated/api', replacement: resolve(root, 'zoer/dashboard/api.ts') },
      { find: '@bcbid/shared', replacement: resolve(root, 'packages/shared/src/index.ts') },
    ] },
  };
}
