"use client";

/**
 * Rein darstellende Komponenten fuer die Freitext-KI-Bestaetigungs-UX (Phase
 * 12 AP3, ChatGPT-GO 2026-08-23). Alle Zustands-/Fetch-Logik bleibt in
 * `QuestionFlow.tsx` (analog `StatusBanners.tsx` fuer AP4) -- diese Datei
 * enthaelt ausschliesslich Anzeige + Event-Weiterleitung.
 *
 * ChatGPTs verbindliche AP3-Leitplanken (siehe QuestionFlow.tsx-Modulkommentar
 * fuer die vollstaendige Umsetzung): Vorschlaege erscheinen SEPARAT am
 * jeweiligen Fragefeld (kein automatisches Ausfuellen), Einzelentscheidung
 * pro Vorschlag (Uebernehmen/Aendern/Verwerfen), keine Bulk-Uebernahme, keine
 * neue Persistenz fuer den Suggestion-State (rein React-State im Elternteil).
 */

import type { AiExtractionCandidate } from "@/server/ai-extraction/types";
import type { QuestionForAnswering } from "@/server/questionnaire/service";
import { formatSuggestionValue } from "@/lib/ai-suggestion-format";

interface AiSuggestionCardProps {
  candidate: AiExtractionCandidate;
  question: QuestionForAnswering;
  isEditing: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDismiss: () => void;
}

/**
 * Erscheint direkt bei der aktuell aktiven Frage, wenn dafuer ein noch
 * offener KI-Vorschlag existiert (siehe `QuestionFlow.tsx`: nur fuer
 * `activeQuestion` gerendert -- "separat am jeweiligen Fragefeld"). Im
 * `isEditing`-Modus zeigt `QuestionFlow` den Vorschlagswert bereits
 * vorausgefuellt im normalen Fragefeld an; diese Karte zeigt dann nur noch
 * den Hinweis + "Bearbeitung abbrechen" (das eigentliche Speichern laeuft
 * ueber den ganz normalen `onCommit()`-Pfad des Fragefelds selbst).
 */
export function AiSuggestionCard({
  candidate,
  question,
  isEditing,
  onAccept,
  onEdit,
  onCancelEdit,
  onDismiss,
}: AiSuggestionCardProps) {
  return (
    <div className="ai-suggestion" role="region" aria-label="KI-Vorschlag aus dem Freitext">
      <p className="ai-suggestion__value">
        KI-Vorschlag: <strong>{formatSuggestionValue(candidate, question)}</strong>
      </p>
      {isEditing ? (
        <>
          <p className="ai-suggestion__hint">
            Wert oben anpassen und wie gewohnt speichern, oder Bearbeitung abbrechen.
          </p>
          <div className="ai-suggestion__actions">
            <button type="button" onClick={onCancelEdit}>
              Bearbeitung abbrechen
            </button>
          </div>
        </>
      ) : (
        <div className="ai-suggestion__actions">
          <button type="button" onClick={onAccept}>
            Übernehmen
          </button>
          <button type="button" onClick={onEdit}>
            Ändern
          </button>
          <button type="button" onClick={onDismiss}>
            Verwerfen
          </button>
        </div>
      )}
    </div>
  );
}

interface PendingSuggestionEntry {
  questionId: string;
  label: string;
}

interface AiExtractionFormProps {
  freeText: string;
  onFreeTextChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  errorMessage: string | null;
  otherPendingSuggestions: PendingSuggestionEntry[];
  onJumpToQuestion: (questionId: string) => void;
}

/**
 * Freitext-Eingabe + "Vorschlaege generieren"-Aktion. Sendet AUSSCHLIESSLICH
 * `freeText` an die Route (nie einen eigenen Fragenkatalog, siehe
 * `ai-extraction/schemas.ts`-Kommentar). Listet zusaetzlich noch offene
 * Vorschlaege fuer NICHT aktive Fragen auf (Sprung-Links) -- rein
 * navigatorisch, keine Bulk-Aktion.
 */
export function AiExtractionForm({
  freeText,
  onFreeTextChange,
  onSubmit,
  submitting,
  errorMessage,
  otherPendingSuggestions,
  onJumpToQuestion,
}: AiExtractionFormProps) {
  return (
    <section className="ai-extraction-panel" aria-label="Freitext-KI-Angebot">
      <h2 className="ai-extraction-panel__title">Freitext-KI-Angebot (Beta)</h2>
      <p className="ai-extraction-panel__hint">
        Kundenaussagen als Freitext einfuegen. Die KI schlaegt passende Antworten fuer noch offene
        Fragen vor -- uebernommen wird nur, was Sie explizit bestaetigen.
      </p>
      <textarea
        className="ai-extraction-panel__textarea"
        value={freeText}
        onChange={(event) => onFreeTextChange(event.target.value)}
        placeholder="z. B. „Der Kunde moechte auch im EU-Ausland telefonieren und hat ein Budget von 40 Euro im Monat.“"
        rows={3}
        maxLength={4000}
        disabled={submitting}
      />
      <div className="ai-extraction-panel__actions">
        <button type="button" onClick={onSubmit} disabled={submitting || freeText.trim() === ""}>
          {submitting ? "Wird analysiert…" : "Vorschläge generieren"}
        </button>
      </div>
      {errorMessage && (
        <p className="ai-extraction-panel__error" role="alert">
          {errorMessage}
        </p>
      )}
      {otherPendingSuggestions.length > 0 && (
        <div className="ai-extraction-panel__pending">
          <p className="ai-extraction-panel__pending-label">
            Weitere offene Vorschläge ({otherPendingSuggestions.length}):
          </p>
          <ul className="ai-extraction-panel__pending-list">
            {otherPendingSuggestions.map((entry) => (
              <li key={entry.questionId}>
                <button type="button" onClick={() => onJumpToQuestion(entry.questionId)}>
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
