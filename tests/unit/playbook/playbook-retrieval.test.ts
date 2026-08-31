/**
 * Phase 14 AP4 -- Unit-Tests fuer die reine Retrieval-Selektionsfunktion
 * `selectPlaybookSections()` (`src/server/playbook/playbook-retrieval.ts`,
 * ChatGPT-GO 2026-08-31, siehe project_ki_cross_phase14_ap3_status.md fuer
 * die vollstaendigen AP4-Leitplanken). Reine Funktion, KEIN DB-Zugriff --
 * diese Suite laeuft immer, unabhaengig von DATABASE_URL (analog
 * `tests/unit/recommendation/conditions.test.ts`).
 *
 * Deckt die von ChatGPT explizit geforderte Mindestliste ab (soweit sie
 * die reine Selektionsfunktion betrifft -- Tenant-/Scope-/Versions-
 * Faelle sind Sache von `playbook-retrieval-context.test.ts`, siehe dort):
 * kein Treffer, ein Treffer, mehrere Treffer mit Prioritaets-
 * Konfliktaufloesung (AP0 Abschnitt 13.2 Testfaelle 1-3), deterministische
 * Reihenfolge, Limits (maxSections/maxTotalContentChars) werden
 * eingehalten, Idempotenz (gleiche Eingabe zweimal -> identisches
 * Ergebnis).
 */

import { describe, expect, it } from "vitest";
import {
  selectPlaybookSections,
  type PlaybookRetrievalCandidateSection,
  type PlaybookRetrievalContext,
} from "@/server/playbook/playbook-retrieval";

function section(
  overrides: Partial<PlaybookRetrievalCandidateSection> = {},
): PlaybookRetrievalCandidateSection {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    sectionType: "ARGUMENTATION",
    relatedTopics: [],
    relatedProductKeys: [],
    relatedSituations: [],
    priority: null,
    active: true,
    contentLength: 100,
    ...overrides,
  };
}

const NO_CONTEXT: PlaybookRetrievalContext = {};

describe("Phase 14 AP4: selectPlaybookSections()", () => {
  // -------------------------------------------------------------------
  // AP0 Abschnitt 13.2 Testfall 1: kein passender Abschnitt
  // -------------------------------------------------------------------

  it("liefert eine leere Auswahl, wenn kein Kandidat vorhanden ist", () => {
    const result = selectPlaybookSections(NO_CONTEXT, [], { maxSections: 10 });
    expect(result.selectedSectionIds).toEqual([]);
    expect(result.discardedForBudgetCount).toBe(0);
  });

  it("liefert eine leere Auswahl, wenn kein Kandidat zum Kontext passt (Metadaten vorhanden, aber kein Ueberlappung)", () => {
    const candidates = [
      section({ id: "s1", relatedProductKeys: ["kfz-basis"] }),
      section({ id: "s2", relatedSituations: ["preisorientiert"] }),
      section({ id: "s3", relatedTopics: ["rabatt"] }),
    ];
    const context: PlaybookRetrievalContext = {
      productKeys: ["hausrat-premium"],
      situations: ["erstberatung"],
      topics: ["garantie"],
    };
    const result = selectPlaybookSections(context, candidates, { maxSections: 10 });
    expect(result.selectedSectionIds).toEqual([]);
    expect(result.discardedForBudgetCount).toBe(0);
  });

  it("ignoriert inaktive Sections, auch wenn sie inhaltlich passen wuerden", () => {
    const candidates = [section({ id: "s1", relatedProductKeys: ["kfz-basis"], active: false })];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual([]);
  });

  // -------------------------------------------------------------------
  // AP0 Abschnitt 13.2 Testfall 2: genau ein passender Abschnitt
  // -------------------------------------------------------------------

  it("waehlt genau einen Abschnitt bei genau einem Metadaten-Treffer (relatedProductKeys)", () => {
    const candidates = [section({ id: "s1", relatedProductKeys: ["kfz-basis"] })];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  it("matched ueber relatedSituations", () => {
    const candidates = [section({ id: "s1", relatedSituations: ["preisorientiert"] })];
    const result = selectPlaybookSections({ situations: ["preisorientiert"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  it("matched ueber relatedTopics via currentQuestionKey", () => {
    const candidates = [section({ id: "s1", relatedTopics: ["rabatt-frage"] })];
    const result = selectPlaybookSections({ currentQuestionKey: "rabatt-frage" }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  it("matched ueber relatedTopics via activeRecommendationKeys", () => {
    const candidates = [section({ id: "s1", relatedTopics: ["kfz-vollkasko"] })];
    const result = selectPlaybookSections(
      { activeRecommendationKeys: ["kfz-vollkasko"] },
      candidates,
      { maxSections: 10 },
    );
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  it("matched ueber relatedTopics via activeCampaignKeys", () => {
    const candidates = [section({ id: "s1", relatedTopics: ["sommeraktion"] })];
    const result = selectPlaybookSections({ activeCampaignKeys: ["sommeraktion"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  it("matched ueber relatedTopics via freies topics-Feld", () => {
    const candidates = [section({ id: "s1", relatedTopics: ["garantie"] })];
    const result = selectPlaybookSections({ topics: ["garantie"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  it("waehlt eine universelle Section (alle drei Metadaten-Arrays leer) IMMER aus, unabhaengig vom Kontext", () => {
    const candidates = [section({ id: "s1" })];
    const result = selectPlaybookSections(NO_CONTEXT, candidates, { maxSections: 10 });
    expect(result.selectedSectionIds).toEqual(["s1"]);
  });

  // -------------------------------------------------------------------
  // AP0 Abschnitt 13.2 Testfall 3: mehrere passende Abschnitte,
  // Konfliktaufloesung ueber priority
  // -------------------------------------------------------------------

  it("sortiert mehrere Treffer nach priority absteigend", () => {
    const candidates = [
      section({ id: "low", relatedProductKeys: ["kfz-basis"], priority: 1 }),
      section({ id: "high", relatedProductKeys: ["kfz-basis"], priority: 10 }),
      section({ id: "mid", relatedProductKeys: ["kfz-basis"], priority: 5 }),
    ];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["high", "mid", "low"]);
  });

  it("behandelt priority: null als niedrigste Prioritaet (nach allen gesetzten Werten)", () => {
    const candidates = [
      section({ id: "no-priority", relatedProductKeys: ["kfz-basis"], priority: null }),
      section({ id: "has-priority", relatedProductKeys: ["kfz-basis"], priority: 0 }),
    ];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["has-priority", "no-priority"]);
  });

  it("bei priority-Gleichstand: deterministischer Tie-Breaker ueber id aufsteigend", () => {
    const candidates = [
      section({ id: "b", relatedProductKeys: ["kfz-basis"], priority: 5 }),
      section({ id: "a", relatedProductKeys: ["kfz-basis"], priority: 5 }),
    ];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
    });
    expect(result.selectedSectionIds).toEqual(["a", "b"]);
  });

  // -------------------------------------------------------------------
  // Limits (AP0 Abschnitt 15, Kostenkontrolle)
  // -------------------------------------------------------------------

  it("begrenzt die Auswahl auf maxSections und meldet die verworfene Anzahl", () => {
    const candidates = [
      section({ id: "s1", relatedProductKeys: ["kfz-basis"], priority: 3 }),
      section({ id: "s2", relatedProductKeys: ["kfz-basis"], priority: 2 }),
      section({ id: "s3", relatedProductKeys: ["kfz-basis"], priority: 1 }),
    ];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 2,
    });
    expect(result.selectedSectionIds).toEqual(["s1", "s2"]);
    expect(result.discardedForBudgetCount).toBe(1);
  });

  it("begrenzt die Auswahl auf maxTotalContentChars (strikter Praefix-Cutoff, kein Bin-Packing)", () => {
    const candidates = [
      section({ id: "s1", relatedProductKeys: ["kfz-basis"], priority: 3, contentLength: 400 }),
      // s2 wuerde das Budget (500) ueberschreiten (400+300 > 500) und wird
      // daher verworfen, OBWOHL s3 danach noch reinpassen wuerde --
      // bewusstes Verhalten (siehe Modulkommentar
      // PlaybookRetrievalOptions.maxTotalContentChars).
      section({ id: "s2", relatedProductKeys: ["kfz-basis"], priority: 2, contentLength: 300 }),
      section({ id: "s3", relatedProductKeys: ["kfz-basis"], priority: 1, contentLength: 50 }),
    ];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
      maxTotalContentChars: 500,
    });
    expect(result.selectedSectionIds).toEqual(["s1"]);
    expect(result.discardedForBudgetCount).toBe(2);
  });

  it("waehlt exakt bis zum Budget-Limit (Grenzfall: Summe genau gleich maxTotalContentChars)", () => {
    const candidates = [
      section({ id: "s1", relatedProductKeys: ["kfz-basis"], priority: 2, contentLength: 300 }),
      section({ id: "s2", relatedProductKeys: ["kfz-basis"], priority: 1, contentLength: 200 }),
    ];
    const result = selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, {
      maxSections: 10,
      maxTotalContentChars: 500,
    });
    expect(result.selectedSectionIds).toEqual(["s1", "s2"]);
    expect(result.discardedForBudgetCount).toBe(0);
  });

  // -------------------------------------------------------------------
  // Idempotenz/Determinismus (ChatGPTs Mindestliste)
  // -------------------------------------------------------------------

  it("liefert bei identischer Eingabe zweimal ein identisches Ergebnis (reine Funktion, kein versteckter Zustand)", () => {
    const candidates = [
      section({ id: "b", relatedProductKeys: ["kfz-basis"], priority: 5 }),
      section({ id: "a", relatedProductKeys: ["kfz-basis"], priority: 5 }),
      section({ id: "c" }),
    ];
    const context: PlaybookRetrievalContext = { productKeys: ["kfz-basis"] };
    const first = selectPlaybookSections(context, candidates, { maxSections: 10 });
    const second = selectPlaybookSections(context, candidates, { maxSections: 10 });
    expect(second).toEqual(first);
  });

  it("mutiert die uebergebenen candidateSections nicht (reine Funktion)", () => {
    const candidates = [section({ id: "s1", relatedProductKeys: ["kfz-basis"], priority: 5 })];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    selectPlaybookSections({ productKeys: ["kfz-basis"] }, candidates, { maxSections: 10 });
    expect(candidates).toEqual(snapshot);
  });

  // -------------------------------------------------------------------
  // Snapshot-Stabilitaet bei "Versionswechsel" (unterschiedliche
  // candidateSections-Listen fuer denselben Kontext, ChatGPTs
  // Mindestliste + AP0 Abschnitt 13.2 Testfall 9)
  // -------------------------------------------------------------------

  it("eine neue candidateSections-Liste (simulierter Versionswechsel) veraendert das Ergebnis, waehrend ein erneuter Aufruf mit der urspruenglichen Liste weiterhin das urspruengliche Ergebnis liefert", () => {
    const context: PlaybookRetrievalContext = { productKeys: ["kfz-basis"] };
    const versionOneCandidates = [section({ id: "v1-section", relatedProductKeys: ["kfz-basis"] })];
    const versionTwoCandidates = [section({ id: "v2-section", relatedProductKeys: ["kfz-basis"] })];

    const resultV1First = selectPlaybookSections(context, versionOneCandidates, {
      maxSections: 10,
    });
    expect(resultV1First.selectedSectionIds).toEqual(["v1-section"]);

    const resultV2 = selectPlaybookSections(context, versionTwoCandidates, { maxSections: 10 });
    expect(resultV2.selectedSectionIds).toEqual(["v2-section"]);

    const resultV1Again = selectPlaybookSections(context, versionOneCandidates, {
      maxSections: 10,
    });
    expect(resultV1Again).toEqual(resultV1First);
  });
});
