# Abschlussbericht Phase 11 – Ziele-Modell (Goal/GoalVersion)

Stand: 2026-08-23. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (gleiches Prinzip wie in den Abschlussberichten der Vorphasen).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Commit-Verlauf dieser Phase** (`git log --oneline 0620cad..c51b891`,
`0620cad` = Berichts-Commit Phase 10):

| Commit    | Inhalt                                                                        |  CI-Lauf   |  Ergebnis   |
| --------- | ----------------------------------------------------------------------------- | :--------: | :---------: |
| `f47b31f` | AP0 – Discovery (`PHASE_11_DISCOVERY.md`, keine Implementierung)              |     –      |      –      |
| `aaf4e04` | Implementierungsplan (Entwurf)                                                |     –      |      –      |
| `bbc4726` | Implementierungsplan um ChatGPTs vier Korrekturen ergänzt                     |     –      |      –      |
| `5cd94d2` | Concurrency-Auflage + ChatGPT finales GO für AP1 dokumentiert                 |     –      |      –      |
| `e52eb3a` | AP1 – Schema + Migration + PGlite-Verifikation + RBAC-Grundgerüst             |   CI #83   | **Failure** |
| `f577c33` | Fix CI #83 – verwaiste `Tenant.goalVersions`-Rückrelation entfernt            |   CI #84   | **Success** |
| `8692b6f` | AP2 – Service-Schicht `goal-admin.ts`                                         |   CI #85   | **Failure** |
| `f23d063` | Fix CI #85 – ISO-Zeitstempel löste PII-Telefonnummer-Heuristik aus            |   CI #86   | **Success** |
| `aaae5ed` | AP3 – `goal-validator.ts` + API-Routen `/api/admin/goals`                     |   CI #87   | **Success** |
| `0820820` | AP4 Schritt 1 – `getCalendarPeriodBounds()` (UTC-Kalenderperioden)            |   CI #88   | **Success** |
| `341933e` | AP4 Schritt 2 – DEALS_CLOSED/REVENUE-Mapping in `computeGoalProgress()`       |   CI #89   | **Success** |
| `0ae76d9` | AP4 Schritt 3 – CLOSE_RATE-Metrik implementiert                               |   CI #90   | **Success** |
| `a9fae3e` | AP5 – RBAC-/Sichtbarkeits-Integration (`goal-visibility.ts`)                  |   CI #91   | **Failure** |
| `7ffcaa7` | Fix CI #91 – echter Actor-User statt `randomUUID()` (FK-Verletzung)           |   CI #92   | **Success** |
| `f7d1be0` | AP6 – Admin-UI für Ziele-Modell (Listing, Detail, Formulare, Scope-Picker)    |   CI #93   | **Success** |
| `1aba7e2` | AP7 – Ziel-vs.-Ist-Integration in Analytics-Dashboards                        |   CI #94   | **Failure** |
| `7a9420f` | Fix CI #94 – `formatGoalPeriodLabel()` YEAR-Grammatik + Intl-Testassertions   |   CI #95   | **Success** |
| `670a0e4` | AP8 – Audit-/Reproduzierbarkeits-Regressionstests für `GoalVersion`           |   CI #96   | **Success** |
| `ee4a9c9` | AP9 – Security-/Regressionshärtung Goals-Feature                              |   CI #97   | **Failure** |
| `c51b891` | Fix CI #97 – Retry-Kollision + Strict-Mode-Violation in `admin-goals.spec.ts` | **CI #98** | **Success** |

Maßgeblich für den technischen Nachweis dieser Phase ist **CI #98** auf
dem finalen Stand `c51b891` – dieser Lauf deckt den gesamten kumulierten
Codestand von AP0 bis AP9 ab (973 Tests über vier Ebenen, davon 22/22
E2E-Tests Desktop+Tablet, siehe Abschnitt 10/11). Vier Zwischenläufe (CI
#83, #85, #91, #94) und ein E2E-Lauf (CI #97) schlugen fehl – **alle
waren echte, von CI gefundene Bugs, keine Sandbox-Artefakte**; Root
Causes und Fixes siehe Abschnitt 7/8. `git status` zum Zeitpunkt der
Fertigstellung dieses Berichts: sauber bis auf die für diesen Bericht
gehörenden Dokumentationsänderungen und die seit Phase 7–10 bekannten
untracked Altlasten (Abschnitt 13).

## 1. Technische Versionen

Unverändert gegenüber Phase 10 – **keine neuen Abhängigkeiten** in Phase 11
(`git diff --stat 0620cad..c51b891 -- package.json package-lock.json`
liefert keine Treffer):

- Node.js: `>=20.11 <23` (`package.json` `engines.node`)
- Paketmanager: npm (`packageManager: "npm@10.9.4"`)
- Next.js: `^15.5.22`
- React / React-DOM: `^19.2.8`
- Prisma / `@prisma/client`: `^6.19.3`
- Zod: `^3.25.76`
- TypeScript: `^5.9.3`
- Vitest: `^3.2.7`, `@playwright/test`: `^1.62.1`
- ESLint: `^9.19.0`, Prettier: `^3.4.2`

## 2. Ausgangslage und Ziel der Phase

Phase 11 = Ziele-Modell (`Goal`/`GoalVersion`), die zweite von vier vom
Nutzer bestätigten Folgephasen (Reihenfolge: Provisionsmodell-Editor →
**Ziele-Modell** → Freitext-KI-Angebot → Campaign-Management, jeweils
eigene, saubere Phase, nicht parallel).

**AP0-Kernentscheidungen** (`PHASE_11_DISCOVERY.md` +
`PHASE_11_IMPLEMENTATION_PLAN.md`, ChatGPTs zehn Architekturentscheidungen
vom 2026-08-22):

1. **Goal (Identität) + GoalVersion (Zielwert)** – bewusst **kein**
   Draft→Publish→ACTIVE/EXPIRED-Lebenszyklus wie bei
   Questionnaire/RuleSet/CommissionModel. `Goal` identifiziert den
   fachlichen Gegenstand (Scope + Metrik + Periode), `GoalVersion` trägt
   den konkreten Zielwert und ist append-only historisiert.
2. **Feste Kalenderperioden** (`MONTH`/`QUARTER`/`YEAR`), keine freien
   `from`/`to`-Werte – bewusste Trennung von der freien
   Analytics-Zeitraumwahl.
3. **Alle vier Scope-Ebenen** (`TENANT`/`COMPANY`/`STORE`/`EMPLOYEE`),
   ausdrücklich **keine automatische Konsistenzrechnung** zwischen den
   Ebenen (Store-Ziele müssen nicht zur Summe des Company-Ziels passen).
4. **Drei Metriken**: `DEALS_CLOSED`, `REVENUE`, `CLOSE_RATE`.
5. **Typisierte Zielwerte** statt eines einzelnen Feldes:
   `targetAmountMinor`/`targetCount`/`targetPercentageBasisPoints`,
   serverseitige XOR-Regel je nach `metricKey`.
6. **Currency-Pflicht bei REVENUE**, keine Währungsvermischung.
7. **RBAC-Trennung**: `config.goals.view/edit/publish` regelt **wer Ziele
   setzen darf**; die bestehende Management-Scope-Architektur (Phase 7)
   regelt **wer welche Ziele sehen darf** – zwei bewusst getrennte
   Autorisierungsmodelle.
8. **Mitarbeiter-Sichtbarkeit**: ausschließlich das eigene Ziel + eigener
   Ist-Wert + eigener Erreichungsgrad.
9. **Keine Recommendation-Engine-Rückkopplung** (reines
   Reporting-Feature).
10. **Zwei getrennte UI-Flächen**: `/admin/goals` (Zielverwaltung) und
    eine Ziel-vs.-Ist-Erweiterung der bestehenden
    `/analytics`/`/analytics/management`-Dashboards.

**Explizit ausgeschlossen** (Scope-Schutz, unverändert über die gesamte
Phase): automatische Zielverteilung, Forecasting, KI-Zielvorschläge,
Bonus-/Provisionskopplung, Recommendation-Priorisierung, neue
KPI-Berechnungen, frei definierbare Zeiträume, automatische Soll-Ist-
Konsistenz zwischen Tenant/Company/Store, Campaign-Verknüpfung,
historische as-of-Auswertungen, ein Snapshot-System.

Der Implementierungsplan durchlief zwei Prüfrunden bei ChatGPT: Runde 1
forderte vier Korrekturen (tenant-gebundene `scopeId`-Validierung, kein
gespeichertes `periodEnd`, kein `status`-Feld auf `GoalVersion`, vorherige
Klärung der Metrik→KPI-Zuordnung insbesondere für `CLOSE_RATE`); Runde 2
bestätigte alle vier Korrekturen und erteilte das GO für AP1 mit einer
zusätzlichen Auflage (concurrency-sichere `versionNumber`-Vergabe, siehe
Abschnitt 4).

## 3. Umfang dieser Phase (AP0–AP9)

- **AP0** – Discovery (`PHASE_11_DISCOVERY.md`).
- **Implementierungsplan** (`PHASE_11_IMPLEMENTATION_PLAN.md`) – zwei
  Prüfrunden bei ChatGPT, siehe Abschnitt 2.
- **AP1** – Schema + Migration (`Goal`, `GoalVersion`, drei neue Enums),
  PGlite-Verifikation, RBAC-Grundgerüst `config.goals.view/edit/publish`.
- **AP2** – Service-Schicht `goal-admin.ts`: CRUD für `Goal` (Identität)
  - `GoalVersion` (Zielwert-Historie), Kardinalitätsregel,
    `scopeId`-Validierung gegen die reale Organisationsstruktur,
    concurrency-sichere `versionNumber`-Vergabe.
- **AP3** – `goal-validator.ts` (metrikspezifische Zielwert-/
  Currency-Zuordnung), API-Routen `/api/admin/goals`,
  `/api/admin/goals/[id]/versions`.
- **AP3.5** – reine Verifikation (kein Code): bestehende
  Zeitraumgrenzen-Konvention in `kpis.ts` vor `getCalendarPeriodBounds()`
  geprüft.
- **AP4** – Ziel-vs.-Ist-Berechnung in drei Schritten:
  `getCalendarPeriodBounds()` (UTC-Kalenderperioden), DEALS_CLOSED/
  REVENUE-Mapping, CLOSE_RATE (nach eigener Discovery-Runde).
- **AP5** – RBAC-/Sichtbarkeits-Integration (`goal-visibility.ts`):
  Mitarbeiter-Eigensicht, Management-Subset-Regeln je Scope-Typ.
- **AP6** – Admin-UI `/admin/goals` (Liste, Detail, Formulare,
  Scope-Options-Picker).
- **AP7** – Analytics-UI-Erweiterung: Ziel-Kartensektion in
  `/analytics` und `/analytics/management`.
- **AP8** – Audit-/Reproduzierbarkeitsnachweis der gesamten
  Mutationskette AP1–AP7, gezielte Beweisführung ohne neuen
  Feature-Scope.
- **AP9** – Security/Regression/E2E (Desktop+Tablet), inkl. des in
  Abschnitt 8 beschriebenen E2E-Bugs und dessen Fix.

Von ChatGPT final abgenommen am 2026-08-23 auf Basis von CI #98 ("AP9
final abgenommen. Phase 11 AP0–AP9 vollständig." – GO für diesen
Abschlussbericht).

## 4. Architektur: Goal (Identität) + GoalVersion (append-only Zielwert)

**Kein Draft→Publish→ACTIVE/EXPIRED wie in Phase 8–10.** `Goal`
identifiziert den fachlichen Gegenstand über die UNIQUE-Kombination
`(tenantId, scopeType, scopeId, metricKey, periodType, periodStart)`
(Constraint `goals_scope_metric_period_key`) – pro Tenant+Scope+Metrik+
Periodentyp+Periodenstart ist genau ein `Goal` zulässig, mehrere
Perioden koexistieren nebeneinander (Q2/Q3/Q4 gleichzeitig gültig).
`GoalVersion` trägt ausschließlich den konkreten Zielwert und hat
**kein** `status`-Feld: "Version 1" ist historisch, "Version 2" die
aktuelle Korrektur, usw. Welche `GoalVersion` "aktuell" ist, wird
**ausschließlich** über die zentrale Resolver-Funktion
`getCurrentGoalVersion(goalId)` bestimmt (`ORDER BY versionNumber DESC
LIMIT 1`, `src/server/admin/goal-admin.ts`) – kein anderer Code-Pfad
darf eigenständig eine "aktuelle" `GoalVersion` ermitteln.

**`Goal` selbst hat keinen Update-Pfad.** Korrekturen am Zielwert
erfolgen ausschließlich über `createGoalVersion()` (neue Zeile, alte
bleibt unverändert bestehen). `createGoal()` legt `Goal` + die erste
`GoalVersion` (versionNumber 1) atomar in derselben Transaktion an – ein
"leeres" Goal ohne jede Version ist strukturell ausgeschlossen.

**Concurrency-sichere Versionsvergabe** (ChatGPTs zusätzliche Auflage bei
der finalen Plan-Freigabe, analog dem in Phase 10 AP9-Fix gefundenen
Race-Condition-Bug bei `createDraftCommissionModelVersion()`):
`createGoalVersion()` sperrt als **erste** Operation seiner Transaktion
die betroffene `goals`-Zeile:

```ts
await tx.$queryRaw`SELECT id FROM goals WHERE id = ${goalId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
```

erst danach wird `MAX(versionNumber)` gelesen und die neue Zeile
angelegt – ohne diesen Lock würden zwei parallele Aufrufe für dasselbe
`Goal` unter READ COMMITTED denselben `MAX(versionNumber)` lesen, bevor
einer committet. `createGoal()` selbst braucht diesen Lock nicht (immer
`versionNumber=1` für ein brandneues `Goal`, die Kardinalitäts-UNIQUE-
Constraint auf `goals` schützt bereits vor parallelem Doppel-Anlegen).

**Scope-ID-Tenant-Bindung** (ChatGPTs ausdrückliche Sicherheitsauflage):
`scopeId` ist bewusst **kein** Fremdschlüssel (polymorph je nach
`scopeType`) – die Zugehörigkeit zum aktuellen Mandanten wird daher
serverseitig vor jeder `Goal`-Mutation geprüft (`validateScopeId()` in
`goal-admin.ts`): `TENANT` muss exakt der aktuellen `tenantId`
entsprechen; `COMPANY`/`STORE`/`EMPLOYEE` müssen im aktuellen Tenant
existieren (Prüfung über den tenant-gescopten `db`-Client, dessen
Prisma-Extension die `tenantId` automatisch in jedes `where` mischt – ein
fremder `scopeId` liefert dadurch strukturell 0 Treffer). Bei einem
ungültigen Scope bleibt **keine** Mutation und **kein** Audit-Eintrag
zurück (`validateScopeId()` läuft bewusst **vor** Transaktionsbeginn).

**Kardinalitätsverstoß-Übersetzung:** `createGoal()` übersetzt eine
Verletzung von `goals_scope_metric_period_key` in
`GoalAlreadyExistsError` (HTTP 409) statt eines rohen P2002-Fehlers,
analoges Muster wie in `commission-admin.ts` (Phase 10).

## 5. Schema-/Migrationsänderungen

Eine neue Migration in Phase 11 (`git diff --stat 0620cad..c51b891 --
'prisma/migrations/*'`: 1 Datei, 80 Zeilen), `20260822100000_goal_model`
– rein additiv, keine Änderung an bestehenden Tabellen/Zeilen:

- Drei neue Enums: `GoalPeriodType` (MONTH/QUARTER/YEAR),
  `GoalScopeType` (TENANT/COMPANY/STORE/EMPLOYEE, eigenes Enum – bewusst
  nicht `RoleScopeType` wiederverwendet, da dieses kein EMPLOYEE kennt),
  `GoalMetricKey` (DEALS_CLOSED/REVENUE/CLOSE_RATE).
- Tabelle `goals`: `scopeId` als reine `UUID`-Spalte ohne FK (polymorph),
  `currency CHAR(3)` nullable, **kein `periodEnd`-Feld** (wird nie
  gespeichert, siehe Abschnitt 6), UNIQUE-Index
  `goals_scope_metric_period_key` auf `(tenant_id, scope_type, scope_id,
metric_key, period_type, period_start)`.
- Tabelle `goal_versions`: FK auf `goals(tenant_id, id)` (`onDelete:
Restrict`), FK auf `users(tenant_id, id)` für `created_by_user_id`
  (`onDelete: SetNull` – die historische Zeile bleibt bestehen, auch wenn
  der erstellende User später deaktiviert wird), UNIQUE-Index
  `goal_versions_tenant_id_goal_id_version_number_key`, sowie der
  metrik-**unabhängige** CHECK-Constraint
  `goal_versions_target_value_xor_check` ("genau eines der drei
  Zielwert-Felder ist gesetzt" – die metrik-**abhängige** Zuordnung, z. B.
  "REVENUE erfordert `targetAmountMinor`", ist eine Cross-Table-Regel
  gegen `Goal.metricKey` und daher nicht per DB-CHECK abbildbar, sondern
  serverseitig in `goal-validator.ts`, siehe Abschnitt 6).

`scripts/verify_migration_pglite.mjs` wurde entsprechend erweitert (86
Zeilen): PGlite-Verifikationsfälle für die neue Migration, u. a.
FK-Ablehnung bei nicht existierendem `Goal`, den XOR-Check und die
Kardinalitäts-UNIQUE.

## 6. Die drei Metriken: exakte Ist-Berechnung

`computeGoalProgress()` (`src/server/analytics/goal-progress.ts`) führt
**keine eigene KPI-Aggregation** durch, sondern ruft ausschließlich
bestehende KPI-Funktionen (`getDealKpi()`, `getConsultationVolumeKpi()`
aus `kpis.ts`) auf und vergleicht das Ergebnis mit dem Zielwert der
aktuellen `GoalVersion`.

**Periodengrenzen (`getCalendarPeriodBounds()`):** einzige Stelle im
System, die aus `Goal.periodType`/`Goal.periodStart` das (bewusst nicht
gespeicherte) `periodEnd` ableitet – **deterministisch in UTC** über
`Date.UTC()` mit den `getUTC*()`-Feldern von `periodStart` (explizit
**nicht** nach dem Muster von `dashboard-view.ts::resolvePeriodRange()`,
das lokale `Date`-Getter nutzt und damit von der Laufzeit-Zeitzone des
Node-Prozesses abhängt). Diese Entscheidung geht auf eine ausdrückliche
ChatGPT-Korrektur zurück (AP3.5-Nachprüfung, 2026-08-22): dasselbe Goal
dürfte je nach Deployment-Umgebung nicht unterschiedliche UTC-Grenzen
erzeugen. Rückgabe ist ein halboffenes Intervall `[periodStart,
periodEnd)`, identisch zur bestehenden `{gte: from, lt: to}`-Konvention
in `kpis.ts` (in AP3.5 als bereits kompatibel verifiziert, keine
Anpassung an den bestehenden KPI-Funktionen nötig).

**DEALS_CLOSED** → `DealKpiByCurrency.dealsClosed`, währungsunabhängig
über **alle** Currency-Buckets aufsummiert (Stückzahl, keine
Geldgröße). Ziel: `targetCount`.

**REVENUE** → `DealKpiByCurrency.totalContractValueMinor` **genau** des
Currency-Buckets, der `Goal.currency` entspricht – kein Aufsummieren über
Währungen, keine Umrechnung, keine Neuberechnung aus
`oneTimeRevenueMinor`/`monthlyRecurringRevenueMinor` (diese Summe liefert
`getDealKpi()` bereits fertig als `totalContractValueMinor`). Gibt es für
die Goal-Currency in der Periode keinen Bucket, ist `actual` explizit 0
(kein Fehler). Ziel: `targetAmountMinor` + `currency`.

**CLOSE_RATE** → "periodische Abschlussquote" (bewusst kein
Kohorten-Conversion-Maß): `dealsClosed / totalSessions`, Zähler aus
`getDealKpi()` (identisches DEALS_CLOSED-Mapping), Nenner aus
`getConsultationVolumeKpi().totalSessions`, **beide mit exakt denselben**
`[periodStart, periodEnd)`-Grenzen. `targetPercentageBasisPoints` liegt
bereits in Basispunkten vor (0..10000 = 0..100 %, analog der
`commissionPercentageBasisPoints`-Konvention) – `actual` wird daher
ebenfalls in Basispunkten berechnet (`Math.round(dealsClosed /
totalSessions * 10000)`), nicht als Prozentzahl 0..100. Bei
`totalSessions === 0` wird `achievementRate` explizit auf `null`
erzwungen (mathematisch undefiniert, analog der
`RecommendationOutcomeKpi.acceptanceRate`-Konvention) – dieser Sonderfall
ist unabhängig von der allgemeinen `target > 0`-Prüfung, da `target` bei
0 Beratungen durchaus > 0 sein kann. Es wurde bewusst **keine** neue
`getCloseRateKpi()`-Funktion in `kpis.ts` eingeführt – die Division
bleibt lokal in `computeGoalProgress()`.

**Allgemein:** `achievementRate = actual / target` (`null` falls `target`
0 ist), `remaining = target - actual` – bewusst **nicht** auf 0
geclampt, damit Übererfüllung (negativer Wert) erkennbar bleibt.

Die exakte Metrik-Zuordnung (insbesondere REVENUE = `totalContractValueMinor`
statt `monthlyRecurringRevenueMinor`, und CLOSE_RATE als reines
Periodenverhältnis statt Kohorten-Conversion) wurde jeweils erst nach
gezielter Rückfrage an ChatGPT festgelegt (Details der
Entscheidungsfindung: `project_ki_cross_phase11_plan_go.md`).

## 7. Scope-/RBAC-/Tenant-Isolation und Sichtbarkeit

**Zwei strukturell getrennte Lesepfade** (ChatGPTs ausdrückliche
Architekturvorgabe):

```
Admin-CRUD             -> goal-admin.ts       -> config.goals.*  (wer darf Ziele SETZEN)
Mitarbeiter-/Mgmt-Read  -> goal-visibility.ts  -> ManagementScope/Employee-Context (wer darf Ziele SEHEN)
```

`config.goals.view/edit/publish` ist ein eigener, tenant-scoped
Namespace additiv zu `ALL_CONFIG_PERMISSION_KEYS` (`config-permissions.ts`)
– `config_editor` erhält zusätzlich `config.goals.view`+`.edit`,
`config_publisher` zusätzlich alle drei Keys, beide automatisch über die
bestehende `permissionKeysForSeedRole()`-Logik (keine neuen Rollen).
`config.goals.publish` ist im Katalog vorhanden, wird aber von keiner
Goal-Route tatsächlich geprüft (Goal hat kein Publish-Konzept, siehe
Abschnitt 4) – eine bewusst dokumentierte, folgenlose Katalog-Inkonsistenz.

**Mitarbeiter-Sichtbarkeit** (`listVisibleGoalsForEmployee()`):
ausschließlich `Goal`s mit `scopeType=EMPLOYEE` und `scopeId` == der
eigenen `employeeId` aus dem `TenantContext` – die `employeeId` kommt
strukturell **nie** aus einem Request-Parameter.

**Management-Sichtbarkeit** (`listVisibleGoalsForManagement()`), vier
verbindliche Regeln je `Goal.scopeType`, alle über die bestehende
`resolveAuthorizedStoreFilter()` (Phase 7) aufgelöst:

- `STORE` → sichtbar, wenn `goal.scopeId` in `authorizedStoreIds` liegt.
- `COMPANY` → sichtbar, wenn **alle** Stores dieser Company vollständig
  in `authorizedStoreIds` enthalten sind (Subset-Prinzip – ein Manager
  mit nur zwei von vier Filialen darf das Company-Ziel nicht sehen).
- `TENANT` → sichtbar, wenn `authorizedStoreIds` **alle** Stores des
  Mandanten abdeckt (bewusst nicht `scope.level === "TENANT"` allein
  geprüft – ein Company-Manager mit voller Company-Abdeckung deckt
  dadurch nicht automatisch weitere Companies desselben Mandanten ab).
- `EMPLOYEE` → sichtbar, wenn der Mitarbeiter einem autorisierten Store
  angehört (Management darf individuelle Mitarbeiterziele sehen,
  additiv zur Mitarbeiter-Eigensicht, kein Widerspruch dazu).

Tenant-Isolation gilt immer zuerst und strukturell (tenant-gescopter
`db`-Client) – ein `Goal` eines fremden Mandanten kann durch keine
nachgelagerte Scope-Prüfung sichtbar werden.

**"Keine anteilige Zielprojektion"-Regel** (AP7, ChatGPTs Korrektur):
`buildGoalProgressForManagement()` erhält den **roh angewendeten**
Dashboard-Filter (nicht den vollen autorisierten Scope) – ein
COMPANY-Goal über zwei Filialen verschwindet, sobald auf eine einzelne
Filiale gefiltert wird, statt anteilig angezeigt zu werden. Damit prüft
`listVisibleGoalsForManagement()` gleichzeitig Autorisierung (der Filter
darf den Scope nur einschränken) und Goal-Scope-Zugehörigkeit zum genau
angewendeten Filter.

**KPI-Scope vs. Sichtbarkeit bewusst getrennt:**
`resolveGoalKpiScopeFilter()` beantwortet "welche Deals/Beratungen zählen
als Ist für dieses Goal", unabhängig von der Frage "wer darf das Goal
sehen" – beide gehen von `Goal.scopeType` aus, sind aber unterschiedliche
Fragen.

## 8. Der E2E-Bug in admin-goals.spec.ts (AP9, CI #97/#98)

**Ausgangspunkt:** die neue Playwright-Suite `tests/e2e/admin-goals.spec.ts`
(3 Tests: RBAC-Zugriff, Zugriffsverweigerung, vollständiger Anlegen- →
Korrektur-Flow) lief automatisch auf beiden Playwright-Projekten
(`desktop-chromium`, `tablet-ipad-landscape`), die parallel gegen
**eine** per `globalSetup` einmalig geseedete DB laufen.

**CI #97 – zwei getrennte Ursachen:**

1. **Strict-Mode-Violation:** der finale Listen-Text-Locator
   (`page.getByText(/Ziel: 80 Deals.*Version 2/)`) traf auf zwei
   Elemente – Desktop- und Tablet-Projekt erzeugten denselben
   Zielwertverlauf (50 → 80), der ursprüngliche `periodStartForProject()`
   variierte nur nach Projektname, nicht genug, um die tatsächlich
   angezeigte Textzeile eindeutig zu machen.
2. **Retry-Timeout:** beim automatischen CI-Retry (`retries: 1`)
   versuchte der wiederholte Testlauf, ein `Goal` mit identischem
   Scope+Metrik+Periode-Schlüssel wie im bereits erfolgreichen ersten
   Versuch anzulegen → 409 durch `goals_scope_metric_period_key` → keine
   Navigation → `waitForURL`-Timeout.

**Fix (Commit c51b891):** `periodStartForProject(projectName, retry)`
staffelt den Monat jetzt zusätzlich nach `testInfo.retry`, garantiert
Eindeutigkeit sowohl zwischen den Playwright-Projekten als auch
zwischen einem ursprünglichen Versuch und einem CI-Retry desselben
Tests. Die finale Sichtbarkeitsprüfung in der `/admin/goals`-Liste
identifiziert das eigene Goal ausschließlich über seinen `href`
(`/admin/goals/${goalId}`, aus der Detail-URL nach dem Anlegen
extrahiert) statt über mehrdeutigen Text.

**CI #98: grün** – 22/22 E2E-Tests auf beiden Projekten, vollständige
Pipeline erfolgreich.

## 9. Audit/Reproduzierbarkeit (AP8)

ChatGPTs zentrale Präzisierung vor AP8: "Reproduzierbarkeit" bedeutet in
Phase 11 ausdrücklich **nicht** "ein historischer Ziel-vs.-Ist-Bericht
kann exakt wiederhergestellt werden" (das wäre eine neue fachliche
Funktion mit eigenem asOf-Resolver – kein Bestandteil dieser Phase),
sondern **nur**: keine historische `GoalVersion` wird gelöscht oder
überschrieben, jede Korrektur erzeugt eine neue Version,
`getCurrentGoalVersion()` bleibt alleiniger Current-Resolver, eine neue
Version wirkt sofort für die laufende Periode. Kein DB-Trigger für
`goal_versions` – konsistent mit dem Phase 8–10-Muster
(CommissionModelVersion/QuestionnaireVersion/RuleSetVersion nutzen
ebenfalls reine Service-Semantik statt eines DB-Append-only-Triggers).

Verbindlich getestete Sequenz (`tests/integration/goal-admin.test.ts`,
Sektion 4): `Goal` → v1 anlegen → `getCurrentGoalVersion()` liefert v1 →
neue Version → v2 → `getCurrentGoalVersion()` liefert jetzt v2 → v1
bleibt **byte-identisch** zum Original-Erstellungswert (`toEqual()`) →
Audit enthält beide Versionen (3 CREATE-Einträge insgesamt: Goal +
GoalVersion v1 + GoalVersion v2). Zusätzliche Append-only-Regression:
drei aufeinanderfolgende `createGoalVersion()`-Aufrufe erzeugen drei
separate, seitdem unveränderliche Zeilen.

**PII-/Audit-Metadata-Regel** (aus dem CI-#85-Fund, siehe Abschnitt 12,
jetzt im Modulkommentar von `goal-admin.ts` dokumentiert): `AuditLog.metadata`
für `Goal`/`GoalVersion` darf **niemals** Datums-/Zeitstempel-Strings
enthalten (z. B. `periodStart.toISOString()`). Der generische PII-Scanner
(`src/server/validation/contact-data-guard.ts`) erkennt Ziffernfolgen ab
7 zusammenhängenden Ziffern als vermeintliche Telefonnummer – ein
ISO-8601-Zeitstempel matcht dieses Muster fälschlich. Zulässig sind
ausschließlich UUIDs (vom Scanner whitelisted), Enum-Strings und Zahlen.
Ein benötigtes Datum wird über `entityId` + Tabellen-Lookup
nachgeschlagen, nie direkt ins Audit-Metadata geschrieben.

## 10. Admin- und Analytics-UI

**`/admin/goals`** (AP6, bewusst deutlich leichter als Phase 8–10, da
kein Draft-Editor mit Publish-Workflow nötig ist): Listing-Seite mit
allen Goals des Tenants (`{Metrik-Label} – {Scope-Label}`, aktuelle
Version + Zielwert), Detailseite `/admin/goals/[id]` mit vollständiger
Versionshistorie (ohne Status-Badges/Rollback – jede Version ist bereits
final), `CreateGoalButton.tsx` (Formular: Scope-Typ → Scope-Options-Picker
→ Metrik → passendes Zielwertfeld → Periodentyp → Periodenbeginn),
`NewGoalVersionForm.tsx` ("Neue Zielkorrektur erfassen", nur das zur
Metrik passende Feld, kein Draft-Zustand). `goal-scope-options.ts`
(`listGoalScopeOptions(scopeType)`, liest `tenantId` selbst aus dem
Server-Kontext statt als Parameter – von ChatGPT ausdrücklich als
sicherere Variante bestätigt) liefert die Auswahloptionen für den
Scope-Picker; die serverseitige `validateScopeId()`-Prüfung bleibt die
alleinige fachliche Sicherheitsinstanz gegen ein manipuliertes `scopeId`.

**Analytics-Integration** (AP7): neue Ziel-Kartensektion in
`AnalyticsDashboardContent.tsx` (Mitarbeiter, nur eigenes aktives
EMPLOYEE-Goal) und `ManagementAnalyticsContent.tsx` (Management,
zusätzlich mit Scope-Zeile pro Karte). Nur "aktive" Goals werden gezeigt
(`isGoalPeriodActive()`: `periodStart <= now < periodEnd`, exakt über
`getCalendarPeriodBounds()`) – historische/zukünftige Goals bleiben
unverändert nur in `/admin/goals/[id]` sichtbar. Die Ziel-Anzeige ist
bewusst vom unabhängigen week/month-KPI-Zeitraumfilter entkoppelt und
zeigt immer die aktuell aktiven Goals; jede Karte macht die Periode
sichtbar (z. B. "August 2026 · Monatsziel"). Die UI-Komponenten
formatieren ausschließlich – die gesamte Berechnung liefert
`GoalProgressViewModel` aus `goal-visibility.ts` (Sichtbarkeit +
Scope-Auflösung + `computeGoalProgress()` bereits fertig kombiniert).

## 11. Anzahl und Art aller Tests

Vier Testebenen, insgesamt **973 Testfälle** (837 aus Phase 10 + 136 neu
in Phase 11), verifiziert per `git show <ref>:<datei> | grep -c` je
Datei gegen den Commit-Stand vor (`0620cad`) und nach (`c51b891`) dieser
Phase (konsistent mit der Zählmethode der Vorphasen-Berichte):

| Ebene                                    | Phase 10 | Neu in Phase 11 | Gesamt Phase 11 | Neue Dateien                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------: | --------------: | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (`npm run test:unit`)               |      368 |              49 |             417 | `tests/unit/goal-format.test.ts` (12, neu), `tests/unit/goal-progress.test.ts` (17, neu), `tests/unit/goal-validator.test.ts` (14, neu); erweitert: `authz/config-permissions.test.ts`, `authz/seed-role-permissions.test.ts`                                            |
| Component (`npm run test:component`)     |      117 |               0 |             117 | keine neuen Component-Tests in Phase 11 (nur eine kleine Erweiterung von `AnalyticsDashboardContent.test.tsx`)                                                                                                                                                           |
| Integration (`npm run test:integration`) |      333 |              84 |             417 | `goal-admin.test.ts` (20, neu), `goal-admin-routes.test.ts` (18, neu), `goal-progress.test.ts` (10, neu), `goal-progress-view.test.ts` (8, neu), `goal-scope-options.test.ts` (6, neu), `goal-scope-options-route.test.ts` (6, neu), `goal-visibility.test.ts` (16, neu) |
| E2E (`npm run test:e2e`)                 |       19 |               3 |              22 | `tests/e2e/admin-goals.spec.ts` (3, neu)                                                                                                                                                                                                                                 |
| **Gesamt**                               |  **837** |         **136** |         **973** |                                                                                                                                                                                                                                                                          |

**Inhalt der zentralen neuen Testdateien** (ausschließlich echte
Postgres-/Playwright-Fixtures, kein Mocking der DB-Schicht):

- `goal-admin.test.ts` (577 Zeilen, 20 Testfälle) – CRUD, Kardinalität,
  tenant-gebundene `scopeId`-Validierung für alle vier Scope-Typen,
  concurrency-sicherer Row-Lock inkl. Regressions-/Gegenprobe-Test,
  Audit-/Reproduzierbarkeitssequenz (Abschnitt 9).
- `goal-admin-routes.test.ts` (489 Zeilen, 18 Testfälle) – RBAC,
  401-ohne-Cookie, 403-ohne-Permission, 400/422/409-Fehlerpfade,
  201/200-Erfolg, Cross-Tenant-404 für Goal und GoalVersion.
- `goal-progress.test.ts` (420 Zeilen, 10 Testfälle) – Currency-Isolation,
  Periodengrenzen, fehlender Currency-Bucket, `target=0` → `null`,
  negatives `remaining` bei Übererfüllung, Defense-in-Depth-Fehler.
- `goal-progress-view.test.ts` (367 Zeilen, 8 Testfälle) – AP9-Ergänzung:
  mehrere gleichzeitig aktive Goals unterschiedlicher Metrik im echten
  View-Pfad, Versionswechsel wirkt nachweislich im vollständigen
  `buildGoalProgressForEmployee()`-Pfad.
- `goal-scope-options.test.ts`/`goal-scope-options-route.test.ts` (145 +
  173 Zeilen, 12 Testfälle) – Service- und Route-Ebene für den
  Scope-Picker, Tenant-Isolation, 401/403/400.
- `goal-visibility.test.ts` (346 Zeilen, 16 Testfälle) – alle vier
  Management-Sichtbarkeitsregeln inkl. beider Negativfälle,
  IDOR-Einschränkung, Deny-by-default, Tenant-Isolation.
- `tests/e2e/admin-goals.spec.ts` (171 Zeilen, 3 Testfälle) – siehe
  Abschnitt 8.
- `tests/unit/goal-progress.test.ts` (140 Zeilen, 17 Testfälle) –
  `getCalendarPeriodBounds()`: Monat, Quartal, Jahr, Schaltjahr,
  Jahreswechsel, exaktes halboffenes Intervall.
- `tests/unit/goal-validator.test.ts` (189 Zeilen, 14 Testfälle) – alle
  Metrik/Currency-Kombinationen der XOR-Regel.
- `tests/unit/goal-format.test.ts` (101 Zeilen, 12 Testfälle) –
  Formatierungshelfer inkl. des in CI #94 gefundenen YEAR-Grammatikfehlers.

## 12. Vollständige Prüfkommandos mit Ergebnissen

| Kommando                                                            | Ergebnis                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` (Stand `c51b891`)                                      | sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen und die bekannten untracked Altlasten (Abschnitt 13)                                                                                                                                                                              |
| `npx tsc --noEmit`                                                  | durchgängig identisch zur bekannten stale-Prisma-Client-Baseline (fehlende `goal`/`goalVersion`-Felder, unverändert seit Phase 8–10 durch `prisma generate` ohne Netzwerkzugriff in der Sandbox) – keine neuen Fehlerkategorien, nach jedem Fix in dieser Phase gegen die gespeicherte Baseline diffgeprüft |
| `npx eslint <geänderte Dateien>`                                    | durchgängig sauber                                                                                                                                                                                                                                                                                          |
| `npx prettier --check <geänderte Dateien>`                          | durchgängig sauber (zwei Dateien mussten während AP9 einmal per `--write` nachformatiert werden, danach sauber)                                                                                                                                                                                             |
| `npx vitest run` (alle vier Testebenen)                             | in dieser Sandbox nicht ausführbar (bekannte, sandboxweite `@rollup/rollup-linux-arm64-gnu`-Limitierung + fehlender Netzwerkzugriff für `prisma generate`, unverändert seit Phase 2/10) – Verifikation ausschließlich über CI                                                                               |
| GitHub Actions (`vindoo187/ki-cross/actions`, via Claude-in-Chrome) | CI #83–#98 (Details Commit-Tabelle, Kopf des Berichts); **CI #98 (`c51b891`): Success** – maßgeblicher Nachweis für diese Phase                                                                                                                                                                             |

**CI #98 im Detail:** vollständiger Lauf über den kumulierten Codestand
AP0–AP9, deckt ab: Lint/Prettier/`tsc` sauber, Migration gegen echte
Postgres-Test-DB angewendet, alle 951 Unit-/Component-/Integrationstests
grün, Produktions-Build (`next build`) erfolgreich, Playwright-E2E-Tests
**22/22 grün auf beiden Projekten** (Desktop + Tablet), keine Regression
in Phase 2–10.

**Sandbox-Einschränkung dieser Sitzung (unverändert seit Phase 2/10):**
weder `npx prisma generate` (403 Forbidden beim Abruf der
Engine-Checksummen von `binaries.prisma.sh`, kein Netzwerkzugriff) noch
`npx vitest run` (`Cannot find module '@rollup/rollup-linux-arm64-gnu'`)
konnten in dieser Sandbox direkt ausgeführt werden. Die tatsächliche
Ausführung aller 973 Testfälle ist ausschließlich über die CI-Läufe
#83–#98 belegt, deren Status über Claude-in-Chrome-Browserzugriff auf die
GitHub-Actions-Oberfläche ausgelesen wurde (clientseitig gerenderte
Seite, daher kein statischer `WebFetch`-Abruf). `tsc`/`eslint`/`prettier`
wurden in dieser Sitzung nach jedem einzelnen Fix tatsächlich lokal
ausgeführt.

## 13. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat 0620cad..c51b891` (`0620cad` = Berichts-Commit Phase 10,
`c51b891` = letzter Commit dieser Phase): **47 Dateien geändert, 7.132
Zeilen hinzugefügt, 30 Zeilen entfernt.**

```
docs/PHASE_11_DISCOVERY.md                                    |  216 + (neu)
docs/PHASE_11_IMPLEMENTATION_PLAN.md                          |  242 + (neu)
prisma/migrations/20260822100000_goal_model/migration.sql     |   80 + (neu)
prisma/schema.prisma                                          |  114 +
prisma/seed-e2e.ts                                            |   18 +-
prisma/seed.ts                                                |    8 +
scripts/verify_migration_pglite.mjs                           |   86 +-
src/app/admin/goals/[id]/page.tsx                             |  125 + (neu)
src/app/admin/goals/page.tsx                                  |  118 + (neu)
src/app/api/admin/goals/[id]/route.ts                         |   32 + (neu)
src/app/api/admin/goals/[id]/versions/route.ts                |   70 + (neu)
src/app/api/admin/goals/route.ts                              |   66 + (neu)
src/app/api/admin/goals/scope-options/route.ts                |   47 + (neu)
src/app/consultation/page.tsx                                 |   11 +
src/app/globals.css                                           |   81 +
src/components/admin/CreateGoalButton.tsx                     |  254 + (neu)
src/components/admin/GoalTargetValueFields.tsx                |  135 + (neu)
src/components/admin/NewGoalVersionForm.tsx                   |  120 + (neu)
src/components/analytics/AnalyticsDashboardContent.tsx        |   54 +
src/components/analytics/ManagementAnalyticsContent.tsx       |   60 +
src/lib/goal-format.ts                                        |  159 + (neu)
src/server/admin/goal-admin-errors.ts                         |  102 + (neu)
src/server/admin/goal-admin.ts                                |  519 + (neu)
src/server/admin/goal-schemas.ts                               |   92 + (neu)
src/server/admin/goal-scope-options.ts                        |  102 + (neu)
src/server/admin/goal-validator.ts                            |  174 + (neu)
src/server/analytics/dashboard-view.ts                        |   14 +-
src/server/analytics/goal-progress.ts                         |  333 + (neu)
src/server/analytics/goal-visibility.ts                       |  394 + (neu)
src/server/analytics/management-view.ts                       |   32 +-
src/server/authz/config-permissions.ts                        |   33 +-
src/server/authz/seed-role-permissions.ts                     |   13 +-
src/server/consultation-ui/http-errors.ts                     |   40 +
tests/component/AnalyticsDashboardContent.test.tsx            |    4 +
tests/e2e/admin-goals.spec.ts                                 |  171 + (neu)
tests/integration/goal-admin-routes.test.ts                   |  489 + (neu)
tests/integration/goal-admin.test.ts                          |  577 + (neu)
tests/integration/goal-progress-view.test.ts                  |  367 + (neu)
tests/integration/goal-progress.test.ts                       |  420 + (neu)
tests/integration/goal-scope-options-route.test.ts            |  173 + (neu)
tests/integration/goal-scope-options.test.ts                  |  145 + (neu)
tests/integration/goal-visibility.test.ts                     |  346 + (neu)
tests/unit/authz/config-permissions.test.ts                   |   67 +-
tests/unit/authz/seed-role-permissions.test.ts                |   29 +-
tests/unit/goal-format.test.ts                                |  101 + (neu)
tests/unit/goal-progress.test.ts                              |  140 + (neu)
tests/unit/goal-validator.test.ts                             |  189 + (neu)
47 files changed, 7132 insertions(+), 30 deletions(-)
```

Zusätzlich mit diesem Berichts-Commit: `docs/ABSCHLUSSBERICHT_PHASE11.md`
(neu, dieses Dokument).

## 14. Vollständige bekannte Einschränkungen

- **Zentrale Sandbox-Einschränkung (unverändert seit Phase 2/10):**
  weder `npx prisma generate` (403, kein Netzwerkzugriff) noch `npx
vitest run` (`@rollup/rollup-linux-arm64-gnu` fehlt) liefen in dieser
  Sitzung direkt – Verifikation ausschließlich über CI #83–#98.
- **Kein DB-Append-only-Trigger für `goal_versions`** – nur
  Service-Semantik (kein Update-/Delete-Pfad in `goal-admin.ts`),
  konsistent mit CommissionModelVersion/QuestionnaireVersion/
  RuleSetVersion (Phase 8–10, dieselbe bewusste Grenze).
- **CLOSE_RATE ist ein reines Periodenverhältnis, keine
  Kohorten-Conversion-Rate:** `dealsClosed`/`totalSessions` werden
  unabhängig nach `closedAt` bzw. `startedAt` gefiltert, es gibt keine
  Session→Deal-Zuordnung auf Datensatzebene für diese Metrik (bewusste,
  mit ChatGPT abgestimmte Entscheidung, siehe Abschnitt 6).
- **REVENUE verwendet ausschließlich `totalContractValueMinor`** (Summe
  Einmal- + MRR-Anteil der in der Periode abgeschlossenen Deals) – nicht
  `monthlyRecurringRevenueMinor` (das wäre eine andere, ebenfalls valide
  SaaS-Kennzahl "neu hinzugekommener MRR"), verbindlich von ChatGPT
  festgelegt.
- **Neue `GoalVersion` wirkt sofort auf die laufende Periode** – kein
  historischer asOf-Resolver, kein rückwirkend "eingefrorener"
  Ziel-vs.-Ist-Bericht für vergangene Zeitpunkte (siehe Abschnitt 9,
  ChatGPTs Scope-Abgrenzung für AP8).
- **UTC-Entscheidung bei `getCalendarPeriodBounds()`** ist eine bewusste
  Abweichung vom bestehenden `dashboard-view.ts::resolvePeriodRange()`-Muster
  (lokale Node-Prozess-Zeitzone) – beide Utilities bleiben unabhängig
  nebeneinander bestehen, `resolvePeriodRange()` wurde nicht rückwirkend
  umgebaut (separater Scope).
- **Keine Ausrichtungsprüfung für `periodStart`** (z. B. "MONTH erfordert
  den 1. des Monats um 00:00 UTC") – weder in `getCalendarPeriodBounds()`
  noch in `goal-validator.ts` vorhanden; als offene Beobachtung
  dokumentiert, kein Blocker für Phase 11.
- **`config.goals.publish` existiert im Permission-Katalog, wird aber
  von keiner Route geprüft** (Goal hat kein Publish-Konzept) – eine
  bewusst dokumentierte, folgenlose Katalog-Inkonsistenz (Abschnitt 7).
- **FUSE-Mount-Eigenheit dieser Sandbox** (wiederholt aufgetreten, jedes
  Mal folgenlos gelöst): Git-Befehle hinterließen mehrfach phantomhafte
  `index.lock`/`HEAD.lock`-Dateien – gelöst durch Umbenennen (nicht
  Löschen) der Lock-Datei und Wiederholung des Git-Befehls.
- **Zwei echte, in dieser Phase gefundene und behobene CI-Bugs**
  (CI #83/#85/#91/#94 Implementierungs-/Testfehler, CI #97
  Playwright-Strict-Mode-/Retry-Kollisionsfehler) – Details Abschnitt 8
  sowie die Commit-Tabelle am Kopf des Berichts.
- **Keine Rate-Begrenzung, kein User-Lifecycle-System, zwei parallele
  Login-Mechanismen** – alle unverändert aus Phase 8–10 übernommene,
  bewusste Einschränkungen, siehe `docs/ABSCHLUSSBERICHT_PHASE9.md`
  Abschnitt 13.
- **Testzahlen in Abschnitt 11 sind grep-/`git show`-basiert gezählt**,
  nicht aus einem in dieser Sitzung tatsächlich ausgeführten Testlauf –
  die tatsächliche Ausführung ist ausschließlich über die CI-Läufe
  #83–#98 belegt.

## 15. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **Forecasting, KI-Zielvorschläge, automatische Zielverteilung** –
  bewusster Scope-Ausschluss, siehe Abschnitt 2.
- **Bonus-/Provisionskopplung an Ziele, Recommendation-Rückkopplung** –
  bewusster Scope-Ausschluss, keine Verknüpfung zwischen Goals und der
  Recommendation Engine (Phase 3B/5) oder dem Provisionsmodell
  (Phase 10).
- **Freie Zeiträume für Zieldefinitionen** – nur feste Kalenderperioden
  (MONTH/QUARTER/YEAR), keine `from`/`to`-Zieldefinition.
- **Historische as-of-Auswertungen / Snapshot-System** – bewusster
  Scope-Ausschluss für AP8 (Abschnitt 9), separater zukünftiger Scope
  falls benötigt.
- **Automatische Soll-Ist-Konsistenzprüfung zwischen Tenant/Company/
  Store-Zielen** – bewusster Scope-Ausschluss, unabhängige
  Managementziele je Ebene (Abschnitt 2, Punkt 3).
- **Ausrichtungsprüfung für `periodStart`** (Kalendergrenzen-Snapping) –
  als offene Beobachtung vorgemerkt (Abschnitt 14).
- **Freitext-KI-Angebotsfeature, Campaign-Management** – bereits vor
  Phase 10/11 als nächste Phasen vorgesehen, weiterhin nicht begonnen.
- **Rate-Limiting/Brute-Force-Schutz, Passwort-Reset-/Einladungsflow,
  User-Lifecycle-System** – unverändert aus Phase 8–10 offen.
- **Sidebar-Feature** (AP-Navigation) – bereits vor Phase 8
  zurückgestellt, weiterhin offen.

## 16. Fazit

Phase 11 hat das Ziele-Modell (`Goal`/`GoalVersion`) als vierte
Fachadministrations-Fläche in ki-cross eingeführt – strukturell bewusst
**anders** als Phase 8–10: statt eines Draft→Validate→Publish-Workflows
trägt `Goal` eine unveränderliche fachliche Identität und `GoalVersion`
eine reine append-only Zielwert-Historie, deren "aktuelle" Version
ausschließlich über eine zentrale Resolver-Funktion bestimmt wird. Die
Phase führte außerdem eine vollständig neue Ziel-vs.-Ist-Berechnungsebene
ein (`goal-progress.ts`), die konsequent auf bestehende KPI-Funktionen
statt neuer Aggregationslogik zurückgreift, sowie einen zweiten,
strukturell von der Admin-RBAC getrennten Sichtbarkeits-Lesepfad
(`goal-visibility.ts`) für Mitarbeiter-/Management-Reporting.

Der Implementierungsprozess folgte durchgängig dem in Phase 9/10
etablierten Muster: vor jedem AP eine kurze, kodifizierte Discovery ohne
Code, explizite ChatGPT-Prüfrunden mit teils mehreren Korrekturen (vier
Korrekturen vor AP1, zwei Präzisierungen vor AP7, eine eigene
Discovery-Runde allein für die CLOSE_RATE-Metrik), sowie eine
konsequente "erst beweisen, dann fixen"-Fehlerdiagnose bei allen fünf in
dieser Phase aufgetretenen CI-Fehlschlägen (CI #83, #85, #91, #94, #97) –
jeder davon ein echter, von CI gefundener Bug (drei Implementierungs-
fehler, ein Testfehler mit einer echten Node-Versions-Inkompatibilität,
ein Playwright-Test-Isolationsfehler), keiner ein Sandbox-Artefakt.

Der technische Nachweis für die gesamte Phase ist CI #98 (Commit
`c51b891`, grün), der neben Build/TypeScript und allen bestehenden
Regressionstests aus Phase 2–10 auch die 136 neuen Phase-11-Tests (inkl.
des Row-Lock-Regressionstests, der vier Management-Sichtbarkeitsregeln
und der vollständigen Playwright-E2E-Suite auf Desktop + Tablet) gegen
eine echte Postgres-Datenbank erfolgreich ausführt. AP9 wurde von
ChatGPT auf dieser Basis final abgenommen ("Phase 11 AP0–AP9
vollständig."); dieser Bericht (AP10) schließt die Phase formal ab.
