/**
 * Phase 14 AP4 -- Integrationstests fuer die DB-Ladefunktion
 * `loadActivePlaybookSectionCandidates()`
 * (`src/server/playbook/playbook-retrieval-context.ts`) gegen eine ECHTE
 * Postgres-Datenbank. Deckt genau die Tenant-/Scope-/Zeitraum-Faelle ab,
 * die ChatGPT fuer AP4 explizit als Mindesttestliste gefordert hat (siehe
 * project_ki_cross_phase14_ap3_status.md): TENANT-Treffer, STORE-Treffer
 * nur im richtigen Store, fremder Tenant -> kein Treffer, Draft -> kein
 * Treffer, abgelaufene/noch nicht gueltige Version -> kein Treffer.
 * Struktur/Vorgehen (Rohinsert von Playbook/PlaybookVersion/
 * PlaybookSection statt ueber playbook-admin.ts, um beliebige
 * Zeitraeume/Status direkt zu setzen) analog
 * `tests/integration/recommendation-campaign-active.test.ts` (Phase 13
 * AP4).
 *
 * Die reine Selektionslogik (Metadaten-Matching/Prioritaet/Limits) ist
 * bereits vollstaendig in `tests/unit/playbook/playbook-retrieval.test.ts`
 * abgedeckt -- diese Suite testet AUSSCHLIESSLICH die DB-/Scope-/
 * Zeitraum-Aufloesung dieser Ladefunktion.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { db } from "@/server/db/client";
import { loadActivePlaybookSectionCandidates } from "@/server/playbook/playbook-retrieval-context";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "Phase 14 AP4: loadActivePlaybookSectionCandidates() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    const FAR_PAST = new Date("2020-01-01T00:00:00Z");
    const FAR_FUTURE = new Date("2099-01-01T00:00:00Z");
    const AT_TIME = new Date("2026-06-01T00:00:00Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function ctx(tenantId: string) {
      return { tenantId, userId: randomUUID(), roles: [], managementScope: null };
    }

    async function createTenantWithStore(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      const company = await rawClient.company.create({
        data: { tenantId: tenant.id, key: `company-${key}-${suffix}`, name: `Company ${key}` },
      });
      const store = await rawClient.store.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          key: `store-${key}-${suffix}`,
          name: `Store ${key}`,
        },
      });
      const secondStore = await rawClient.store.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          key: `store2-${key}-${suffix}`,
          name: `Store2 ${key}`,
        },
      });
      return { tenantId: tenant.id, storeId: store.id, secondStoreId: secondStore.id };
    }

    /** Legt ein Playbook + genau eine PlaybookVersion + eine Section per Rohinsert an (analog createCampaignWithVersion() in recommendation-campaign-active.test.ts). */
    async function createPlaybookWithVersionAndSection(
      tenantId: string,
      key: string,
      scopeType: "TENANT" | "STORE",
      scopeId: string,
      status: "DRAFT" | "ACTIVE" | "EXPIRED" | "ARCHIVED",
      validFrom: Date,
      validTo: Date | null,
    ) {
      const playbook = await rawClient.playbook.create({
        data: { tenantId, key: `${key}-${suffix}`, name: `Playbook ${key}` },
      });
      const version = await rawClient.playbookVersion.create({
        data: {
          tenantId,
          playbookId: playbook.id,
          versionNumber: 1,
          status,
          scopeType,
          scopeId,
          validFrom,
          validTo,
        },
      });
      const section = await rawClient.playbookSection.create({
        data: {
          tenantId,
          playbookVersionId: version.id,
          sectionType: "ARGUMENTATION",
          title: `Section ${key}`,
          content: "Testinhalt.",
          relatedTopics: [],
          relatedProductKeys: [],
          relatedSituations: [],
          tags: [],
          active: true,
        },
      });
      return { playbookId: playbook.id, versionId: version.id, sectionId: section.id };
    }

    it("TENANT-Scope: ACTIVE-Version liefert ihre Section als Kandidat", async () => {
      const { tenantId, storeId } = await createTenantWithStore("tenant-ok");
      const { sectionId } = await createPlaybookWithVersionAndSection(
        tenantId,
        "p",
        "TENANT",
        tenantId,
        "ACTIVE",
        FAR_PAST,
        null,
      );

      const candidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(candidates.map((c) => c.id)).toEqual([sectionId]);
    });

    it("STORE-Scope: Section erscheint NUR fuer die exakt passende Filiale, nicht fuer eine andere Filiale desselben Mandanten", async () => {
      const { tenantId, storeId, secondStoreId } = await createTenantWithStore("store-scope");
      const { sectionId } = await createPlaybookWithVersionAndSection(
        tenantId,
        "p",
        "STORE",
        storeId,
        "ACTIVE",
        FAR_PAST,
        null,
      );

      const matchingCandidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(matchingCandidates.map((c) => c.id)).toEqual([sectionId]);

      const otherStoreCandidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, secondStoreId, AT_TIME),
      );
      expect(otherStoreCandidates).toEqual([]);
    });

    it("fremder Tenant -> kein Treffer (Tenant-Isolation ueber den gescopten db-Client)", async () => {
      const { tenantId: tenantA, storeId: storeA } = await createTenantWithStore("iso-a");
      const { tenantId: tenantB } = await createTenantWithStore("iso-b");
      await createPlaybookWithVersionAndSection(
        tenantB,
        "p",
        "TENANT",
        tenantB,
        "ACTIVE",
        FAR_PAST,
        null,
      );

      const candidatesForA = await runWithTenantContext(ctx(tenantA), () =>
        loadActivePlaybookSectionCandidates(db, storeA, AT_TIME),
      );
      expect(candidatesForA).toEqual([]);
    });

    it("DRAFT-Version gilt NICHT als aktiv -> kein Treffer", async () => {
      const { tenantId, storeId } = await createTenantWithStore("draft-case");
      await createPlaybookWithVersionAndSection(
        tenantId,
        "p",
        "TENANT",
        tenantId,
        "DRAFT",
        FAR_PAST,
        null,
      );

      const candidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(candidates).toEqual([]);
    });

    it("EXPIRED-Version (validTo in der Vergangenheit) gilt NICHT als aktiv -> kein Treffer", async () => {
      const { tenantId, storeId } = await createTenantWithStore("expired-case");
      await createPlaybookWithVersionAndSection(
        tenantId,
        "p",
        "TENANT",
        tenantId,
        "EXPIRED",
        FAR_PAST,
        new Date("2025-01-01T00:00:00Z"),
      );

      const candidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(candidates).toEqual([]);
    });

    it("noch nicht gueltige Version (validFrom in der Zukunft) gilt NICHT als aktiv -> kein Treffer", async () => {
      const { tenantId, storeId } = await createTenantWithStore("future-case");
      await createPlaybookWithVersionAndSection(
        tenantId,
        "p",
        "TENANT",
        tenantId,
        "ACTIVE",
        FAR_FUTURE,
        null,
      );

      const candidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(candidates).toEqual([]);
    });

    it("aggregiert Sections aus MEHREREN gleichzeitig aktiven Playbooks desselben Tenants", async () => {
      const { tenantId, storeId } = await createTenantWithStore("multi-playbook");
      const { sectionId: sectionOne } = await createPlaybookWithVersionAndSection(
        tenantId,
        "p1",
        "TENANT",
        tenantId,
        "ACTIVE",
        FAR_PAST,
        null,
      );
      const { sectionId: sectionTwo } = await createPlaybookWithVersionAndSection(
        tenantId,
        "p2",
        "TENANT",
        tenantId,
        "ACTIVE",
        FAR_PAST,
        null,
      );

      const candidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(new Set(candidates.map((c) => c.id))).toEqual(new Set([sectionOne, sectionTwo]));
    });

    it("liefert contentLength statt des eigentlichen content-Texts (Trust-Boundary/Datenminimierung)", async () => {
      const { tenantId, storeId } = await createTenantWithStore("content-length");
      await createPlaybookWithVersionAndSection(
        tenantId,
        "p",
        "TENANT",
        tenantId,
        "ACTIVE",
        FAR_PAST,
        null,
      );

      const candidates = await runWithTenantContext(ctx(tenantId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, AT_TIME),
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).not.toHaveProperty("content");
      expect(candidates[0].contentLength).toBe("Testinhalt.".length);
    });
  },
);
