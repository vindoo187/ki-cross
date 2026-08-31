/**
 * Synthetisches Seed-Skript (Phase 2, erweitert um Phase 3A/3B).
 *
 * Erzeugt AUSSCHLIESSLICH synthetische/fiktive Testdaten (keine echten
 * Kunden-, Mitarbeiter- oder Vertragsdaten), markiert ueberall mit
 * isSynthetic = true bzw. eindeutig fiktiven Namen ("DemoTel ...").
 *
 * Kernzweck: ZWEI unabhaengige Tenants ("demotel-nord", "demotel-sued")
 * anlegen, die strukturell identisch aufgebaut sind, damit die
 * Isolationstests (tests/integration/tenant-isolation.test.ts) exakt
 * pruefen koennen, dass ein Tenant niemals Daten eines anderen Tenants
 * lesen oder referenzieren kann.
 *
 * Phase 3B (siehe PHASE_3B_IMPLEMENTATION_PLAN.md): jeder Tenant erhaelt
 * zusaetzlich drei Produktversionen (S/M/L-Tarif) mit den vier
 * Registry-Attributen aus src/server/recommendation/attribute-registry.ts
 * (dataVolumeGb, pricePlanTier, hasEuRoaming, contractCommitmentMonths)
 * sowie eine ACTIVE RuleSetVersion mit je mindestens einer Eligibility-,
 * Exclusion-, Prioritization- und CrossSelling-Regel inkl. strukturierter
 * Conditions, damit src/server/recommendation/service.ts::evaluate() gegen
 * die Seed-Daten ausgewertet werden kann (siehe scripts/verify_seed_pglite.mjs
 * fuer eine schema-verifizierte SQL-Spiegelung dieses Skripts).
 *
 * Idempotent: Kann mehrfach ausgefuehrt werden (upsert auf eindeutigen
 * Schluesseln wie tenant.key, product.key, ...). Die Phase-3B-Ergaenzungen
 * (weitere ProductVersions, RuleSetVersion-Inhalte, Demo-Recommendation)
 * folgen dem bereits bestehenden Muster ohne Upsert (siehe `product`,
 * `productVersion`, `commissionModel` oben) - ein wiederholter Lauf gegen
 * eine bereits befuellte DB legt daher (wie schon vor dieser Erweiterung)
 * zusaetzliche Zeilen an statt zu aktualisieren.
 */

import { createHash } from "node:crypto";
import { PrismaClient, ProductType, CommissionType, AnswerType, NeedType } from "@prisma/client";
import {
  SEED_ROLE_KEYS,
  permissionKeysForSeedRole,
  type SeedRoleKey,
} from "../src/server/authz/seed-role-permissions";
import { hashPassword } from "../src/server/auth/password";

const prisma = new PrismaClient();

/**
 * Deterministischer Platzhalter-Fingerprint fuer die manuell (nicht ueber
 * src/server/recommendation/service.ts::evaluate()) angelegten Demo-
 * Recommendation-Zeilen unten. `Recommendation.evaluationFingerprint` ist
 * @db.Char(64) (SHA-256-Hexdigest) - hier ohne echte Auswertungseingaben
 * berechnet, da dieser Demo-Datensatz nicht durch die Engine gelaufen ist.
 */
function seedFingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

const RENEWAL_LOOKAHEAD_DAYS_DEFAULT = 180;

// ---------------------------------------------------------------------------
// Globaler Katalog (nicht tenant-gebunden): Provider, Permissions
// ---------------------------------------------------------------------------

async function seedGlobalCatalog() {
  const providers = await Promise.all(
    [
      { key: "o2-telefonica", name: "O2 / Telefonica (synthetisch)" },
      { key: "telekom", name: "Telekom (synthetisch)" },
      { key: "freenet", name: "freenet (synthetisch)" },
    ].map((p) =>
      prisma.provider.upsert({
        where: { key: p.key },
        update: {},
        create: { ...p, isSynthetic: true },
      }),
    ),
  );

  const permissionKeys = [
    "consultation.create",
    "consultation.view_own",
    "consultation.view_store",
    "deal.create",
    "deal.view_own",
    "deal.view_store",
    "analytics.view_store",
    "analytics.view_company",
    "analytics.view_tenant",
    "master_data.manage",
    "user.manage",
    // Phase 8 AP2 (ChatGPT-GO 2026-08-18): Configuration-RBAC fuer die
    // Fragen-/Fragebogen-Administration, siehe
    // src/server/authz/config-permissions.ts. Bewusst drei separate Keys
    // statt eines pauschalen admin.*-Rechts (deny-by-default, publish darf
    // nicht implizit aus edit entstehen).
    "config.questions.view",
    "config.questions.edit",
    "config.questions.publish",
    // Phase 9 AP1 (ChatGPT-GO 2026-08-18): Configuration-RBAC fuer den
    // Regel-Editor, siehe src/server/authz/config-permissions.ts
    // (CONFIG_RULES_PERMISSION_KEYS). Additive Erweiterung derselben
    // config_editor/config_publisher-Rollen wie bei den Fragen-Keys oben
    // (keine neuen Rollen, siehe PHASE_9_IMPLEMENTATION_PLAN.md
    // Abschnitt 2.1).
    "config.rules.view",
    "config.rules.edit",
    "config.rules.publish",
    // Phase 10 AP1 (ChatGPT-GO 2026-08-21): Configuration-RBAC fuer den
    // Provisionsmodell-Editor, siehe src/server/authz/config-permissions.ts
    // (CONFIG_COMMISSIONS_PERMISSION_KEYS). Additive Erweiterung derselben
    // config_editor/config_publisher-Rollen (keine neuen Rollen, siehe
    // PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 3).
    "config.commissions.view",
    "config.commissions.edit",
    "config.commissions.publish",
    // Phase 11 AP1 (ChatGPT finales GO 2026-08-22): Configuration-RBAC fuer
    // die Zielverwaltung, siehe src/server/authz/config-permissions.ts
    // (CONFIG_GOALS_PERMISSION_KEYS). Additive Erweiterung derselben
    // config_editor/config_publisher-Rollen (keine neuen Rollen, siehe
    // PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 7).
    "config.goals.view",
    "config.goals.edit",
    "config.goals.publish",
    // Phase 13 AP1 (Campaign Management, ChatGPT-GO 2026-08-24):
    // Configuration-RBAC fuer die Kampagnenverwaltung, siehe
    // src/server/authz/config-permissions.ts
    // (CONFIG_CAMPAIGNS_PERMISSION_KEYS). Additive Erweiterung derselben
    // config_editor/config_publisher-Rollen (keine neuen Rollen, siehe
    // PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 4).
    "config.campaigns.view",
    "config.campaigns.edit",
    "config.campaigns.publish",
    // Phase 14 AP1 (Sales Playbook, ChatGPT-GO 2026-08-31):
    // Configuration-RBAC fuer die Playbook-Verwaltung, siehe
    // src/server/authz/config-permissions.ts
    // (CONFIG_PLAYBOOKS_PERMISSION_KEYS). Additive Erweiterung derselben
    // config_editor/config_publisher-Rollen (keine neuen Rollen, siehe
    // PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 5).
    "config.playbooks.view",
    "config.playbooks.edit",
    "config.playbooks.publish",
    // Phase 12 AP1 (Freitext-KI-Angebotsfeature, ChatGPT-GO 2026-08-23):
    // Laufzeit-Permission (kein config.*-Namespace, siehe
    // src/server/authz/consultation-permissions.ts) fuer die KI-Extraktion
    // waehrend einer laufenden Beratung. Faellt bei sales_employee automatisch
    // unter den bestehenden Catch-all-Zweig in permissionKeysForSeedRole()
    // (alle Permissions ausser Management-Analytics/config.*), keine
    // Sonderregel noetig.
    "consultation.ai_extraction.use",
  ];
  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Berechtigung: ${key}` },
      }),
    ),
  );

  return { providers, permissions };
}

// ---------------------------------------------------------------------------
// Pro Tenant: vollstaendiger, strukturell identischer Aufbau
// ---------------------------------------------------------------------------

interface TenantConfig {
  key: string;
  name: string;
  companyKey: string;
  companyName: string;
  storeKeys: [string, string];
}

async function seedTenant(
  config: TenantConfig,
  providers: Awaited<ReturnType<typeof seedGlobalCatalog>>["providers"],
  permissions: Awaited<ReturnType<typeof seedGlobalCatalog>>["permissions"],
) {
  const tenant = await prisma.tenant.upsert({
    where: { key: config.key },
    update: {},
    create: { key: config.key, name: config.name, isSynthetic: true },
  });

  const company = await prisma.company.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: config.companyKey } },
    update: {},
    create: { tenantId: tenant.id, key: config.companyKey, name: config.companyName },
  });

  const stores = await Promise.all(
    config.storeKeys.map((storeKey, i) =>
      prisma.store.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: storeKey } },
        update: {},
        create: {
          tenantId: tenant.id,
          companyId: company.id,
          key: storeKey,
          name: `${config.companyName} Filiale ${i + 1}`,
        },
      }),
    ),
  );

  // --- Rollen & Zuweisung ---
  //
  // Phase 7 AP1 (Bugfix, ChatGPT-GO 2026-08-17): die drei
  // Management-Analytics-Permissions (analytics.view_store/_company/_tenant)
  // wurden zuvor pauschal an sales_employee vergeben (jeder normale
  // Verkaufsberater haette dadurch die neue Management-Autorisierung
  // bestanden) und store_admin bekam gar keine Permission. Die verbindliche
  // Rollentabelle (sales_employee -> keine Management-Analytics, store_admin
  // -> STORE, company_management -> COMPANY, executive_management -> TENANT)
  // ist in `src/server/authz/seed-role-permissions.ts::permissionKeysForSeedRole()`
  // ausgelagert -- rein, ohne DB-Zugriff, damit
  // `tests/unit/authz/seed-role-permissions.test.ts` ein erneutes
  // Falsch-Seeden verhindert (ChatGPT-Auflage, siehe
  // PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).

  const adminRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "store_admin" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "store_admin",
      name: "Filialleitung",
      isSystemDefined: true,
    },
  });
  const salesRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "sales_employee" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "sales_employee",
      name: "Verkaufsberater:in",
      isSystemDefined: true,
    },
  });
  const companyManagementRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "company_management" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "company_management",
      name: "Prokurist/Regionalleitung",
      isSystemDefined: true,
    },
  });
  const executiveManagementRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "executive_management" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "executive_management",
      name: "Geschaeftsfuehrung",
      isSystemDefined: true,
    },
  });
  // Phase 8 AP2 (ChatGPT-GO 2026-08-18): Configuration-RBAC-Rollen fuer die
  // Fragen-/Fragebogen-Administration -- getrennt von den Management-
  // Analytics-Rollen oben (eigene, unabhaengige RBAC-Architektur, siehe
  // PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.2).
  const configEditorRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "config_editor" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "config_editor",
      name: "Fachadministration (Entwurf)",
      isSystemDefined: true,
    },
  });
  const configPublisherRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "config_publisher" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "config_publisher",
      name: "Fachadministration (Veroeffentlichung)",
      isSystemDefined: true,
    },
  });

  const allPermissionKeys = permissions.map((p) => p.key);
  const roleByKey: Record<SeedRoleKey, { id: string }> = {
    sales_employee: salesRole,
    store_admin: adminRole,
    company_management: companyManagementRole,
    executive_management: executiveManagementRole,
    config_editor: configEditorRole,
    config_publisher: configPublisherRole,
  };

  for (const roleKey of SEED_ROLE_KEYS) {
    const role = roleByKey[roleKey];
    const grantedKeys = permissionKeysForSeedRole(roleKey, allPermissionKeys);
    for (const key of grantedKeys) {
      const permission = permissions.find((p) => p.key === key);
      if (!permission) {
        throw new Error(`Seed-Fehler: Permission "${key}" nicht im globalen Katalog gefunden.`);
      }
      await prisma.rolePermission
        .upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        })
        .catch(() => undefined);
    }
  }

  // --- Mitarbeitende ---
  const employees = await Promise.all(
    stores.map(async (store, i) => {
      const user = await prisma.user.upsert({
        where: {
          tenantId_email: {
            tenantId: tenant.id,
            email: `${config.key}-mitarbeiter${i + 1}@example-synthetic.test`,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          email: `${config.key}-mitarbeiter${i + 1}@example-synthetic.test`,
          isSynthetic: true,
        },
      });
      return prisma.employee.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: {},
        create: {
          tenantId: tenant.id,
          storeId: store.id,
          userId: user.id,
          displayName: `Synthetische:r Mitarbeiter:in ${i + 1} (${config.key})`,
        },
      });
    }),
  );

  await prisma.roleAssignment
    .create({
      data: {
        tenantId: tenant.id,
        userId: employees[0]!.userId!,
        roleId: adminRole.id,
        scopeType: "STORE",
        companyId: company.id,
        storeId: stores[0]!.id,
      },
    })
    .catch(() => undefined);

  // --- Management-Testnutzer (Phase 7 AP1) ---
  // Eigene synthetische Mitarbeiter fuer COMPANY-/TENANT-Scope, damit beide
  // Stufen ueber den Dev-Login tatsaechlich testbar sind (die bestehenden
  // zwei Verkaufsberater:innen oben decken nur STORE/keine Berechtigung ab).
  const companyManagerUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: `${config.key}-prokurist@example-synthetic.test`,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: `${config.key}-prokurist@example-synthetic.test`,
      isSynthetic: true,
    },
  });
  const companyManagerEmployee = await prisma.employee.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: companyManagerUser.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      userId: companyManagerUser.id,
      displayName: `Synthetische:r Prokurist:in (${config.key})`,
    },
  });
  await prisma.roleAssignment
    .create({
      data: {
        tenantId: tenant.id,
        userId: companyManagerEmployee.userId!,
        roleId: companyManagementRole.id,
        scopeType: "COMPANY",
        companyId: company.id,
        storeId: null,
      },
    })
    .catch(() => undefined);

  const executiveUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: `${config.key}-geschaeftsfuehrung@example-synthetic.test`,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: `${config.key}-geschaeftsfuehrung@example-synthetic.test`,
      isSynthetic: true,
    },
  });
  const executiveEmployee = await prisma.employee.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: executiveUser.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      userId: executiveUser.id,
      displayName: `Synthetische Geschaeftsfuehrung (${config.key})`,
    },
  });
  await prisma.roleAssignment
    .create({
      data: {
        tenantId: tenant.id,
        userId: executiveEmployee.userId!,
        roleId: executiveManagementRole.id,
        scopeType: "TENANT",
        companyId: null,
        storeId: null,
      },
    })
    .catch(() => undefined);

  // --- Admin-/Konfigurations-Testnutzer (Phase 8 AP1/AP2) ---
  // Synthetischer Admin-Testnutzer OHNE jede config.*-RoleAssignment --
  // dient als bewusste Negativ-Fixture fuer deny-by-default (gesetztes
  // Passwort, aber keine Fragen-Administrationsrechte). Erhaelt wie jeder
  // synthetische Nutzer einen Employee-Datensatz (notwendig, weil
  // SessionPayload employeeId/storeId voraussetzt). Test-Passwort ist
  // bewusst klar als synthetisch gekennzeichnet, kein echtes Secret, NICHT
  // produktionsreif (siehe src/server/auth/errors.ts).
  const adminTestPassword = "synthetic-admin-test-passwort-2026";
  const adminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: `${config.key}-admin@example-synthetic.test`,
      },
    },
    update: { passwordHash: hashPassword(adminTestPassword) },
    create: {
      tenantId: tenant.id,
      email: `${config.key}-admin@example-synthetic.test`,
      isSynthetic: true,
      passwordHash: hashPassword(adminTestPassword),
    },
  });
  await prisma.employee.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: adminUser.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      userId: adminUser.id,
      displayName: `Synthetische:r Admin:in ohne Config-Rechte (${config.key})`,
    },
  });

  // config_editor-Testnutzer: darf Entwuerfe erstellen/aendern, aber NICHT
  // veroeffentlichen (config.questions.view+.edit UND seit Phase 9 AP1
  // config.rules.view+.edit, kein .publish in beiden Bereichen).
  const configEditorUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: `${config.key}-config-editor@example-synthetic.test`,
      },
    },
    update: { passwordHash: hashPassword(adminTestPassword) },
    create: {
      tenantId: tenant.id,
      email: `${config.key}-config-editor@example-synthetic.test`,
      isSynthetic: true,
      passwordHash: hashPassword(adminTestPassword),
    },
  });
  const configEditorEmployee = await prisma.employee.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: configEditorUser.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      userId: configEditorUser.id,
      displayName: `Synthetische:r Fragen-Editor:in (${config.key})`,
    },
  });
  await prisma.roleAssignment
    .create({
      data: {
        tenantId: tenant.id,
        userId: configEditorEmployee.userId!,
        roleId: configEditorRole.id,
        scopeType: "TENANT",
        companyId: null,
        storeId: null,
      },
    })
    .catch(() => undefined);

  // config_publisher-Testnutzer: darf zusaetzlich veroeffentlichen
  // (alle sechs config.questions.*/config.rules.*-Permissions, siehe
  // ALL_CONFIG_PERMISSION_KEYS).
  const configPublisherUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: `${config.key}-config-publisher@example-synthetic.test`,
      },
    },
    update: { passwordHash: hashPassword(adminTestPassword) },
    create: {
      tenantId: tenant.id,
      email: `${config.key}-config-publisher@example-synthetic.test`,
      isSynthetic: true,
      passwordHash: hashPassword(adminTestPassword),
    },
  });
  const configPublisherEmployee = await prisma.employee.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: configPublisherUser.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      userId: configPublisherUser.id,
      displayName: `Synthetische:r Fragen-Publisher:in (${config.key})`,
    },
  });
  await prisma.roleAssignment
    .create({
      data: {
        tenantId: tenant.id,
        userId: configPublisherEmployee.userId!,
        roleId: configPublisherRole.id,
        scopeType: "TENANT",
        companyId: null,
        storeId: null,
      },
    })
    .catch(() => undefined);

  // --- Produktkatalog (tenant-eigene Kategorien/Produkte, globaler Provider) ---
  const category = await prisma.productCategory.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "mobilfunk" } },
    update: {},
    create: { tenantId: tenant.id, key: "mobilfunk", name: "Mobilfunk" },
  });

  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      providerId: providers[0]!.id,
      categoryId: category.id,
      productType: ProductType.MOBILE_NEW_CONTRACT,
      name: "DemoTel Mobil M (synthetisch)",
      isSynthetic: true,
    },
  });

  const productVersion = await prisma.productVersion.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      currency: "EUR",
      monthlyPriceMinor: 2999,
      oneTimePriceMinor: 0,
      contractMonths: 24,
    },
  });

  await prisma.tariffAttribute.createMany({
    data: [
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "data_gb",
        attributeValue: "20",
        valueType: "number",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "5g",
        attributeValue: "true",
        valueType: "boolean",
      },
      // Phase 3B: Attribute-Keys aus der geschlossenen Registry (siehe
      // src/server/recommendation/attribute-registry.ts,
      // PRODUCT_ATTRIBUTE_DEFINITIONS) - zusaetzlich zu den obigen
      // Legacy-Keys ("data_gb"/"5g"), die von der Regel-Engine nicht
      // gelesen werden.
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "dataVolumeGb",
        attributeValue: "20",
        valueType: "number",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "pricePlanTier",
        attributeValue: "STANDARD",
        valueType: "string",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "hasEuRoaming",
        attributeValue: "true",
        valueType: "boolean",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "contractCommitmentMonths",
        attributeValue: "24",
        valueType: "number",
      },
    ],
  });

  const commissionModel = await prisma.commissionModel.create({
    data: { tenantId: tenant.id, productId: product.id, name: "Standardprovision Mobil M" },
  });
  await prisma.commissionModelVersion.create({
    data: {
      tenantId: tenant.id,
      commissionModelId: commissionModel.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 3000,
      recurringCommissionAmountMinor: 100,
    },
  });

  // --- Phase 3B: zwei weitere Produktversionen (S/L-Tarif), damit die
  // Eligibility-/Exclusion-/Prioritization-/CrossSelling-Regeln unten
  // tatsaechlich zwischen mehreren ProductVersions unterscheiden koennen
  // (siehe PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.1/3.3/3.5). ---
  const productS = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      providerId: providers[0]!.id,
      categoryId: category.id,
      productType: ProductType.MOBILE_NEW_CONTRACT,
      name: "DemoTel Mobil S (synthetisch)",
      isSynthetic: true,
    },
  });
  const productVersionS = await prisma.productVersion.create({
    data: {
      tenantId: tenant.id,
      productId: productS.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      currency: "EUR",
      monthlyPriceMinor: 1499,
      oneTimePriceMinor: 0,
      contractMonths: 24,
    },
  });
  await prisma.tariffAttribute.createMany({
    data: [
      {
        tenantId: tenant.id,
        productVersionId: productVersionS.id,
        attributeKey: "dataVolumeGb",
        attributeValue: "5",
        valueType: "number",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersionS.id,
        attributeKey: "pricePlanTier",
        attributeValue: "BASIC",
        valueType: "string",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersionS.id,
        attributeKey: "hasEuRoaming",
        attributeValue: "false",
        valueType: "boolean",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersionS.id,
        attributeKey: "contractCommitmentMonths",
        attributeValue: "24",
        valueType: "number",
      },
    ],
  });
  const commissionModelS = await prisma.commissionModel.create({
    data: { tenantId: tenant.id, productId: productS.id, name: "Standardprovision Mobil S" },
  });
  await prisma.commissionModelVersion.create({
    data: {
      tenantId: tenant.id,
      commissionModelId: commissionModelS.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 1500,
      recurringCommissionAmountMinor: 50,
    },
  });

  const productL = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      providerId: providers[0]!.id,
      categoryId: category.id,
      productType: ProductType.MOBILE_NEW_CONTRACT,
      name: "DemoTel Mobil L (synthetisch)",
      isSynthetic: true,
    },
  });
  const productVersionL = await prisma.productVersion.create({
    data: {
      tenantId: tenant.id,
      productId: productL.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      currency: "EUR",
      monthlyPriceMinor: 4499,
      oneTimePriceMinor: 0,
      contractMonths: 24,
    },
  });
  await prisma.tariffAttribute.createMany({
    data: [
      {
        tenantId: tenant.id,
        productVersionId: productVersionL.id,
        attributeKey: "dataVolumeGb",
        attributeValue: "50",
        valueType: "number",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersionL.id,
        attributeKey: "pricePlanTier",
        attributeValue: "PREMIUM",
        valueType: "string",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersionL.id,
        attributeKey: "hasEuRoaming",
        attributeValue: "true",
        valueType: "boolean",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersionL.id,
        attributeKey: "contractCommitmentMonths",
        attributeValue: "24",
        valueType: "number",
      },
    ],
  });
  const commissionModelL = await prisma.commissionModel.create({
    data: { tenantId: tenant.id, productId: productL.id, name: "Standardprovision Mobil L" },
  });
  await prisma.commissionModelVersion.create({
    data: {
      tenantId: tenant.id,
      commissionModelId: commissionModelL.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 5000,
      recurringCommissionAmountMinor: 200,
    },
  });

  // --- Fix 4 (ChatGPT-Konsultation 2026-08-06): begrenztes, synthetisches
  // DSL-Testprodukt fuer das DSL-Cross-Selling-Szenario weiter unten. Bewusst
  // KEIN vollstaendiger Telekom-/O2-DSL-Produktkatalog -- nur ein einzelnes
  // Produkt, referenziert ueber CrossSellingRule.suggestedProductVersionId.
  // Wird NICHT in der Haupt-Tarifempfehlung angezeigt (buildConsultationRecommendationView
  // filtert dort auf eligibilityPassed, Cross-Selling-Signale durchlaufen
  // diesen Filter nicht), auch wenn die mobilfunkspezifische
  // "ausreichendesDatenvolumen"-Regel (dataVolumeGb) fuer dieses Produkt
  // mangels passendem Attribut nicht erfuellt ist -- das ist hier unschaedlich.
  const productDsl = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      providerId: providers[0]!.id,
      categoryId: category.id,
      productType: ProductType.DSL,
      name: "DemoTel Home DSL 100 (synthetisch)",
      isSynthetic: true,
    },
  });
  const productVersionDsl = await prisma.productVersion.create({
    data: {
      tenantId: tenant.id,
      productId: productDsl.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      currency: "EUR",
      monthlyPriceMinor: 2499,
      oneTimePriceMinor: 0,
      contractMonths: 24,
    },
  });
  await prisma.tariffAttribute.create({
    data: {
      tenantId: tenant.id,
      productVersionId: productVersionDsl.id,
      attributeKey: "bandwidth_mbit",
      attributeValue: "100",
      valueType: "number",
    },
  });
  const commissionModelDsl = await prisma.commissionModel.create({
    data: { tenantId: tenant.id, productId: productDsl.id, name: "Standardprovision Home DSL" },
  });
  await prisma.commissionModelVersion.create({
    data: {
      tenantId: tenant.id,
      commissionModelId: commissionModelDsl.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 2000,
      recurringCommissionAmountMinor: 100,
    },
  });

  // --- Konfigurierbarer Schwellenwert (Renewal-Lookahead, seed = 180 Tage) ---
  await prisma.configurableThreshold.upsert({
    where: {
      tenantId_key_validFrom: {
        tenantId: tenant.id,
        key: "renewal_lookahead_days",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "renewal_lookahead_days",
      value: String(RENEWAL_LOOKAHEAD_DAYS_DEFAULT),
      validFrom: new Date("2026-01-01T00:00:00Z"),
    },
  });

  // --- Fragebogen (minimal, ein Bedarfsfeld) ---
  const questionnaire = await prisma.questionnaire.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "basisberatung" } },
    update: {},
    create: { tenantId: tenant.id, key: "basisberatung" },
  });
  const questionnaireVersion = await prisma.questionnaireVersion.create({
    data: {
      tenantId: tenant.id,
      questionnaireId: questionnaire.id,
      label: "Basisberatung v1",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  const question = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "hat_streaming_bedarf",
      needType: NeedType.STREAMING,
      sortOrder: 1,
    },
  });
  const questionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: question.id,
      label: "Interessieren Sie sich fuer ein Streaming-Paket?",
      answerType: AnswerType.BOOLEAN,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  // --- Fragebogen (erweitert): weitere AnswerTypes + Sichtbarkeits-Branching ---

  const tarifTypQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "bevorzugter_tarif_typ",
      sortOrder: 2,
    },
  });
  const tarifTypQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: tarifTypQuestion.id,
      label: "Welchen Tarif-Typ bevorzugen Sie?",
      answerType: AnswerType.SINGLE_CHOICE,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "prepaid",
        label: "Prepaid",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "vertrag",
        label: "Vertrag",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "family",
        label: "Family-Tarif",
        sortOrder: 3,
      },
    ],
  });

  const zusatzleistungenQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "gewuenschte_zusatzleistungen",
      sortOrder: 3,
    },
  });
  const zusatzleistungenQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: zusatzleistungenQuestion.id,
      label: "Welche Zusatzleistungen interessieren Sie?",
      answerType: AnswerType.MULTIPLE_CHOICE,
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: zusatzleistungenQuestionVersion.id,
        key: "geraeteschutz",
        label: "Geraeteschutz",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: zusatzleistungenQuestionVersion.id,
        key: "auslandsflat",
        label: "Auslandsflat",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: zusatzleistungenQuestionVersion.id,
        key: "cloud_speicher",
        label: "Cloud-Speicher",
        sortOrder: 3,
      },
    ],
  });

  const simKartenQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "anzahl_sim_karten",
      sortOrder: 4,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: simKartenQuestion.id,
      label: "Wie viele SIM-Karten benoetigen Sie?",
      answerType: AnswerType.INTEGER,
      isRequired: false,
      minValue: 1,
      maxValue: 10,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const budgetQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "monatliches_budget",
      sortOrder: 5,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: budgetQuestion.id,
      label: "Wie viel moechten Sie monatlich ausgeben (EUR)?",
      answerType: AnswerType.DECIMAL,
      isRequired: false,
      minValue: 0,
      maxValue: 200,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const aktuellerAnbieterQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "aktueller_anbieter",
      sortOrder: 6,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: aktuellerAnbieterQuestion.id,
      label: "Wer ist Ihr aktueller Anbieter?",
      answerType: AnswerType.SHORT_TEXT,
      isRequired: false,
      maxLength: 100,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const wunschterminQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "wunschtermin_wechsel",
      sortOrder: 7,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: wunschterminQuestion.id,
      label: "Zu welchem Termin moechten Sie wechseln?",
      answerType: AnswerType.DATE,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  // Sichtbarkeits-Branching: diese Frage ist nur sichtbar, wenn
  // "hat_streaming_bedarf" (siehe oben) mit "true" beantwortet wurde.
  const streamingPaketQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "bevorzugtes_streaming_paket",
      needType: NeedType.STREAMING,
      sortOrder: 8,
    },
  });
  const streamingPaketQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: streamingPaketQuestion.id,
      // Fix 5 (ChatGPT-Konsultation 2026-08-07): Mehrfachauswahl statt
      // Einfachauswahl -- Label entsprechend pluralisiert (Kunden koennen
      // mehrere Streaming-Anbieter gleichzeitig nutzen wollen).
      label: "Welche Streaming-Pakete interessieren Sie?",
      answerType: AnswerType.MULTIPLE_CHOICE,
      isRequired: false,
      minSelections: 1,
      maxSelections: 3,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "netflix",
        label: "Netflix",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "disney_plus",
        label: "Disney+",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "amazon_prime",
        label: "Amazon Prime Video",
        sortOrder: 3,
      },
    ],
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId: tenant.id,
      questionVersionId: streamingPaketQuestionVersion.id,
      targetQuestionId: question.id,
      operator: "EQUALS",
      comparisonValue: "true",
      combinator: "AND",
    },
  });

  // --- Fix 3 (ChatGPT-Konsultation 2026-08-06): drei weitere, fachlich
  // unterschiedliche Fragenpfade mit eigenem Sichtbarkeits-Branching, damit
  // die Fragen-Engine im manuellen Test/AP15 tatsaechlich als dynamisch
  // wahrgenommen wird (vorher gab es ausser Streaming keine weitere
  // VisibilityCondition). Die Fragen-Engine selbst wird dafuer NICHT
  // veraendert -- nur zusaetzliche Seed-Fragen/-Bedingungen nach demselben,
  // bereits bestehenden Muster (siehe streamingPaketQuestion oben).

  // Pfad 2: Smartphone-Bedarf -> Geraeteklasse-Folgefrage.
  const smartphoneQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "smartphone_benoetigt",
      sortOrder: 9,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: smartphoneQuestion.id,
      label: "Benoetigen Sie ein neues Smartphone?",
      answerType: AnswerType.BOOLEAN,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const smartphoneGeraeteklasseQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "smartphone_geraeteklasse",
      sortOrder: 10,
    },
  });
  const smartphoneGeraeteklasseQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: smartphoneGeraeteklasseQuestion.id,
      // Fix 5 (ChatGPT-Konsultation 2026-08-07): Mehrfachauswahl statt
      // Einfachauswahl -- Label entsprechend pluralisiert.
      label: "Welche Geraeteklassen kommen fuer Sie infrage?",
      answerType: AnswerType.MULTIPLE_CHOICE,
      isRequired: false,
      minSelections: 1,
      maxSelections: 3,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: smartphoneGeraeteklasseQuestionVersion.id,
        key: "einsteiger",
        label: "Einsteigerklasse",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: smartphoneGeraeteklasseQuestionVersion.id,
        key: "mittelklasse",
        label: "Mittelklasse",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: smartphoneGeraeteklasseQuestionVersion.id,
        key: "premium",
        label: "Premiumklasse",
        sortOrder: 3,
      },
    ],
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId: tenant.id,
      questionVersionId: smartphoneGeraeteklasseQuestionVersion.id,
      targetQuestionId: smartphoneQuestion.id,
      operator: "EQUALS",
      comparisonValue: "true",
      combinator: "AND",
    },
  });

  // Pfad 3: Rufnummernmitnahme -> Portierungs-Folgefrage.
  const rufnummerMitnehmenQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "rufnummer_mitnehmen",
      sortOrder: 11,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: rufnummerMitnehmenQuestion.id,
      label: "Moechten Sie Ihre bisherige Rufnummer mitnehmen (Portierung)?",
      answerType: AnswerType.BOOLEAN,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const rufnummerAnbieterQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "rufnummer_bisheriger_anbieter",
      sortOrder: 12,
    },
  });
  const rufnummerAnbieterQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: rufnummerAnbieterQuestion.id,
      label: "Bei welchem Anbieter ist Ihre aktuelle Rufnummer registriert?",
      answerType: AnswerType.SHORT_TEXT,
      isRequired: false,
      maxLength: 100,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId: tenant.id,
      questionVersionId: rufnummerAnbieterQuestionVersion.id,
      targetQuestionId: rufnummerMitnehmenQuestion.id,
      operator: "EQUALS",
      comparisonValue: "true",
      combinator: "AND",
    },
  });

  // Pfad 4: DSL-/Internet-zuhause-Bedarf -> Bandbreiten-Folgefrage. Traegt
  // needType DSL, damit die CrossSellingRuleCondition unten (Fix 4) per
  // ANSWER-Bedingung darauf verweisen kann (analog hat_streaming_bedarf).
  const dslBedarfQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "dsl_bedarf",
      needType: NeedType.DSL,
      sortOrder: 13,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: dslBedarfQuestion.id,
      label: "Interessieren Sie sich zusaetzlich fuer einen Internetanschluss (DSL) zuhause?",
      answerType: AnswerType.BOOLEAN,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const dslBandbreiteQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "dsl_bevorzugte_bandbreite",
      sortOrder: 14,
    },
  });
  const dslBandbreiteQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: dslBandbreiteQuestion.id,
      // Fix 5 (ChatGPT-Konsultation 2026-08-07): Mehrfachauswahl statt
      // Einfachauswahl -- Label auf "welche Bandbreiten kommen infrage"
      // umformuliert, damit die Mehrfachauswahl semantisch nicht
      // widerspruechlich wirkt (ChatGPT-Vorschlag).
      label: "Welche Bandbreiten kommen fuer Sie infrage?",
      answerType: AnswerType.MULTIPLE_CHOICE,
      isRequired: false,
      minSelections: 1,
      maxSelections: 3,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: dslBandbreiteQuestionVersion.id,
        key: "bis_50",
        label: "bis 50 Mbit/s",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: dslBandbreiteQuestionVersion.id,
        key: "bis_100",
        label: "bis 100 Mbit/s",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: dslBandbreiteQuestionVersion.id,
        key: "bis_250",
        label: "bis 250 Mbit/s",
        sortOrder: 3,
      },
    ],
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId: tenant.id,
      questionVersionId: dslBandbreiteQuestionVersion.id,
      targetQuestionId: dslBedarfQuestion.id,
      operator: "EQUALS",
      comparisonValue: "true",
      combinator: "AND",
    },
  });

  // --- Regelsatz (Phase 3B: strukturierte Eligibility-/Exclusion-/
  // Prioritization-/CrossSelling-Regeln mit Conditions, siehe
  // PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.1-3.4). Genau eine ACTIVE
  // RuleSetVersion je Tenant (EXCLUDE-Constraint
  // rule_set_versions_tenant_active_no_overlap). ---
  const ruleSet = await prisma.ruleSet.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "standardregeln" } },
    update: {},
    create: { tenantId: tenant.id, key: "standardregeln" },
  });
  const ruleSetVersion = await prisma.ruleSetVersion.create({
    data: {
      tenantId: tenant.id,
      ruleSetId: ruleSet.id,
      label: "Standardregeln v1",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  // Hartes Gate ohne echte Einschraenkung (Platzhalter aus Phase 2,
  // `expression` -> `legacyExpression` umbenannt; keine strukturierten
  // Conditions = immer erfuellt, siehe conditions.ts::evaluateConditionGroups).
  await prisma.eligibilityRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "mind_18",
      description: "Kunde ist volljaehrig (synthetische Platzhalterregel)",
      legacyExpression: "true",
    },
  });

  // Hartes Gate ueber ein echtes PRODUCT_ATTRIBUTE: alle drei Demo-Tarife
  // (S=5, M=20, L=50 GB) erfuellen dies, demonstriert aber einen echten
  // PRODUCT_ATTRIBUTE-Vergleich ohne die Empfehlung einzuschraenken.
  const ausreichendesDatenvolumen = await prisma.eligibilityRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "ausreichendes_datenvolumen",
      description: "Produkt bietet mindestens 5 GB Datenvolumen",
      isRequired: true,
    },
  });
  await prisma.eligibilityRuleCondition.create({
    data: {
      tenantId: tenant.id,
      eligibilityRuleId: ausreichendesDatenvolumen.id,
      groupIndex: 0,
      sourceType: "PRODUCT_ATTRIBUTE",
      attributeKey: "dataVolumeGb",
      operator: "GREATER_THAN_OR_EQUAL",
      comparisonValue: "5",
    },
  });

  // Weiche Regel (isRequired=false): fliesst gewichtet in
  // RecommendationItem.customerFitScore ein statt eligibilityPassed zu
  // beeinflussen. Kombiniert ANSWER (Streaming-Bedarf) UND PRODUCT_ATTRIBUTE
  // (EU-Roaming) per gleichem groupIndex (UND-Verknuepfung).
  const roamingPasstZuBedarf = await prisma.eligibilityRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "roaming_passt_zu_streaming_bedarf",
      description: "Streaming-interessierte Kunden profitieren von EU-Roaming",
      isRequired: false,
      fitWeight: 60,
    },
  });
  await prisma.eligibilityRuleCondition.createMany({
    data: [
      {
        tenantId: tenant.id,
        eligibilityRuleId: roamingPasstZuBedarf.id,
        groupIndex: 0,
        sourceType: "ANSWER",
        questionId: question.id,
        operator: "EQUALS",
        comparisonValue: "true",
      },
      {
        tenantId: tenant.id,
        eligibilityRuleId: roamingPasstZuBedarf.id,
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        attributeKey: "hasEuRoaming",
        operator: "EQUALS",
        comparisonValue: "true",
      },
    ],
  });

  // Exclusion-Regel: bei Vertragsverlaengerung (SESSION_ATTRIBUTE) wird der
  // PREMIUM-Tarif (PRODUCT_ATTRIBUTE) zunaechst ausgeschlossen.
  const renewalKeinPremium = await prisma.exclusionRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "renewal_kein_premium",
      reasonCode: "RENEWAL_NO_PREMIUM_TIER",
      description: "Bei Vertragsverlaengerung wird der PREMIUM-Tarif zunaechst nicht empfohlen",
    },
  });
  await prisma.exclusionRuleCondition.createMany({
    data: [
      {
        tenantId: tenant.id,
        exclusionRuleId: renewalKeinPremium.id,
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "consultationType",
        operator: "EQUALS",
        comparisonValue: "RENEWAL",
      },
      {
        tenantId: tenant.id,
        exclusionRuleId: renewalKeinPremium.id,
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        attributeKey: "pricePlanTier",
        operator: "EQUALS",
        comparisonValue: "PREMIUM",
      },
    ],
  });

  // Prioritization-Regel: Bonus fuer EU-Roaming-faehige Produkte.
  const bonusEuRoaming = await prisma.prioritizationRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "bonus_eu_roaming",
      description: "Bonus fuer Produkte mit EU-Roaming",
      weight: 30,
      commissionRequired: false,
    },
  });
  await prisma.prioritizationRuleCondition.create({
    data: {
      tenantId: tenant.id,
      prioritizationRuleId: bonusEuRoaming.id,
      groupIndex: 0,
      sourceType: "PRODUCT_ATTRIBUTE",
      attributeKey: "hasEuRoaming",
      operator: "EQUALS",
      comparisonValue: "true",
    },
  });

  // Prioritization-Regel mit commissionRequired=true (uebt den strikten
  // Provisions-Aufloesungspfad aus, siehe service.ts::buildResolveCommission
  // - alle drei Demo-Tarife haben eine aktive CommissionModelVersion, der
  // Pfad schlaegt hier also nie fehl).
  const bonusNeuvertragPremium = await prisma.prioritizationRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "bonus_neuvertrag_premium",
      description: "Bonus fuer PREMIUM-Tarif bei Neuvertrag",
      weight: 20,
      commissionRequired: true,
    },
  });
  await prisma.prioritizationRuleCondition.createMany({
    data: [
      {
        tenantId: tenant.id,
        prioritizationRuleId: bonusNeuvertragPremium.id,
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "consultationType",
        operator: "EQUALS",
        comparisonValue: "NEW_CONTRACT",
      },
      {
        tenantId: tenant.id,
        prioritizationRuleId: bonusNeuvertragPremium.id,
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        attributeKey: "pricePlanTier",
        operator: "EQUALS",
        comparisonValue: "PREMIUM",
      },
    ],
  });

  // Cross-Selling-Regel: Streaming-Zusatzpaket-Signal bei entsprechendem
  // Bedarf (matcht die unten angelegte Beispiel-Antwort auf
  // "hat_streaming_bedarf").
  const streamingZusatzpaket = await prisma.crossSellingRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "streaming_zusatzpaket",
      description: "Cross-Selling-Signal fuer ein Streaming-Zusatzpaket",
      needType: NeedType.STREAMING,
      priority: 70,
      reasonCode: "STREAMING_ADDON_SUGGESTED",
    },
  });
  await prisma.crossSellingRuleCondition.create({
    data: {
      tenantId: tenant.id,
      crossSellingRuleId: streamingZusatzpaket.id,
      groupIndex: 0,
      sourceType: "ANSWER",
      questionId: question.id,
      operator: "EQUALS",
      comparisonValue: "true",
    },
  });

  // Fix 4 (ChatGPT-Konsultation 2026-08-06): Cross-Selling-Regel fuer das
  // DSL-Testprodukt oben, matcht die "dsl_bedarf"-Antwort (Fix 3). Analog zum
  // Streaming-Muster darueber, zusaetzlich mit suggestedProductVersionId.
  const dslZusatzpaket = await prisma.crossSellingRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "dsl_zusatzpaket",
      description: "Cross-Selling-Signal fuer einen DSL-Internetanschluss",
      needType: NeedType.DSL,
      priority: 65,
      reasonCode: "DSL_ADDON_SUGGESTED",
      suggestedProductVersionId: productVersionDsl.id,
    },
  });
  await prisma.crossSellingRuleCondition.create({
    data: {
      tenantId: tenant.id,
      crossSellingRuleId: dslZusatzpaket.id,
      groupIndex: 0,
      sourceType: "ANSWER",
      questionId: dslBedarfQuestion.id,
      operator: "EQUALS",
      comparisonValue: "true",
    },
  });

  // --- Pseudonymer Kundenbezug (kein echter Name) ---
  const customerReference = await prisma.customerReference.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      displayCode: `${config.key.toUpperCase()}-K-0001`,
    },
  });

  // --- Beratungssitzung -> Bedarf -> Opportunity -> Empfehlung -> Deal ---
  const session = await prisma.consultationSession.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      customerReferenceId: customerReference.id,
      questionnaireVersionId: questionnaireVersion.id,
      consultationType: "NEW_CONTRACT",
      status: "COMPLETED",
      startedAt: new Date("2026-07-15T09:00:00Z"),
      endedAt: new Date("2026-07-15T09:20:00Z"),
      dataCompletenessScore: 0.9,
    },
  });

  await prisma.consultationTopic.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      topicKey: NeedType.STREAMING,
      openedAt: new Date("2026-07-15T09:05:00Z"),
      closedAt: new Date("2026-07-15T09:08:00Z"),
    },
  });

  await prisma.customerAnswer.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      questionVersionId: questionVersion.id,
      answerType: AnswerType.BOOLEAN,
      booleanValue: true,
      answeredAt: new Date("2026-07-15T09:06:00Z"),
    },
  });

  // source=EMPLOYEE_MARKED, da diese Demo-Zeile manuell (nicht ueber ein
  // RecommendationCrossSellingSignal) angelegt wird - siehe
  // src/server/recommendation/sales-opportunity.ts::assertSalesOpportunitySourceConsistency
  // (RULE_BASED erfordert einen gesetzten triggerSignalId, den es hier nicht gibt).
  const detectedNeed = await prisma.detectedNeed.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      needType: NeedType.STREAMING,
      source: "EMPLOYEE_MARKED",
      detectedAt: new Date("2026-07-15T09:06:30Z"),
    },
  });

  await prisma.salesOpportunity.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      detectedNeedId: detectedNeed.id,
      status: "OFFERED",
      offeredAt: new Date("2026-07-15T09:10:00Z"),
    },
  });

  // algorithmVersion/evaluationFingerprint: Pflichtfelder seit Phase 3B
  // (Idempotenz-Grundlage, siehe src/server/recommendation/fingerprint.ts).
  // Diese Demo-Zeile durchlaeuft nicht die echte Engine (service.ts::evaluate()),
  // daher ein deterministischer Platzhalter-Fingerprint statt eines echten,
  // aus Eingabedaten berechneten Werts.
  const recommendation = await prisma.recommendation.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      ruleSetVersionId: ruleSetVersion.id,
      algorithmVersion: 1,
      evaluationFingerprint: seedFingerprint(tenant.id, session.id, "seed-demo-recommendation"),
      generatedAt: new Date("2026-07-15T09:07:00Z"),
    },
  });

  const recommendationItem = await prisma.recommendationItem.create({
    data: {
      tenantId: tenant.id,
      recommendationId: recommendation.id,
      productVersionId: productVersion.id,
      eligibilityPassed: true,
      exclusionReasonCodes: [],
      customerFitScore: 80,
      businessPriorityScore: 80,
      priorityRank: 1,
    },
  });

  await prisma.recommendationRationale.create({
    data: {
      tenantId: tenant.id,
      recommendationItemId: recommendationItem.id,
      factorKey: "detected_need_match",
      factorValue: "STREAMING",
      weight: 0.8,
    },
  });

  await prisma.recommendationOutcome.create({
    data: {
      tenantId: tenant.id,
      recommendationItemId: recommendationItem.id,
      outcome: "ACCEPTED",
      decidedByEmployeeId: employees[0]!.id,
      decidedAt: new Date("2026-07-15T09:15:00Z"),
    },
  });

  const deal = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      customerReferenceId: customerReference.id,
      currency: "EUR",
      closedAt: new Date("2026-07-15T09:18:00Z"),
    },
  });

  await prisma.dealItem.create({
    data: {
      tenantId: tenant.id,
      dealId: deal.id,
      productVersionId: productVersion.id,
      quantity: 1,
    },
  });

  await prisma.dealFinancialSnapshot.create({
    data: {
      tenantId: tenant.id,
      dealId: deal.id,
      currency: "EUR",
      monthlyRecurringRevenueMinor: 2999,
      totalContractValueMinor: 2999 * 24,
      oneTimeRevenueMinor: 0,
      commissionAmountMinor: 3000,
      expectedRecurringCommissionMinor: 100,
      hardwarePurchaseCostMinor: 0,
      subsidyCostMinor: 0,
      discountCostMinor: 0,
      otherDirectCostMinor: 0,
      contributionMarginMinor: 2999 * 24 + 3000 - 100,
      contributionMarginFormulaVersion: "v1",
      capturedAt: new Date("2026-07-15T09:18:00Z"),
    },
  });

  await prisma.followUp.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      customerReferenceId: customerReference.id,
      reason: "RENEWAL_LOOKAHEAD",
      status: "OPEN",
      dueDate: new Date("2028-01-15T09:00:00Z"),
      thresholdUsedDays: RENEWAL_LOOKAHEAD_DAYS_DEFAULT,
    },
  });

  // --- Analytics-/Audit-Beispiele ---
  await prisma.analyticsEvent.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      eventType: "DEAL_CLOSED",
      payload: { dealId: deal.id },
      occurredAt: new Date("2026-07-15T09:18:00Z"),
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorUserId: employees[0]!.userId,
      action: "CREATE",
      entityType: "Deal",
      entityId: deal.id,
      metadata: { source: "seed" },
    },
  });

  await prisma.baselineMeasurement.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      metricKey: "cross_sell_rate_before_rollout",
      metricValue: 0.12,
      periodStart: new Date("2026-06-01T00:00:00Z"),
      periodEnd: new Date("2026-06-30T23:59:59Z"),
      measurementSource: "MANUAL",
      measurementMethod: "OBSERVATION",
      startedAt: new Date("2026-06-15T09:00:00Z"),
      endedAt: new Date("2026-06-15T09:20:00Z"),
      activeDurationSeconds: 900,
      inactiveDurationSeconds: 300,
      consultationOutcome: "COMPLETED",
      dealCompleted: true,
      productsSoldCount: 1,
      detectedCrossSellCount: 1,
      offeredCrossSellCount: 1,
      acceptedCrossSellCount: 0,
      dataCompletenessScore: 0.9,
    },
  });

  return { tenant, stores, employees, customerReference, deal };
}

async function main() {
  console.log("Seeding: globaler Katalog ...");
  const { providers, permissions } = await seedGlobalCatalog();

  console.log("Seeding: Tenant A (demotel-nord) ...");
  const tenantA = await seedTenant(
    {
      key: "demotel-nord",
      name: "DemoTel Nord (synthetisch)",
      companyKey: "demotel-nord-gmbh",
      companyName: "DemoTel Nord GmbH",
      storeKeys: ["nord-filiale-1", "nord-filiale-2"],
    },
    providers,
    permissions,
  );

  console.log("Seeding: Tenant B (demotel-sued) ...");
  const tenantB = await seedTenant(
    {
      key: "demotel-sued",
      name: "DemoTel Sued (synthetisch)",
      companyKey: "demotel-sued-gmbh",
      companyName: "DemoTel Sued GmbH",
      storeKeys: ["sued-filiale-1", "sued-filiale-2"],
    },
    providers,
    permissions,
  );

  console.log("Seed abgeschlossen.");
  console.log(`Tenant A: ${tenantA.tenant.key} (${tenantA.tenant.id})`);
  console.log(`Tenant B: ${tenantB.tenant.key} (${tenantB.tenant.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
