# Phase 11 – Implementierungsplan: Ziele-Modell (Goal/GoalVersion)

Stand: 2026-08-22. Basiert auf `PHASE_11_DISCOVERY.md` (AP0) und ChatGPTs
zehn Architekturentscheidungen dazu (2026-08-22, "GO für den
Implementation Plan"). Analog Phase 6–10: dieser Plan geht vor jedem
AP1-Code an ChatGPT zur Prüfung, danach an den Nutzer für das explizite
Implementierungs-GO.

## 1. Verbindliche Architekturentscheidungen (ChatGPT, 2026-08-22)

1. **Goal (Identität) + GoalVersion (Zielwert)** – kein
   Draft→Publish→ACTIVE/EXPIRED auf `Goal` selbst. `Goal` identifiziert
   den fachlichen Gegenstand (Scope + Metrik + Periode), `GoalVersion`
   trägt den konkreten Zielwert. Mehrere Perioden koexistieren
   nebeneinander (Q2/Q3/Q4 gleichzeitig gültig); innerhalb EINER Periode
   sind nachträgliche Korrekturen über neue `GoalVersion`-Zeilen
   historisiert (kein Datenverlust, Audit, reproduzierbare Reports).
2. **Feste Kalenderperioden**: `MONTH`/`QUARTER`/`YEAR`, keine freien
   `from`/`to`-Werte für die Zieldefinition (Trennung von der freien
   Analytics-Zeitraumwahl).
3. **Alle vier Scope-Ebenen**: `TENANT`/`COMPANY`/`STORE`/`EMPLOYEE`.
   Ausdrücklich **keine automatische Konsistenzrechnung** zwischen den
   Ebenen in Phase 11 (Store-Ziele müssen nicht zur Summe des
   Company-Ziels passen – unabhängige Managementziele).
4. **Drei Metriken zunächst**: `DEALS_CLOSED`, `REVENUE`, `CLOSE_RATE`.
5. **Typisierte Zielwerte** statt eines einzelnen `targetValueMinor`:
   `targetAmountMinor` (REVENUE) / `targetCount` (DEALS_CLOSED) /
   `targetPercentageBasisPoints` (CLOSE_RATE), serverseitige XOR-Regel
   je nach `metricKey` (analog Phase 10 TIERED-Lehre: fachlich falsche
   Zustände auf Daten-/Validator-Ebene verhindern).
6. **Currency-Pflicht bei REVENUE**, keine Währungsvermischung (analog
   `DealKpiByCurrency[]` – niemals EUR+USD+CHF blind summieren). Bei
   `DEALS_CLOSED`/`CLOSE_RATE` keine Currency.
7. **RBAC-Trennung**: `config.goals.view/edit/publish` (eigener,
   tenant-scoped Namespace, additiv zu Phase 8–10) für **wer darf Ziele
   setzen**; die bestehende Management-Scope-Architektur (Phase 7) für
   **wer darf welche Ziele sehen**.
8. **Mitarbeiter-Sichtbarkeit**: ausschließlich das eigene Ziel + eigener
   Ist-Wert + eigener Erreichungsgrad. Keine fremden Mitarbeiter-/
   Store-/Unternehmensziele, sofern nicht explizit freigegeben.
   Management sieht gemäß seinem `ManagementScope` (Employee/Store/
   Company/Tenant).
9. **Keine Recommendation-Engine-Rückkopplung** in Phase 11 (reines
   Reporting-Feature).
10. **Zwei getrennte UI-Flächen**: `/admin/goals` (Zielverwaltung:
    Zeitraum, Scope, Metrik, Zielwert, Currency, Status, Versionen,
    Audit) und eine Ziel-vs.-Ist-Erweiterung der bestehenden
    `/analytics`/`/analytics/management`-Dashboards (Spalten Ziel/Ist/
    Erreichung/Verbleibend).

**Explizit ausgeschlossen** (ChatGPT, Scope-Schutz): automatische
Zielverteilung, Forecasting, KI-Zielvorschläge, Bonus-/
Provisionskopplung, Recommendation-Priorisierung, neue
KPI-Berechnungen, frei definierbare Zeiträume, automatische Soll-Ist-
Konsistenz zwischen Tenant/Company/Store, Campaign-Verknüpfung.

## 2. Schema (Skizze, verbindliche Feldliste folgt in AP1)

```prisma
enum GoalPeriodType { MONTH QUARTER YEAR }
enum GoalScopeType  { TENANT COMPANY STORE EMPLOYEE } // eigenes Enum,
  // NICHT RoleScopeType wiederverwenden: RoleScopeType kennt kein
  // EMPLOYEE (Rollen werden nie auf einzelne Mitarbeiter vergeben,
  // Ziele aber schon) -- bewusste Abweichung, in AP1 an ChatGPT
  // gegenzuprüfen.
enum GoalMetricKey  { DEALS_CLOSED REVENUE CLOSE_RATE }

model Goal {
  id            String
  tenantId      String
  scopeType     GoalScopeType
  scopeId       String        // je nach scopeType: tenantId/companyId/storeId/employeeId
  metricKey     GoalMetricKey
  periodType    GoalPeriodType
  periodStart   DateTime      // periodEnd wird daraus abgeleitet (kalendarisch, kein freies Feld)
  currency      String?       // Pflicht bei REVENUE, sonst null
  createdAt     DateTime

  versions      GoalVersion[]
  @@unique([tenantId, scopeType, scopeId, metricKey, periodType, periodStart])
}

model GoalVersion {
  id                          String
  tenantId                    String
  goalId                      String
  versionNumber               Int
  status                      VersionStatus   // DRAFT/ACTIVE (Wiederverwendung, aber OHNE dass
                                                // ACTIVE die vorherige Periode "ablöst" -- nur
                                                // Korrektur INNERHALB derselben Goal-Identität)
  targetAmountMinor           Int?            // nur bei REVENUE
  targetCount                 Int?            // nur bei DEALS_CLOSED
  targetPercentageBasisPoints Int?            // nur bei CLOSE_RATE
  createdAt                   DateTime
  createdByUserId             String

  @@unique([tenantId, goalId, versionNumber])
}
```

Validator (`goal-validator.ts`, analog `commission-validator.ts`): genau
eines von `targetAmountMinor`/`targetCount`/`targetPercentageBasisPoints`
passend zu `metricKey`, `currency` gesetzt gdw. `metricKey === REVENUE`,
`scopeId` muss zu einer existierenden Entität des `scopeType` im
Tenant gehören (z. B. `STORE` → `Store.id` im selben Tenant).

## 3. Arbeitspakete

- **AP0** – Discovery (bereits erledigt, `PHASE_11_DISCOVERY.md`).
- **AP1** – Schema + Migration (`Goal`, `GoalVersion`, drei neue Enums),
  PGlite-Verifikation, RBAC-Grundgerüst `config.goals.view/edit/publish`
  additiv zu `ALL_CONFIG_PERMISSION_KEYS`.
- **AP2** – Service-Schicht `goal-admin.ts`: CRUD für `Goal` (Scope+
  Metrik+Periode-Identität) + `GoalVersion` (Zielwert-Historie pro
  Goal), Kardinalitätsregel (ein `Goal` pro
  Tenant+Scope+Metrik+Periodentyp+Periodenstart), `scopeId`-Validierung
  gegen die reale Organisationsstruktur.
- **AP3** – `goal-validator.ts` (XOR-Zielwert-Regel, Currency-Pflicht bei
  REVENUE), API-Routen `/api/admin/goals`, `/api/admin/goals/[id]/versions`.
- **AP4** – Ziel-vs.-Ist-Berechnung: neue reine Funktion(en) in
  `src/server/analytics/` (z. B. `goal-progress.ts`), die einen `Goal`+
  aktuelle `GoalVersion` gegen die passende bestehende KPI-Funktion aus
  `kpis.ts` (`getDealKpi`/`getConsultationVolumeKpi`) für den
  kalendarisch abgeleiteten Zeitraum abgleicht → `{target, actual,
achievementRate, remaining}`. Kein neuer Aggregations-Code, nur
  Wiederverwendung + Vergleich.
- **AP5** – RBAC/Sichtbarkeits-Integration: Mitarbeiter-Query
  (ausschließlich `scopeType=EMPLOYEE, scopeId=eigene employeeId`),
  Management-Query (gefiltert über bestehendes
  `resolveAuthorizedStoreFilter()`/`ManagementScope`, IDOR-Schutz analog
  Phase 7).
- **AP6** – Admin-UI `/admin/goals` (Liste, Formular Zeitraum/Scope/
  Metrik/Zielwert/Currency, Versionshistorie, Audit-Anzeige) – bewusst
  leichter als Phase 8–10 (kein Draft-Editor mit Publish-Workflow,
  reines CRUD+Historie).
- **AP7** – Analytics-UI-Erweiterung: `/analytics` (nur eigenes
  Mitarbeiterziel) und `/analytics/management` (Ziel/Ist/Erreichung je
  Scope-Auswahl) um eine Ziel-Spalte ergänzen.
- **AP8** – Audit/Reproduzierbarkeit: jede Goal-/GoalVersion-Mutation
  atomar mit `AuditLog`, Reproduzierbarkeitstest (ein späteres neues
  `GoalVersion` ändert nicht die historische Zielerreichung vergangener
  Perioden).
- **AP9** – Security/Regression/E2E (Desktop+Tablet, gleiche Härte wie
  Phase 8–10): RBAC, Tenant-Isolation/IDOR, Mitarbeiter-Sichtbarkeits-
  Grenze (kein Zugriff auf fremde Ziele), Management-Scope-Grenzen,
  Currency-Konsistenz, XOR-Validierung.
- **AP10** – Abschlussbericht Phase 11.

## 4. Offene technische Detailfragen für AP1 (an ChatGPT vor Code)

- Bestätigung des eigenen `GoalScopeType`-Enums (statt Wiederverwendung
  von `RoleScopeType`), da `EMPLOYEE` dort fehlt.
- Genaue `periodEnd`-Ableitung aus `periodStart`+`periodType`
  (kalendarisch, Zeitzone – Tenant hat keine explizite Zeitzone im
  Schema, bisherige Konvention prüfen).
- Ob `GoalVersion.status` überhaupt nötig ist oder ob "letzte
  `versionNumber` je `Goal`" als impliziter aktueller Wert genügt (ohne
  DRAFT-Zwischenstufe, da Ziele keinen Freigabe-Workflow wie
  Fragebögen/Regeln/Provisionsmodelle brauchen).

## 5. Nächster Schritt

Diesen Plan an ChatGPT zur Prüfung senden, anschließend explizites
Nutzer-Implementierungs-GO vor AP1-Code einholen (analog dem in allen
Vorgängerphasen etablierten Muster).
