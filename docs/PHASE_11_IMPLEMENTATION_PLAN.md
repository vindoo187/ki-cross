# Phase 11 – Implementierungsplan: Ziele-Modell (Goal/GoalVersion)

Stand: 2026-08-22. Basiert auf `PHASE_11_DISCOVERY.md` (AP0), ChatGPTs
zehn Architekturentscheidungen dazu (2026-08-22, "GO für den
Implementation Plan") sowie ChatGPTs vier Korrekturen zur ersten
Planfassung (2026-08-22, "GO für AP1" unter der Bedingung dieser vier
Punkte). Analog Phase 6–10: dieser Plan geht vor jedem AP1-Code an
ChatGPT zur Prüfung, danach an den Nutzer für das explizite
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
   **wer darf welche Ziele sehen**. Ergänzend (ChatGPT-Korrektur 1): AP2
   muss `scopeId` server-seitig zwingend gegen den Tenant validieren –
   `TENANT` ⇒ `scopeId === tenantId`; `COMPANY`/`STORE`/`EMPLOYEE` ⇒ die
   referenzierte Entität muss nachweislich zum selben Tenant gehören.
   Ohne diese Prüfung wäre ein tenantübergreifender IDOR über `scopeId`
   möglich.
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
  // bestätigt (ChatGPT): NICHT RoleScopeType wiederverwenden.
  // RoleScopeType kennt kein EMPLOYEE (Rollen werden nie auf einzelne
  // Mitarbeiter vergeben, Ziele aber schon) -- unterschiedliche fachliche
  // Konzepte (Authz/Rollen vs. Zieladressierung).
enum GoalMetricKey  { DEALS_CLOSED REVENUE CLOSE_RATE }

model Goal {
  id            String
  tenantId      String
  scopeType     GoalScopeType
  scopeId       String        // je nach scopeType: tenantId/companyId/storeId/employeeId
                               // AP2: serverseitig zwingend tenant-gebunden validieren (s.o., Korrektur 1)
  metricKey     GoalMetricKey
  periodType    GoalPeriodType
  periodStart   DateTime      // Beginn der Kalenderperiode (UTC, Tag-genau)
                               // KEIN periodEnd-Feld (ChatGPT-Korrektur 2): wird nie gespeichert,
                               // sondern deterministisch über getCalendarPeriodBounds(periodType,
                               // periodStart) abgeleitet. Alle zeitraumbasierten Filter verwenden
                               // durchgängig das halboffene Intervall [periodStart, periodEnd).
                               // Keine neue Tenant-Zeitzone-Infrastruktur: Tenant hat aktuell kein
                               // Zeitzonenfeld, es gilt die bestehende UTC/DateTime-Konvention wie
                               // überall sonst im System.
  currency      String?       // Pflicht bei REVENUE, sonst null
  createdAt     DateTime

  versions      GoalVersion[]
  @@unique([tenantId, scopeType, scopeId, metricKey, periodType, periodStart])
}

model GoalVersion {
  id                          String
  tenantId                    String
  goalId                      String
  versionNumber               Int   // aufsteigend, lückenlos je Goal; ältere Versionen bleiben
                                     // unverändert/historisch, keine Löschung
  // KEIN status-Feld (ChatGPT-Korrektur 3): kein DRAFT/ACTIVE auf GoalVersion.
  // "Version 1" = historisch, "Version 2" = aktuelle Korrektur usw. Welche
  // GoalVersion "aktuell" ist, wird AUSSCHLIESSLICH über eine zentrale
  // Resolver-Funktion getCurrentGoalVersion(goalId) bestimmt
  // (ORDER BY versionNumber DESC LIMIT 1). Kein anderer Code-Pfad darf
  // eigenständig eine "aktuelle" GoalVersion ermitteln (verhindert
  // verstreute Resolution-Logik, analog dem Grund für zentrale
  // Scope-Filter-Funktionen in Phase 7).
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

Neue zentrale Utilities (AP1/AP2, verbindlich statt Ad-hoc-Logik):

- `getCalendarPeriodBounds(periodType, periodStart): { periodStart, periodEnd }`
  – einzige Stelle, die `periodEnd` berechnet; halboffenes Intervall
  `[periodStart, periodEnd)`.
- `getCurrentGoalVersion(goalId): GoalVersion` – einzige Stelle, die die
  "aktuelle" `GoalVersion` bestimmt (s. o.).

**Zusätzliche ChatGPT-Auflage (finale Freigabe, 2026-08-22):**
Die `versionNumber`-Vergabe muss concurrency-sicher erfolgen – zwei
parallele Änderungen desselben `Goal` dürfen nicht dieselbe nächste
`versionNumber` berechnen (analog der in Phase 10 (AP9-Fix) gefundenen
Row-Lock-Falle bei `createDraftCommissionModelVersion()`). AP2 muss die
neue `GoalVersion` innerhalb einer Transaktion mit Row-Lock auf das
`Goal` (oder einer äquivalenten atomaren Konstruktion) erzeugen, nicht
per "SELECT MAX(versionNumber) dann INSERT".

## 3. Arbeitspakete

- **AP0** – Discovery (bereits erledigt, `PHASE_11_DISCOVERY.md`).
- **AP1** – Schema + Migration (`Goal`, `GoalVersion`, drei neue Enums),
  PGlite-Verifikation, RBAC-Grundgerüst `config.goals.view/edit/publish`
  additiv zu `ALL_CONFIG_PERMISSION_KEYS`.
- **AP2** – Service-Schicht `goal-admin.ts`: CRUD für `Goal` (Scope+
  Metrik+Periode-Identität) + `GoalVersion` (Zielwert-Historie pro
  Goal), Kardinalitätsregel (ein `Goal` pro
  Tenant+Scope+Metrik+Periodentyp+Periodenstart), `scopeId`-Validierung
  gegen die reale Organisationsstruktur, concurrency-sichere
  `versionNumber`-Vergabe (Row-Lock, s. o.).
- **AP3** – `goal-validator.ts` (XOR-Zielwert-Regel, Currency-Pflicht bei
  REVENUE), API-Routen `/api/admin/goals`, `/api/admin/goals/[id]/versions`.
- **AP3.5 (Vorstufe zu AP4, ChatGPT-Korrektur 2b)** – Vor jeglichem
  AP4-Code: prüfen, wie `startedAt`/`closedAt` und die bestehenden
  `kpis.ts`-Queries Zeitraumgrenzen aktuell behandeln (inklusive/
  exklusive Grenzen), damit `getCalendarPeriodBounds()` und das
  halboffene `[periodStart, periodEnd)`-Intervall konsistent mit der
  bestehenden Konvention sind. Reine Verifikation, keine neue Logik.
- **AP4** – Ziel-vs.-Ist-Berechnung: neue reine Funktion(en) in
  `src/server/analytics/` (z. B. `goal-progress.ts`), die einen `Goal`+
  `getCurrentGoalVersion()` gegen die passende bestehende KPI-Funktion
  aus `kpis.ts` für den über `getCalendarPeriodBounds()` abgeleiteten
  Zeitraum abgleicht → `{target, actual, achievementRate, remaining}`.
  Kein neuer Aggregations-Code, nur Wiederverwendung + Vergleich.
  Vor Implementierung (ChatGPT-Korrektur 4) exakte 1:1-Zuordnung
  Metrik → bestehende KPI-Funktion festlegen und mit ChatGPT
  gegenprüfen: `DEALS_CLOSED`/`REVENUE` → `getDealKpi()`
  (`DealKpiByCurrency[]`, je `currency`). `CLOSE_RATE` hat KEINE
  direkte 1:1-Entsprechung in `kpis.ts` (`getDealKpi`/
  `getConsultationVolumeKpi` liefern keine fertige Abschlussquote) –
  hier ist vorab zu klären, ob eine Quotienten-Bildung aus zwei
  vorhandenen Kennzahlen genügt oder ob dies bereits als "neue
  KPI-Berechnung" gilt und damit außerhalb des Phase-11-Scopes läge.
  Diese Klärung erfolgt VOR AP4-Code, nicht währenddessen.
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

## 4. Von ChatGPT geklärte Detailfragen (2026-08-22, vier Korrekturen)

Die ursprünglich offenen Detailfragen sind mit ChatGPTs vier Korrekturen
zur ersten Planfassung beantwortet und oben (Abschnitt 1 Punkt 7,
Abschnitt 2, Abschnitt 3 AP3.5/AP4) eingearbeitet:

1. `GoalScopeType` als eigenes Enum bestätigt (GO) – zusätzlich:
   `scopeId` muss in AP2 serverseitig zwingend tenant-gebunden validiert
   werden (TENANT/COMPANY/STORE/EMPLOYEE-spezifisch).
2. `periodEnd` wird NICHT gespeichert, sondern über
   `getCalendarPeriodBounds(periodType, periodStart)` deterministisch
   abgeleitet; halboffenes Intervall `[periodStart, periodEnd)`; keine
   neue Tenant-Zeitzone-Infrastruktur; vor AP4 (AP3.5) wird geprüft, wie
   bestehende KPI-Queries Zeitraumgrenzen behandeln.
3. `GoalVersion.status` entfällt vollständig – keine DRAFT/ACTIVE-Stufe.
   Einzige Quelle der Wahrheit für die "aktuelle" Version ist die
   zentrale Funktion `getCurrentGoalVersion(goalId)`.
4. Vor AP4-Code: exakte Zuordnung Metrik → bestehende `kpis.ts`-Funktion
   festlegen und mit ChatGPT gegenprüfen, insbesondere für
   `CLOSE_RATE`, da dort keine direkte 1:1-Entsprechung existiert.

ChatGPT (verbatim, 2026-08-22): "Wenn diese vier Punkte im
Implementation Plan korrigiert sind, gebe ich den Plan für AP1 frei.
Danach würde ich tatsächlich wieder strikt nach unserem bisherigen
Muster vorgehen: AP1 Schema + Migration + PGlite + RBAC, dann CI, dann
erst AP2."

## 5. Nächster Schritt

ChatGPT hat die korrigierte Fassung geprüft und final freigegeben
(2026-08-22): "Die korrigierte Fassung von Phase 11 ist aus
Architektur-Sicht stimmig. [...] Damit könnt ihr AP1 jetzt
implementieren." Auflage dabei: die zusätzliche Concurrency-Anforderung
aus Abschnitt 2 (concurrency-sichere `versionNumber`-Vergabe), bereits
oben eingearbeitet. Nach AP1 (Migration, Constraints,
PGlite-Verifikation, RBAC-Seed) erfolgt erneut eine Prüfung durch
ChatGPT, bevor AP2 beginnt.

Ausstehend: explizites Nutzer-Implementierungs-GO vor AP1-Code (analog
dem in allen Vorgängerphasen etablierten Muster).
