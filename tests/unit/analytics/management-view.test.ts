import { describe, expect, it } from "vitest";
import { ManagementAccessDeniedError } from "@/server/analytics/management-authz";
import { buildManagementAnalyticsView } from "@/server/analytics/management-view";

/**
 * Unit-Test fuer den Deny-by-default-Guard von `buildManagementAnalyticsView()`
 * (Phase 7 AP3). Deckt nur den Fall ab, der ohne aktiven TenantContext/DB
 * pruefbar ist: ein `null`-Scope muss VOR jedem DB-Zugriff abgelehnt werden.
 * Die vollen Erfolgspfade (mit echten KPI-Daten) werden in AP7 durch
 * Integrationstests gegen Seed-Fixtures abgedeckt, da sie einen aktiven
 * TenantContext benoetigen.
 */
describe("buildManagementAnalyticsView", () => {
  it("wirft ManagementAccessDeniedError bei null-Scope, bevor irgendein DB-Zugriff erfolgt", async () => {
    await expect(buildManagementAnalyticsView(null, { period: "week" })).rejects.toThrow(
      ManagementAccessDeniedError,
    );
  });
});
