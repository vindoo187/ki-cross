/**
 * Phase 10 AP5 -- deterministischer Unit-Test fuer `translatePublishError()`
 * (`src/server/admin/commission-admin.ts`), analog
 * `tests/unit/admin/rule-admin-publish-error-mapping.test.ts` (Phase 9 AP9).
 * ChatGPT-Vorgabe (identisch angewendet): "keinen pauschalen PostgreSQL-/
 * Prisma-Fehler auf 409 mappen", nur den bekannten Constraint-Namen
 * `commission_model_versions_no_overlap`.
 *
 * Da ein echter EXCLUDE-Constraint-Konflikt sich nicht zuverlaessig ueber
 * eine echte Nebenlaeufigkeitssituation provozieren laesst, deckt dieser
 * Test die Mapping-Logik direkt mit synthetischen, aber realistisch
 * geformten Prisma-Fehlerobjekten ab -- ohne Datenbank, ohne
 * DATABASE_URL-Abhaengigkeit (siehe
 * tests/integration/commission-admin.test.ts fuer den echten,
 * timing-abhaengigen Nebenlaeufigkeitstest).
 */

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { translatePublishError } from "@/server/admin/commission-admin";
import { CommissionModelVersionPublishConflictError } from "@/server/admin/commission-admin-errors";

const CONSTRAINT_NAME = "commission_model_versions_no_overlap";

describe("translatePublishError() -- Phase 10 AP5 EXCLUDE-Constraint-Uebersetzung", () => {
  it("uebersetzt eine PrismaClientUnknownRequestError mit dem bekannten Constraint-Namen in CommissionModelVersionPublishConflictError (409)", () => {
    const rawMessage =
      "Invalid `prisma.commissionModelVersion.updateMany()` invocation:\n\n" +
      `Raw query failed. Code: \`23P01\`. Message: \`ERROR: conflicting key value violates exclusion constraint "${CONSTRAINT_NAME}"\``;
    const err = new Prisma.PrismaClientUnknownRequestError(rawMessage, { clientVersion: "test" });

    expect(() => translatePublishError(err, "version-123")).toThrow(
      CommissionModelVersionPublishConflictError,
    );
  });

  it("uebersetzt auch eine PrismaClientKnownRequestError mit dem Constraint-Namen in der Meldung (defensiv, falls Prisma den Fehlercode in einer kuenftigen Version doch kennt)", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the constraint: \`${CONSTRAINT_NAME}\``,
      { code: "P2002", clientVersion: "test" },
    );

    expect(() => translatePublishError(err, "version-456")).toThrow(
      CommissionModelVersionPublishConflictError,
    );
  });

  it("wirft ausschliesslich CommissionModelVersionPublishConflictError, KEINEN rohen Prisma-Fehler mehr, im Konfliktfall", () => {
    const err = new Prisma.PrismaClientUnknownRequestError(
      `exclusion constraint "${CONSTRAINT_NAME}"`,
      { clientVersion: "test" },
    );

    try {
      translatePublishError(err, "version-789");
      expect.fail("translatePublishError() haette werfen muessen");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(CommissionModelVersionPublishConflictError);
      expect(thrown).not.toBe(err);
    }
  });

  it("wirft einen ANDEREN Prisma-Fehler (kein bekannter Constraint-Name) UNVERAENDERT weiter -- kein pauschales Mapping auf 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
      code: "P2025",
      clientVersion: "test",
    });

    expect(() => translatePublishError(err, "version-999")).toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
    try {
      translatePublishError(err, "version-999");
    } catch (thrown) {
      expect(thrown).toBe(err);
      expect(thrown).not.toBeInstanceOf(CommissionModelVersionPublishConflictError);
    }
  });

  it("wirft eine fachliche Fehlerklasse (z. B. CommissionModelVersionNotDraftError aus dem updateMany-Guard) UNVERAENDERT weiter", () => {
    const err = new Error(
      'CommissionModelVersion "x" kann nicht veroeffentlicht werden (Status: ACTIVE)',
    );

    expect(() => translatePublishError(err, "version-abc")).toThrow(err);
    try {
      translatePublishError(err, "version-abc");
    } catch (thrown) {
      expect(thrown).toBe(err);
    }
  });

  it("wirft einen komplett unbekannten Nicht-Prisma-Fehler (z. B. TypeError) UNVERAENDERT weiter", () => {
    const err = new TypeError("etwas anderes ist schiefgelaufen");

    try {
      translatePublishError(err, "version-def");
      expect.fail("translatePublishError() haette werfen muessen");
    } catch (thrown) {
      expect(thrown).toBe(err);
      expect(thrown).not.toBeInstanceOf(CommissionModelVersionPublishConflictError);
    }
  });
});
