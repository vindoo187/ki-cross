import { describe, expect, it } from "vitest";
import {
  assertNoContactData,
  ContactDataDetectedError,
  findContactDataIssues,
} from "@/server/validation/contact-data-guard";

describe("contact-data-guard", () => {
  describe("lehnt verbotene Schluessel ab", () => {
    const forbiddenPayloads: Array<[string, unknown]> = [
      ["customerName", { customerName: "Max Mustermann" }],
      ["kundenname", { kundenname: "Erika Musterfrau" }],
      ["vorname", { vorname: "Max" }],
      ["email", { email: "max@example.com" }],
      ["telefon", { telefon: "0301234567" }],
      ["phoneNumber", { phoneNumber: "+49 30 1234567" }],
      ["adresse", { adresse: "Musterstrasse 1" }],
      ["iban", { iban: "DE89370400440532013000" }],
      ["notes", { notes: "kurzer Kommentar" }],
      ["kommentar", { kommentar: "kurzer Kommentar" }],
      ["verschachtelt", { context: { customer: { email: "a@b.de" } } }],
    ];

    for (const [label, payload] of forbiddenPayloads) {
      it(`Schluessel "${label}"`, () => {
        expect(() => assertNoContactData(payload, "Test")).toThrow(ContactDataDetectedError);
      });
    }
  });

  describe("lehnt Werte ab, die wie Kontaktdaten aussehen (unabhaengig vom Schluesselnamen)", () => {
    it("E-Mail-artiger Wert unter neutralem Schluessel", () => {
      expect(() => assertNoContactData({ value: "someone@example.com" }, "Test")).toThrow(
        ContactDataDetectedError,
      );
    });

    it("Telefonnummer-artiger Wert unter neutralem Schluessel", () => {
      expect(() => assertNoContactData({ value: "+49 170 1234567" }, "Test")).toThrow(
        ContactDataDetectedError,
      );
    });

    it("langer Freitext-String (> 200 Zeichen)", () => {
      const longText = "a".repeat(201);
      expect(() => assertNoContactData({ value: longText }, "Test")).toThrow(
        ContactDataDetectedError,
      );
    });

    it("Freitext in einem Array-Element", () => {
      expect(() => assertNoContactData({ tags: ["ok", "call me at 030-1234567"] }, "Test")).toThrow(
        ContactDataDetectedError,
      );
    });
  });

  describe("akzeptiert strukturierte, nicht-personenbezogene Werte", () => {
    it("UUIDs werden nicht als Telefonnummer fehlerkannt", () => {
      expect(
        findContactDataIssues({
          productVersionId: "11111111-1111-1111-1111-111111111111",
          storeId: "22222222-2222-2222-2222-222222222222",
        }),
      ).toEqual([]);
    });

    it("Enums, Zahlen, Booleans, kurze IDs", () => {
      expect(
        findContactDataIssues({
          outcome: "ACCEPTED",
          rejectionReason: "TOO_EXPENSIVE",
          amountMinorUnits: 129900,
          currency: "EUR",
          isCrossSell: true,
          count: 3,
        }),
      ).toEqual([]);
    });

    it("verschachtelte, sichere Objekte/Arrays", () => {
      expect(
        findContactDataIssues({
          productIds: ["11111111-1111-1111-1111-111111111111", "product-2"],
          context: { storeId: "33333333-3333-3333-3333-333333333333", channel: "IN_STORE" },
        }),
      ).toEqual([]);
    });

    it("null/undefined-Werte", () => {
      expect(findContactDataIssues({ payload: null })).toEqual([]);
      expect(findContactDataIssues(null)).toEqual([]);
    });

    it("Business-Namen ohne direkten Personenbezug (z.B. productName) sind erlaubt", () => {
      // Bewusste Design-Entscheidung: die Sperrliste blockt exakte
      // personenbezogene Schluessel (z. B. "customerName"), nicht jeden
      // Schluessel, der zufaellig die Buchstabenfolge "name" enthaelt.
      expect(findContactDataIssues({ productName: "Smartphone Modell X" })).toEqual([]);
    });
  });
});
