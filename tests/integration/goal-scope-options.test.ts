/**
 * Integrationstests fuer `listGoalScopeOptions()`
 * (`src/server/admin/goal-scope-options.ts`, Phase 11 AP6, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22 nach
 * AP6-Discovery) gegen eine ECHTE Postgres-Datenbank.
 *
 * Deckt ab:
 * - `TENANT`: genau eine Option (der Mandant selbst), `id === tenantId`.
 * - `COMPANY`/`STORE`/`EMPLOYEE`: alle Zeilen DES AKTUELLEN Mandanten,
 *   alphabetisch nach Name/Anzeigename sortiert.
 * - Tenant-Isolation: Company/Store/Employee eines FREMDEN Mandanten duerfen
 *   niemals in der Optionsliste auftauchen (struktureller Schutz ueber den
 *   tenant-gescopten `db`-Client, siehe Modulkommentar `goal-scope-options.ts`).
 * - `EMPLOYEE`-Liste ist NICHT nach `employmentStatus` gefiltert (bewusste
 *   Design-Entscheidung, siehe Modulkommentar).
 * - Leeres Ergebnis, wenn der Mandant keine Zeilen des jeweiligen Typs hat.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { listGoalScopeOptions } from "@/server/admin/goal-scope-options";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "admin/goal-scope-options.ts (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asContext<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId: undefined, roles: [], managementScope: null },
        fn,
      );
    }

    async function createTenant(key: string, name?: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: name ?? `Test ${key}`, isSynthetic: true },
      });
      return tenant.id;
    }

    async function createCompany(tenantId: string, key: string, name: string) {
      const company = await rawClient.company.create({
        data: { tenantId, key: `${key}-${suffix}`, name },
      });
      return company.id;
    }

    async function createStore(tenantId: string, companyId: string, key: string, name: string) {
      const store = await rawClient.store.create({
        data: { tenantId, companyId, key: `${key}-${suffix}`, name },
      });
      return store.id;
    }

    async function createEmployee(tenantId: string, storeId: string, displayName: string) {
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, displayName },
      });
      return employee.id;
    }

    it("TENANT: liefert genau eine Option (der Mandant selbst)", async () => {
      const tenantId = await createTenant("tenant-scope", "Zebra Handel GmbH");
      const options = await asContext(tenantId, () => listGoalScopeOptions("TENANT"));
      expect(options).toEqual([{ id: tenantId, name: "Zebra Handel GmbH" }]);
    });

    it("COMPANY: liefert alle Companies des Mandanten, alphabetisch sortiert", async () => {
      const tenantId = await createTenant("company-scope");
      const companyZ = await createCompany(tenantId, "company-z", "Zeta AG");
      const companyA = await createCompany(tenantId, "company-a", "Alpha AG");
      const options = await asContext(tenantId, () => listGoalScopeOptions("COMPANY"));
      expect(options).toEqual([
        { id: companyA, name: "Alpha AG" },
        { id: companyZ, name: "Zeta AG" },
      ]);
    });

    it("STORE: liefert alle Stores des Mandanten, alphabetisch sortiert", async () => {
      const tenantId = await createTenant("store-scope");
      const companyId = await createCompany(tenantId, "company", "Company");
      const storeZ = await createStore(tenantId, companyId, "store-z", "Filiale Z");
      const storeA = await createStore(tenantId, companyId, "store-a", "Filiale A");
      const options = await asContext(tenantId, () => listGoalScopeOptions("STORE"));
      expect(options).toEqual([
        { id: storeA, name: "Filiale A" },
        { id: storeZ, name: "Filiale Z" },
      ]);
    });

    it("EMPLOYEE: liefert alle Mitarbeiter des Mandanten (auch INACTIVE), alphabetisch sortiert", async () => {
      const tenantId = await createTenant("employee-scope");
      const companyId = await createCompany(tenantId, "company", "Company");
      const storeId = await createStore(tenantId, companyId, "store", "Store");
      const empZ = await createEmployee(tenantId, storeId, "Zoe Mustermann");
      const empA = await createEmployee(tenantId, storeId, "Anna Mustermann");
      await rawClient.employee.update({
        where: { tenantId_id: { tenantId, id: empZ } },
        data: { employmentStatus: "DEACTIVATED", deactivatedAt: new Date() },
      });
      const options = await asContext(tenantId, () => listGoalScopeOptions("EMPLOYEE"));
      expect(options).toEqual([
        { id: empA, name: "Anna Mustermann" },
        { id: empZ, name: "Zoe Mustermann" },
      ]);
    });

    it("Tenant-Isolation: Company/Store/Employee eines FREMDEN Mandanten tauchen nie auf", async () => {
      const tenantA = await createTenant("isolation-a");
      const tenantB = await createTenant("isolation-b");
      const companyB = await createCompany(tenantB, "company-b", "Fremde Firma");
      const storeB = await createStore(tenantB, companyB, "store-b", "Fremde Filiale");
      await createEmployee(tenantB, storeB, "Fremder Mitarbeiter");

      const [companyOptions, storeOptions, employeeOptions] = await asContext(tenantA, () =>
        Promise.all([
          listGoalScopeOptions("COMPANY"),
          listGoalScopeOptions("STORE"),
          listGoalScopeOptions("EMPLOYEE"),
        ]),
      );
      expect(companyOptions).toEqual([]);
      expect(storeOptions).toEqual([]);
      expect(employeeOptions).toEqual([]);
    });

    it("COMPANY ohne vorhandene Companies liefert leere Liste", async () => {
      const tenantId = await createTenant("empty-scope");
      const options = await asContext(tenantId, () => listGoalScopeOptions("COMPANY"));
      expect(options).toEqual([]);
    });
  },
);
