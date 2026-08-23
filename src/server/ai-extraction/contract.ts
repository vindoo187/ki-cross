/**
 * Providerunabhaengiges Extraktions-Interface (Phase 12 AP1, ChatGPT-Schicht
 * 1 "Extraction Contract", siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt
 * 2). JEDER Provider (Mock in AP1-AP4, ein spaeterer echter externer
 * KI-Provider erst in AP5 nach separatem GO) implementiert ausschliesslich
 * dieses Interface -- kein Provider-spezifischer Typ (API-Client, Prompt-
 * Format, Modellname) leckt hier nach aussen. Das macht einen spaeteren
 * Providerwechsel (AP5) zu einem reinen Austausch der Implementierung ohne
 * Aenderung an Schicht 2/4/5/6 (ChatGPT: "Wir tauschen lediglich den
 * Provider aus, nicht die gesamte Architektur").
 *
 * WICHTIG (Datenschutz-Grenze, ChatGPT-Entscheidung 1, siehe
 * PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1): der Freitext verlaesst den
 * Request-Handler AUSSCHLIESSLICH ueber `AiExtractionProvider.extract()`.
 * Kein anderer Code-Pfad darf `AiExtractionRequest.freeText` lesen,
 * protokollieren oder persistieren -- weder `visible-question-context.ts`
 * noch `extraction-validator.ts` fassen dieses Feld an.
 */

import type { AiExtractionCandidate, AiExtractionVisibleQuestion } from "./types";

export interface AiExtractionRequest {
  /**
   * Der vom Mitarbeiter eingegebene Freitext. Wird NICHT persistiert (siehe
   * Modulkommentar) -- der Aufrufer (spaetere AP2-Route) darf diesen Wert
   * ausschliesslich transaktionsnah/in-memory halten.
   */
  freeText: string;
  /**
   * Der serverseitig ermittelte, erlaubte Fragenkatalog (siehe
   * `visible-question-context.ts`). Der Provider darf NUR `questionId`s aus
   * dieser Liste vorschlagen -- `extraction-validator.ts` erzwingt dies
   * zusaetzlich serverseitig (Defense-in-Depth, ein Provider ist nicht
   * vertrauenswuerdig).
   */
  visibleQuestions: AiExtractionVisibleQuestion[];
}

/**
 * Providerunabhaengiges Extraktions-Interface. `extract()` darf NIEMALS
 * werfen, um einen einzelnen unklaren Fall zu signalisieren -- laut ChatGPTs
 * Grundsatz ("lieber 'nicht erkannt' als eine falsche strukturierte
 * Antwort") bedeutet Unsicherheit schlicht: kein Kandidat fuer diese Frage in
 * der zurueckgegebenen Liste. Ein leeres Array ist ein vollkommen valides
 * Ergebnis (z. B. bei einem Freitext ohne erkennbare Fakten).
 */
export interface AiExtractionProvider {
  extract(request: AiExtractionRequest): Promise<AiExtractionCandidate[]>;
}
