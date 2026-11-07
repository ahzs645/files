import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { readdirSync, readFileSync } from "node:fs";

// ZOER_HOST=absent (CI without ZOER_SOURCE_TOKEN) skips the suites that import the private Zoer host from the
// sibling ../zoer checkout, found by their host paths. Any other value runs them, so a missing host fails loudly.
const testsDir = new URL("./tests/", import.meta.url);
const hostSuites = process.env.ZOER_HOST === "absent"
  ? readdirSync(testsDir, { recursive: true, encoding: "utf8" })
    .filter(file => /\.test\.tsx?$/.test(file) && /['"](?:\.\.\/)+zoer\/(?:backend|frontend|sdk)\//.test(readFileSync(new URL(file, testsDir), "utf8")))
    .map(file => `tests/${file}`)
  : [];
if (hostSuites.length) console.warn(`ZOER_HOST=absent: skipping ${hostSuites.length} suites that need the Zoer host:\n  ${hostSuites.join("\n  ")}`);

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // Same alias as tsconfig.base.json / zoer/dashboard-config.ts, so dashboard modules that use the core package are testable.
  resolve: { alias: {
    "@bcbid/procurement-core": new URL("./packages/procurement-core/src/index.ts", import.meta.url).pathname,
    "@zoer/plugin-ui/controls": new URL("./tests/fixtures/plugin-ui-controls.tsx", import.meta.url).pathname,
    // Exercise real registered handlers without requiring a configured deployment's generated bridge.
    "./_generated/server": new URL("./tests/fixtures/convex-generated.ts", import.meta.url).pathname,
    "./_generated/api": new URL("./tests/fixtures/convex-generated.ts", import.meta.url).pathname,
  } },
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    environmentMatchGlobs: [["**/tests/web/**", "jsdom"]],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.git/**", ...hostSuites]
  }
});
