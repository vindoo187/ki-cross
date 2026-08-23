/**
 * Reine Selektionslogik zur Ableitung des Management-Analytics-Scopes aus
 * bereits geladenen RoleAssignment-Daten. Kein DB-Zugriff hier -- die
 * DB-seitige Ladung und Store-ID-Aufloesung erfolgt in
 * `src/server/auth/dev-users.ts` (`resolveManagementScopeForUser()`), damit
 * diese sicherheitskritische Auswahllogik isoliert und ohne DB unit-testbar
 * bleibt (siehe PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.4/4).
 *
 * Verbindliche Leitplanken (ChatGPT-Vorgabe, 2026-08-17):
 * - Deny-by-default: kann kein eindeutiger Scope ermittelt werden, liefert
 *   diese Funktion `null` -- NIE ein impliziter "alle Filialen"-Fallback.
 * - Kombinierte RoleAssignments: die HOECHSTE vorhandene Berechtigungsstufe
 *   (TENANT > COMPANY > STORE) gewinnt; bei mehreren Zuweisungen derselben
 *   Stufe werden deren Store-Mengen vereinigt (z. B. Filialleitung zweier
 *   Filialen). Diese Semantik ist Phase-7-uebergreifend verbindlich und wird
 *   nicht ad hoc pro Aufrufstelle neu erfunden.
 */

export type ManagementScopeLevel = "STORE" | "COMPANY" | "TENANT";

export interface ManagementScope {
  level: ManagementScopeLevel;
  /** Bereits vollstaendig aufgeloeste, zulaessige Store-IDs (bei einem nicht-null Scope nie leer). */
  storeIds: string[];
}

const LEVEL_RANK: Record<ManagementScopeLevel, number> = {
  STORE: 1,
  COMPANY: 2,
  TENANT: 3,
};

/** Permission-Key, den eine RoleAssignment fuer ihre eigene Scope-Ebene tragen muss, um zu qualifizieren. */
const REQUIRED_PERMISSION_BY_LEVEL: Record<ManagementScopeLevel, string> = {
  STORE: "analytics.view_store",
  COMPANY: "analytics.view_company",
  TENANT: "analytics.view_tenant",
};

/**
 * Eine bereits DB-seitig vorbereitete Kandidaten-Zuweisung: die Scope-Ebene
 * der RoleAssignment (aus `scopeType`), die vom zugehoerigen `Role`
 * tatsaechlich gehaltenen Permission-Keys, und die fuer DIESE Zuweisung
 * bereits konkret aufgeloeste Menge an Store-IDs (bei STORE: die eine
 * Filiale, bei COMPANY: alle Filialen der Company, bei TENANT: alle
 * Filialen des Mandanten -- diese Aufloesung erfolgt in `dev-users.ts`,
 * nicht hier). Nur aktive Zuweisungen (`revokedAt IS NULL`) duerfen hier
 * ankommen; das Filtern erfolgt ebenfalls im DB-Ladepfad.
 */
export interface ManagementScopeCandidate {
  scopeType: ManagementScopeLevel;
  permissionKeys: string[];
  storeIds: string[];
}

/**
 * Reine Auswahllogik (kein DB-Zugriff, keine Seiteneffekte). Deny-by-default:
 * liefert `null`, wenn keine Kandidaten-Zuweisung eine zu ihrer eigenen
 * Scope-Ebene passende `analytics.view_*`-Permission traegt, oder wenn die
 * hoechste qualifizierende Stufe (z. B. wegen fehlender Store-Zuordnung)
 * keine konkreten Store-IDs liefert.
 */
export function deriveManagementScope(
  candidates: ManagementScopeCandidate[],
): ManagementScope | null {
  const qualifying = candidates.filter((candidate) =>
    candidate.permissionKeys.includes(REQUIRED_PERMISSION_BY_LEVEL[candidate.scopeType]),
  );

  if (qualifying.length === 0) {
    return null;
  }

  const highestRank = Math.max(...qualifying.map((candidate) => LEVEL_RANK[candidate.scopeType]));
  const highestLevel = (Object.keys(LEVEL_RANK) as ManagementScopeLevel[]).find(
    (level) => LEVEL_RANK[level] === highestRank,
  );
  /* istanbul ignore next -- highestRank stammt immer aus LEVEL_RANK, daher immer auffindbar */
  if (!highestLevel) {
    return null;
  }

  const storeIds = Array.from(
    new Set(
      qualifying
        .filter((candidate) => candidate.scopeType === highestLevel)
        .flatMap((candidate) => candidate.storeIds),
    ),
  );

  if (storeIds.length === 0) {
    // Deny-by-default: eine hoechste Stufe ohne tatsaechlich aufgeloeste
    // Store-IDs (z. B. eine Company ohne Filialen) darf keinen "leeren, aber
    // gueltigen" Scope erzeugen -- das waere von einem "kein Zugriff" nicht
    // mehr unterscheidbar und koennte spaeter faelschlich als "0 Ergebnisse
    // im erlaubten Scope" statt "kein erlaubter Scope" interpretiert werden.
    return null;
  }

  return { level: highestLevel, storeIds };
}
