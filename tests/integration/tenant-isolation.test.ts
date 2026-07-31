/**
 * Integrationstest fuer Mandantentrennung gegen eine ECHTE Postgres-Datenbank.
 *
 * Im Gegensatz zu `tests/unit/tenant-scope.test.ts` (reine Funktionstests
 * ohne Datenbank) prueft dieser Test beide Schutzschichten gemeinsam und
 * gegen ein echtes System:
 *  1. Datenbankebene: zusammengesetzte Fremdschluessel lehnen einen
 *     Tenant/Parent-Mismatch beim Schreiben ab.
 *  2. Anwendungsebene: `withTenantScope()` verhindert Lese- und
 *     Schreibzugriffe ausserhalb des aktiven Tenant-Kontexts.
 *
 * Benoetigt eine erreichbare Datenbank (siehe `.env`/`docker-compose.yml`)
 * sowie einen erfolgreichen `prisma generate`-Lauf, da `@prisma/client`
 * sonst keine Typen/Laufzeitengine besitzt. Kann daher NICHT in dieser
 * Sandbox ausgefuehrt werden (siehe docs/IMPLEMENTATION_STATUS.md) -
 * ausschliesslich in CI bzw. lokal mit `DATABASE_URL` gesetzt. Ohne
 * `DATABASE_URL` wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { TenantMismatchError, withTenantScope } from "@/server/tenant/scoped-client";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("Tenant-Isolation (Integrationstest, echte Postgres-DB)", () => {
  const rawClient = new PrismaClient();
  const db = withTenantScope(rawClient);

  const suffix = randomUUID().slice(0, 8);
  let tenantAId: string;
  let tenantBId: string;
  let companyAId: string;
  let companyBId: string;
  let storeAId: string;

  beforeAll(async () => {
    const tenantA = await rawClient.tenant.create({
      data: { key: `test-tenant-a-${suffix}`, name: "Test Tenant A", isSynthetic: true },
    });
    const tenantB = await rawClient.tenant.create({
      data: { key: `test-tenant-b-${suffix}`, name: "Test Tenant B", isSynthetic: true },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const companyA = await rawClient.company.create({
      data: { tenantId: tenantAId, key: `company-a-${suffix}`, name: "Company A" },
    });
    const companyB = await rawClient.company.create({
      data: { tenantId: tenantBId, key: `company-b-${suffix}`, name: "Company B" },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const storeA = await rawClient.store.create({
      data: {
        tenantId: tenantAId,
        companyId: companyAId,
        key: `store-a-${suffix}`,
        name: "Store A",
      },
    });
    storeAId = storeA.id;

    await rawClient.store.create({
      data: {
        tenantId: tenantBId,
        companyId: companyBId,
        key: `store-b-${suffix}`,
        name: "Store B",
      },
    });
  });

  afterAll(async () => {
    // Aufraeumen in fremdschluessel-sicherer Reihenfolge (Kind vor Eltern).
    await rawClient.store.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await rawClient.company.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await rawClient.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await rawClient.$disconnect();
  });

  it("Datenbankebene: lehnt einen Store mit Tenant/Company-Mismatch per Fremdschluessel ab", async () => {
    await expect(
      rawClient.store.create({
        data: { tenantId: tenantAId, companyId: companyBId, key: `cross-${suffix}`, name: "Cross" },
      }),
    ).rejects.toThrow();
  });

  it("Anwendungsebene: findUnique liefert null statt eines fremden Datensatzes", async () => {
    await runWithTenantContext(
      { tenantId: tenantBId, userId: randomUUID(), roles: [] },
      async () => {
        const found = await db.store.findUnique({ where: { id: storeAId } });
        expect(found).toBeNull();
      },
    );
  });

  it("Anwendungsebene: findMany liefert nur Datensaetze des aktiven Mandanten", async () => {
    await runWithTenantContext(
      { tenantId: tenantAId, userId: randomUUID(), roles: [] },
      async () => {
        const stores = await db.store.findMany({ where: { key: { contains: suffix } } });
        expect(stores.map((s) => s.id)).toEqual([storeAId]);
      },
    );
  });

  it("Anwendungsebene: create injiziert automatisch die tenantId aus dem Kontext", async () => {
    await runWithTenantContext(
      { tenantId: tenantAId, userId: randomUUID(), roles: [] },
      async () => {
        // `tenantId` wird von `withTenantScope()` zur Laufzeit aus dem aktiven
        // TenantContext injiziert (siehe assertOrInjectTenantId in
        // scoped-client.ts) - das ist exakt das Verhalten, das dieser Test
        // verifiziert. Der generierte Prisma-Typ kennt diese Laufzeit-Ergaenzung
        // durch das Extension jedoch nicht und verlangt `tenantId` statisch;
        // der Cast auf den konkreten Unchecked-Input-Typ dokumentiert bewusst
        // diese Diskrepanz zwischen Laufzeitverhalten und Prisma-Typ, statt sie
        // per `any` zu verschleiern (siehe eslint no-explicit-any).
        const company = await db.company.create({
          data: {
            key: `auto-${suffix}`,
            name: "Auto Company",
          } as Prisma.CompanyUncheckedCreateInput,
        });
        expect(company.tenantId).toBe(tenantAId);
        await rawClient.company.delete({ where: { id: company.id } });
      },
    );
  });

  it("Anwendungsebene: create wirft TenantMismatchError bei expliziter Fremd-tenantId", async () => {
    await runWithTenantContext(
      { tenantId: tenantAId, userId: randomUUID(), roles: [] },
      async () => {
        await expect(
          db.company.create({
            data: { key: `mismatch-${suffix}`, name: "X", tenantId: tenantBId },
          }),
        ).rejects.toThrow(TenantMismatchError);
      },
    );
  });

  it("wirft MissingTenantContextError ausserhalb eines Tenant-Kontexts", async () => {
    await expect(db.store.findMany({})).rejects.toThrow(/TenantContext/);
  });
});
