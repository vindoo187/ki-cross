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
});
