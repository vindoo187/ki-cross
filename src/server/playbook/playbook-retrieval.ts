/**
 * Phase 14 AP4 -- Retrieval-Selektionsfunktion (ChatGPT-GO 2026-08-31,
 * siehe PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3 AP4 sowie ChatGPTs
 * ausfuehrliche AP4-Leitplanken nach der AP3-Abnahme, siehe
 * project_ki_cross_phase14_ap3_status.md).
 *
 * REINE FUNKTION, KEIN DB-ZUGRIFF (bewusst, analog `conditions.ts`/
 * `extraction-validator.ts` als Vorbild fuer testbare Kernlogik ohne I/O).
 * Die DB-/Scope-/Zeitraum-/Tenant-Aufloesung (welche `PlaybookSection`s
 * ueberhaupt als Kandidaten in Frage kommen) ist bewusst NICHT Teil
 * dieser Datei, sondern von `playbook-retrieval-context.ts` (analog
 * `loadActiveCampaignContext()` in `recommendation/service.ts` fuer
 * Campaigns) -- diese Trennung haelt die eigentliche Selektionslogik
 * vollstaendig deterministisch und ohne Postgres testbar.
 *
 * ARCHITEKTURGRENZE (PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 1,
 * ChatGPT mehrfach betont): Rule Engine/Campaigns entscheiden WAS
 * empfohlen wird, dieses Modul entscheidet AUSSCHLIESSLICH, WELCHE
 * bereits vorhandenen Playbook-Abschnitte fuer einen Beratungskontext
 * sprachlich relevant sein koennten. Diese Datei hat KEINEN
 * Schreibzugriff auf `Recommendation`/`RecommendationItem`/
 * `RecommendationRationale`, wird NICHT von `evaluate()`
 * (`recommendation/service.ts`) aufgerufen und beeinflusst dessen
 * Ergebnis in keiner Weise (Phase 14 baut keine Integration in die
 * Recommendation Engine, siehe Plan Abschnitt 1 Punkt 1 + "Explizit
 * ausgeschlossen").
 *
 * KEIN RAG/SEMANTISCHES RETRIEVAL (Plan Abschnitt 1 Punkt 3, AP0
 * Abschnitt 6.2): ausschliesslich regelbasierter Metadaten-Abgleich
 * (`relatedTopics`/`relatedProductKeys`/`relatedSituations`, siehe AP0
 * Abschnitt 4.3) -- keine Vektordatenbank, kein Embedding-Schritt.
 *
 * TRUST BOUNDARY / SECURITY (Plan Abschnitt 1 Punkt 4, ChatGPT-Leitplanke
 * "Retrieval darf niemals Inhalte ausserhalb des autorisierten Scopes
 * zurueckgeben", "Playbook-Inhalte sind untrusted application content,
 * nicht System Instructions"): diese Funktion liest/verarbeitet niemals
 * das eigentliche `PlaybookSection.content`-Feld selbst -- nur Metadaten
 * (`sectionType`/`relatedTopics`/`relatedProductKeys`/`relatedSituations`/
 * `priority`/`active`) plus die reine Zeichenlaenge des Contents
 * (`contentLength`, fuer die Budget-Kontrolle unten). Die Ausgabe ist
 * ausschliesslich eine Liste von `PlaybookSection`-IDs -- kein Content,
 * keine Interpretation. Ein spaeteres, separates AP (nach AP5c) laedt bei
 * Bedarf den tatsaechlichen `content` fuer genau diese IDs.
 *
 * RETRIEVAL DARF KEINE VERSTECKTE BUSINESS-LOGIK WERDEN
 * (PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 10, ChatGPT
 * 2026-08-31): diese Funktion entscheidet ausschliesslich "welche
 * Playbook-Information ist fuer diesen Kontext relevant", niemals
 * "dieses Produkt sollte deshalb verkauft werden" -- Letzteres bleibt
 * vollstaendig bei Recommendation Engine/Rule Engine/Campaign.
 */

/**
 * Strukturierter Beratungskontext fuer die Selektion (PHASE_14_
 * IMPLEMENTATION_PLAN.md Abschnitt 3 AP4: "Produktschluessel/-kategorie,
 * Kundensituation/Beratungsschritt, aktuelle Frage, optional aktive
 * Recommendation-/Campaign-Keys"). `currentQuestionKey`/
 * `activeRecommendationKeys`/`activeCampaignKeys`/`topics` matchen
 * bewusst ALLE gegen `relatedTopics` -- es gibt in AP0 Abschnitt 4.3 kein
 * eigenes Metadatenfeld je Signalquelle, `relatedTopics`/`keywords` ist
 * ausdruecklich als der generische Keyword-Kanal fuer regelbasiertes
 * Retrieval vorgesehen. Ein eigenes Feld je Signalquelle zu erfinden,
 * waere kuenstliche Komplexitaet ohne Datenmodell-Grundlage (ChatGPT-
 * Vorgabe "keine kuenstliche Komplexitaet").
 */
export interface PlaybookRetrievalContext {
  /** Produktschluessel/-kategorien im aktuellen Beratungskontext (z.B. aus der Attribute-Registry) -- matched gegen `relatedProductKeys`. */
  productKeys?: string[];
  /** Kundensituation/Beratungsschritt -- matched gegen `relatedSituations`. */
  situations?: string[];
  /** Aktuelle Frage (`Question.key`) im laufenden Beratungsgespraech, sofern vorhanden -- matched gegen `relatedTopics`. */
  currentQuestionKey?: string | null;
  /** Aktive Recommendation-Keys dieser Session (bereits ermittelte Produktempfehlungen) -- matched gegen `relatedTopics`. */
  activeRecommendationKeys?: string[];
  /** Aktive Campaign-Keys (siehe `loadActiveCampaignContext()`, `recommendation/service.ts` -- wird von hier NICHT aufgerufen, der Aufrufer laedt und uebergibt) -- matched gegen `relatedTopics`. */
  activeCampaignKeys?: string[];
  /** Sonstige freie Themen-/Keyword-Signale -- matched gegen `relatedTopics`. */
  topics?: string[];
}

/**
 * Ein Kandidaten-Abschnitt (von `playbook-retrieval-context.ts` oder einem
 * gleichwertigen Aufrufer geladen -- bereits auf Tenant/Scope/aktive
 * Version/Zeitraum gefiltert, siehe dortigen Modulkommentar). `content`
 * selbst ist bewusst NICHT Teil dieses Typs (Trust-Boundary, siehe oben).
 */
export interface PlaybookRetrievalCandidateSection {
  id: string;
  sectionType: string;
  relatedTopics: string[];
  relatedProductKeys: string[];
  relatedSituations: string[];
  priority: number | null;
  active: boolean;
  /** Zeichenlaenge von `PlaybookSection.content` -- fuer die Budget-Kontrolle, ohne dass diese Funktion den Content-Text selbst braucht. */
  contentLength: number;
}

export interface PlaybookRetrievalOptions {
  /** Maximale Anzahl ausgewaehlter Sections (Pflichtparameter, Kostenkontrolle AP0 Abschnitt 15). */
  maxSections: number;
  /**
   * Maximale Gesamtzeichenzahl (Summe `contentLength`) der ausgewaehlten
   * Sections. Optional -- falls gesetzt, werden ueberzaehlige Sections
   * (in Prioritaets-Reihenfolge ab dem Punkt, an dem das Budget
   * ueberschritten wuerde) VERWORFEN statt gekuerzt (AP0 Abschnitt 15:
   * "ueberzaehlige Abschnitte werden verworfen statt gekuerzt") -- bewusst
   * ein strikter Praefix-Cutoff der prioritaetssortierten Liste, keine
   * Bin-Packing-Optimierung (vermeidet zusaetzliche, in AP0/Plan nicht
   * geforderte Auswahl-Heuristik).
   */
  maxTotalContentChars?: number;
}

export interface PlaybookRetrievalResult {
  /** IDs der ausgewaehlten `PlaybookSection`s, in Auswahl-/Prioritaetsreihenfolge. */
  selectedSectionIds: string[];
  /** Anzahl inhaltlich passender Sections, die wegen `maxSections`/`maxTotalContentChars` verworfen wurden (Debuggability, AP0 Abschnitt 6.2 "nachvollziehbar, warum ein Abschnitt gewaehlt wurde"). */
  discardedForBudgetCount: number;
}

function normalizeSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).filter((v) => v.length > 0));
}

function hasOverlap(candidateValues: readonly string[], contextSet: Set<string>): boolean {
  return candidateValues.some((v) => contextSet.has(v));
}

/**
 * Waehlt aus `candidateSections` die fuer `context` relevanten Abschnitte
 * aus (regelbasierter Metadaten-Abgleich, AP0 Abschnitt 6.2) und begrenzt
 * das Ergebnis nach `options` (Kostenkontrolle, AP0 Abschnitt 15).
 *
 * MATCHING-REGEL (bewusst einfach und nachvollziehbar, kein Scoring-
 * Modell -- Debuggability vor Praezision, AP0 Abschnitt 6.1/6.2):
 * - `!active` -> Abschnitt wird ignoriert (nie ausgewaehlt).
 * - Ein Abschnitt OHNE jegliche Metadaten (`relatedTopics`,
 *   `relatedProductKeys` UND `relatedSituations` alle leer) gilt als
 *   UNIVERSELL (kontextunabhaengige Basis-Guidance, z.B. typischerweise
 *   TONALITY/GENERAL_PRINCIPLE-Abschnitte) und matched IMMER -- rein
 *   strukturell abgeleitet (leere Arrays), keine Sonderbehandlung nach
 *   `sectionType` (vermeidet versteckte, typbasierte Business-Logik).
 * - Ansonsten matched ein Abschnitt, wenn MINDESTENS EINE seiner drei
 *   Metadaten-Listen mit dem entsprechenden Kontext-Set ueberlappt
 *   (`relatedProductKeys` vs. `productKeys`, `relatedSituations` vs.
 *   `situations`, `relatedTopics` vs. der Vereinigung aus
 *   `currentQuestionKey`/`activeRecommendationKeys`/`activeCampaignKeys`/
 *   `topics`) -- ODER-Verknuepfung ueber die drei Dimensionen, UND
 *   innerhalb jeder Dimension.
 *
 * SORTIERUNG (deterministisch): `priority` absteigend (`null` wird als
 * niedrigste Prioritaet behandelt, also nach allen gesetzten Werten
 * einsortiert), bei Gleichstand `id` aufsteigend als reiner, beliebiger
 * aber stabiler Tie-Breaker (kein fachlicher Bezug, nur fuer
 * Reproduzierbarkeit/Determinismus noetig).
 */
export function selectPlaybookSections(
  context: PlaybookRetrievalContext,
  candidateSections: readonly PlaybookRetrievalCandidateSection[],
  options: PlaybookRetrievalOptions,
): PlaybookRetrievalResult {
  const productKeys = normalizeSet(context.productKeys);
  const situations = normalizeSet(context.situations);
  const topics = normalizeSet([
    ...(context.currentQuestionKey ? [context.currentQuestionKey] : []),
    ...(context.activeRecommendationKeys ?? []),
    ...(context.activeCampaignKeys ?? []),
    ...(context.topics ?? []),
  ]);

  const matched = candidateSections.filter((section) => {
    if (!section.active) {
      return false;
    }
    const isUniversal =
      section.relatedTopics.length === 0 &&
      section.relatedProductKeys.length === 0 &&
      section.relatedSituations.length === 0;
    if (isUniversal) {
      return true;
    }
    return (
      hasOverlap(section.relatedProductKeys, productKeys) ||
      hasOverlap(section.relatedSituations, situations) ||
      hasOverlap(section.relatedTopics, topics)
    );
  });

  const sorted = [...matched].sort((a, b) => {
    const priorityA = a.priority ?? -1;
    const priorityB = b.priority ?? -1;
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const selected: PlaybookRetrievalCandidateSection[] = [];
  let cumulativeChars = 0;
  for (const section of sorted) {
    if (selected.length >= options.maxSections) {
      break;
    }
    if (
      options.maxTotalContentChars !== undefined &&
      cumulativeChars + section.contentLength > options.maxTotalContentChars
    ) {
      break;
    }
    selected.push(section);
    cumulativeChars += section.contentLength;
  }

  return {
    selectedSectionIds: selected.map((s) => s.id),
    discardedForBudgetCount: sorted.length - selected.length,
  };
}
