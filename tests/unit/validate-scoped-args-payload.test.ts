import { describe, expect, it } from "vitest";
import { validateScopedArgsPayload } from "@/server/tenant/scoped-client";

describe("validateScopedArgsPayload", () => {
  it("ignoriert Modelle ohne JSON-Payload-Feld", () => {
    expect(() =>
      validateScopedArgsPayload({
        model: "Deal",
        operation: "create",
        args: { data: { customerName: "Max Mustermann" } },
      }),
    ).not.toThrow();
  });

  describe("AnalyticsEvent.payload", () => {
    it("akzeptiert ein strukturiertes Payload bei create", () => {
      expect(() =>
        validateScopedArgsPayload({
          model: "AnalyticsEvent",
          operation: "create",
          args: {
            data: {
              eventType: "DEAL_CLOSED",
              payload: {
                productVersionId: "11111111-1111-1111-1111-111111111111",
                amountMinorUnits: 1000,
              },
            },
          },
        }),
      ).not.toThrow();
    });

    it("lehnt Kontaktdaten im Payload bei create ab", () => {
      expect(() =>
        validateScopedArgsPayload({
          model: "AnalyticsEvent",
          operation: "create",
          args: {
            data: { eventType: "DEAL_CLOSED", payload: { customerEmail: "max@example.com" } },
          },
        }),
      ).toThrow();
    });

    it("prueft jede Zeile bei createMany", () => {
      expect(() =>
        validateScopedArgsPayload({
          model: "AnalyticsEvent",
          operation: "createMany",
          args: {
            data: [
              { eventType: "DEAL_CLOSED", payload: { amount: 10 } },
              { eventType: "FOLLOW_UP_CREATED", payload: { telefon: "030-1234567" } },
            ],
          },
        }),
      ).toThrow();
    });

    it("erlaubt fehlendes payload-Feld", () => {
      expect(() =>
        validateScopedArgsPayload({
          model: "AnalyticsEvent",
          operation: "create",
          args: { data: { eventType: "DEAL_CLOSED" } },
        }),
      ).not.toThrow();
    });
  });

  describe("AuditLog.metadata", () => {
    it("akzeptiert strukturierte Metadaten bei update", () => {
      expect(() =>
        validateScopedArgsPayload({
          model: "AuditLog",
          operation: "update",
          args: { data: { action: "UPDATE", metadata: { field: "status", newValue: "ACTIVE" } } },
        }),
      ).not.toThrow();
    });

    it("lehnt Freitext-Metadaten bei upsert.create ab", () => {
      expect(() =>
        validateScopedArgsPayload({
          model: "AuditLog",
          operation: "upsert",
          args: {
            create: { action: "CREATE", metadata: { kommentar: "manuell nachgetragen" } },
            update: {},
          },
        }),
      ).toThrow();
    });
  });
});
