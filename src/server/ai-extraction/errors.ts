/**
 * Fehlerklassen der Extraction-Orchestrierung (Phase 12 AP2, siehe
 * `service.ts`).
 */

/**
 * Wird geworfen, wenn `isAiExtractionAvailable()` (Permission UND
 * Tenant-Feature-Flag) `false` liefert -- unabhaengig davon, WELCHE der
 * beiden Bedingungen fehlschlaegt. Bewusst EIN gemeinsamer Fehler statt
 * zweier unterscheidbarer Fehlerklassen: die Route soll nicht erkennbar
 * machen, ob eine Anfrage an der fehlenden Mitarbeiter-Permission oder am
 * deaktivierten Tenant-Feature-Flag scheitert (Minimal-Information-Prinzip,
 * analog dazu, dass die Route laut ChatGPT-Vorgabe "keine Providerdetails
 * nach aussen leaken" darf).
 */
export class AiExtractionNotAvailableError extends Error {
  constructor() {
    super("KI-Extraktion ist fuer dieses Konto aktuell nicht verfuegbar.");
    this.name = "AiExtractionNotAvailableError";
  }
}
