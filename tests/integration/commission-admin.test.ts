/**
 * Phase 10 AP2 -- Integrationstests fuer die CommissionModel-/Version-
 * Management-API (siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4). Testet
 * sowohl die Service-Schicht (`src/server/admin/commission-admin.ts`, direkt
 * innerhalb `runWithTenantContext()`) als auch die volle HTTP-Kette (Route-
 * Handler mit echtem signiertem Session-Cookie), gegen ECHTE Postgres-
 * Fixtures (kein `vi.mock`, Codebase-Konvention, siehe
 * tests/integration/rule-admin.test.ts).
 *
 * ZENTRALER STRUKTUR-UNTERSCHIED zu `tests/integration/rule-admin.test.ts`
 * (Phase 9 AP2): `CommissionModelVersion` ist PRO `CommissionModel` gescoped
 * (Phase-8-Muster, siehe PHASE_10_DISCOVERY.md Abschnitt 1) -- anders als bei
 * `RuleSetVersion` (mandantenweiter Scope) darf `copyFromVersionId` HIER
 * NICHT zu einem ANDEREN `CommissionModel` gehoeren. Ein entsprechender
 * Versuch liefert `CommissionModelVersionNotFoundError`, nicht etwa Erfolg --
 * das genaue Gegenteil des "zentralen AP2-Testfalls" aus rule-admin.test.ts.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient, type CommissionType, type VersionStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@/server/auth/session";
import {
  createCommissionTier,
  createDraftCommissionModelVersion,
  deleteCommissionTier,
  getCommissionModelVersionDetail,
  listCommissionModels,
  publishCommissionModelVersion,
  updateCommissionModelVersionFields,
  updateCommissionTier,
} from "@/server/admin/commission-admin";
import { validateCommissionModelVersion } from "@/server/admin/commission-validator";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionInvalidError,
  CommissionModelVersionNotDraftError,
  CommissionModelVersionNotFoundError,
  CommissionTierNotFoundError,
} from "@/server/admin/commission-admin-errors";
import { GET as listCommissionModelsRoute } from "@/app/api/admin/commission-models/route";
import { POST as createDraftCommissionModelVersionRoute } from "@/app/api/admin/commission-models/[id]/versions/route";
import {
  GET as getCommissionModelVersionDetailRoute,
  PATCH as patchCommissionModelVersionRoute,
} from "@/app/api/admin/commission-models/[id]/versions/[versionId]/route";
import { POST as createCommissionTierRoute } from "@/app/api/admin/commission-models/[id]/versions/[versionId]/tiers/route";
import {
  DELETE as deleteCommissionTierRoute,
  PATCH as patchCommissionTierRoute,
} from "@/app/api/admin/commission-models/[id]/versions/[versionId]/tiers/[tierId]/route";
import { POST as publishCommissionModelVersionRoute } from "@/app/api/admin/commission-models/[id]/versions/[versionId]/publish/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap2-commission-admin-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 10 AP2: CommissionModel-/Version-Management API", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await rawClient.$disconnect();
  });

  function baseSessionPayload(tenantId: string, userId: string): Omit<SessionPayload, "issuedAt"> {
    return {
      tenantId,
      userId,
      employeeId: randomUUID(),
      storeId: randomUUID(),
      displayName: "Test",
      roles: [],
      managementScope: null,
      configPermissions: [],
    };
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

  /**
   * `Provider.key` ist GLOBAL eindeutig (kein `tenantId`-Bezug, anders als
   * `ProductCategory`/`Product`) -- viele Testfaelle rufen `createProduct()`
   * mit demselben kurzen `key` (z. B. "p") in JEWEILS eigenen Tenants auf.
   * Der gemeinsame Datei-`suffix` allein reicht daher NICHT aus, um
   * Provider-Key-Kollisionen ueber alle Testfaelle hinweg zu vermeiden --
   * zusaetzlich ein frischer Per-Call-Suffix (CI #65-Fix).
   */
  async function createProvider(key: string) {
    const provider = await rawClient.provider.create({
      data: {
        key: `provider-${key}-${suffix}-${randomUUID().slice(0, 8)}`,
        name: `Provider ${key}`,
        isSynthetic: true,
      },
    });
    return provider.id;
  }

  async function createCategory(tenantId: string, key: string) {
    const category = await rawClient.productCategory.create({
      data: { tenantId, key: `category-${key}-${suffix}`, name: `Kategorie ${key}` },
    });
    return category.id;
  }

  async function createProduct(tenantId: string, key: string) {
    const providerId = await createProvider(key);
    const categoryId = await createCategory(tenantId, key);
    const product = await rawClient.product.create({
      data: {
        tenantId,
        providerId,
        categoryId,
        productType: "MOBILE_NEW_CONTRACT",
        name: `Produkt ${key}`,
        isSynthetic: true,
      },
    });
    return product.id;
  }

  async function createEmptyCommissionModel(tenantId: string, productId: string, key: string) {
    const commissionModel = await rawClient.commissionModel.create({
      data: { tenantId, productId, name: `Modell ${key}` },
    });
    return commissionModel.id;
  }

  async function createCommissionModelWithVersion(
    tenantId: string,
    productId: string,
    key: string,
    overrides: Partial<{
      status: VersionStatus;
      validFrom: Date;
      validTo: Date | null;
      commissionType: CommissionType;
      currency: string;
      commissionAmountMinor: number | null;
    }> = {},
  ) {
    const commissionModelId = await createEmptyCommissionModel(tenantId, productId, key);
    const version = await rawClient.commissionModelVersion.create({
      data: {
        tenantId,
        commissionModelId,
        versionNumber: 1,
        status: overrides.status ?? "ACTIVE",
        validFrom: overrides.validFrom ?? new Date("2026-01-01T00:00:00Z"),
        validTo: overrides.validTo ?? null,
        commissionType: overrides.commissionType ?? "FLAT",
        currency: overrides.currency ?? "EUR",
        // Bewusst KEIN "??": ein explizit uebergebenes null (z. B. fuer
        // TIERED-Versionen, bei denen commissionAmountMinor null sein MUSS)
        // darf nicht durch den 1_500-Default ueberschrieben werden -- ??
        // behandelt null und undefined identisch, was genau das verhindern
        // wuerde. Daher: nur bei undefined (Feld gar nicht uebergeben) den
        // Default verwenden.
        commissionAmountMinor:
          overrides.commissionAmountMinor !== undefined ? overrides.commissionAmountMinor : 1_500,
      },
    });
    return { commissionModelId, versionId: version.id };
  }

  /**
   * Direkter DB-Bypass fuer die Validator-Tests (AP4) -- legt eine
   * `CommissionTier`-Zeile OHNE die App-Schicht-Guards aus
   * `createCommissionTier()` an (insbesondere OHNE die
   * "nur bei commissionType TIERED"-Pruefung). Damit lassen sich
   * `validateCommissionModelVersion()`-Faelle testen, die die App-Schicht
   * selbst gar nicht erst zulaesst (z. B. Tier-Zeilen unter einer FLAT-
   * Version) -- die tier-INTERNEN DB-CHECK-Constraints (Amount-XOR-
   * Percentage, threshold >= 0, UNIQUE threshold/sortOrder) bleiben dabei
   * unveraendert in Kraft und koennen daher NICHT umgangen werden.
   */
  async function createRawCommissionTier(
    tenantId: string,
    commissionModelVersionId: string,
    overrides: Partial<{
      thresholdMinor: number;
      tierAmountMinor: number | null;
      tierPercentageBasisPoints: number | null;
      sortOrder: number;
    }> = {},
  ) {
    return rawClient.commissionTier.create({
      data: {
        tenantId,
        commissionModelVersionId,
        thresholdMinor: overrides.thresholdMinor ?? 0,
        tierAmountMinor: overrides.tierAmountMinor ?? 100,
        tierPercentageBasisPoints: overrides.tierPercentageBasisPoints ?? null,
        sortOrder: overrides.sortOrder ?? 0,
      },
    });
  }

  function requestWithCookie(
    url: string,
    token: string,
    init?: { method?: string; body?: string },
  ) {
    return new NextRequest(url, {
      method: init?.method,
      body: init?.body,
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    });
  }

  function routeParams<T extends Record<string, string>>(value: T) {
    return { params: Promise.resolve(value) };
  }

  const draftInput = {
    commissionType: "FLAT" as const,
    currency: "EUR",
    commissionAmountMinor: 2_000,
  };

  // -------------------------------------------------------------------
  // 1. Service-Schicht
  // -------------------------------------------------------------------
  describe("1. Service-Schicht", () => {
    it("listCommissionModels() liefert Modelle inkl. Versionen+Status", async () => {
      const tenantId = await createTenant("svc-list");
      const productId = await createProduct(tenantId, "p");
      await createCommissionModelWithVersion(tenantId, productId, "cm");
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => listCommissionModels(),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.versions[0]?.status).toBe("ACTIVE");
    });

    it("getCommissionModelVersionDetail() liefert alle Skalarfelder korrekt", async () => {
      const tenantId = await createTenant("svc-detail");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { commissionType: "PERCENTAGE", commissionAmountMinor: null },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getCommissionModelVersionDetail(commissionModelId, versionId),
      );
      expect(detail.commissionType).toBe("PERCENTAGE");
      expect(detail.currency).toBe("EUR");
      expect(detail.status).toBe("ACTIVE");
    });

    it("getCommissionModelVersionDetail() mit fremder commissionModelId -> CommissionModelNotFoundError", async () => {
      const tenantId = await createTenant("svc-cmnf");
      const productId = await createProduct(tenantId, "p");
      const { versionId } = await createCommissionModelWithVersion(tenantId, productId, "cm");
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getCommissionModelVersionDetail(randomUUID(), versionId),
        ),
      ).rejects.toThrow(CommissionModelNotFoundError);
    });

    it("getCommissionModelVersionDetail() mit versionId aus ANDEREM CommissionModel -> CommissionModelVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-vnf");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { commissionModelId: modelA } = await createCommissionModelWithVersion(
        tenantId,
        productA,
        "cm-a",
      );
      const { versionId: versionB } = await createCommissionModelWithVersion(
        tenantId,
        productB,
        "cm-b",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getCommissionModelVersionDetail(modelA, versionB),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    it("createDraftCommissionModelVersion() ohne copyFromVersionId legt DRAFT mit versionNumber 1 an (erstes Modell)", async () => {
      const tenantId = await createTenant("svc-empty");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftCommissionModelVersion(commissionModelId, draftInput),
      );
      expect(detail.status).toBe("DRAFT");
      expect(detail.versionNumber).toBe(1);
      expect(detail.commissionAmountMinor).toBe(2_000);
    });

    it("createDraftCommissionModelVersion() erhoeht versionNumber bei einer zweiten Version", async () => {
      const tenantId = await createTenant("svc-versionnum");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftCommissionModelVersion(commissionModelId, draftInput),
      );
      expect(detail.versionNumber).toBe(2);
    });

    it("createDraftCommissionModelVersion() mit copyFromVersionId DESSELBEN CommissionModel funktioniert", async () => {
      const tenantId = await createTenant("svc-copy-same");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createDraftCommissionModelVersion(commissionModelId, {
            ...draftInput,
            copyFromVersionId: versionId,
          }),
      );
      expect(detail.status).toBe("DRAFT");
      expect(detail.commissionModelId).toBe(commissionModelId);
    });

    it("createDraftCommissionModelVersion() mit copyFromVersionId eines ANDEREN CommissionModel -> CommissionModelVersionNotFoundError (per-Entity-Scope, Gegenteil von Phase 9 AP2)", async () => {
      const tenantId = await createTenant("svc-copy-cross");
      const actorUserId = await createUser(tenantId, "actor");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { versionId: sourceVersionId } = await createCommissionModelWithVersion(
        tenantId,
        productA,
        "cm-source",
      );
      const targetCommissionModelId = await createEmptyCommissionModel(
        tenantId,
        productB,
        "cm-target",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createDraftCommissionModelVersion(targetCommissionModelId, {
              ...draftInput,
              copyFromVersionId: sourceVersionId,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    it("createDraftCommissionModelVersion() mit nicht existierender copyFromVersionId -> CommissionModelVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-copy-missing");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createDraftCommissionModelVersion(commissionModelId, {
              ...draftInput,
              copyFromVersionId: randomUUID(),
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    it("createDraftCommissionModelVersion() mit copyFromVersionId aus FREMDEM Mandanten -> CommissionModelVersionNotFoundError (Tenant-Isolation)", async () => {
      const tenantA = await createTenant("svc-tenant-a");
      const tenantB = await createTenant("svc-tenant-b");
      const actorA = await createUser(tenantA, "actor-a");
      const productB = await createProduct(tenantB, "pb");
      const { versionId: foreignVersionId } = await createCommissionModelWithVersion(
        tenantB,
        productB,
        "cm",
      );
      const productA = await createProduct(tenantA, "pa");
      const commissionModelId = await createEmptyCommissionModel(tenantA, productA, "cm");
      await expect(
        runWithTenantContext(
          { tenantId: tenantA, userId: actorA, roles: [], managementScope: null },
          () =>
            createDraftCommissionModelVersion(commissionModelId, {
              ...draftInput,
              copyFromVersionId: foreignVersionId,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    /**
     * Regressionstest fuer den in Phase 10 AP9 (E2E-Suite, CI #75) gefundenen
     * Concurrency-Bug: createDraftCommissionModelVersion() ermittelte die
     * naechste versionNumber urspruenglich OHNE Row-Lock auf das
     * CommissionModel -- zwei echt parallele Aufrufe fuer DASSELBE Modell
     * lasen unter READ COMMITTED denselben MAX(versionNumber), bevor einer
     * committete, und der zweite Versuch scheiterte am UNIQUE-Constraint
     * (tenant_id, commission_model_id, version_number) mit P2002 statt
     * sauber die naechste freie Nummer zu erhalten. Fix (analog AP5s
     * publishCommissionModelVersion()): SELECT ... FOR UPDATE auf
     * commission_models als erste Transaktionsoperation. ChatGPT-Root-Cause-
     * Bestaetigung + Fix-GO: 2026-08-22.
     */
    it("Nebenlaeufigkeit: zwei ECHT parallele createDraftCommissionModelVersion()-Aufrufe DESSELBEN CommissionModel sind BEIDE erfolgreich und erhalten unterschiedliche versionNumber (Row-Lock-Regressionstest, Phase 10 AP9 CI #75)", async () => {
      const tenantId = await createTenant("ap9-parallel-draft-same-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm-base",
      );

      // Bewusst KEIN sequentielles await -- beide Draft-Erstellungen werden
      // ECHT gleichzeitig fuer DASSELBE CommissionModel gestartet, um den in
      // commission-admin.ts dokumentierten CommissionModel-Row-Lock zu
      // pruefen.
      const results = await Promise.allSettled([
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => createDraftCommissionModelVersion(commissionModelId, draftInput),
        ),
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => createDraftCommissionModelVersion(commissionModelId, draftInput),
        ),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const fulfilled = results as PromiseFulfilledResult<
        Awaited<ReturnType<typeof createDraftCommissionModelVersion>>
      >[];
      const versionNumbers = fulfilled.map((r) => r.value.versionNumber).sort();
      // Basisversion (AP1) ist bereits versionNumber 1 -- beide neuen Drafts
      // muessen 2 und 3 erhalten, in irgendeiner Reihenfolge.
      expect(versionNumbers).toEqual([2, 3]);

      const draftVersions = await rawClient.commissionModelVersion.findMany({
        where: { tenantId, commissionModelId, status: "DRAFT" },
      });
      expect(draftVersions).toHaveLength(2);

      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionModelVersion", action: "CREATE" },
      });
      expect(auditEntries).toHaveLength(2);
    });

    it("Gegenprobe: zwei ECHT parallele createDraftCommissionModelVersion()-Aufrufe fuer VERSCHIEDENE CommissionModels duerfen sich NICHT gegenseitig blockieren (kein falscher Tenant-weiter Lock)", async () => {
      const tenantId = await createTenant("ap9-parallel-draft-cross-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productX = await createProduct(tenantId, "px");
      const productY = await createProduct(tenantId, "py");
      const { commissionModelId: modelX } = await createCommissionModelWithVersion(
        tenantId,
        productX,
        "cm-x",
      );
      const { commissionModelId: modelY } = await createCommissionModelWithVersion(
        tenantId,
        productY,
        "cm-y",
      );

      const results = await Promise.allSettled([
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => createDraftCommissionModelVersion(modelX, draftInput),
        ),
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => createDraftCommissionModelVersion(modelY, draftInput),
        ),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const draftX = await rawClient.commissionModelVersion.findFirst({
        where: { tenantId, commissionModelId: modelX, status: "DRAFT" },
      });
      const draftY = await rawClient.commissionModelVersion.findFirst({
        where: { tenantId, commissionModelId: modelY, status: "DRAFT" },
      });
      expect(draftX?.versionNumber).toBe(2);
      expect(draftY?.versionNumber).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // 1b. Feld-CRUD (AP3)
  // -------------------------------------------------------------------
  describe("1b. Feld-CRUD (AP3) -- updateCommissionModelVersionFields()", () => {
    it("aendert nur die uebergebenen Felder (partielles Update, currency)", async () => {
      const tenantId = await createTenant("ap3-partial");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionModelVersionFields(commissionModelId, versionId, { currency: "CHF" }),
      );
      expect(detail.currency).toBe("CHF");
      expect(detail.commissionType).toBe("FLAT");
      expect(detail.commissionAmountMinor).toBe(1_500);
    });

    it("gegen eine nicht-DRAFT-Version -> CommissionModelVersionNotDraftError", async () => {
      const tenantId = await createTenant("ap3-not-draft");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionModelVersionFields(commissionModelId, versionId, { currency: "CHF" }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotDraftError);
    });

    it("commissionType -> PERCENTAGE, wenn commissionAmountMinor aus der bestehenden Version noch gesetzt ist -> CommissionModelVersionInvalidError (Merge-Pruefung, nicht nur Patch-lokal)", async () => {
      const tenantId = await createTenant("ap3-invalid-merge");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      // Patch enthaelt NUR commissionType -- commissionAmountMinor bleibt aus
      // dem bestehenden Datensatz bestehen und muss dennoch als Verstoss
      // erkannt werden.
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionModelVersionFields(commissionModelId, versionId, {
              commissionType: "PERCENTAGE",
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("commissionType PERCENTAGE + amount/recurringAmount im selben Patch auf null -> Erfolg", async () => {
      const tenantId = await createTenant("ap3-valid-percentage");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          updateCommissionModelVersionFields(commissionModelId, versionId, {
            commissionType: "PERCENTAGE",
            commissionAmountMinor: null,
            commissionPercentageBasisPoints: 500,
          }),
      );
      expect(detail.commissionType).toBe("PERCENTAGE");
      expect(detail.commissionAmountMinor).toBeNull();
      expect(detail.commissionPercentageBasisPoints).toBe(500);
    });

    it("commissionType FLAT mit gleichzeitig gesetztem commissionPercentageBasisPoints -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap3-invalid-flat-pct");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionModelVersionFields(commissionModelId, versionId, {
              commissionPercentageBasisPoints: 250,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("commissionType FLAT: commissionAmountMinor UND recurringCommissionAmountMinor GLEICHZEITIG gesetzt ist ERLAUBT (bewusst NICHT exklusiv, siehe computeCommissionAmountMinor()-Kommentar)", async () => {
      const tenantId = await createTenant("ap3-flat-both-amounts");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          updateCommissionModelVersionFields(commissionModelId, versionId, {
            recurringCommissionAmountMinor: 300,
          }),
      );
      expect(detail.commissionAmountMinor).toBe(1_000);
      expect(detail.recurringCommissionAmountMinor).toBe(300);
    });

    it("gegen fremdes CommissionModel (versionId gehoert nicht zu commissionModelId) -> CommissionModelVersionNotFoundError", async () => {
      const tenantId = await createTenant("ap3-wrong-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { commissionModelId: modelA } = await createCommissionModelWithVersion(
        tenantId,
        productA,
        "cm-a",
        { status: "DRAFT" },
      );
      const { versionId: versionB } = await createCommissionModelWithVersion(
        tenantId,
        productB,
        "cm-b",
        { status: "DRAFT" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => updateCommissionModelVersionFields(modelA, versionB, { currency: "CHF" }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 2. HTTP-Kette
  // -------------------------------------------------------------------
  describe("2. HTTP-Kette", () => {
    it("GET /api/admin/commission-models ohne config.commissions.view -> 403", async () => {
      const tenantId = await createTenant("http-403-list");
      const actorUserId = await createUser(tenantId, "actor");
      const token = createSessionToken(baseSessionPayload(tenantId, actorUserId));
      const response = await listCommissionModelsRoute(
        requestWithCookie("http://localhost/api/admin/commission-models", token),
      );
      expect(response.status).toBe(403);
    });

    it("GET /api/admin/commission-models mit config.commissions.view -> 200 mit Liste", async () => {
      const tenantId = await createTenant("http-200-list");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      await createCommissionModelWithVersion(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await listCommissionModelsRoute(
        requestWithCookie("http://localhost/api/admin/commission-models", token),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.commissionModels.length).toBeGreaterThanOrEqual(1);
    });

    it("GET .../versions/:versionId mit config.commissions.view -> 200 mit Detail", async () => {
      const tenantId = await createTenant("http-200-detail");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await getCommissionModelVersionDetailRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.commissionType).toBe("FLAT");
    });

    it("POST .../versions ohne config.commissions.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-post");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await createDraftCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions`,
          token,
          { method: "POST", body: JSON.stringify(draftInput) },
        ),
        routeParams({ id: commissionModelId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../versions mit config.commissions.edit -> 201", async () => {
      const tenantId = await createTenant("http-201-create");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await createDraftCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions`,
          token,
          { method: "POST", body: JSON.stringify(draftInput) },
        ),
        routeParams({ id: commissionModelId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version.status).toBe("DRAFT");
      expect(body.version.commissionAmountMinor).toBe(2_000);
    });

    it("POST .../versions mit ungueltigem Body (fehlendes commissionType/currency) -> 400", async () => {
      const tenantId = await createTenant("http-400-post");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await createDraftCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions`,
          token,
          { method: "POST", body: JSON.stringify({}) },
        ),
        routeParams({ id: commissionModelId }),
      );
      expect(response.status).toBe(400);
    });

    it("PATCH .../versions/:versionId ohne config.commissions.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "CHF" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("PATCH .../versions/:versionId mit config.commissions.edit -> 200 mit aktualisiertem Detail", async () => {
      const tenantId = await createTenant("http-200-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "CHF" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.currency).toBe("CHF");
    });

    it("PATCH .../versions/:versionId gegen eine ACTIVE-Version -> 409", async () => {
      const tenantId = await createTenant("http-409-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "CHF" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    it("PATCH .../versions/:versionId mit Amount/Percentage-Verstoss -> 422", async () => {
      const tenantId = await createTenant("http-422-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ commissionType: "PERCENTAGE" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(422);
    });

    it("PATCH .../versions/:versionId mit ungueltigem Body (falscher Typ) -> 400", async () => {
      const tenantId = await createTenant("http-400-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "TOOLONG" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // 3. Auditierung (Phase 10 AP2, von Anfang an eingebaut)
  // -------------------------------------------------------------------
  describe("3. Auditierung", () => {
    it("createDraftCommissionModelVersion() schreibt einen AuditLog-Eintrag (action CREATE, entityType CommissionModelVersion)", async () => {
      const tenantId = await createTenant("audit-create");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftCommissionModelVersion(commissionModelId, draftInput),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionModelVersion", entityId: detail.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("CREATE");
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
    });

    it("updateCommissionModelVersionFields() schreibt einen AuditLog-Eintrag (action UPDATE, changedFields nur die Feldnamen)", async () => {
      const tenantId = await createTenant("audit-update");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionModelVersionFields(commissionModelId, versionId, { currency: "CHF" }),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "CommissionModelVersion",
          entityId: versionId,
          action: "UPDATE",
        },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
      expect(auditEntries[0]?.metadata).toMatchObject({ changedFields: ["currency"] });
    });

    it("updateCommissionModelVersionFields() OHNE tatsaechliche Feldaenderungen (leerer Patch) schreibt KEINEN AuditLog-Eintrag", async () => {
      const tenantId = await createTenant("audit-empty-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionModelVersionFields(commissionModelId, versionId, {}),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "CommissionModelVersion",
          entityId: versionId,
          action: "UPDATE",
        },
      });
      expect(auditEntries).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // 4. Tier-CRUD (AP4) -- createCommissionTier()/updateCommissionTier()/
  //    deleteCommissionTier()
  // -------------------------------------------------------------------
  describe("4. Tier-CRUD (AP4)", () => {
    it("createCommissionTier() gegen eine NICHT-TIERED-Version -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-not-tiered");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 0,
              tierAmountMinor: 100,
              sortOrder: 0,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("createCommissionTier() gegen eine nicht-DRAFT-Version -> CommissionModelVersionNotDraftError", async () => {
      const tenantId = await createTenant("ap4-not-draft");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 0,
              tierAmountMinor: 100,
              sortOrder: 0,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotDraftError);
    });

    it("createCommissionTier() mit tierAmountMinor UND tierPercentageBasisPoints gleichzeitig gesetzt -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-both-set");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 0,
              tierAmountMinor: 100,
              tierPercentageBasisPoints: 500,
              sortOrder: 0,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("createCommissionTier() mit weder tierAmountMinor NOCH tierPercentageBasisPoints gesetzt -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-neither-set");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 0,
              sortOrder: 0,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("createCommissionTier() legt eine gueltige Amount-Stufe an, sichtbar in getCommissionModelVersionDetail().tiers", async () => {
      const tenantId = await createTenant("ap4-create-valid");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      expect(tier.thresholdMinor).toBe(0);
      expect(tier.tierAmountMinor).toBe(100);
      expect(tier.tierPercentageBasisPoints).toBeNull();

      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => getCommissionModelVersionDetail(commissionModelId, versionId),
      );
      expect(detail.tiers).toHaveLength(1);
      expect(detail.tiers[0]?.id).toBe(tier.id);
    });

    it("createCommissionTier() mit doppeltem thresholdMinor innerhalb derselben Version -> CommissionModelVersionInvalidError (P2002-Uebersetzung)", async () => {
      const tenantId = await createTenant("ap4-dup-threshold");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 0,
              tierAmountMinor: 200,
              sortOrder: 1,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("createCommissionTier() mit doppeltem sortOrder innerhalb derselben Version -> CommissionModelVersionInvalidError (P2002-Uebersetzung)", async () => {
      const tenantId = await createTenant("ap4-dup-sortorder");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 1_000,
              tierPercentageBasisPoints: 500,
              sortOrder: 0,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("updateCommissionTier() Merge-Pruefung: Patch setzt nur tierPercentageBasisPoints, tierAmountMinor bleibt aus dem bestehenden Datensatz gesetzt -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-update-merge-invalid");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionTier(commissionModelId, versionId, tier.id, {
              tierPercentageBasisPoints: 500,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("updateCommissionTier() gueltiges partielles Update (nur thresholdMinor) laesst tierAmountMinor unveraendert", async () => {
      const tenantId = await createTenant("ap4-update-valid");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      const updated = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionTier(commissionModelId, versionId, tier.id, { thresholdMinor: 50 }),
      );
      expect(updated.thresholdMinor).toBe(50);
      expect(updated.tierAmountMinor).toBe(100);
    });

    it("updateCommissionTier() gegen eine nicht-DRAFT-Version -> CommissionModelVersionNotDraftError", async () => {
      const tenantId = await createTenant("ap4-update-not-draft");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await rawClient.commissionModelVersion.update({
        where: { id: versionId },
        data: { status: "ACTIVE" },
      });
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => updateCommissionTier(commissionModelId, versionId, tier.id, { thresholdMinor: 10 }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotDraftError);
    });

    it("updateCommissionTier()/deleteCommissionTier() mit tierId aus ANDERER Version -> CommissionTierNotFoundError", async () => {
      const tenantId = await createTenant("ap4-wrong-version");
      const actorUserId = await createUser(tenantId, "actor");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { commissionModelId: modelA, versionId: versionA } =
        await createCommissionModelWithVersion(tenantId, productA, "cm-a", {
          status: "DRAFT",
          commissionType: "TIERED",
          commissionAmountMinor: null,
        });
      const { versionId: versionB } = await createCommissionModelWithVersion(
        tenantId,
        productB,
        "cm-b",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      // Direkter Bypass statt createCommissionTier(), da modelA/versionB als
      // fremdes Modell ohnehin schon bei requireCommissionModelVersion()
      // abgelehnt wuerde -- hier interessiert ausschliesslich die
      // requireCommissionTier()-Zugehoerigkeitspruefung selbst (Tier gehoert
      // zu versionB, wird aber unter versionA angefragt).
      const rawTier = await createRawCommissionTier(tenantId, versionB, {
        thresholdMinor: 0,
        sortOrder: 0,
      });
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => updateCommissionTier(modelA, versionA, rawTier.id, { thresholdMinor: 10 }),
        ),
      ).rejects.toThrow(CommissionTierNotFoundError);
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => deleteCommissionTier(modelA, versionA, rawTier.id),
        ),
      ).rejects.toThrow(CommissionTierNotFoundError);
    });

    it("deleteCommissionTier() entfernt die Zeile vollstaendig (kein Append-only bei CommissionTier)", async () => {
      const tenantId = await createTenant("ap4-delete");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => deleteCommissionTier(commissionModelId, versionId, tier.id),
      );
      const remaining = await rawClient.commissionTier.findUnique({ where: { id: tier.id } });
      expect(remaining).toBeNull();
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => getCommissionModelVersionDetail(commissionModelId, versionId),
      );
      expect(detail.tiers).toHaveLength(0);
    });

    it("createCommissionTier()/updateCommissionTier()/deleteCommissionTier() schreiben je einen AuditLog-Eintrag (CREATE/UPDATE/DELETE, entityType CommissionTier)", async () => {
      const tenantId = await createTenant("ap4-audit");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionTier(commissionModelId, versionId, tier.id, { thresholdMinor: 5 }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => deleteCommissionTier(commissionModelId, versionId, tier.id),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionTier", entityId: tier.id },
        orderBy: { occurredAt: "asc" },
      });
      expect(auditEntries.map((e) => e.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
      expect(auditEntries.every((e) => e.actorUserId === actorUserId)).toBe(true);
    });

    it("HTTP: POST .../tiers mit config.commissions.edit -> 201", async () => {
      const tenantId = await createTenant("ap4-http-post");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await createCommissionTierRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/tiers`,
          token,
          {
            method: "POST",
            body: JSON.stringify({ thresholdMinor: 0, tierAmountMinor: 100, sortOrder: 0 }),
          },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.tier.thresholdMinor).toBe(0);
    });

    it("HTTP: POST .../tiers ohne config.commissions.edit -> 403", async () => {
      const tenantId = await createTenant("ap4-http-403");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await createCommissionTierRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/tiers`,
          token,
          {
            method: "POST",
            body: JSON.stringify({ thresholdMinor: 0, tierAmountMinor: 100, sortOrder: 0 }),
          },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("HTTP: PATCH .../tiers/:tierId -> 200, DELETE .../tiers/:tierId -> 204", async () => {
      const tenantId = await createTenant("ap4-http-patch-delete");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      const tier = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const patchResponse = await patchCommissionTierRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/tiers/${tier.id}`,
          token,
          { method: "PATCH", body: JSON.stringify({ thresholdMinor: 25 }) },
        ),
        routeParams({ id: commissionModelId, versionId, tierId: tier.id }),
      );
      expect(patchResponse.status).toBe(200);
      const patchBody = await patchResponse.json();
      expect(patchBody.tier.thresholdMinor).toBe(25);

      const deleteResponse = await deleteCommissionTierRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/tiers/${tier.id}`,
          token,
          { method: "DELETE" },
        ),
        routeParams({ id: commissionModelId, versionId, tierId: tier.id }),
      );
      expect(deleteResponse.status).toBe(204);
    });
  });

  // -------------------------------------------------------------------
  // 5. Validator (AP4) -- validateCommissionModelVersion()
  // -------------------------------------------------------------------
  describe("5. Validator (AP4) -- validateCommissionModelVersion()", () => {
    it("gueltige FLAT-Version -> { valid: true }", async () => {
      const tenantId = await createTenant("ap4-val-flat-ok");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => validateCommissionModelVersion(commissionModelId, versionId),
      );
      expect(result).toEqual({ valid: true });
    });

    it("FLAT-Version ohne Amount UND ohne RecurringAmount -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-val-flat-empty");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const version = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId,
          versionNumber: 1,
          status: "DRAFT",
          validFrom: new Date("2026-01-01T00:00:00Z"),
          commissionType: "FLAT",
          currency: "EUR",
        },
      });
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => validateCommissionModelVersion(commissionModelId, version.id),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("PERCENTAGE-Version mit gleichzeitig gesetztem commissionAmountMinor (DB-Bypass) -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-val-pct-invalid");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const version = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId,
          versionNumber: 1,
          status: "DRAFT",
          validFrom: new Date("2026-01-01T00:00:00Z"),
          commissionType: "PERCENTAGE",
          currency: "EUR",
          commissionPercentageBasisPoints: 500,
          commissionAmountMinor: 1_000, // App-Schicht wuerde das verhindern -- Validator prueft redundant.
        },
      });
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => validateCommissionModelVersion(commissionModelId, version.id),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("FLAT-Version MIT CommissionTier-Zeilen (DB-Bypass, App-Schicht wuerde das verhindern) -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-val-flat-with-tiers");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      await createRawCommissionTier(tenantId, versionId, { thresholdMinor: 0, sortOrder: 0 });
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => validateCommissionModelVersion(commissionModelId, versionId),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("TIERED-Version ohne jede CommissionTier-Zeile -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-val-tiered-empty");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => validateCommissionModelVersion(commissionModelId, versionId),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("TIERED-Version OHNE Stufe mit thresholdMinor = 0 -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap4-val-tiered-no-zero");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 500,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => validateCommissionModelVersion(commissionModelId, versionId),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("gueltige TIERED-Version MIT thresholdMinor = 0-Stufe -> { valid: true }", async () => {
      const tenantId = await createTenant("ap4-val-tiered-ok");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 1_000,
            tierPercentageBasisPoints: 500,
            sortOrder: 1,
          }),
      );
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => validateCommissionModelVersion(commissionModelId, versionId),
      );
      expect(result).toEqual({ valid: true });
    });

    it("Tenant-Isolation: validateCommissionModelVersion() mit commissionModelId aus fremdem Mandanten -> CommissionModelNotFoundError", async () => {
      const tenantA = await createTenant("ap4-val-tenant-a");
      const tenantB = await createTenant("ap4-val-tenant-b");
      const productB = await createProduct(tenantB, "pb");
      const { commissionModelId: modelB, versionId: versionB } =
        await createCommissionModelWithVersion(tenantB, productB, "cm-b", { status: "DRAFT" });
      await expect(
        runWithTenantContext(
          { tenantId: tenantA, userId: randomUUID(), roles: [], managementScope: null },
          () => validateCommissionModelVersion(modelB, versionB),
        ),
      ).rejects.toThrow(CommissionModelNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 6. Publish-Workflow (AP5, siehe PHASE_10_IMPLEMENTATION_PLAN.md
  //    Abschnitt 7, ChatGPT-GO 2026-08-21). Analog
  //    tests/integration/rule-admin-publish.test.ts (Phase 9 AP5) --
  //    zentraler Unterschied: PRO-CommissionModel-Scope, kein
  //    mandantenweiter Scope. Der "zentrale Regressionstest" ist daher
  //    das GENAUE GEGENTEIL von Phase 9s zentralem Testfall: Modell A's
  //    ACTIVE-Version DARF NICHT expiret werden, wenn Modell B's Draft
  //    veroeffentlicht wird.
  // -------------------------------------------------------------------
  describe("6. Publish-Workflow (AP5) -- publishCommissionModelVersion()", () => {
    it("erster Publish ueberhaupt (kein vorheriger ACTIVE-Datensatz DESSELBEN CommissionModel) -> previousActiveVersionId: null", async () => {
      const tenantId = await createTenant("ap5-first-publish");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );

      const result = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishCommissionModelVersion(commissionModelId, versionId),
      );

      expect(result.previousActiveVersionId).toBeNull();
      expect(result.version.status).toBe("ACTIVE");

      const versionRow = await rawClient.commissionModelVersion.findUnique({
        where: { id: versionId },
      });
      expect(versionRow?.status).toBe("ACTIVE");
      expect(versionRow?.validTo).toBeNull();
    });

    it("Publish expiret die bisherige ACTIVE-Version DESSELBEN CommissionModel", async () => {
      const tenantId = await createTenant("ap5-expire-previous");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId: versionA } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE", validFrom: new Date("2026-01-01T00:00:00Z") },
      );
      const versionB = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId,
          versionNumber: 2,
          status: "DRAFT",
          validFrom: new Date(),
          validTo: null,
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 3_000,
        },
      });

      const result = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishCommissionModelVersion(commissionModelId, versionB.id),
      );

      expect(result.previousActiveVersionId).toBe(versionA);

      const rowA = await rawClient.commissionModelVersion.findUnique({ where: { id: versionA } });
      const rowB = await rawClient.commissionModelVersion.findUnique({
        where: { id: versionB.id },
      });
      expect(rowA?.status).toBe("EXPIRED");
      expect(rowA?.validTo).not.toBeNull();
      expect(rowB?.status).toBe("ACTIVE");
      expect(rowB?.validTo).toBeNull();
    });

    it("Publish schreibt AuditLog-Eintrag (ACTIVATE) mit commissionModelId + previousActiveVersionId in metadata", async () => {
      const tenantId = await createTenant("ap5-audit");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId: versionA } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE" },
      );
      const versionB = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId,
          versionNumber: 2,
          status: "DRAFT",
          validFrom: new Date(),
          validTo: null,
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 3_000,
        },
      });

      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishCommissionModelVersion(commissionModelId, versionB.id),
      );

      const auditEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "CommissionModelVersion",
          entityId: versionB.id,
          action: "ACTIVATE",
        },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.metadata).toMatchObject({
        commissionModelId,
        previousActiveVersionId: versionA,
      });
    });

    it("Publish einer nicht-DRAFT-Version -> CommissionModelVersionNotDraftError", async () => {
      const tenantId = await createTenant("ap5-not-draft");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE" },
      );

      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(commissionModelId, versionId),
        ),
      ).rejects.toThrow(CommissionModelVersionNotDraftError);
    });

    it("Publish eines ungueltigen Drafts (FLAT ohne commissionAmountMinor/recurringCommissionAmountMinor) -> Validierungsfehler, KEINE Transaktion eroeffnet", async () => {
      const tenantId = await createTenant("ap5-invalid-draft");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionAmountMinor: null },
      );

      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(commissionModelId, versionId),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);

      const versionRow = await rawClient.commissionModelVersion.findUnique({
        where: { id: versionId },
      });
      expect(versionRow?.status).toBe("DRAFT");
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionModelVersion", entityId: versionId },
      });
      expect(auditEntries).toHaveLength(0);
    });

    it("ZENTRALER REGRESSIONSTEST (ChatGPT-Vorgabe AP5, 2026-08-21): Cross-Model-Unabhaengigkeit -- Publish von Modell B's Draft laesst Modell A's ACTIVE-Version UNVERAENDERT (kein mandantenweiter Scope wie Phase 9)", async () => {
      const tenantId = await createTenant("ap5-cross-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { commissionModelId: modelA, versionId: versionA } =
        await createCommissionModelWithVersion(tenantId, productA, "cm-a", { status: "ACTIVE" });
      const { commissionModelId: modelB, versionId: versionB } =
        await createCommissionModelWithVersion(tenantId, productB, "cm-b", { status: "DRAFT" });

      const result = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishCommissionModelVersion(modelB, versionB),
      );

      // Modell B's Publish hat KEINE vorherige ACTIVE-Version DESSELBEN
      // Modells (das ist versionB's allererste Version) -- previousActiveVersionId
      // muss null sein, NICHT versionA (das waere der mandantenweite
      // Phase-9-Scope-Fehler).
      expect(result.previousActiveVersionId).toBeNull();

      const rowA = await rawClient.commissionModelVersion.findUnique({ where: { id: versionA } });
      const rowB = await rawClient.commissionModelVersion.findUnique({ where: { id: versionB } });
      expect(
        rowA?.status,
        "Modell A's ACTIVE-Version darf durch Modell B's Publish NICHT beruehrt werden",
      ).toBe("ACTIVE");
      expect(rowB?.status).toBe("ACTIVE");

      expect(modelA).not.toBe(modelB);
    });

    it("Nebenlaeufigkeit: zwei ECHT parallele Publishes VERSCHIEDENER CommissionModels duerfen BEIDE unabhaengig erfolgreich sein (kein falscher Cross-Model-Lock)", async () => {
      const tenantId = await createTenant("ap5-parallel-cross-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productX = await createProduct(tenantId, "px");
      const productY = await createProduct(tenantId, "py");
      const { commissionModelId: modelX, versionId: versionX } =
        await createCommissionModelWithVersion(tenantId, productX, "cm-x", { status: "DRAFT" });
      const { commissionModelId: modelY, versionId: versionY } =
        await createCommissionModelWithVersion(tenantId, productY, "cm-y", { status: "DRAFT" });

      // Bewusst KEIN sequentielles await -- beide gehoeren zu VERSCHIEDENEN
      // CommissionModels, duerfen sich also NICHT gegenseitig serialisieren/
      // blockieren (anders als Test unten fuer DASSELBE CommissionModel).
      const results = await Promise.allSettled([
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(modelX, versionX),
        ),
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(modelY, versionY),
        ),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);

      const rowX = await rawClient.commissionModelVersion.findUnique({ where: { id: versionX } });
      const rowY = await rawClient.commissionModelVersion.findUnique({ where: { id: versionY } });
      expect(rowX?.status).toBe("ACTIVE");
      expect(rowY?.status).toBe("ACTIVE");
    });

    /**
     * DIAGNOSE (analog Phase 9 AP9, "erst beweisen, dann fixen"): bevor der
     * Nebenlaeufigkeitstest unten interpretiert wird, muss belegt sein, DASS
     * der EXCLUDE-Constraint `commission_model_versions_no_overlap` in der
     * CI-Postgres-Instanz ueberhaupt existiert (Migrationsstatus, bereits im
     * init-Migrations-SQL enthalten, siehe
     * prisma/migrations/20260731000000_init/migration.sql) und WIE er
     * tatsaechlich lautet.
     */
    it("DIAGNOSE: EXCLUDE-Constraint commission_model_versions_no_overlap existiert und ist btree_gist-basiert", async () => {
      const constraints = await rawClient.$queryRaw<Array<{ conname: string; definition: string }>>`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'commission_model_versions_no_overlap'
      `;
      expect(constraints).toHaveLength(1);
      const definition = constraints[0]?.definition ?? "";
      expect(definition).toContain("EXCLUDE USING gist");
      expect(definition).toContain("tenant_id");
      expect(definition).toContain("commission_model_id");
      expect(definition).toContain("&&");

      const extensions = await rawClient.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
      `;
      expect(extensions).toHaveLength(1);
    });

    it("Nebenlaeufigkeit: zwei ECHT parallele Publishes DESSELBEN CommissionModels -- CommissionModel-Row-Lock serialisiert korrekt: am Ende genau 1 ACTIVE-Version, jeder erfolgreiche Publish vollstaendig auditiert, keine Dateninkonsistenz (commission_model_versions_no_overlap EXCLUDE-Constraint als Backstop)", async () => {
      const tenantId = await createTenant("ap5-parallel-same-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm-base",
        {
          status: "EXPIRED",
          validFrom: new Date("2020-01-01T00:00:00Z"),
          validTo: new Date("2020-06-01T00:00:00Z"),
        },
      );
      const versionX = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId,
          versionNumber: 2,
          status: "DRAFT",
          validFrom: new Date(),
          validTo: null,
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 1_000,
        },
      });
      const versionY = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId,
          versionNumber: 3,
          status: "DRAFT",
          validFrom: new Date(),
          validTo: null,
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 2_000,
        },
      });

      // Bewusst KEIN sequentielles await -- beide Publish-Aufrufe werden ECHT
      // gleichzeitig gestartet fuer DASSELBE CommissionModel, um den in
      // commission-admin.ts dokumentierten CommissionModel-Row-Lock zu pruefen.
      const results = await Promise.allSettled([
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(commissionModelId, versionX.id),
        ),
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(commissionModelId, versionY.id),
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // DIAGNOSE zuerst erfassen (analog Phase 9 AP9, CI #56), BEVOR scharfe
      // Assertions werfen koennen.
      const finalActiveVersions = await rawClient.commissionModelVersion.findMany({
        where: { tenantId, commissionModelId, status: "ACTIVE" },
      });
      const versionXRow = await rawClient.commissionModelVersion.findUniqueOrThrow({
        where: { id: versionX.id },
      });
      const versionYRow = await rawClient.commissionModelVersion.findUniqueOrThrow({
        where: { id: versionY.id },
      });
      const activateAuditsForDiagnosis = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionModelVersion", action: "ACTIVATE" },
      });
      const diagnosis = JSON.stringify(
        {
          fulfilledCount: fulfilled.length,
          rejectedCount: rejected.length,
          rejectedReasons: rejected.map((r) => (r.status === "rejected" ? String(r.reason) : null)),
          activeCount: finalActiveVersions.length,
          activeVersionIds: finalActiveVersions.map((v) => v.id),
          versionXStatus: versionXRow.status,
          versionYStatus: versionYRow.status,
          activateAuditCount: activateAuditsForDiagnosis.length,
        },
        null,
        2,
      );

      // Kernaussage (analog Phase 9 AP9-Entscheidung): Der CommissionModel-
      // Row-Lock serialisiert alle Publish-Transaktionen DESSELBEN
      // CommissionModel korrekt -- beide unabhaengigen, gueltigen Publish-
      // Anfragen duerfen deshalb BEIDE erfolgreich sein (sequentiell
      // serialisiert). Die verbindliche Invariante: am Ende existiert exakt
      // eine ACTIVE-Version DIESES CommissionModel, und jeder tatsaechlich
      // erfolgreiche Publish ist vollstaendig (und nur einmal) auditiert.
      expect(finalActiveVersions, `Diagnose:\n${diagnosis}`).toHaveLength(1);
      expect(activateAuditsForDiagnosis, `Diagnose:\n${diagnosis}`).toHaveLength(fulfilled.length);

      // Bewusst KEINE Erwartung an eine feste Gewinner-Reihenfolge (X vs. Y).
      const winnerVersionId = finalActiveVersions[0]?.id;
      expect([versionX.id, versionY.id]).toContain(winnerVersionId);
      const loserVersionId = winnerVersionId === versionX.id ? versionY.id : versionX.id;
      const loserRow = await rawClient.commissionModelVersion.findUniqueOrThrow({
        where: { id: loserVersionId },
      });
      if (fulfilled.length === 2) {
        expect(loserRow.status, `Diagnose:\n${diagnosis}`).toBe("EXPIRED");
      } else {
        expect(loserRow.status, `Diagnose:\n${diagnosis}`).not.toBe("ACTIVE");
      }

      for (const r of rejected) {
        if (r.status === "rejected") {
          expect(r.reason).toBeInstanceOf(Error);
        }
      }
    });

    describe("HTTP-Kette", () => {
      it("POST .../publish ohne config.commissions.publish -> 403 (config.commissions.edit reicht NICHT)", async () => {
        const tenantId = await createTenant("ap5-http-403");
        const actorUserId = await createUser(tenantId, "actor");
        const productId = await createProduct(tenantId, "p");
        const { commissionModelId, versionId } = await createCommissionModelWithVersion(
          tenantId,
          productId,
          "cm",
          { status: "DRAFT" },
        );
        const token = createSessionToken({
          ...baseSessionPayload(tenantId, actorUserId),
          configPermissions: ["config.commissions.edit"],
        });
        const response = await publishCommissionModelVersionRoute(
          requestWithCookie(
            `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/publish`,
            token,
            { method: "POST" },
          ),
          routeParams({ id: commissionModelId, versionId }),
        );
        expect(response.status).toBe(403);
      });

      it("POST .../publish mit config.commissions.publish -> 200, Status ACTIVE", async () => {
        const tenantId = await createTenant("ap5-http-200");
        const actorUserId = await createUser(tenantId, "actor");
        const productId = await createProduct(tenantId, "p");
        const { commissionModelId, versionId } = await createCommissionModelWithVersion(
          tenantId,
          productId,
          "cm",
          { status: "DRAFT" },
        );
        const token = createSessionToken({
          ...baseSessionPayload(tenantId, actorUserId),
          configPermissions: ["config.commissions.publish"],
        });
        const response = await publishCommissionModelVersionRoute(
          requestWithCookie(
            `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/publish`,
            token,
            { method: "POST" },
          ),
          routeParams({ id: commissionModelId, versionId }),
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.version.status).toBe("ACTIVE");
        expect(body.previousActiveVersionId).toBeNull();
      });

      it("POST .../publish fuer bereits ACTIVE Version -> 409", async () => {
        const tenantId = await createTenant("ap5-http-409");
        const actorUserId = await createUser(tenantId, "actor");
        const productId = await createProduct(tenantId, "p");
        const { commissionModelId, versionId } = await createCommissionModelWithVersion(
          tenantId,
          productId,
          "cm",
          { status: "ACTIVE" },
        );
        const token = createSessionToken({
          ...baseSessionPayload(tenantId, actorUserId),
          configPermissions: ["config.commissions.publish"],
        });
        const response = await publishCommissionModelVersionRoute(
          requestWithCookie(
            `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/publish`,
            token,
            { method: "POST" },
          ),
          routeParams({ id: commissionModelId, versionId }),
        );
        expect(response.status).toBe(409);
      });

      it("POST .../publish fuer ungueltigen Draft -> 422", async () => {
        const tenantId = await createTenant("ap5-http-422");
        const actorUserId = await createUser(tenantId, "actor");
        const productId = await createProduct(tenantId, "p");
        const { commissionModelId, versionId } = await createCommissionModelWithVersion(
          tenantId,
          productId,
          "cm",
          { status: "DRAFT", commissionAmountMinor: null },
        );
        const token = createSessionToken({
          ...baseSessionPayload(tenantId, actorUserId),
          configPermissions: ["config.commissions.publish"],
        });
        const response = await publishCommissionModelVersionRoute(
          requestWithCookie(
            `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/publish`,
            token,
            { method: "POST" },
          ),
          routeParams({ id: commissionModelId, versionId }),
        );
        expect(response.status).toBe(422);
      });
    });
  });

  // -------------------------------------------------------------------
  // 7. AP7 -- Audit-Atomaritaet gegen tatsaechliche Fehlerpfade +
  //    Cross-Tenant-Isolation des Publish-Workflows (ChatGPT-GO 2026-08-22:
  //    "Mutation + Audit in derselben Transaktion, fehlgeschlagene Mutation
  //    -> kein Audit"; "Cross-Tenant-ID -> sauber 404/403 gemaess
  //    bestehendem Muster"). Kein neuer Feature-Scope -- gezielte
  //    Beweisfuehrung gegen die bereits in AP1-AP5 implementierten
  //    Transaktionsbloecke (siehe commission-admin.ts).
  // -------------------------------------------------------------------
  describe("7. AP7 -- Audit-Atomaritaet + Cross-Tenant", () => {
    it("createCommissionTier() P2002-Konflikt (doppeltes thresholdMinor): die fehlgeschlagene zweite Mutation schreibt KEINEN weiteren AuditLog-Eintrag (Rollback der gesamten Transaktion inkl. Audit)", async () => {
      const tenantId = await createTenant("ap7-audit-atomicity");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "TIERED", commissionAmountMinor: null },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createCommissionTier(commissionModelId, versionId, {
            thresholdMinor: 0,
            tierAmountMinor: 100,
            sortOrder: 0,
          }),
      );
      // Zweiter Versuch mit demselben thresholdMinor -> P2002 -> 422,
      // die GESAMTE Transaktion (inkl. des versuchten AuditLog.create())
      // wird zurueckgerollt.
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createCommissionTier(commissionModelId, versionId, {
              thresholdMinor: 0,
              tierAmountMinor: 200,
              sortOrder: 1,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);

      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionTier" },
      });
      // Genau EIN Eintrag -- vom ERSTEN, erfolgreichen createCommissionTier()-
      // Aufruf. Der fehlgeschlagene zweite Versuch hat keine Spur hinterlassen.
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("CREATE");

      // Auch auf DB-Ebene bestaetigt: nur eine einzige CommissionTier-Zeile
      // existiert tatsaechlich (die zweite wurde nie persistiert).
      const tiers = await rawClient.commissionTier.findMany({
        where: { tenantId, commissionModelVersionId: versionId },
      });
      expect(tiers).toHaveLength(1);
    });

    it("publishCommissionModelVersion() gegen einen ungueltigen Draft: die Revalidierung schlaegt VOR jeder Transaktion fehl -> KEIN AuditLog-Eintrag (ACTIVATE) wird geschrieben", async () => {
      const tenantId = await createTenant("ap7-audit-publish-invalid");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionAmountMinor: null },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(commissionModelId, versionId),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);

      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionModelVersion", entityId: versionId },
      });
      expect(auditEntries).toHaveLength(0);

      const versionRow = await rawClient.commissionModelVersion.findUnique({
        where: { id: versionId },
      });
      expect(versionRow?.status).toBe("DRAFT");
    });

    it("publishCommissionModelVersion() mit commissionModelId aus FREMDEM Mandanten -> CommissionModelNotFoundError, kein Zustand veraendert (Tenant-Isolation, analog validateCommissionModelVersion())", async () => {
      const tenantA = await createTenant("ap7-cross-tenant-a");
      const tenantB = await createTenant("ap7-cross-tenant-b");
      const actorUserId = await createUser(tenantA, "actor");
      const productBId = await createProduct(tenantB, "p");
      const { commissionModelId: commissionModelBId, versionId: versionBId } =
        await createCommissionModelWithVersion(tenantB, productBId, "cm", { status: "DRAFT" });

      // Im TenantContext von Tenant A wird versucht, ein CommissionModel von
      // Tenant B zu publishen -- der tenant-gescopte `db`-Client liefert dafuer
      // strukturell 0 Treffer, unabhaengig davon, dass die IDs real existieren.
      await expect(
        runWithTenantContext(
          { tenantId: tenantA, userId: actorUserId, roles: [], managementScope: null },
          () => publishCommissionModelVersion(commissionModelBId, versionBId),
        ),
      ).rejects.toThrow(CommissionModelNotFoundError);

      // Der Zustand in Tenant B bleibt vollstaendig unveraendert.
      const versionRow = await rawClient.commissionModelVersion.findUnique({
        where: { id: versionBId },
      });
      expect(versionRow?.status).toBe("DRAFT");
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId: tenantB, entityType: "CommissionModelVersion", entityId: versionBId },
      });
      expect(auditEntries).toHaveLength(0);
    });
  });
});
