// Local development server for the Zoer plugin dashboard. It serves zoer/dashboard/main.tsx with the same
// aliases and source substitutions as the packaged build, but with Vite HMR instead of a single inlined file.
// Start the Zoer frontend dev server with
//   VITE_PLUGIN_WORKSPACE_DEV_URLS=bc-bid-monitor=http://localhost:5175/
// and the host proxies /plugin-dev/bc-bid-monitor/ here, so the workspace iframe loads this server instead of
// the installed package. The iframe keeps its sandbox attribute, so the document still has an opaque origin
// and talks to the host only through the bridge. Unlike the installed package, the dev document has no HTTP
// CSP; that is acceptable for local work only.
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { dashboardConfig, root, zoerRoot } from './dashboard-config';

const port = Number(process.env.BCBID_DEV_PORT || 5175);
// Must match the host's /plugin-dev/<plugin id>/ proxy path so module and HMR URLs resolve through the proxy.
const publicBase = process.env.BCBID_DEV_BASE || '/plugin-dev/bc-bid-monitor/';
const entry = resolve(root, 'zoer/dashboard/main.tsx');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BC Bid plugin (dev)</title></head><body><div id="root"></div><script type="module" src="/@fs${entry}"></script></body></html>`;
const base = dashboardConfig();
const server = await createServer({
  ...base,
  base: publicBase,
  appType: 'custom',
  plugins: [...(base.plugins ?? []), {
    name: 'zoer-dev-entry',
    configureServer(dev) {
      return () => dev.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (req.method !== 'GET' || (path !== '/' && path !== '/index.html')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-store');
        res.end(await dev.transformIndexHtml('/', html));
      });
    },
  }],
  // The sandboxed iframe sends `Origin: null`, so module and HMR requests need permissive CORS.
  server: { port, strictPort: true, cors: true, fs: { allow: [root, zoerRoot] } },
  // Scan the plugin entry, not the standalone app's index.html under the Vite root.
  optimizeDeps: { entries: [entry] },
});
await server.listen();
server.printUrls();
console.log(`Host override: VITE_PLUGIN_WORKSPACE_DEV_URLS=bc-bid-monitor=http://localhost:${port}/`);
