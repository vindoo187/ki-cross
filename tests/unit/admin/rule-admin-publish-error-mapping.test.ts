/**
 * Phase 9 AP9 -- deterministischer Unit-Test fuer `translatePublishError()`
 * (`src/server/admin/rule-admin.ts`), ChatGPT-Vorgabe 2026-08-18:
 *
 * "den konkreten PostgreSQL-Fehler ueber Constraint-Namen und/oder
 * Fehlercode sicher erkennen, nur diesen bekannten
 * rule_set_versions_tenant_active_no_overlap-Fall auf einen fachlichen 409
 * Conflict mappen, eine eigene Fehlerklasse verwenden, keinen pauschalen
 * PostgreSQL-/Prisma-Fehler auf 409 mappen."
 *
 * Da ein echter EXCLUDE-Constraint-Konflikt sich nicht zuverlaessig ueber
 * eine echte Nebenlaeufigkeitssituation provozieren laesst (siehe
 * tests/integration/rule-admin-publish.test.ts, timing-abhaengig), deckt
 * dieser Test die Mapping-Logik direkt mit synthetischen, aber realistisch
 * geformten Prisma-Fehlerobjekten ab -- ohne Datenbank, ohne
 * DATABASE_URL-Abhaengigkeit.
 */

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { translatePublishError } from "@/server/admin/rule-admin";
import { RuleSetVersionPublishConflictError } from "@/server/admin/rule-admin-errors";

const CONSTRAINT_NAME = "rule_set_versions_tenant_active_no_overlap";

describe("translatePublishError() -- Phase 9 AP9 EXCLUDE-Constraint-Uebersetzung", () => {
  it("uebersetzt eine PrismaClientUnknownRequestError mit dem bekannten Constraint-Namen in RuleSetVersionPublishConflictError (409)", () => {
    const rawMessage =
      "Invalid `prisma.ruleSetVersion.updateMany()` invocation:\n\n" +
      `Raw query failed. Code: \`23P01\`. Message: \`ERROR: conflicting key value violates exclusion constraint "${CONSTRAINT_NAME}"\``;
    const err = new Prisma.PrismaClientUnknownRequestError(rawMessage, { clientVersion: "test" });

    expect(() => translatePublishError(err, "version-123")).toThrow(
      RuleSetVersionPublishConflictError,
    );
  });

  it("uebersetzt auch eine PrismaClientKnownRequestError mit dem Constraint-Namen in der Meldung (defensiv, falls Prisma den Fehlercode in einer kuenftigen Version doch kennt)", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the constraint: \`${CONSTRAINT_NAME}\``,
      { code: "P2002", clientVersion: "test" },
    );

    expect(() => translatePublishError(err, "version-456")).toThrow(
      RuleSetVersionPublishConflictError,
    );
  });

  it("wirft ausschliesslich RuleSetVersionPublishConflictError, KEINEN rohen Prisma-Fehler mehr, im Konfliktfall", () => {
    const err = new Prisma.PrismaClientUnknownRequestError(
      `exclusion constraint "${CONSTRAINT_NAME}"`,
      { clientVersion: "test" },
    );

    try {
      translatePublishError(err, "version-789");
      expect.fail("translatePublishError() haette werfen muessen");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(RuleSetVersionPublishConflictError);
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
      expect(thrown).not.toBeInstanceOf(RuleSetVersionPublishConflictError);
    }
  });

  it("wirft eine fachliche Fehlerklasse (z. B. RuleSetVersionNotDraftError aus dem updateMany-Guard) UNVERAENDERT weiter", () => {
    const err = new Error('RuleSetVersion "x" kann nicht veroeffentlicht werden (Status: ACTIVE)');

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
      expect(thrown).not.toBeInstanceOf(RuleSetVersionPublishConflictError);
    }
  });
});
