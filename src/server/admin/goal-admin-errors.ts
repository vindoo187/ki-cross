/**
 * Fehlerklassen der Goal-Management-API (Phase 11 AP2, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3). Eigene, von
 * `commission-admin-errors.ts`/`rule-admin-errors.ts`/`question-admin-errors.ts`
 * getrennte Fehlerhierarchie -- gleiches Trennungsprinzip wie zwischen den
 * uebrigen drei Fachadministrations-Domaenen.
 */

export class GoalAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ein referenziertes `Goal` existiert nicht (oder gehoert zu einem anderen Mandanten -- tenant-scoped `db`). */
export class GoalNotFoundError extends GoalAdminError {
  constructor(goalId: string) {
    super(`Goal "${goalId}" wurde nicht gefunden.`);
  }
}

/**
 * Kardinalitaetsverstoss: fuer die Kombination aus
 * `tenantId+scopeType+scopeId+metricKey+periodType+periodStart` existiert
 * bereits ein `Goal` (DB-UNIQUE-Constraint `goals_scope_metric_period_key`,
 * siehe Migration `20260822100000_goal_model`). Uebersetzung des rohen
 * Prisma-P2002-Fehlers in eine fachliche 409-Antwort -- analoges Muster wie
 * `CommissionModelVersionInvalidError`/P2002-Uebersetzung in
 * `commission-admin.ts`.
 */
export class GoalAlreadyExistsError extends GoalAdminError {
  constructor(
    public readonly scopeType: string,
    public readonly scopeId: string,
    public readonly metricKey: string,
    public readonly periodType: string,
    public readonly periodStart: string,
  ) {
    super(
      `Fuer Scope "${scopeType}:${scopeId}", Metrik "${metricKey}", Periode ` +
        `"${periodType}" ab "${periodStart}" existiert bereits ein Goal. Pro Tenant+Scope+Metrik+` +
        `Periodentyp+Periodenstart ist genau EIN Goal zulaessig -- Korrekturen erfolgen ueber eine neue ` +
        `GoalVersion des bestehenden Goal, nicht ueber ein zweites Goal.`,
    );
  }
}

/**
 * `scopeId` ist fuer den angegebenen `scopeType` nicht gueltig -- entweder
 * gehoert die referenzierte Entitaet (Company/Store/Employee) nicht zum
 * aktuellen Mandanten, oder (bei `scopeType: "TENANT"`) `scopeId` weicht von
 * der `tenantId` des aktuellen Mandanten ab. Diese Pruefung ist die
 * serverseitige Tenant-Bindung, die ChatGPT bei der Plan-Freigabe explizit
 * gefordert hat (PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 7): eine
 * rein polymorphe `scopeId`-Spalte ohne Fremdschluessel (siehe
 * Migrationskommentar) darf niemals ungeprueft als "zugehoerig" akzeptiert
 * werden.
 */
export class GoalScopeInvalidError extends GoalAdminError {
  constructor(
    public readonly scopeType: string,
    public readonly scopeId: string,
  ) {
    super(
      `scopeId "${scopeId}" ist fuer scopeType "${scopeType}" nicht gueltig -- die referenzierte ` +
        `Entitaet existiert nicht oder gehoert nicht zum aktuellen Mandanten.`,
    );
  }
}

/**
 * `getCurrentGoalVersion()` fand keine `GoalVersion`-Zeile fuer ein
 * existierendes `Goal` -- strukturell sollte dies nie auftreten, da
 * `createGoal()` Goal und die erste GoalVersion (versionNumber 1) immer
 * atomar in derselben Transaktion anlegt. Dient als Defense-in-Depth-Fehler
 * fuer den (bewusst nie erwarteten) Fall einer inkonsistenten Datenlage.
 */
export class GoalVersionNotFoundError extends GoalAdminError {
  constructor(goalId: string) {
    super(`Fuer Goal "${goalId}" wurde keine GoalVersion gefunden (unerwarteter Datenzustand).`);
  }
}
