import { describe, expect, it } from "vitest";
import { buildScopedArgs, TenantMismatchError } from "@/server/tenant/scoped-client";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

describe("buildScopedArgs", () => {
  describe("Lese-Operationen (where-basiert)", () => {
    const readOps = [
      "findUnique",
      "findUniqueOrThrow",
      "findFirst",
      "findFirstOrThrow",
      "findMany",
      "aggregate",
      "count",
      "groupBy",
    ];

    for (const operation of readOps) {
      it(`ergaenzt tenantId im where-Objekt fuer "${operation}"`, () => {
        const scoped = buildScopedArgs(
          { model: "Deal", operation, args: { where: { id: "deal-1" } } },
          TENANT_A,
        );
        expect(scoped.where).toEqual({ id: "deal-1", tenantId: TENANT_A });
      });

      it(`funktioniert fuer "${operation}" auch ohne vorhandenes where-Objekt`, () => {
        const scoped = buildScopedArgs({ model: "Deal", operation, args: {} }, TENANT_A);
        expect(scoped.where).toEqual({ tenantId: TENANT_A });
      });

      it(`ueberschreibt eine abweichende, vom Aufrufer gesetzte tenantId im where fuer "${operation}"`, () => {
        // Sicherheitsrelevant: Ein Aufrufer darf den Tenant-Scope nicht durch
        // Angabe einer fremden tenantId im where umgehen koennen.
        const scoped = buildScopedArgs(
          { model: "Deal", operation, args: { where: { id: "deal-1", tenantId: TENANT_B } } },
          TENANT_A,
        );
        expect(scoped.where).toEqual({ id: "deal-1", tenantId: TENANT_A });
      });
    }

    it("bewahrt verschachtelte OR/NOT-Bedingungen im where", () => {
      const scoped = buildScopedArgs(
        {
          model: "Deal",
          operation: "findMany",
          args: { where: { OR: [{ status: "OPEN" }, { status: "WON" }] } },
        },
        TENANT_A,
      );
      expect(scoped.where).toEqual({
        OR: [{ status: "OPEN" }, { status: "WON" }],
        tenantId: TENANT_A,
      });
    });
  });

  describe("update / updateMany", () => {
    for (const operation of ["update", "updateMany", "updateManyAndReturn"]) {
      it(`ergaenzt tenantId im where fuer "${operation}"`, () => {
        const scoped = buildScopedArgs(
          { model: "Deal", operation, args: { where: { id: "deal-1" }, data: { status: "WON" } } },
          TENANT_A,
        );
        expect(scoped.where).toEqual({ id: "deal-1", tenantId: TENANT_A });
        expect(scoped.data).toEqual({ status: "WON" });
      });

      it(`erlaubt data ohne tenantId-Feld fuer "${operation}"`, () => {
        const scoped = buildScopedArgs(
          { model: "Deal", operation, args: { where: {}, data: { status: "WON" } } },
          TENANT_A,
        );
        expect(scoped.data).toEqual({ status: "WON" });
      });

      it(`wirft TenantMismatchError, wenn data eine abweichende tenantId setzt ("${operation}")`, () => {
        expect(() =>
          buildScopedArgs(
            {
              model: "Deal",
              operation,
              args: { where: { id: "deal-1" }, data: { tenantId: TENANT_B } },
            },
            TENANT_A,
          ),
        ).toThrow(TenantMismatchError);
      });
    }
  });

  describe("delete / deleteMany", () => {
    for (const operation of ["delete", "deleteMany"]) {
      it(`ergaenzt tenantId im where fuer "${operation}"`, () => {
        const scoped = buildScopedArgs(
          { model: "Deal", operation, args: { where: { id: "deal-1" } } },
          TENANT_A,
        );
        expect(scoped.where).toEqual({ id: "deal-1", tenantId: TENANT_A });
      });
    }
  });

  describe("create", () => {
    it("injiziert tenantId, wenn im data-Objekt nicht vorhanden", () => {
      const scoped = buildScopedArgs(
        { model: "Deal", operation: "create", args: { data: { status: "OPEN" } } },
        TENANT_A,
      );
      expect(scoped.data).toEqual({ status: "OPEN", tenantId: TENANT_A });
    });

    it("akzeptiert eine explizit passende tenantId im data-Objekt", () => {
      const scoped = buildScopedArgs(
        {
          model: "Deal",
          operation: "create",
          args: { data: { status: "OPEN", tenantId: TENANT_A } },
        },
        TENANT_A,
      );
      expect(scoped.data).toEqual({ status: "OPEN", tenantId: TENANT_A });
    });

    it("wirft TenantMismatchError bei abweichender tenantId im data-Objekt", () => {
      expect(() =>
        buildScopedArgs(
          {
            model: "Deal",
            operation: "create",
            args: { data: { status: "OPEN", tenantId: TENANT_B } },
          },
          TENANT_A,
        ),
      ).toThrow(TenantMismatchError);
    });
  });

  describe("createMany / createManyAndReturn", () => {
    for (const operation of ["createMany", "createManyAndReturn"]) {
      it(`injiziert tenantId in jede Zeile fuer "${operation}"`, () => {
        const scoped = buildScopedArgs(
          {
            model: "DealItem",
            operation,
            args: { data: [{ label: "a" }, { label: "b", tenantId: TENANT_A }] },
          },
          TENANT_A,
        );
        expect(scoped.data).toEqual([
          { label: "a", tenantId: TENANT_A },
          { label: "b", tenantId: TENANT_A },
        ]);
      });

      it(`wirft TenantMismatchError, wenn eine Zeile eine abweichende tenantId hat ("${operation}")`, () => {
        expect(() =>
          buildScopedArgs(
            {
              model: "DealItem",
              operation,
              args: { data: [{ label: "a", tenantId: TENANT_B }] },
            },
            TENANT_A,
          ),
        ).toThrow(TenantMismatchError);
      });
    }
  });

  describe("upsert", () => {
    it("scopt where, create und update konsistent", () => {
      const scoped = buildScopedArgs(
        {
          model: "Deal",
          operation: "upsert",
          args: {
            where: { id: "deal-1" },
            create: { status: "OPEN" },
            update: { status: "WON" },
          },
        },
        TENANT_A,
      );
      expect(scoped.where).toEqual({ id: "deal-1", tenantId: TENANT_A });
      expect(scoped.create).toEqual({ status: "OPEN", tenantId: TENANT_A });
      expect(scoped.update).toEqual({ status: "WON" });
    });

    it("wirft TenantMismatchError bei abweichender tenantId im create-Zweig", () => {
      expect(() =>
        buildScopedArgs(
          {
            model: "Deal",
            operation: "upsert",
            args: { where: { id: "deal-1" }, create: { tenantId: TENANT_B }, update: {} },
          },
          TENANT_A,
        ),
      ).toThrow(TenantMismatchError);
    });

    it("wirft TenantMismatchError bei abweichender tenantId im update-Zweig", () => {
      expect(() =>
        buildScopedArgs(
          {
            model: "Deal",
            operation: "upsert",
            args: { where: { id: "deal-1" }, create: {}, update: { tenantId: TENANT_B } },
          },
          TENANT_A,
        ),
      ).toThrow(TenantMismatchError);
    });
  });

  it("laesst Operationen ausserhalb der bekannten Kategorien unveraendert (z. B. subscribe-artige/Sonderfaelle)", () => {
    const scoped = buildScopedArgs(
      { model: "Deal", operation: "someFutureOp", args: { foo: "bar" } },
      TENANT_A,
    );
    expect(scoped).toEqual({ foo: "bar" });
  });
});
