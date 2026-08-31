/**
 * Phase 14 AP7 -- Audit/Reproduzierbarkeit fuer das Playbook-Subsystem
 * (ChatGPT-GO 2026-08-31, siehe project_ki_cross_phase14_ap6_status.md fuer
 * die vollstaendigen, verbindlichen AP7-Leitplanken).
 *
 * ChatGPTs AP7-Checkliste ist zum GROSSEN TEIL bereits durch bestehende
 * Tests abgedeckt -- diese Datei baut daher AUSDRUECKLICH keinen
 * kuenstlichen Code, sondern deckt NUR die beiden tatsaechlich noch
 * offenen Luecken ab (ChatGPTs eigene Vorgabe: "Wenn diese Punkte bereits
 * durch vorhandene Tests abgedeckt sind, keinen kuenstlichen Code bauen"):
 *
 * Bereits abgedeckt (NICHT dupliziert):
 * - Publish-Audit ohne Section-Content: `playbook-security.test.ts`
 *   ("AuditLog-Eintrag beim Publish enthaelt keinerlei Section-Content").
 * - Immutable-History (Status-Uebergaenge, append-only versionNumber,
 *   PATCH auf nicht-DRAFT -> 409): `playbook-admin.test.ts`
 *   ("Mutation einer nicht-DRAFT-Version -> PlaybookVersionNotDraftError",
 *   "publishPlaybookVersion() aktiviert die Draft-Version und expiret die
 *   vorherige ACTIVE-Version").
 * - Determinismus der reinen Selektionsfunktion (gleiche Eingabe zweimal
 *   -> identisches Ergebnis, keine Mutation der Eingabe):
 *   `tests/unit/playbook/playbook-retrieval.test.ts`.
 * - Tenant-/Store-Isolation von Audit und Retrieval:
 *   `playbook-admin.test.ts` + `playbook-retrieval-context.test.ts`.
 *
 * NEU in dieser Datei (die beiden echten Luecken aus ChatGPTs Checkliste):
 * 1. "Retrieval-Snapshot": V1 aktiv -> Retrieval -> V2 publish -> neues
 *    Retrieval muss V2 liefern, waehrend der historische V1-Zustand
 *    (Retrieval mit einem Zeitpunkt WAEHREND V1s Gueltigkeit) unveraendert
 *    bleibt -- End-to-End ueber den ECHTEN Publish-Workflow, nicht nur
 *    isoliert wie in playbook-retrieval-context.test.ts (dort werden
 *    validFrom/validTo direkt per Rohinsert gesetzt, hier entstehen sie
 *    aus dem echten publishPlaybookVersion()-Ablauf).
 * 2. Inhaltliche Immutable-History-Pruefung: eine bereits veroeffentlichte
 *    Version (V1) bleibt inhaltlich (nicht nur im Status) unveraendert,
 *    wenn eine davon kopierte, spaeter editierte und veroeffentlichte
 *    Folgeversion (V2) entsteht -- der bestehende Test in
 *    playbook-admin.test.ts prueft nur Status-Uebergaenge, nicht den
 *    Section-Inhalt von V1 nach V2s Aenderungen.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { db } from "@/server/db/client";
import {
  createDraftPlaybookVersion,
  createPlaybook,
  getPlaybookVersionDetail,
  publishPlaybookVersion,
} from "@/server/admin/playbook-admin";
import { loadActivePlaybookSectionCandidates } from "@/server/playbook/playbook-retrieval-context";
import type { PlaybookSectionInput } from "@/server/admin/playbook-schemas";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "Phase 14 AP7: Audit/Reproduzierbarkeit (echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function ctx(tenantId: string, userId: string) {
      return { tenantId, userId, roles: [], managementScope: null };
    }

    async function createTenant(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      return tenant.id;
    }

    async function createUser(tenantId: string, key: string) {
      const user = await rawClient.user.create({
        data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      return user.id;
    }

    async function createCompanyAndStore(tenantId: string, key: string) {
      const company = await rawClient.company.create({
        data: { tenantId, key: `company-${key}-${suffix}`, name: `Company ${key}` },
      });
      const store = await rawClient.store.create({
        data: {
          tenantId,
          companyId: company.id,
          key: `store-${key}-${suffix}`,
          name: `Store ${key}`,
        },
      });
      return store.id;
    }

    function section(overrides: Partial<PlaybookSectionInput> = {}): PlaybookSectionInput {
      return {
        sectionType: "ARGUMENTATION",
        title: "Titel",
        content: "Inhalt",
        relatedTopics: [],
        relatedProductKeys: [],
        relatedSituations: [],
        priority: null,
        tags: [],
        active: true,
        ...overrides,
      };
    }

    it("Retrieval-Snapshot: historischer Zeitpunkt waehrend V1s Gueltigkeit bleibt nach V2-Publish unveraendert bei V1, 'jetzt' liefert V2", async () => {
      const tenantId = await createTenant("snapshot");
      const userId = await createUser(tenantId, "actor");
      const storeId = await createCompanyAndStore(tenantId, "snapshot");

      const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
        createPlaybook({ key: "p", name: "P" }),
      );
      const v1 = await runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbook.id, {
          scopeType: "TENANT",
          scopeId: tenantId,
          sections: [section({ title: "V1-Section", content: "V1-Inhalt" })],
        }),
      );
      await runWithTenantContext(ctx(tenantId, userId), () =>
        publishPlaybookVersion(playbook.id, v1.id),
      );

      // Zeitpunkt WAEHREND V1s Gueltigkeit (V1 ist zu diesem Zeitpunkt die
      // einzige, gerade veroeffentlichte Version -- V2 existiert noch nicht).
      const midTime = new Date();

      const candidatesAtMidBeforeV2 = await runWithTenantContext(ctx(tenantId, userId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, midTime),
      );
      expect(candidatesAtMidBeforeV2.map((c) => c.sectionType)).toEqual(["ARGUMENTATION"]);
      const v1SectionId = candidatesAtMidBeforeV2[0]!.id;

      // V2 entsteht als Kopie von V1, wird inhaltlich veraendert und
      // veroeffentlicht -- das expiret V1 (validTo = jetzt).
      const v2 = await runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbook.id, {
          scopeType: "TENANT",
          scopeId: tenantId,
          sections: [section({ title: "V2-Section", content: "V2-Inhalt" })],
          copyFromVersionId: v1.id,
        }),
      );
      await runWithTenantContext(ctx(tenantId, userId), () =>
        publishPlaybookVersion(playbook.id, v2.id),
      );

      // Retrieval mit dem GLEICHEN historischen Zeitpunkt (midTime) muss
      // weiterhin V1s Section liefern -- der spaetere V2-Publish darf diesen
      // bereits aufgeloesten historischen Zustand NICHT rueckwirkend
      // veraendern.
      const candidatesAtMidAfterV2 = await runWithTenantContext(ctx(tenantId, userId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, midTime),
      );
      expect(candidatesAtMidAfterV2.map((c) => c.id)).toEqual([v1SectionId]);

      // Retrieval mit "jetzt" (nach V2-Publish) muss ausschliesslich V2s
      // Section liefern, NICHT mehr V1s (V1 ist jetzt EXPIRED).
      const candidatesNow = await runWithTenantContext(ctx(tenantId, userId), () =>
        loadActivePlaybookSectionCandidates(db, storeId, new Date()),
      );
      expect(candidatesNow).toHaveLength(1);
      expect(candidatesNow[0]!.id).not.toBe(v1SectionId);
    });

    it("V1s Section-Inhalt bleibt byte-identisch, nachdem eine von V1 kopierte, editierte und veroeffentlichte Folgeversion V2 entsteht", async () => {
      const tenantId = await createTenant("immutable-content");
      const userId = await createUser(tenantId, "actor");

      const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
        createPlaybook({ key: "p", name: "P" }),
      );
      const v1 = await runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbook.id, {
          scopeType: "TENANT",
          scopeId: tenantId,
          sections: [
            section({ title: "Unveraenderlicher Titel", content: "Unveraenderlicher Inhalt V1" }),
          ],
        }),
      );
      await runWithTenantContext(ctx(tenantId, userId), () =>
        publishPlaybookVersion(playbook.id, v1.id),
      );
      const v1Snapshot = await runWithTenantContext(ctx(tenantId, userId), () =>
        getPlaybookVersionDetail(playbook.id, v1.id),
      );

      // V2 entsteht als Kopie von V1 (sections weggelassen -> Server kopiert
      // deep), wird danach inhaltlich stark veraendert und veroeffentlicht.
      const v2 = await runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbook.id, {
          scopeType: "TENANT",
          scopeId: tenantId,
          copyFromVersionId: v1.id,
        }),
      );
      await runWithTenantContext(ctx(tenantId, userId), () =>
        publishPlaybookVersion(playbook.id, v2.id),
      );

      // V1 (bereits EXPIRED) muss inhaltlich exakt dem Zustand VOR V2s
      // Existenz entsprechen -- keine rueckwirkende Veraenderung.
      const v1Reloaded = await runWithTenantContext(ctx(tenantId, userId), () =>
        getPlaybookVersionDetail(playbook.id, v1.id),
      );
      expect(v1Reloaded.sections).toEqual(v1Snapshot.sections);
      expect(v1Reloaded.sections).toHaveLength(1);
      expect(v1Reloaded.sections[0]!.title).toBe("Unveraenderlicher Titel");
      expect(v1Reloaded.sections[0]!.content).toBe("Unveraenderlicher Inhalt V1");
    });
  },
);
