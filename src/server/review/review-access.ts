/**
 * Technische Zugriffskontrolle fuer die interne Pruefansicht `/review`
 * (siehe `src/app/review/page.tsx`).
 *
 * Diese Seite umgeht bewusst das Mandanten-Scoping (zeigt alle Mandanten
 * nebeneinander) und ist damit ein reines Entwicklungs-/Abnahme-Werkzeug -
 * niemals ein Endnutzer-Feature. Bis Phase 2B war das ausschliesslich in
 * einem Code-Kommentar dokumentiert, aber NICHT technisch durchgesetzt: die
 * Seite waere in einem Produktions-Deployment ganz normal erreichbar
 * gewesen. Diese Datei erzwingt die Beschraenkung stattdessen zur Laufzeit.
 *
 * Standardverhalten (Allowlist, nicht Blocklist): Die Seite ist NUR
 * erreichbar, wenn `NODE_ENV` einem der erlaubten Werte entspricht
 * (`development`, `test`). Jede andere Umgebung - insbesondere `production`,
 * aber auch ein unerwarteter/leerer Wert - fuehrt zu 404. Ueber
 * `ENABLE_REVIEW_PAGE` kann dieses Verhalten explizit uebersteuert werden
 * (z. B. `"false"`, um die Seite auch lokal hart abzuschalten).
 */

const ALLOWED_NODE_ENVS = new Set(["development", "test"]);

export interface ReviewAccessEnv {
  NODE_ENV?: string;
  ENABLE_REVIEW_PAGE?: string;
}

export function isReviewPageEnabled(env: ReviewAccessEnv): boolean {
  if (env.ENABLE_REVIEW_PAGE === "true") {
    return true;
  }
  if (env.ENABLE_REVIEW_PAGE === "false") {
    return false;
  }
  return ALLOWED_NODE_ENVS.has(env.NODE_ENV ?? "");
}
