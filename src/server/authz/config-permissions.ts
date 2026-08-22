/**
 * Configuration-RBAC fuer die Fach-Fragen-/Fragebogen-, (seit Phase 9 AP1)
 * Regel- UND (seit Phase 10 AP1) Provisionsmodell-Administration.
 * Ursprünglich Phase 8 AP2 (siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt
 * 3.2/5), um `config.rules.*` erweitert in Phase 9 AP1 (ChatGPT-GO
 * 2026-08-18) und um `config.commissions.*` erweitert in Phase 10 AP1
 * (ChatGPT-GO 2026-08-21, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt
 * 3/14 Punkt 4 -- "config.commissions.*", NICHT "config.pricing.*", da der
 * fachliche Gegenstand Provision/Commission ist, nicht Pricing). Um
 * `config.goals.*` erweitert in Phase 11 AP1 (ChatGPT finales GO
 * 2026-08-22, siehe PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 7)
 * -- regelt WER Ziele setzen darf; bewusst getrennt von der Frage, WER
 * welche Ziele SEHEN darf (weiterhin die bestehende Management-Scope-
 * Architektur aus Phase 7, siehe unten).
 * Durchgaengig additive Erweiterung der bestehenden `config_editor`/
 * `config_publisher`-Rollen statt neuer Rollen -- siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 2.1. Getrennt von der
 * Management-Analytics-Scope-Architektur aus Phase 7
 * (`src/server/authz/management-scope.ts`) -- ChatGPT wörtlich: "Die
 * bestehende Phase-7-Management-Scope-Architektur bleibt davon getrennt."
 *
 * Verbindliche Leitplanken (ChatGPT-GO, 2026-08-18, gelten fuer ALLE VIER
 * Permission-Gruppen gleichermassen, siehe Phase-11-Ergaenzung oben):
 * - Config-Permissions sind ausschliesslich TENANT-scoped (Fragen/
 *   Fragebögen, Regeln/RuleSets, Provisionsmodelle UND Ziele sind
 *   mandantenweit modelliert, kein `storeId`-Bezug im Schema) -- STORE-/
 *   COMPANY-Zuweisungen tragen NIE zu Config-Permissions bei, kein
 *   "künstlicher Store-Scope". (Die STORE/COMPANY/EMPLOYEE-Scope-Werte
 *   von `Goal.scopeType` sind ein rein fachlicher Adressierungs-Wert des
 *   Zielobjekts, KEIN Config-Permission-Scope -- wer ein Store-Ziel
 *   setzen darf, wird weiterhin ausschliesslich ueber die TENANT-scoped
 *   `config.goals.edit`-Permission entschieden.)
 * - Deny-by-default: keine qualifizierende Zuweisung -> leere Permission-
 *   Menge, NIE ein impliziter Vollzugriff.
 * - `publish` darf nicht implizit aus `edit` entstehen -- alle Keys werden
 *   unabhängig gewährt/geprüft (siehe `permissionKeysForSeedRole()` in
 *   seed-role-permissions.ts für die Rollen-Zuordnung).
 */

export const CONFIG_QUESTIONS_PERMISSION_KEYS = [
  "config.questions.view",
  "config.questions.edit",
  "config.questions.publish",
] as const;

/** Phase 9 AP1 (ChatGPT-GO 2026-08-18): Permission-Keys fuer den Regel-Editor. */
export const CONFIG_RULES_PERMISSION_KEYS = [
  "config.rules.view",
  "config.rules.edit",
  "config.rules.publish",
] as const;

/** Phase 10 AP1 (ChatGPT-GO 2026-08-21): Permission-Keys fuer den Provisionsmodell-Editor. */
export const CONFIG_COMMISSIONS_PERMISSION_KEYS = [
  "config.commissions.view",
  "config.commissions.edit",
  "config.commissions.publish",
] as const;

/** Phase 11 AP1 (ChatGPT finales GO 2026-08-22): Permission-Keys fuer die Zielverwaltung. */
export const CONFIG_GOALS_PERMISSION_KEYS = [
  "config.goals.view",
  "config.goals.edit",
  "config.goals.publish",
] as const;

/** Kombinierter Katalog aller Config-Permission-Keys (Fragen + Regeln + Provisionsmodelle + Ziele). */
export const ALL_CONFIG_PERMISSION_KEYS = [
  ...CONFIG_QUESTIONS_PERMISSION_KEYS,
  ...CONFIG_RULES_PERMISSION_KEYS,
  ...CONFIG_COMMISSIONS_PERMISSION_KEYS,
  ...CONFIG_GOALS_PERMISSION_KEYS,
] as const;

export type ConfigPermissionKey = (typeof ALL_CONFIG_PERMISSION_KEYS)[number];

function isConfigPermissionKey(value: string): value is ConfigPermissionKey {
  return (ALL_CONFIG_PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Eine bereits DB-seitig geladene, aktive (`revokedAt IS NULL`)
 * RoleAssignment-Zeile mit den fuer die Config-Permission-Aufloesung
 * noetigen Feldern. Nur `scopeType`/`permissionKeys` -- anders als bei
 * `ManagementScopeCandidate` wird hier keine Store-ID-Aufloesung benoetigt.
 */
export interface ConfigPermissionCandidate {
  scopeType: string;
  permissionKeys: string[];
}

/**
 * Reine Auswahllogik (kein DB-Zugriff, keine Seiteneffekte): vereinigt die
 * `config.questions.*`-, `config.rules.*`- UND `config.commissions.*`-
 * Permission-Keys aller TENANT-scoped Kandidaten-Zuweisungen. STORE-/
 * COMPANY-Zuweisungen werden ignoriert (siehe
 * Modul-Kommentar). Liefert ein leeres Array bei fehlender Berechtigung
 * (deny-by-default) statt `null` -- ein leeres Array ist hier bereits
 * eindeutig "keine Config-Berechtigung", es gibt (anders als bei
 * `ManagementScope`) keine Unterscheidung zwischen "kein Scope" und "Scope
 * ohne Inhalt".
 */
export function deriveConfigPermissions(
  candidates: ConfigPermissionCandidate[],
): ConfigPermissionKey[] {
  const granted = new Set<ConfigPermissionKey>();
  for (const candidate of candidates) {
    if (candidate.scopeType !== "TENANT") {
      continue;
    }
    for (const key of candidate.permissionKeys) {
      if (isConfigPermissionKey(key)) {
        granted.add(key);
      }
    }
  }
  return Array.from(granted);
}

/**
 * Wird geworfen, wenn eine Session die fuer eine Admin-/Konfigurations-
 * Aktion erforderliche Permission nicht besitzt. API-Routen (AP3+) mappen
 * dies auf HTTP 403 (analog `ManagementAccessDeniedError` aus Phase 7).
 */
export class ConfigAccessDeniedError extends Error {
  constructor(requiredPermission: ConfigPermissionKey) {
    super(`Fehlende Berechtigung: ${requiredPermission}`);
    this.name = "ConfigAccessDeniedError";
  }
}

/**
 * Zentrale Autorisierungsprüfung fuer alle Admin-/Konfigurations-Routen
 * (AP3+, Phase 9 AP2+ fuer Regeln, Phase 10 AP1+ fuer Provisionsmodelle):
 * prüft, ob die übergebene Session die geforderte `config.questions.*`-,
 * `config.rules.*`- oder `config.commissions.*`-Permission besitzt. Wirft
 * `ConfigAccessDeniedError`
 * bei fehlender Berechtigung -- es gibt keinen Codepfad, der eine
 * Config-Mutation ohne diese Prüfung ausführt (ChatGPT-Leitplanke:
 * "Permission + Tenant-Kontext müssen gemeinsam erfüllt sein", der
 * Tenant-Kontext wird bereits durch die bestehende
 * `withServerSessionTenantContext()`-Session-Bindung sichergestellt, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 5).
 */
export function requireConfigPermission(
  session: { configPermissions: ConfigPermissionKey[] },
  required: ConfigPermissionKey,
): void {
  if (!session.configPermissions.includes(required)) {
    throw new ConfigAccessDeniedError(required);
  }
}
