/**
 * Phase 8 AP1 -- Integrationstests fuer den neuen Admin-/Konfigurations-
 * Login (additiv zum bestehenden `dev-login`, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4). Testet die volle Kette
 * `verifyAdminCredentials()` -> HTTP-Route -> Session-Cookie, gegen ECHTE
 * Postgres-Fixtures (kein `vi.mock`, Codebase-Konvention, siehe
 * tests/integration/analytics-management-security.test.ts).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { verifyAdminCredentials } from "@/server/auth/admin-login";
import { hashPassword } from "@/server/auth/password";
import { verifySessionToken } from "@/server/auth/session";
import { POST as adminLogin } from "@/app/api/auth/admin-login/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
// Nur zum Signieren von Test-Session-Tokens noetig (siehe session.ts) -- kein
// echtes Geheimnis, analog zum CI-Platzhalter in .github/workflows/ci.yml.
process.env.DEV_AUTH_SECRET ??= "ap1-admin-login-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 8 AP1: Admin-Login (verifyAdminCredentials + POST /api/auth/admin-login)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const CORRECT_PASSWORD = "korrektes-test-passwort-123";

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    async function createTenant(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      return tenant.id;
    }

    async function createCompanyAndStore(tenantId: string, key: string) {
      const company = await rawClient.company.create({
        data: { tenantId, key: `${key}-${suffix}`, name: `Company ${key}` },
      });
      const store = await rawClient.store.create({
        data: { tenantId, companyId: company.id, key: `${key}-${suffix}`, name: `Store ${key}` },
      });
      return store.id;
    }

    async function createAdminUserWithEmployee(
      tenantId: string,
      storeId: string,
      key: string,
      options: {
        passwordHash?: string | null;
        isSynthetic?: boolean;
        employmentStatus?: "ACTIVE" | "DEACTIVATED";
        withEmployee?: boolean;
      } = {},
    ) {
      const {
        passwordHash = hashPassword(CORRECT_PASSWORD),
        isSynthetic = true,
        employmentStatus = "ACTIVE",
        withEmployee = true,
      } = options;
      const email = `${key}-${suffix}@example-synthetic.test`;
      const user = await rawClient.user.create({
        data: { tenantId, email, isSynthetic, passwordHash },
      });
      if (withEmployee) {
        await rawClient.employee.create({
          data: {
            tenantId,
            storeId,
            userId: user.id,
            displayName: `Admin ${key}`,
            employmentStatus,
          },
        });
      }
      return { userId: user.id, email };
    }

    function jsonRequest(body: unknown) {
      return new NextRequest("http://127.0.0.1:3000/api/auth/admin-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // ---------------------------------------------------------------------
    // 1. verifyAdminCredentials() -- reine Funktion, ohne HTTP-Schicht
    // ---------------------------------------------------------------------

    it("liefert bei korrekten Credentials einen gueltigen SessionPayload", async () => {
      const tenantId = await createTenant("t1");
      const storeId = await createCompanyAndStore(tenantId, "s1");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u1");

      const payload = await verifyAdminCredentials(tenantId, email, CORRECT_PASSWORD);

      expect(payload).not.toBeNull();
      expect(payload?.tenantId).toBe(tenantId);
      expect(payload?.storeId).toBe(storeId);
    });

    it("liefert null bei falschem Passwort", async () => {
      const tenantId = await createTenant("t2");
      const storeId = await createCompanyAndStore(tenantId, "s2");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u2");

      const payload = await verifyAdminCredentials(tenantId, email, "falsches-passwort");
      expect(payload).toBeNull();
    });

    it("liefert null bei unbekannter E-Mail (nicht unterscheidbar von falschem Passwort)", async () => {
      const tenantId = await createTenant("t3");
      const payload = await verifyAdminCredentials(
        tenantId,
        `unbekannt-${suffix}@example-synthetic.test`,
        "irgendein-passwort",
      );
      expect(payload).toBeNull();
    });

    it("liefert null fuer einen Nutzer ohne gesetzten passwordHash (reiner dev-login-Nutzer)", async () => {
      const tenantId = await createTenant("t4");
      const storeId = await createCompanyAndStore(tenantId, "s4");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u4", {
        passwordHash: null,
      });

      const payload = await verifyAdminCredentials(tenantId, email, CORRECT_PASSWORD);
      expect(payload).toBeNull();
    });

    it("liefert null fuer einen nicht-synthetischen Nutzer, selbst mit korrektem Passwort", async () => {
      const tenantId = await createTenant("t5");
      const storeId = await createCompanyAndStore(tenantId, "s5");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u5", {
        isSynthetic: false,
      });

      const payload = await verifyAdminCredentials(tenantId, email, CORRECT_PASSWORD);
      expect(payload).toBeNull();
    });

    it("liefert null fuer einen Nutzer ohne verknuepften Employee-Datensatz", async () => {
      const tenantId = await createTenant("t6");
      const storeId = await createCompanyAndStore(tenantId, "s6");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u6", {
        withEmployee: false,
      });

      const payload = await verifyAdminCredentials(tenantId, email, CORRECT_PASSWORD);
      expect(payload).toBeNull();
    });

    it("liefert null fuer einen Nutzer mit deaktiviertem Employee-Status", async () => {
      const tenantId = await createTenant("t7");
      const storeId = await createCompanyAndStore(tenantId, "s7");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u7", {
        employmentStatus: "DEACTIVATED",
      });

      const payload = await verifyAdminCredentials(tenantId, email, CORRECT_PASSWORD);
      expect(payload).toBeNull();
    });

    it("Tenant-Isolation: dieselbe E-Mail unter falscher tenantId schlaegt fehl", async () => {
      const tenantA = await createTenant("t8a");
      const tenantB = await createTenant("t8b");
      const storeA = await createCompanyAndStore(tenantA, "s8a");
      const { email } = await createAdminUserWithEmployee(tenantA, storeA, "u8");

      // Nutzer existiert nur in tenantA -- Anfrage mit tenantB + derselben
      // E-Mail darf nicht erfolgreich sein (kein Cross-Tenant-Login-Leck).
      const payload = await verifyAdminCredentials(tenantB, email, CORRECT_PASSWORD);
      expect(payload).toBeNull();
    });

    // ---------------------------------------------------------------------
    // 2. HTTP-Route POST /api/auth/admin-login
    // ---------------------------------------------------------------------

    it("Route: korrekte Credentials -> 200, Session-Cookie gesetzt, kein passwordHash in der Antwort", async () => {
      const tenantId = await createTenant("t9");
      const storeId = await createCompanyAndStore(tenantId, "s9");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u9");

      const response = await adminLogin(
        jsonRequest({ tenantId, email, password: CORRECT_PASSWORD }),
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(body)).not.toContain("passwordHash");

      const setCookie = response.cookies.get("ki_cross_dev_session");
      expect(setCookie).toBeDefined();
      const session = verifySessionToken(setCookie?.value);
      expect(session?.tenantId).toBe(tenantId);
    });

    it("Route: falsches Passwort -> 401 InvalidAdminCredentials", async () => {
      const tenantId = await createTenant("t10");
      const storeId = await createCompanyAndStore(tenantId, "s10");
      const { email } = await createAdminUserWithEmployee(tenantId, storeId, "u10");

      const response = await adminLogin(
        jsonRequest({ tenantId, email, password: "falsches-passwort" }),
      );
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("InvalidAdminCredentials");
    });

    it("Route: unbekannte E-Mail -> identischer 401-Fehler wie bei falschem Passwort (keine Nutzer-Enumeration)", async () => {
      const tenantId = await createTenant("t11");
      const response = await adminLogin(
        jsonRequest({
          tenantId,
          email: `unbekannt-${suffix}@example-synthetic.test`,
          password: "irgendein-passwort",
        }),
      );
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("InvalidAdminCredentials");
    });

    it("Route: ungueltiger Request-Body (fehlendes Passwort) -> 400 InvalidRequest", async () => {
      const tenantId = await createTenant("t12");
      const response = await adminLogin(jsonRequest({ tenantId, email: "a@b.test" }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("InvalidRequest");
    });
  },
);
