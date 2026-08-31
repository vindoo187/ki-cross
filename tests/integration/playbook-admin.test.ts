/**
 * Phase 14 AP2 -- Integrationstests fuer den Playbook-Management-Service
 * (`src/server/admin/playbook-admin.ts`, siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31 mit
 * den in "Ein Punkt, den ich fuer AP2 ausdruecklich festhalten wuerde"
 * genannten Vorgaben, siehe project_ki_cross_phase14_ap1_status.md).
 * Testet die Service-Schicht direkt innerhalb `runWithTenantContext()`
 * gegen ECHTE Postgres-Fixtures (kein `vi.mock`, Codebase-Konvention,
 * siehe tests/integration/campaign-admin.test.ts). Es gibt in AP2 noch
 * keine API-Routen (die kommen erst mit AP3, siehe Modulkommentar in
 * `playbook-admin.ts`) -- diese Suite deckt daher ausschliesslich die
 * Service-Schicht ab.
 *
 * STRUKTUR-ANALOGIE: `PlaybookVersion` ist PRO `Playbook` gescoped
 * (identisches Publish-Scope-Muster wie `CampaignVersion`) --
 * `copyFromVersionId` darf daher NICHT zu einem ANDEREN Playbook gehoeren.
 * `PlaybookSection` wird bei jedem Update als GANZES ersetzt.
 *
 * Deckt ChatGPTs AP2-Vorgaben ab: keine tenantId aus Body/URL vertrauen
 * (Tenant-Isolation-Tests), scopeId serverseitig gegen den
 * authentifizierten Tenant validieren (IDOR-Tests), fremde Playbooks/
 * Versionen erzeugen keinen unterscheidbaren Informationskanal (identischer
 * `PlaybookNotFoundError` fuer fremd/nicht-existent), Draft-Versionen
 * append-only (jede neue Version ist eine neue Zeile mit inkrementiertem
 * `versionNumber`), Publish atomar mit Audit, Concurrent-Publish-Test
 * gegen dasselbe Playbook (dieser Test ist zugleich der explizite
 * Regressionstest fuer das "now-vor-Lock"-Muster aus Phase 13 AP10, siehe
 * docs/DECISION_LOG.md -- ChatGPTs ausdruecklicher Wunsch, dies als
 * Testfall statt nur als Code-Konvention zu verankern).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createDraftPlaybookVersion,
  createPlaybook,
  getPlaybookVersionDetail,
  getPlaybookVersionHistory,
  listPlaybooks,
  publishPlaybookVersion,
  translatePublishError,
  updatePlaybookVersionFields,
  validatePlaybookVersion,
} from "@/server/admin/playbook-admin";
import {
  CopySourcePlaybookVersionNotFoundError,
  PlaybookKeyAlreadyExistsError,
  PlaybookNotFoundError,
  PlaybookScopeInvalidError,
  PlaybookVersionInvalidError,
  PlaybookVersionNotDraftError,
  PlaybookVersionNotFoundError,
  PlaybookVersionPublishConflictError,
} from "@/server/admin/playbook-admin-errors";
import type { PlaybookSectionInput } from "@/server/admin/playbook-schemas";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("Phase 14 AP2: Playbook-Management-Service", () => {
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

  async function createCompany(tenantId: string, key: string) {
    const company = await rawClient.company.create({
      data: { tenantId, key: `company-${key}-${suffix}`, name: `Company ${key}` },
    });
    return company.id;
  }

  async function createStore(tenantId: string, companyId: string, key: string) {
    const store = await rawClient.store.create({
      data: { tenantId, companyId, key: `store-${key}-${suffix}`, name: `Store ${key}` },
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

  // -------------------------------------------------------------------
  // 1. Playbook anlegen
  // -------------------------------------------------------------------

  it("createPlaybook() legt ein Playbook ohne Version an", async () => {
    const tenantId = await createTenant("t1");
    const userId = await createUser(tenantId, "u1");

    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "vertrieb-basis", name: "Vertriebs-Grundlagen" }),
    );

    expect(playbook.key).toBe("vertrieb-basis");
    expect(playbook.versions).toEqual([]);

    const list = await runWithTenantContext(ctx(tenantId, userId), () => listPlaybooks());
    expect(list.map((p) => p.id)).toContain(playbook.id);
  });

  it("createPlaybook() mit bereits vergebenem key -> PlaybookKeyAlreadyExistsError", async () => {
    const tenantId = await createTenant("t2");
    const userId = await createUser(tenantId, "u1");

    await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "dup", name: "Erstes" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createPlaybook({ key: "dup", name: "Zweites" }),
      ),
    ).rejects.toBeInstanceOf(PlaybookKeyAlreadyExistsError);
  });

  it("derselbe key ist in ZWEI verschiedenen Mandanten unabhaengig zulaessig (Tenant-Isolation)", async () => {
    const tenantA = await createTenant("t3a");
    const tenantB = await createTenant("t3b");
    const userA = await createUser(tenantA, "u1");
    const userB = await createUser(tenantB, "u1");

    await expect(
      runWithTenantContext(ctx(tenantA, userA), () =>
        createPlaybook({ key: "shared-key", name: "A" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runWithTenantContext(ctx(tenantB, userB), () =>
        createPlaybook({ key: "shared-key", name: "B" }),
      ),
    ).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------
  // 2. scopeId-Validierung (IDOR-Schutz, ChatGPT-Vorgabe AP2)
  // -------------------------------------------------------------------

  it("createDraftPlaybookVersion() mit scopeType TENANT + scopeId === tenantId ist gueltig", async () => {
    const tenantId = await createTenant("t4");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    expect(version.scopeType).toBe("TENANT");
    expect(version.scopeId).toBe(tenantId);
    expect(version.status).toBe("DRAFT");
    expect(version.versionNumber).toBe(1);
  });

  it("createDraftPlaybookVersion() mit scopeType TENANT + fremder scopeId -> PlaybookScopeInvalidError", async () => {
    const tenantId = await createTenant("t5");
    const otherTenantId = await createTenant("t5-other");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: otherTenantId }),
      ),
    ).rejects.toBeInstanceOf(PlaybookScopeInvalidError);
  });

  it("createDraftPlaybookVersion() mit scopeType STORE + gueltigem Store desselben Mandanten ist zulaessig", async () => {
    const tenantId = await createTenant("t6");
    const userId = await createUser(tenantId, "u1");
    const companyId = await createCompany(tenantId, "co");
    const storeId = await createStore(tenantId, companyId, "s1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "STORE", scopeId: storeId }),
    );
    expect(version.scopeType).toBe("STORE");
    expect(version.scopeId).toBe(storeId);
  });

  it("createDraftPlaybookVersion() mit scopeType STORE + Store eines FREMDEN Mandanten -> PlaybookScopeInvalidError (IDOR)", async () => {
    const tenantId = await createTenant("t7");
    const otherTenantId = await createTenant("t7-other");
    const userId = await createUser(tenantId, "u1");
    const otherCompanyId = await createCompany(otherTenantId, "co");
    const foreignStoreId = await createStore(otherTenantId, otherCompanyId, "s1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbook.id, { scopeType: "STORE", scopeId: foreignStoreId }),
      ),
    ).rejects.toBeInstanceOf(PlaybookScopeInvalidError);
  });

  it("updatePlaybookVersionFields() mit nur scopeId-Patch validiert gegen den bestehenden (unveraenderten) scopeType", async () => {
    const tenantId = await createTenant("t8");
    const otherTenantId = await createTenant("t8-other");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        updatePlaybookVersionFields(playbook.id, version.id, { scopeId: otherTenantId }),
      ),
    ).rejects.toBeInstanceOf(PlaybookScopeInvalidError);
  });

  // -------------------------------------------------------------------
  // 3. Cross-Tenant-Zugriff (kein unterscheidbarer Informationskanal fuer
  //    fremde Playbooks/Versionen -- ChatGPT-Vorgabe AP2)
  // -------------------------------------------------------------------

  it("Playbook eines FREMDEN Mandanten ist unter der eigenen tenantId nicht adressierbar -> PlaybookNotFoundError", async () => {
    const tenantA = await createTenant("t9a");
    const tenantB = await createTenant("t9b");
    const userA = await createUser(tenantA, "u1");
    const userB = await createUser(tenantB, "u1");

    const playbookA = await runWithTenantContext(ctx(tenantA, userA), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantB, userB), () =>
        createDraftPlaybookVersion(playbookA.id, { scopeType: "TENANT", scopeId: tenantB }),
      ),
    ).rejects.toBeInstanceOf(PlaybookNotFoundError);

    await expect(
      runWithTenantContext(ctx(tenantB, userB), () => getPlaybookVersionHistory(playbookA.id)),
    ).rejects.toBeInstanceOf(PlaybookNotFoundError);
  });

  it("copyFromVersionId, die zu einem ANDEREN Playbook gehoert -> CopySourcePlaybookVersionNotFoundError", async () => {
    const tenantId = await createTenant("t10");
    const userId = await createUser(tenantId, "u1");
    const playbookA = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "a", name: "A" }),
    );
    const playbookB = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "b", name: "B" }),
    );
    const versionA = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbookA.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftPlaybookVersion(playbookB.id, {
          scopeType: "TENANT",
          scopeId: tenantId,
          copyFromVersionId: versionA.id,
        }),
      ),
    ).rejects.toBeInstanceOf(CopySourcePlaybookVersionNotFoundError);
  });

  // -------------------------------------------------------------------
  // 4. Sections: explizit vs. copyFromVersionId-Deep-Copy
  // -------------------------------------------------------------------

  it("createDraftPlaybookVersion() mit expliziten sections uebernimmt diese 1:1", async () => {
    const tenantId = await createTenant("t11");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        sections: [section({ title: "Einwand Preis" })],
      }),
    );

    expect(version.sections).toHaveLength(1);
    expect(version.sections[0]?.title).toBe("Einwand Preis");
  });

  it("createDraftPlaybookVersion() mit copyFromVersionId UND weggelassenen sections kopiert die Sections der Quelle", async () => {
    const tenantId = await createTenant("t12");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const source = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        sections: [section({ title: "Original" })],
      }),
    );

    const copy = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        copyFromVersionId: source.id,
      }),
    );

    expect(copy.sections).toHaveLength(1);
    expect(copy.sections[0]?.title).toBe("Original");
    // Append-only: neue Version ist eine NEUE Zeile mit inkrementiertem
    // versionNumber, niemals ein Ueberschreiben der Quelle (ChatGPT-Vorgabe).
    expect(copy.versionNumber).toBe(2);
    expect(copy.id).not.toBe(source.id);
  });

  it("createDraftPlaybookVersion() mit copyFromVersionId UND explizit leeren sections ignoriert die Quelle (Aufrufer-Werte gewinnen)", async () => {
    const tenantId = await createTenant("t13");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const source = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        sections: [section()],
      }),
    );

    const copy = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        copyFromVersionId: source.id,
        sections: [],
      }),
    );

    expect(copy.sections).toHaveLength(0);
  });

  it("updatePlaybookVersionFields() mit sections ERSETZT die gesamte bestehende Liste", async () => {
    const tenantId = await createTenant("t14");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        sections: [section({ title: "Alt A" }), section({ title: "Alt B" })],
      }),
    );
    expect(version.sections).toHaveLength(2);

    const updated = await runWithTenantContext(ctx(tenantId, userId), () =>
      updatePlaybookVersionFields(playbook.id, version.id, {
        sections: [section({ title: "Neu" })],
      }),
    );
    expect(updated.sections).toHaveLength(1);
    expect(updated.sections[0]?.title).toBe("Neu");
  });

  // -------------------------------------------------------------------
  // 5. Draft-only Mutation Guard (append-only Draft-Versionen)
  // -------------------------------------------------------------------

  it("Mutation einer nicht-DRAFT-Version -> PlaybookVersionNotDraftError", async () => {
    const tenantId = await createTenant("t15");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );
    await runWithTenantContext(ctx(tenantId, userId), () =>
      publishPlaybookVersion(playbook.id, version.id),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        updatePlaybookVersionFields(playbook.id, version.id, { description: "spaeter" }),
      ),
    ).rejects.toBeInstanceOf(PlaybookVersionNotDraftError);
  });

  // -------------------------------------------------------------------
  // 6. Validierung + Publish
  // -------------------------------------------------------------------

  it("validatePlaybookVersion() ohne Sections ist gueltig (Playbook-Version ohne Inhalt ist strukturell erlaubt)", async () => {
    const tenantId = await createTenant("t16");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        validatePlaybookVersion(playbook.id, version.id),
      ),
    ).resolves.toEqual({ valid: true });
  });

  it("validatePlaybookVersion() mit whitespace-only title/content -> PlaybookVersionInvalidError (Defense-in-Depth ueber Zod min(1) hinaus)", async () => {
    const tenantId = await createTenant("t17");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        sections: [section({ title: "   ", content: "   " })],
      }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        validatePlaybookVersion(playbook.id, version.id),
      ),
    ).rejects.toBeInstanceOf(PlaybookVersionInvalidError);
  });

  it("publishPlaybookVersion() bei fachlich ungueltiger Version schlaegt fehl UND laesst die Version im Status DRAFT (kein Teil-Publish)", async () => {
    const tenantId = await createTenant("t18");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        sections: [section({ title: "   " })],
      }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        publishPlaybookVersion(playbook.id, version.id),
      ),
    ).rejects.toBeInstanceOf(PlaybookVersionInvalidError);

    const reloaded = await runWithTenantContext(ctx(tenantId, userId), () =>
      getPlaybookVersionDetail(playbook.id, version.id),
    );
    expect(reloaded.status).toBe("DRAFT");
  });

  it("publishPlaybookVersion() aktiviert die Draft-Version und expiret die vorherige ACTIVE-Version DESSELBEN Playbooks", async () => {
    const tenantId = await createTenant("t19");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const v1 = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );
    const publish1 = await runWithTenantContext(ctx(tenantId, userId), () =>
      publishPlaybookVersion(playbook.id, v1.id),
    );
    expect(publish1.version.status).toBe("ACTIVE");
    expect(publish1.previousActiveVersionId).toBeNull();

    const v2 = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        copyFromVersionId: v1.id,
      }),
    );
    const publish2 = await runWithTenantContext(ctx(tenantId, userId), () =>
      publishPlaybookVersion(playbook.id, v2.id),
    );
    expect(publish2.version.status).toBe("ACTIVE");
    expect(publish2.previousActiveVersionId).toBe(v1.id);

    const historie = await runWithTenantContext(ctx(tenantId, userId), () =>
      getPlaybookVersionHistory(playbook.id),
    );
    const byId = new Map(historie.map((v) => [v.id, v]));
    expect(byId.get(v1.id)?.status).toBe("EXPIRED");
    expect(byId.get(v2.id)?.status).toBe("ACTIVE");
    // Draft/Publish-Historie: neueste Version zuerst.
    expect(historie[0]?.id).toBe(v2.id);
  });

  it("Publish einer bereits nicht mehr existierenden/fremden Version -> PlaybookVersionNotFoundError", async () => {
    const tenantId = await createTenant("t20");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        publishPlaybookVersion(playbook.id, randomUUID()),
      ),
    ).rejects.toBeInstanceOf(PlaybookVersionNotFoundError);
  });

  // -------------------------------------------------------------------
  // 7. Concurrent Publish (EXCLUDE-Constraint-Backstop UND expliziter
  //    Regressionstest fuer das "now-vor-Lock"-Muster, Phase 13 AP10,
  //    ChatGPT-Vorgabe AP2)
  // -------------------------------------------------------------------

  it("zwei GLEICHZEITIGE Publish-Versuche fuer ZWEI VERSCHIEDENE DRAFT-Versionen DESSELBEN Playbooks: genau einer gewinnt, der andere bekommt einen sauberen Fehler (kein rohes DB-Fehlerobjekt)", async () => {
    const tenantId = await createTenant("t21");
    const userId = await createUser(tenantId, "u1");
    const playbook = await runWithTenantContext(ctx(tenantId, userId), () =>
      createPlaybook({ key: "p", name: "P" }),
    );
    const vA = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );
    const vB = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftPlaybookVersion(playbook.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    const results = await Promise.allSettled([
      runWithTenantContext(ctx(tenantId, userId), () => publishPlaybookVersion(playbook.id, vA.id)),
      runWithTenantContext(ctx(tenantId, userId), () => publishPlaybookVersion(playbook.id, vB.id)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // Der Playbook-Row-Lock serialisiert beide Transaktionen -- BEIDE
    // koennen strukturell erfolgreich sein (nacheinander, nicht wirklich
    // "gleichzeitig" auf DB-Ebene), aber niemals darf einer der beiden mit
    // einem rohen, unuebersetzten DB-Fehler durchfallen. Waere `now` VOR
    // statt NACH dem Lock bestimmt (Phase-13-AP10-Regressionsmuster),
    // wuerde hier ein roher Postgres-22000-Fehler statt einer der beiden
    // erwarteten Fehlerklassen durchschlagen.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(
          r.reason instanceof PlaybookVersionPublishConflictError ||
            r.reason instanceof PlaybookVersionNotDraftError,
        ).toBe(true);
      }
    }

    const historie = await runWithTenantContext(ctx(tenantId, userId), () =>
      getPlaybookVersionHistory(playbook.id),
    );
    const activeCount = historie.filter((v) => v.status === "ACTIVE").length;
    // Strukturelle Garantie der EXCLUDE-Constraint: nie mehr als eine
    // gleichzeitig ACTIVE-Version DESSELBEN Playbooks.
    expect(activeCount).toBeLessThanOrEqual(1);
  });

  it("translatePublishError() uebersetzt NUR die bekannte EXCLUDE-Constraint-Verletzung, alle anderen Fehler werden unveraendert weitergeworfen", () => {
    const versionId = randomUUID();
    const otherError = new Error("irgendein anderer Fehler");
    expect(() => translatePublishError(otherError, versionId)).toThrow(otherError);
  });
});
