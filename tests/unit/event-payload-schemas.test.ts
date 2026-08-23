import { describe, expect, it } from "vitest";
import {
  analyticsEventPayloadSchema,
  auditLogMetadataSchema,
  parseAnalyticsEventPayload,
  parseAuditLogMetadata,
} from "@/server/validation/event-payload-schemas";

describe("event-payload-schemas", () => {
  describe("analyticsEventPayloadSchema / parseAnalyticsEventPayload", () => {
    it("akzeptiert ein typisches strukturiertes Payload", () => {
      const payload = {
        productVersionId: "11111111-1111-1111-1111-111111111111",
        outcome: "ACCEPTED",
        amountMinorUnits: 49900,
        currency: "EUR",
        isCrossSell: true,
      };
      expect(() => parseAnalyticsEventPayload("RECOMMENDATION_ACCEPTED", payload)).not.toThrow();
      expect(analyticsEventPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("erlaubt null/undefined (optionales Feld)", () => {
      expect(parseAnalyticsEventPayload("CONSULTATION_STARTED", null)).toBeNull();
      expect(parseAnalyticsEventPayload("CONSULTATION_STARTED", undefined)).toBeNull();
    });

    it("lehnt Payload mit Kundennamen ab", () => {
      expect(() =>
        parseAnalyticsEventPayload("CONSULTATION_STARTED", {
          customerName: "Max Mustermann",
        }),
      ).toThrow(/customerName|Kontaktdaten/);
    });

    it("lehnt Payload mit E-Mail-Adresse ab", () => {
      expect(() =>
        parseAnalyticsEventPayload("FOLLOW_UP_CREATED", {
          contact: "max.mustermann@example.com",
        }),
      ).toThrow(/E-Mail/);
    });

    it("lehnt Payload mit Telefonnummer ab", () => {
      expect(() =>
        parseAnalyticsEventPayload("FOLLOW_UP_CREATED", {
          reachAt: "+49 170 1234567",
        }),
      ).toThrow(/Telefonnummer/);
    });

    it("lehnt Freitext-Feld (langer String) ab", () => {
      expect(() =>
        parseAnalyticsEventPayload("CONSULTATION_ABANDONED", {
          details: "x".repeat(250),
        }),
      ).toThrow();
    });

    it("lehnt zu tief verschachtelte Objekte ab", () => {
      const deeplyNested = { a: { b: { c: { d: "zu tief" } } } };
      expect(() => parseAnalyticsEventPayload("NEED_DETECTED", deeplyNested)).toThrow();
    });
  });

  describe("auditLogMetadataSchema / parseAuditLogMetadata", () => {
    it("akzeptiert strukturierte Metadaten", () => {
      const metadata = { field: "commissionPercent", oldValue: 5, newValue: 7 };
      expect(() => parseAuditLogMetadata("UPDATE", metadata)).not.toThrow();
    });

    it("lehnt Metadaten mit Adresse ab", () => {
      expect(() => parseAuditLogMetadata("CREATE", { adresse: "Musterstrasse 1" })).toThrow();
    });

    it("lehnt Metadaten mit Freitext-Kommentar ab", () => {
      expect(() =>
        parseAuditLogMetadata("UPDATE", { kommentar: "Grund fuer die Aenderung war..." }),
      ).toThrow();
    });

    it("erlaubt null/undefined", () => {
      expect(parseAuditLogMetadata("DELETION_REQUESTED", null)).toBeNull();
    });

    it("Schema-Objekt validiert direkt (ohne parse-Helper)", () => {
      expect(
        auditLogMetadataSchema.safeParse({ field: "status", newValue: "ACTIVE" }).success,
      ).toBe(true);
      expect(auditLogMetadataSchema.safeParse({ email: "a@b.de" }).success).toBe(false);
    });
  });

  /**
   * Phase 12 AP4 (Freitext-KI-Angebotsfeature, ChatGPT-GO 2026-08-23).
   * Verifiziert zwei Dinge: (1) die tatsaechlichen Payload-Formen, die
   * `src/server/ai-extraction/service.ts` fuer die vier neuen
   * `AnalyticsEventType`-Werte schreibt, sind gueltig (rein technische
   * Metadaten, kein Freitext/PII); (2) der aus Phase 11 AP2/CI #85 bekannte
   * PII-Scanner-Fehlalarm (ISO-8601-Datumsstring wird faelschlich als
   * Telefonnummer erkannt) ist WEITERHIN aktiv -- die damalige Korrektur war
   * bewusst, den Datumswert aus dem Payload zu ENTFERNEN, nicht den Scanner
   * selbst zu aendern (siehe `contact-data-guard.ts`). Dieser Test dient als
   * Canary: er dokumentiert, dass unser Code (hier: die AP4-Payloads) auch
   * weiterhin niemals einen solchen Datumsstring in ein `AnalyticsEvent.
   * payload` schreiben darf.
   */
  describe("Phase 12 AP4: KI-Extraktions-Events", () => {
    it("AI_EXTRACTION_REQUESTED-Payload ist gueltig (Session-ID, Anzahl, Provider-Version)", () => {
      const payload = {
        consultationSessionId: "11111111-1111-1111-1111-111111111111",
        visibleQuestionCount: 3,
        providerVersion: "mock-v1",
      };
      expect(() => parseAnalyticsEventPayload("AI_EXTRACTION_REQUESTED", payload)).not.toThrow();
    });

    it("AI_EXTRACTION_COMPLETED-Payload ist gueltig (Session-ID, Kandidatenanzahl, Provider-Version)", () => {
      const payload = {
        consultationSessionId: "11111111-1111-1111-1111-111111111111",
        candidateCount: 2,
        providerVersion: "mock-v1",
      };
      expect(() => parseAnalyticsEventPayload("AI_EXTRACTION_COMPLETED", payload)).not.toThrow();
    });

    it("AI_SUGGESTION_ACCEPTED-Payload (Uebernehmen, changed=false) ist gueltig", () => {
      const payload = {
        consultationSessionId: "11111111-1111-1111-1111-111111111111",
        questionId: "22222222-2222-2222-2222-222222222222",
        changed: false,
      };
      expect(() => parseAnalyticsEventPayload("AI_SUGGESTION_ACCEPTED", payload)).not.toThrow();
    });

    it("AI_SUGGESTION_ACCEPTED-Payload (Aendern, changed=true) ist gueltig", () => {
      const payload = {
        consultationSessionId: "11111111-1111-1111-1111-111111111111",
        questionId: "22222222-2222-2222-2222-222222222222",
        changed: true,
      };
      expect(() => parseAnalyticsEventPayload("AI_SUGGESTION_ACCEPTED", payload)).not.toThrow();
    });

    it("AI_SUGGESTION_REJECTED-Payload (Verwerfen, kein changed-Feld) ist gueltig", () => {
      const payload = {
        consultationSessionId: "11111111-1111-1111-1111-111111111111",
        questionId: "22222222-2222-2222-2222-222222222222",
      };
      expect(() => parseAnalyticsEventPayload("AI_SUGGESTION_REJECTED", payload)).not.toThrow();
    });

    it("Canary/Regression (Phase 11 AP2, CI #85): ein ISO-8601-Datumsstring wird WEITERHIN faelschlich als Telefonnummer erkannt -- AP4-Payloads duerfen daher niemals einen Datumswert enthalten", () => {
      const isoDatetime = new Date("2026-08-23T10:00:00.000Z").toISOString();
      expect(() =>
        parseAnalyticsEventPayload("AI_EXTRACTION_REQUESTED", {
          consultationSessionId: "11111111-1111-1111-1111-111111111111",
          // Absichtlich der bekannte Fehlerfall aus CI #85 (dort:
          // `periodStart.toISOString()`), NICHT Teil des tatsaechlichen
          // AP4-Payloads -- siehe Testname.
          occurredAtDebug: isoDatetime,
        }),
      ).toThrow(/Telefonnummer/);
    });
  });
});
