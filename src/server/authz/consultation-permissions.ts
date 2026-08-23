/**
 * Laufzeit-Permission fuer das Freitext-KI-Angebotsfeature (Phase 12 AP1,
 * ChatGPT-GO 2026-08-23, siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1
 * Punkt 7). Bewusst KEIN `config.*`-Permission-Namespace (siehe
 * `config-permissions.ts`): dort geht es um WER eine tenantweite
 * Admin-/Konfigurationsressource (Fragen/Regeln/Provisionsmodelle/Ziele)
 * bearbeiten darf -- hier geht es um WER waehrend einer laufenden Beratung
 * ein Laufzeit-Feature benutzen darf. Deshalb auch bewusst KEINE
 * TENANT-Scope-Restriktion wie bei `deriveConfigPermissions()`: normale
 * Verkaufsberater:innen (Rolle `sales_employee`) erhalten ihre
 * RoleAssignment ueblicherweise mit `scopeType = "STORE"` (siehe
 * `prisma/seed.ts`) -- eine TENANT-only-Filterung wuerde die Permission fuer
 * genau die Mitarbeiter unbrauchbar machen, die sie eigentlich nutzen sollen.
 *
 * ChatGPT-Vorgabe (2026-08-23, zweite Pruefrunde): "Wir haben zwei
 * unterschiedliche Fragen: Darf der Mitarbeiter die Funktion benutzen? ->
 * neue Permission. Ist die Funktion fuer den Tenant ueberhaupt aktiviert? ->
 * Tenant-Feature-Flag. [...] Tenant Feature enabled UND User has permission
 * -> AI Extraction verfuegbar. [...] Das Feature-Flag darf keine
 * Sicherheitsentscheidung ersetzen. Die Permission bleibt serverseitig
 * zwingend." -- `isAiExtractionAvailable()` bildet exakt diese UND-Regel ab.
 * Gilt bereits fuer den `MockExtractionProvider` in AP1-AP4, keine Ausnahme
 * weil noch kein echter externer Provider angebunden ist.
 *
 * AP1-SCOPE (Grundgerüst): dieses Modul liefert nur die reine
 * Autorisierungslogik (Permission-Katalog, Ableitung, Guard, UND-Verknuepfung
 * mit dem Tenant-Feature-Flag) -- die tatsaechliche Verdrahtung in
 * `SessionPayload`/`dev-users.ts` sowie die Pruefung innerhalb der
 * `/api/consultation/sessions/[id]/ai-extraction`-Route erfolgt erst in AP2
 * (siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 4), analog dazu, wie
 * `config-permissions.ts` in Phase 8 AP2 zunaechst nur die Logik bereitstellte
 * und erst in AP3 tatsaechlich in Routen verwendet wurde.
 */

export const CONSULTATION_PERMISSION_KEYS = ["consultation.ai_extraction.use"] as const;

export type ConsultationPermissionKey = (typeof CONSULTATION_PERMISSION_KEYS)[number];

function isConsultationPermissionKey(value: string): value is ConsultationPermissionKey {
  return (CONSULTATION_PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Eine bereits DB-seitig geladene, aktive (`revokedAt IS NULL`)
 * RoleAssignment-Zeile mit den fuer die Consultation-Permission-Aufloesung
 * noetigen Feldern. Anders als `ConfigPermissionCandidate` wird `scopeType`
 * hier bewusst NICHT ausgewertet (siehe Modulkommentar) -- jede aktive
 * Zuweisung zaehlt, unabhaengig vom Scope.
 */
export interface ConsultationPermissionCandidate {
  permissionKeys: string[];
}

/**
 * Reine Auswahllogik (kein DB-Zugriff, keine Seiteneffekte): vereinigt die
 * `consultation.*`-Permission-Keys aller Kandidaten-Zuweisungen. Liefert ein
 * leeres Array bei fehlender Berechtigung (deny-by-default) statt `null`.
 */
export function deriveConsultationPermissions(
  candidates: ConsultationPermissionCandidate[],
): ConsultationPermissionKey[] {
  const granted = new Set<ConsultationPermissionKey>();
  for (const candidate of candidates) {
    for (const key of candidate.permissionKeys) {
      if (isConsultationPermissionKey(key)) {
        granted.add(key);
      }
    }
  }
  return Array.from(granted);
}

/**
 * Wird geworfen, wenn eine Session die fuer eine Consultation-Laufzeit-Aktion
 * erforderliche Permission nicht besitzt. Die API-Route (AP2) mappt dies auf
 * HTTP 403 (analog `ConfigAccessDeniedError`).
 */
export class ConsultationAccessDeniedError extends Error {
  constructor(requiredPermission: ConsultationPermissionKey) {
    super(`Fehlende Berechtigung: ${requiredPermission}`);
    this.name = "ConsultationAccessDeniedError";
  }
}

/**
 * Prueft, ob die uebergebene Session die geforderte `consultation.*`-
 * Permission besitzt. Wirft `ConsultationAccessDeniedError` bei fehlender
 * Berechtigung. Prueft AUSSCHLIESSLICH die Permission -- die zusaetzliche
 * Tenant-Feature-Flag-Bedingung wird separat ueber
 * `isAiExtractionAvailable()` verknuepft (siehe unten), da beide Bedingungen
 * aus unterschiedlichen Quellen stammen (Session vs. `Tenant`-Zeile) und der
 * Aufrufer (AP2-Route) ohnehin beide laden muss.
 */
export function requireConsultationPermission(
  session: { consultationPermissions: ConsultationPermissionKey[] },
  required: ConsultationPermissionKey,
): void {
  if (!session.consultationPermissions.includes(required)) {
    throw new ConsultationAccessDeniedError(required);
  }
}

/**
 * Bildet die von ChatGPT vorgegebene UND-Verknuepfung ab: "Tenant Feature
 * enabled UND User has permission -> AI Extraction verfuegbar." Reine
 * Funktion, damit sie unabhaengig von der konkreten Session-/Tenant-Ladeform
 * getestet werden kann. Der Aufrufer ist dafuer verantwortlich, dass
 * `hasPermission` bereits ueber `requireConsultationPermission()`/
 * `deriveConsultationPermissions()` und `tenantFeatureEnabled` ueber
 * `Tenant.aiExtractionEnabled` ermittelt wurde.
 */
export function isAiExtractionAvailable(
  hasPermission: boolean,
  tenantFeatureEnabled: boolean,
): boolean {
  return hasPermission && tenantFeatureEnabled;
}
