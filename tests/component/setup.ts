/**
 * Setup fuer Komponententests (jsdom-Environment, siehe
 * `vitest.config.component.ts`). Registriert die jest-dom-Matcher
 * (`toBeInTheDocument()` etc.) und raeumt nach jedem Test das DOM auf.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});
