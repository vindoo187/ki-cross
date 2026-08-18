/**
 * Configuration-RBAC fuer die Fragen-/Fragebogen-Administration (Phase 8
 * AP2, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.2/5). Getrennt von
 * der Management-Analytics-Scope-Architektur aus Phase 7
 * (`src/server/authz/management-scope.ts`) -- ChatGPT wörtlich: "Die
 * bestehende Phase-7-Management-Scope-Architektur bleibt davon getrennt."
 *
 * Verbindliche Leitplanken (ChatGPT-GO, 2026-08-18):
 * - Config-Permissions sind ausschliesslich TENANT-scoped (Fragen/
 *   Fragebögen sind mandantenweit modelliert, kein `storeId`-Bezug im
 *   Schema) -- STORE-/COMPANY-Zuweisungen tragen NIE zu Config-Permissions
 *   bei, kein "künstlicher Store-Scope".
 * - Deny-by-default: keine qualifizierende Zuweisung -> leere Permission-
 *   Menge, NIE ein impliziter Vollzugriff.
 * - `publish` darf nicht implizit aus `edit` entstehen -- die drei Keys
 *   werden unabhängig gewährt/geprüft (siehe `permissionKeysForSeedRole()`
 *   in seed-role-permissions.ts für die Rollen-Zuordnung).
 */

export const CONFIG_QUESTIONS_PERMISSION_KEYS = [
  "config.questions.view",
  "config.questions.edit",
  "config.questions.publish",
] as const;

export type ConfigPermissionKey = (typeof CONFIG_QUESTIONS_PERMISSION_KEYS)[number];

function isConfigPermissionKey(value: string): value is ConfigPermissionKey {
  return (CONFIG_QUESTIONS_PERMISSION_KEYS as readonly string[]).includes(value);
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
 * `config.questions.*`-Permission-Keys aller TENANT-scoped Kandidaten-
 * Zuweisungen. STORE-/COMPANY-Zuweisungen werden ignoriert (siehe
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
 * (AP3+): prüft, ob die übergebene Session die geforderte
 * `config.questions.*`-Permission besitzt. Wirft `ConfigAccessDeniedError`
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
