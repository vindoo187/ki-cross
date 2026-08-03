/**
 * Gemeinsame, rein darstellende Statuskomponenten fuer den
 * Fragebogen-Arbeitsplatz (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3
 * und Abschnitt 4: `SavingIndicator`, `ConflictBanner`, `OfflineBanner`).
 * Als eine Datei gefuehrt, da alle drei sehr klein sind und ausschliesslich
 * gemeinsam innerhalb von `QuestionFlow` verwendet werden.
 */

interface SavingIndicatorProps {
  status: "saving" | "saved" | "idle";
}

export function SavingIndicator({ status }: SavingIndicatorProps) {
  if (status === "idle") {
    return null;
  }
  return (
    <span
      className={`saving-indicator saving-indicator--${status}`}
      role="status"
      aria-live="polite"
    >
      {status === "saving" ? "Speichert…" : "Gespeichert"}
    </span>
  );
}

interface ConflictBannerProps {
  onReload: () => void;
}

/**
 * Wird bei `StaleAnswerVersionError` gezeigt (Zweitgeraet/Parallelbearbeitung,
 * siehe Plan Abschnitt 4). Keine automatische Zusammenfuehrung -- der
 * Mitarbeiter muss den aktuellen Serverstand explizit neu laden.
 */
export function ConflictBanner({ onReload }: ConflictBannerProps) {
  return (
    <div className="status-banner status-banner--conflict" role="alert">
      <p>
        Diese Antwort wurde zwischenzeitlich anderswo geaendert (z. B. auf einem anderen Geraet).
        Ihre lokale Eingabe wurde NICHT gespeichert.
      </p>
      <button type="button" onClick={onReload}>
        Aktuellen Stand neu laden
      </button>
    </div>
  );
}

interface OfflineBannerProps {
  onRetry: () => void;
  retrying: boolean;
}

/** Wird bei Netzwerkfehlern gezeigt -- manueller Retry statt Auto-Retry (siehe Plan Abschnitt 4). */
export function OfflineBanner({ onRetry, retrying }: OfflineBannerProps) {
  return (
    <div className="status-banner status-banner--offline" role="alert">
      <p>
        Speichern fehlgeschlagen (Netzwerkproblem). Bitte Verbindung pruefen und erneut versuchen.
      </p>
      <button type="button" onClick={onRetry} disabled={retrying}>
        {retrying ? "Versucht erneut…" : "Erneut speichern"}
      </button>
    </div>
  );
}
