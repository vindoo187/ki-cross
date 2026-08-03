/**
 * Unit-Tests fuer `translateRationale()` (AP6, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 7). Reine Logik, keine DB --
 * plain Node vitest-Environment (kein jsdom noetig).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { translateRationale } from "@/server/consultation-ui/rationale-translation";

describe("translateRationale", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uebersetzt eligibility:mind_18 fuer matched/not_matched", () => {
    expect(translateRationale("eligibility:mind_18", "matched")).toBe("Mindestalter erfuellt");
    expect(translateRationale("eligibility:mind_18", "not_matched")).toBe(
      "Mindestalter nicht erfuellt",
    );
  });

  it("uebersetzt eligibility:ausreichendes_datenvolumen fuer matched/not_matched", () => {
    expect(translateRationale("eligibility:ausreichendes_datenvolumen", "matched")).toBe(
      "Bietet ausreichend Datenvolumen fuer den erkannten Bedarf",
    );
    expect(translateRationale("eligibility:ausreichendes_datenvolumen", "not_matched")).toBe(
      "Datenvolumen liegt unter dem erkannten Bedarf",
    );
  });

  it("uebersetzt eligibility:roaming_passt_zu_streaming_bedarf fuer matched/not_matched", () => {
    expect(translateRationale("eligibility:roaming_passt_zu_streaming_bedarf", "matched")).toBe(
      "EU-Roaming passt zum erkannten Streaming-Bedarf",
    );
    expect(translateRationale("eligibility:roaming_passt_zu_streaming_bedarf", "not_matched")).toBe(
      "EU-Roaming aktuell nicht relevant fuer den erkannten Bedarf",
    );
  });

  it("uebersetzt exclusion:RENEWAL_NO_PREMIUM_TIER unabhaengig vom factorValue", () => {
    expect(translateRationale("exclusion:RENEWAL_NO_PREMIUM_TIER", "triggered")).toBe(
      "Premium-Tarif wird bei einer Vertragsverlaengerung aktuell nicht angeboten",
    );
    expect(translateRationale("exclusion:RENEWAL_NO_PREMIUM_TIER", "irrelevant")).toBe(
      "Premium-Tarif wird bei einer Vertragsverlaengerung aktuell nicht angeboten",
    );
  });

  it("uebersetzt cross_selling:STREAMING_ADDON_SUGGESTED unabhaengig vom factorValue (AP8)", () => {
    expect(translateRationale("cross_selling:STREAMING_ADDON_SUGGESTED", "STREAMING")).toBe(
      "Erkannter Streaming-Bedarf -- ein Streaming-Zusatzpaket koennte passend sein",
    );
    expect(translateRationale("cross_selling:STREAMING_ADDON_SUGGESTED", "irrelevant")).toBe(
      "Erkannter Streaming-Bedarf -- ein Streaming-Zusatzpaket koennte passend sein",
    );
  });

  it("liefert eine generische Fallback-Anzeige fuer unbekannte factorKeys", () => {
    const result = translateRationale("eligibility:unbekannte_regel", "matched");
    expect(result).toBe("Zusaetzlicher Faktor: eligibility:unbekannte_regel = matched");
  });

  it("loggt unbekannte factorKeys genau einmal pro Schluessel (kein wiederholtes Logging)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    translateRationale("prioritization:noch_nie_gesehen", "irgendwas");
    translateRationale("prioritization:noch_nie_gesehen", "irgendwas_anderes");
    translateRationale("prioritization:noch_nie_gesehen", "und_nochmal");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("prioritization:noch_nie_gesehen");
  });

  it("loggt unterschiedliche unbekannte factorKeys jeweils separat", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    translateRationale("exclusion:ANDERER_UNBEKANNTER_GRUND", "a");
    translateRationale("exclusion:NOCH_EIN_UNBEKANNTER_GRUND", "b");

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("wirft nicht bei leerem factorValue", () => {
    expect(() => translateRationale("eligibility:mind_18", "")).not.toThrow();
  });
});
