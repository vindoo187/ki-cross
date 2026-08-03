import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Separate Vitest-Config NUR fuer Komponententests (React/DOM, jsdom).
 *
 * Bewusst getrennt von `vitest.config.ts` (environment: "node", 293
 * Server-Unit-/Integrationstests) -- siehe ChatGPT-Freigabevermerk AP12
 * (2026-08-03): die bestehende Node-Testsuite darf NICHT global auf jsdom
 * umgestellt werden, da das unnoetige Overhead/Risiko fuer reine
 * Server-Logik-Tests einfuehren wuerde. Komponententests laufen daher ueber
 * ein eigenes Kommando (`npm run test:component`) mit eigenem Environment.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["tests/component/**/*.test.tsx"],
    setupFiles: ["./tests/component/setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [react()],
});
