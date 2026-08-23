import { describe, expect, it } from "vitest";
import {
  ConsultationAccessDeniedError,
  deriveConsultationPermissions,
  isAiExtractionAvailable,
  requireConsultationPermission,
} from "@/server/authz/consultation-permissions";

/**
 * Unit-Tests fuer `consultation-permissions.ts` (Phase 12 AP1, ChatGPT-
 * Vorgabe "Permission/Feature-Flag-Grundgerüst"). Rein synchron/pure (keine
 * DB-Zugriffe), daher `tests/unit/` -- analog `tests/unit/config-permissions`-
 * artigen Tests (siehe `tests/unit/questionnaire/` fuer das etablierte
 * Testmuster). Deckt insbesondere ab, dass -- anders als bei
 * `deriveConfigPermissions()` -- KEINE Scope-Restriktion stattfindet (siehe
 * Modulkommentar in `consultation-permissions.ts`), sowie die UND-Regel aus
 * `isAiExtractionAvailable()`.
 */

describe("consultation-permissions", () => {
  describe("deriveConsultationPermissions()", () => {
    it("liefert die Permission bei einer STORE-scoped Zuweisung (keine TENANT-Restriktion)", () => {
      const result = deriveConsultationPermissions([
        { permissionKeys: ["consultation.ai_extraction.use"] },
      ]);
      expect(result).toEqual(["consultation.ai_extraction.use"]);
    });

    it("liefert ein leeres Array ohne qualifizierende Zuweisung (deny-by-default)", () => {
      expect(deriveConsultationPermissions([])).toEqual([]);
      expect(deriveConsultationPermissions([{ permissionKeys: [] }])).toEqual([]);
    });

    it("ignoriert unbekannte Permission-Keys", () => {
      const result = deriveConsultationPermissions([
        { permissionKeys: ["consultation.create", "config.goals.edit"] },
      ]);
      expect(result).toEqual([]);
    });

    it("dedupliziert die Permission ueber mehrere Kandidaten hinweg", () => {
      const result = deriveConsultationPermissions([
        { permissionKeys: ["consultation.ai_extraction.use"] },
        { permissionKeys: ["consultation.ai_extraction.use"] },
      ]);
      expect(result).toEqual(["consultation.ai_extraction.use"]);
    });
  });

  describe("requireConsultationPermission()", () => {
    it("wirft nicht, wenn die Permission vorhanden ist", () => {
      expect(() =>
        requireConsultationPermission(
          { consultationPermissions: ["consultation.ai_extraction.use"] },
          "consultation.ai_extraction.use",
        ),
      ).not.toThrow();
    });

    it("wirft ConsultationAccessDeniedError, wenn die Permission fehlt", () => {
      expect(() =>
        requireConsultationPermission(
          { consultationPermissions: [] },
          "consultation.ai_extraction.use",
        ),
      ).toThrow(ConsultationAccessDeniedError);
    });
  });

  describe("isAiExtractionAvailable()", () => {
    it("ist nur verfuegbar, wenn Permission UND Tenant-Feature-Flag zutreffen", () => {
      expect(isAiExtractionAvailable(true, true)).toBe(true);
      expect(isAiExtractionAvailable(true, false)).toBe(false);
      expect(isAiExtractionAvailable(false, true)).toBe(false);
      expect(isAiExtractionAvailable(false, false)).toBe(false);
    });
  });
});
