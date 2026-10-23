import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // Same alias as tsconfig.base.json / zoer/dashboard-config.ts, so dashboard modules that use the core package are testable.
  resolve: { alias: {
    "@bcbid/procurement-core": new URL("./packages/procurement-core/src/index.ts", import.meta.url).pathname,
    // Exercise real registered handlers without requiring a configured deployment's generated bridge.
    "./_generated/server": new URL("./tests/fixtures/convex-generated.ts", import.meta.url).pathname,
    "./_generated/api": new URL("./tests/fixtures/convex-generated.ts", import.meta.url).pathname,
  } },
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    environmentMatchGlobs: [["**/tests/web/**", "jsdom"]],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});
