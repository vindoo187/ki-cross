import { describe, expect, it } from "vitest";
import {
  getOptionalTenantContext,
  getTenantContext,
  getTenantId,
  MissingTenantContextError,
  runWithTenantContext,
  type TenantContext,
} from "@/server/tenant/context";

const baseContext: TenantContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  roles: ["employee"],
  managementScope: null,
};

describe("tenant-context", () => {
  it("liefert undefined ausserhalb eines Kontexts", () => {
    expect(getOptionalTenantContext()).toBeUndefined();
  });

  it("wirft MissingTenantContextError ausserhalb eines Kontexts", () => {
    expect(() => getTenantContext()).toThrow(MissingTenantContextError);
    expect(() => getTenantId()).toThrow(MissingTenantContextError);
  });

  it("liefert den Kontext innerhalb von runWithTenantContext zurueck", () => {
    const result = runWithTenantContext(baseContext, () => {
      expect(getTenantContext()).toEqual(baseContext);
      expect(getTenantId()).toBe(baseContext.tenantId);
      return "ok";
    });
    expect(result).toBe("ok");
  });

  it("isoliert Kontexte in verschachtelten Aufrufen korrekt", () => {
    const otherContext: TenantContext = {
      tenantId: "33333333-3333-3333-3333-333333333333",
      userId: "44444444-4444-4444-4444-444444444444",
      roles: ["owner"],
      managementScope: null,
    };

    runWithTenantContext(baseContext, () => {
      expect(getTenantId()).toBe(baseContext.tenantId);
      runWithTenantContext(otherContext, () => {
        expect(getTenantId()).toBe(otherContext.tenantId);
      });
      // Nach Rueckkehr aus dem verschachtelten Aufruf muss wieder der
      // aeussere Kontext aktiv sein.
      expect(getTenantId()).toBe(baseContext.tenantId);
    });
  });

  it("stellt den Kontext auch innerhalb von async/await-Ketten bereit", async () => {
    await runWithTenantContext(baseContext, async () => {
      await Promise.resolve();
      expect(getTenantId()).toBe(baseContext.tenantId);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getTenantId()).toBe(baseContext.tenantId);
    });
  });

  it("isoliert parallele, unabhaengige Kontexte in gleichzeitig laufenden async-Ketten", async () => {
    const contextA: TenantContext = {
      ...baseContext,
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };
    const contextB: TenantContext = {
      ...baseContext,
      tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };

    async function delayedRead(context: TenantContext, delayMs: number) {
      return runWithTenantContext(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return getTenantId();
      });
    }

    const [resultA, resultB] = await Promise.all([
      delayedRead(contextA, 10),
      delayedRead(contextB, 0),
    ]);

    expect(resultA).toBe(contextA.tenantId);
    expect(resultB).toBe(contextB.tenantId);
  });

  it("MissingTenantContextError hat eine sprechende deutschsprachige Meldung", () => {
    expect(() => getTenantContext()).toThrowError(/TenantContext/);
  });
});
