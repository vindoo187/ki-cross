# Abschlussbericht Phase 6 – Analytics-Grundlage & Deal-Erfassung

Stand: 2026-08-17. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (gleiches Prinzip wie in den Abschlussberichten der Vorphasen).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Zu unterscheiden: Implementierungs-Commits vs. dieser Berichts-Commit.**
Weil dieser Bericht selbst eine versionierte Datei im Repository ist
(`docs/ABSCHLUSSBERICHT_PHASE6.md`), ändert sein eigener Commit den `HEAD`
von `main` erneut. Deshalb wird hier der vollständige, nachvollziehbare
Verlauf aller relevanten Commits seit Beginn dieser Phase tabellarisch
geführt; der maßgebliche Implementierungs-Commit für die technische
Substanz dieses Berichts ist `350d5d5`.

| Commit    | Inhalt                                                                                                                                                                 | CI-Lauf |             CI-Ergebnis              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----: | :----------------------------------: |
| `3e45b5b` | AP1–AP10: Code-Verifikation, `CONSULTATION_STARTED`-Event, Commission-Extraktion, `closeDeal()`, Deal-API/-UI, KPI-Aggregation, Dashboard-UI, Testsuite, Dokumentation |         | (nicht einzeln geprüft, siehe unten) |
| `6ce63f3` | Dokumentations-Update `PHASE_6_IMPLEMENTATION_PLAN.md` (kein Code)                                                                                                     |   #30   |             **Success**              |
| `b905c2e` | AP12 – Security/UI Hardening & Abnahme (Deal-Unique-Constraint, Component-Tests, gezielter E2E-Test, Verifikationsdurchgang)                                           |   #31   |   Fehlgeschlagen (echter Testfund)   |
| `350d5d5` | AP12-Fix – `analytics-kpis.test.ts`-Fixture an neuen Unique-Constraint angepasst, **maßgeblicher Implementierungs-Commit**                                             |   #32   |             **Success**              |

CI-Lauf #30 deckt sowohl `3e45b5b` als auch `6ce63f3` ab (beide Commits vor
diesem Lauf gepusht); `git status` zum Zeitpunkt der Fertigstellung dieses
Berichts bestätigt einen sauberen Arbeitsbaum auf `350d5d5` plus den hier
mitgelieferten Dokumentationsänderungen (dieser Bericht selbst,
Präzisierungen in `docs/DEAL_CAPTURE.md`/`docs/ANALYTICS_AND_KPIS.md`,
Ergänzung `PHASE_6_IMPLEMENTATION_PLAN.md` Abschnitt 12.12).

## 1. Technische Versionen

Unverändert gegenüber Phase 5 – **keine neuen Abhängigkeiten** in Phase 6
(`git diff --stat a1a43c9..350d5d5 -- package.json package-lock.json`
liefert keine Treffer):

- Node.js: `>=20.11 <23` (`package.json` `engines.node`)
- Paketmanager: npm (`packageManager: "npm@10.9.4"`)
- Next.js: `^15.5.22`
- React / React-DOM: `^19.2.8`
- Prisma / `@prisma/client`: `^6.19.3`
- Zod: `^3.25.76`
- TypeScript: `^5.9.3`
- Vitest: `^3.2.7`, `@playwright/test`: `^1.62.1`, `jsdom` +
  `@testing-library/react`/`@testing-library/user-event`
- ESLint: `^9.19.0`, Prettier: `^3.4.2`

## 2. Umfang dieser Phase (AP1–AP13)

Phase 6 schließt die Kette **Beratung → Empfehlung → tatsächlicher
Geschäftsabschluss → messbare Analytics-Daten**, gemäß ChatGPTs
verbindlichem Scope-Rahmen (Plan-Review, siehe
`PHASE_6_IMPLEMENTATION_PLAN.md` Abschnitt 0/12.1): Deal-Erfassung als
minimaler, fachlich sauberer End-to-End-Flow (kein CRM), ein erster
produktiver Analytics-MVP, kein `KpiSnapshot`, keine unnötigen
Schema-/Migrationsänderungen.

- **AP1** – Code-Verifikation der drei offenen Planungsfragen (fehlende
  Events, Provisions-Berechnungskette, UI-Einstiegspunkt für Deals) –
  Ergebnis: nur `CONSULTATION_STARTED` hat einen echten, noch fehlenden
  fachlichen Auslöser; `CONSULTATION_TOPIC_OPENED`, `NEED_DETECTED`,
  `FOLLOW_UP_CREATED` bewusst NICHT nachgezogen (kein echter Auslöser im
  heutigen Produkt).
- **AP2** – `CONSULTATION_STARTED`-Event bei Sitzungsstart ergänzt
  (`questionnaire/service.ts`).
- **AP3** – `src/server/pricing/commission.ts` (Extraktion der bestehenden
  Commission-Auflösung aus `recommendation/service.ts`,
  `computeCommissionAmountMinor()` neu), `src/server/deals/errors.ts`,
  `financial-snapshot.ts` (`computeDealFinancialSnapshot()`, Formel v1),
  `service.ts` (`closeDeal()`, atomare Transaktion Deal + DealItem[] +
  DealFinancialSnapshot + `DEAL_CLOSED`-Event).
- **AP4** – `POST /api/consultation/sessions/[id]/deals`
  (`closeDealBodySchema`, Fehler-Mapping für alle 5 `DealEngineError`-
  Subklassen).
- **AP5** – Deal-Erfassung als Erweiterung der Zusammenfassungsseite
  (`DealClosureForm.tsx`, `DealSummaryCard` in `SessionSummaryView.tsx`,
  Vorauswahl aus angenommenen Empfehlungen).
- **AP7** – `src/server/analytics/kpis.ts`: live aggregierende
  Read-Funktionen (`getConsultationVolumeKpi()`,
  `getRecommendationOutcomeKpi()`, `getDealKpi()`), kein `KpiSnapshot`.
- **AP8** – `src/server/analytics/dashboard-view.ts` + `/analytics`
  (`src/app/analytics/page.tsx`): Kachel-Dashboard mit Zeitraum-/
  Filialfilter, nur Umsatz-KPIs, keine Provisions-/Margendaten.
- **AP9** – Unit-/Integrationstests für Commission, Financial-Snapshot,
  `closeDeal()`, KPI-Funktionen; PGlite-Migrationsprüfung erweitert.
- **AP10** – Dokumentation: `docs/DEAL_CAPTURE.md` (neu),
  `docs/CONSULTATION_UI.md`/`docs/ANALYTICS_AND_KPIS.md`/
  `docs/DATA_MODEL.md` aktualisiert.
- **AP11** – Lokale Verifikation (`tsc`, `eslint`, `prettier`), Commit
  `3e45b5b` + `6ce63f3`, CI #30 grün (inkl. `vitest run`, in dieser
  Sandbox selbst nicht ausführbar, siehe Abschnitt 9).
- **AP12** – Von ChatGPT nach AP11 neu definiert als **"Security/UI
  Hardening & Abnahme"** (siehe Abschnitt 5): systematische Prüfung von
  Atomizität, Doppelabschluss-Schutz, Formel-v1-Konformität,
  Provisions-Logik, Tenant-Isolation, KPI-Korrektheit, Event-Konsistenz,
  UI-Robustheit, plus Component-/gezielter E2E-Test.
- **AP13** – dieser Abschlussbericht.

Details zu Architektur, Provisions-/Kosten-Auflösung und der
Deckungsbeitrags-Formel v1: `docs/DEAL_CAPTURE.md` (140 Zeilen).

## 3. Schema-/Migrationsänderungen

**Eine neue Migration**, entstanden nicht in der ursprünglichen
Deal-Erfassung (AP3, dort war das Schema `Deal`/`DealItem`/
`DealFinancialSnapshot` bereits seit Phase 2 vollständig vorhanden – keine
Migration nötig), sondern erst im Hardening-Schritt AP12:

`prisma/migrations/20260817170000_deal_unique_consultation_session/migration.sql`
— `@@unique([tenantId, consultationSessionId])` auf `Deal` (siehe
Abschnitt 5, echter Sicherheitsbefund). `ls prisma/migrations/` bestätigt:
drei Migrationen aus Phase 2/3B (`20260731000000_init`,
`20260801095926_analytics_events_employee_restrict`,
`20260801130000_recommendation_engine`) plus diese eine neue.

`prisma generate` konnte in dieser Sandbox nicht ausgeführt werden
(`403 Forbidden` bei `binaries.prisma.sh` — Engine-Binary-Download durch
Sandbox-Netzwerkrestriktion blockiert). Unkritisch: eine reine
DB-Constraint-Ergänzung ohne neue Felder im generierten Client-Typ; `npx
tsc --noEmit` bestätigt, dass keine Client-Regenerierung nötig war.

## 4. Architektur der Deal-Erfassung und Analytics-Aggregation

Vollständig beschrieben in `docs/DEAL_CAPTURE.md`. Kernpunkte:

- **Ein einziger Schreibpfad:** `closeDeal()` legt `Deal` + `DealItem[]` +
  `DealFinancialSnapshot` + `DEAL_CLOSED`-Analytics-Event atomar in einer
  `db.$transaction(...)` an. Bewusst **ein Deal pro
  `ConsultationSession`** (kein CRM-Nachtragsprozess) – seit AP12 sowohl
  App-seitig (Precheck) als auch DB-seitig (Unique-Constraint)
  durchgesetzt (siehe Abschnitt 5).
- **Provisions-/Kosten-Auflösung:** dieselbe, aus der Empfehlungs-Engine
  wiederverwendete Berechnungskette (`ProductVersion → CommissionModel →
CommissionModelVersion`), jetzt in `src/server/pricing/commission.ts`
  gebündelt. Vollständig zum `closedAt`-Zeitpunkt aufgelöst und als fertig
  berechnete Minor-Beträge (nicht als Fremdschlüssel) in den append-only
  `DealFinancialSnapshot` geschrieben – spätere Änderungen an
  `CommissionModel`/`ProductCostVersion` beeinflussen bereits
  geschlossene Deals nie rückwirkend.
- **Deckungsbeitrags-Formel "v1"** (ChatGPT-Vorgabe): nur einmaliger
  Umsatz/Kosten fließen ein, `discountCostMinor` immer 0 (keine manuelle,
  unbelegte Rabatt-Eingabe), keine Vertragslaufzeit-Projektion,
  wiederkehrender Umsatz separat ausgewiesen.
- **Analytics-KPI-Aggregation:** `src/server/analytics/kpis.ts` –
  ausschließlich live aggregierende Read-Funktionen direkt gegen
  `AnalyticsEvent`/`ConsultationSession`/`Recommendation`/`Deal`, kein
  `KpiSnapshot` (ChatGPT-Vorgabe). Zeitraum-Filterung pro Datensatztyp
  (Sessions nach `startedAt`, Deals nach `closedAt` usw.),
  `getDealKpi()` gruppiert nach Währung.
- **Dashboard:** `/analytics`, Kachel-Layout ohne Charts (analog `/review`
  aus Phase 2), Zeitraum-Filter (Woche/Monat) + optionaler Filialfilter,
  nur eingeloggt erreichbar (kein RBAC – bestehender, in Phase 5
  dokumentierter Stop-Punkt).
- **Provision/Marge bewusst nicht im Dashboard:** `commissionAmountMinor`/
  `contributionMarginMinor` werden intern berechnet, aber im aktuellen
  RBAC-losen `/analytics` nicht gerendert – endgültige ChatGPT-Entscheidung
  (siehe Abschnitt 5), verifiziert durch
  `tests/component/AnalyticsDashboardContent.test.tsx`.

## 5. AP12 – Security/UI Hardening & Abnahme (mit echtem Befund)

Nach CI #30 (grün) hat ChatGPT AP12 nicht als Abschlussbericht, sondern als
gezielten Härtungs-/Abnahmeschritt neu definiert (`PHASE_6_IMPLEMENTATION_PLAN.md`
Abschnitt 12.8), mit der verbindlichen Entscheidung, dass Provision/Marge im
aktuellen `/analytics` NICHT angezeigt werden (RBAC-los) und dass
Component-Tests sowie ein gezielter Deal-E2E-Test nachgezogen werden
(keine vollständige E2E-Suite).

**Echter Sicherheitsbefund (AP12.1):** Das Invariant "ein Deal pro
`ConsultationSession`" war ausschließlich durch einen App-Level-Precheck in
`closeDeal()` durchgesetzt – **kein** DB-seitiger Unique-Constraint. Das ist
race-anfällig: zwei nahezu gleichzeitige Aufrufe (Doppel-Klick über zwei
Tabs, Netzwerk-Retry) könnten beide den Precheck passieren, bevor eine der
Transaktionen committet, und zu zwei Deal-Zeilen für dieselbe Session
führen.

**Fix:**

- `@@unique([tenantId, consultationSessionId])` auf `Deal` +
  additive Migration mit Bestandsprüfung auf bereits vorhandene Duplikate.
- `closeDeal()`: `db.$transaction(...)` in try/catch, fängt
  `Prisma.PrismaClientKnownRequestError` (Code `P2002`) ab und übersetzt
  sie in `DealAlreadyExistsForSessionError` (Defense-in-Depth, analog dem
  bestehenden Muster in `recommendation/outcome.ts`).
- `scripts/verify_migration_pglite.mjs`: neuer Smoke-Test verifiziert die
  Constraint-Ablehnung.
- `tests/integration/deals-service.test.ts`: neuer Regressionstest ruft
  `closeDeal()` zweimal via `Promise.allSettled()` für dieselbe Session
  auf, prüft genau einen Erfolg und dass am Ende genau ein Deal existiert.

**Weitere Prüfpunkte (Ergebnis):**

| Prüfpunkt                    | Ergebnis                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Deal-Atomizität              | bestätigt – Deal+Items+Snapshot+Event in einer Transaktion                                                          |
| Doppelte Abschlüsse          | echter Befund, behoben (siehe oben)                                                                                 |
| Financial-Snapshot/Formel v1 | verifiziert, exakt wie mit ChatGPT abgestimmt                                                                       |
| Provision/Marge              | verifiziert – eine einzige, geteilte Berechnungsquelle (`pricing/commission.ts`), keine Duplikation                 |
| Tenant-Isolation             | verifiziert – `ScopedPrismaClient` injiziert `tenantId` auch für `groupBy`/`aggregate`/`count`                      |
| KPI-Korrektheit              | Code-Review von `kpis.ts`/`dashboard-view.ts` bestätigt korrekte Aggregation, Währungstrennung, Empty-State         |
| Event-Konsistenz             | bereits in AP1/AP2 abschließend geklärt                                                                             |
| UI-Robustheit                | `DealClosureForm` verhindert Doppel-Submit, behandelt 409 graceful, zeigt Fehlertexte; Dashboard zeigt Empty-States |
| Component-Tests              | `DealClosureForm.test.tsx` (9 Fälle), `AnalyticsDashboardContent.test.tsx` (5 Fälle)                                |
| Gezielter E2E-Test           | `tests/e2e/deal-closure.spec.ts` (1 Fall)                                                                           |

**CI-Fund bei der Verifikation dieser Änderungen (AP12.7):** Commit `b905c2e`
löste in CI #31 einen echten Testfehler aus – nicht sandbox-bedingt, sondern
inhaltlich korrekt vom neuen Constraint erkannt. `tests/integration/analytics-kpis.test.ts`
legte in seiner Fixture drei Deals für dieselbe `ConsultationSessionId` an,
was den neu eingeführten Unique-Constraint verletzte. **Das ist ein
wertvoller Hardening-Befund**, kein Test-Artefakt: der neue fachliche
Invariant deckte einen bestehenden Widerspruch in einer Analytics-Test-
Fixture auf. Fix (Commit `350d5d5`): jeder der drei Test-Deals bekommt eine
eigene `ConsultationSession`; die beiden zusätzlichen Sessions liegen
bewusst außerhalb der in diesem Testfile geprüften Zeiträume, sodass die
bestehenden `getConsultationVolumeKpi()`-Erwartungswerte unverändert
bleiben (`getDealKpi()` filtert ohnehin über `closedAt`, nicht über die
Session). CI #32 (Commit `350d5d5`) **grün**, Laufzeit 3m 24s.

## 6. Bewusste Scope-Entscheidungen (transparent dokumentiert)

- `CONSULTATION_TOPIC_OPENED`, `NEED_DETECTED`, `FOLLOW_UP_CREATED` wurden
  **nicht** künstlich implementiert – kein produktiver fachlicher Trigger
  im heutigen Code (`ConsultationTopic`/`FollowUp` werden nirgends
  angewendet, `DetectedNeed` ist ein dokumentierter Legacy-Pfad). Ein
  künstliches Event hätte gegen ChatGPTs Regel "kein Event ohne echten
  Auslöser" verstoßen bzw. verdeckt neuen Funktionsumfang eingeführt.
- `OPPORTUNITY_OFFERED`/`OPPORTUNITY_DECLINED` waren bereits vor Phase 6
  vorhanden (AP1-Korrektur der ursprünglichen Ist-Analyse).
- `KpiSnapshot` wurde bewusst **nicht** eingeführt – Live-Aggregation
  reicht für den aktuellen Umfang (ChatGPT-Vorgabe).
- Provision/Marge werden intern berechnet, aber im aktuellen RBAC-losen
  `/analytics` **nicht** angezeigt (siehe Abschnitt 4/5).
- `discountCostMinor` ist in Formel v1 **immer 0** – keine manuelle,
  unbelegte Rabatt-Eingabe durch den Mitarbeiter.
- Keine Vertragslaufzeit-Projektion im Contribution Margin v1 – nur
  einmaliger Umsatz/Kosten fließen ein.
- Kein neuer RBAC-/Management-Analytics-Bereich in Phase 6 (spätere Phase,
  ChatGPT-Vorgabe).

## 7. Tenant-Isolation und Datenschutz

Unverändert gegenüber Vorphasen: jede neue Route/Service-Funktion läuft
ausschließlich über `runWithTenantContext()`/`scoped-client.ts`.
`WHERE_SCOPED_OPERATIONS` in `scoped-client.ts` injiziert `tenantId` auch
für `groupBy`/`aggregate`/`count` – kritisch, weil `kpis.ts` genau diese
Prisma-Methoden für die Aggregation nutzt. Bestehende
Mandantentrennungs-Tests (`tests/integration/tenant-isolation.test.ts`)
decken das strukturell ab; `tests/integration/analytics-kpis.test.ts`
enthält zusätzlich einen dedizierten Test ("Mandantentrennung: KPIs eines
Tenants beeinflussen keinen anderen Tenant"). Keine neuen
personenbezogenen Datenfelder in Phase 6.

## 8. Anzahl und Art aller Tests

Vier Testebenen, insgesamt **487 Testfälle** (436 aus Phase 5 + 51 neu in
Phase 6), grep-basiert gezählt (`grep -crE '^\s*it\(|^\s*test\('` je
Verzeichnis, konsistent mit den `it(`/`test(`-Aufrufen im gesamten
`tests/`-Verzeichnis):

| Ebene                                    | Phase 5 | Neu in Phase 6 | Gesamt Phase 6 | Neue Dateien/Fälle                                                                                                                                                                   |
| ---------------------------------------- | ------: | -------------: | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (`npm run test:unit`)               |     260 |             18 |            278 | `tests/unit/pricing/commission.test.ts` (8), `tests/unit/deals/financial-snapshot.test.ts` (10)                                                                                      |
| Component (`npm run test:component`)     |     103 |             14 |            117 | `tests/component/DealClosureForm.test.tsx` (9), `tests/component/AnalyticsDashboardContent.test.tsx` (5)                                                                             |
| Integration (`npm run test:integration`) |      67 |             18 |             85 | `tests/integration/deals-service.test.ts` (12), `tests/integration/analytics-kpis.test.ts` (5), +1 Regressionsfall in `questionnaire-engine.test.ts` (17→18, `CONSULTATION_STARTED`) |
| E2E (`npm run test:e2e`)                 |       6 |              1 |              7 | `tests/e2e/deal-closure.spec.ts` (1)                                                                                                                                                 |
| **Gesamt**                               | **436** |         **51** |        **487** |                                                                                                                                                                                      |

Details zu den Testinhalten: Commission-Auflösung (FLAT/TIERED/PERCENTAGE,
Rundung, Basis-Points-Randfälle), Deckungsbeitrags-Formel v1 (inkl.
Regressionstest für den in AP3 gefundenen Doppelverrechnungs-Bug bei
mengenskalierten Provisionen), `closeDeal()` End-to-End (Erfolg,
Session-Status-Whitelist, alle 5 Fehlerklassen, Mandantentrennung,
Race-Condition-Regressionstest aus AP12), KPI-Funktionen gegen Fixtures mit
bekannten Erwartungswerten (Zeitraum-Grenzen, Store-Filter,
Währungsgruppierung), `DealClosureForm` (Darstellung, erfolgreicher
Abschluss, kein Doppel-Submit, 409-Stillreload, Fehleranzeige),
`AnalyticsDashboardContent` (KPI-Werte, Empty-States, Filialfilter, keine
Provisions-/Margendaten gerendert), gezielter Deal-Abschluss-E2E-Flow
(Empfehlung annehmen → Deal erfassen → read-only Anzeige → kein erneuter
Abschluss nach Reload).

## 9. Vollständige Prüfkommandos mit Ergebnissen

| Kommando                                                            | Ergebnis                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` (Stand `350d5d5` + Doku-Nacharbeiten)                  | sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen                                                                                                                                                                                                                                 |
| `npx tsc --noEmit`                                                  | sauber                                                                                                                                                                                                                                                                                                    |
| `npx eslint .`                                                      | sauber                                                                                                                                                                                                                                                                                                    |
| `npx prettier --check .`                                            | sauber                                                                                                                                                                                                                                                                                                    |
| `node scripts/verify_migration_pglite.mjs`                          | Alle 4 Migrationen angewendet, 61 Tabellen/101 Fremdschlüssel; Deal-Unique-Constraint-Ablehnung verifiziert; append-only-Trigger für `deal_financial_snapshots` bestätigt (UPDATE/DELETE abgelehnt), `deal_items` bewusst mutabel bestätigt; "ALLE MIGRATIONSPRUEFUNGEN (PHASE 3B + PHASE 6) ERFOLGREICH" |
| `ls prisma/migrations/`                                             | 4 Migrationen, davon 1 neu in Phase 6 (siehe Abschnitt 3)                                                                                                                                                                                                                                                 |
| GitHub Actions (`vindoo187/ki-cross/actions`, via Claude-in-Chrome) | CI #30 (`6ce63f3`): Success; CI #31 (`b905c2e`): Failure (echter Testfund, siehe Abschnitt 5); CI #32 (`350d5d5`): Success, 3m 24s                                                                                                                                                                        |

**Sandbox-Einschränkung dieser Sitzung (unverändert seit Phase 2):** `npx
vitest run` (alle vier Testebenen) konnte in dieser Sandbox nicht direkt
ausgeführt werden – `prisma generate` schlägt mit `403 Forbidden` auf
`binaries.prisma.sh` fehl (siehe Abschnitt 3), und das aus Phase 5 bekannte
`@rollup/rollup-linux-arm64-gnu`-Problem besteht unverändert. Die
tatsächliche Ausführung aller vier Testebenen (487 Testfälle, siehe
Abschnitt 8) ist ausschließlich über CI-Lauf #32 (Commit `350d5d5`,
Ergebnis `success`) belegt, dessen Log über Claude-in-Chrome-Browserzugriff
ausgelesen wurde (statische `WebFetch`-Abrufe der GitHub-Actions-Seite
liefern unzuverlässige/veraltete Daten, da die Seite clientseitig
gerendert wird). `git status` bestätigt einen sauberen Arbeitsbaum auf
`350d5d5`, `tsc`/`eslint`/`prettier` wurden in dieser Sitzung tatsächlich
lokal ausgeführt (kein Sandbox-Problem für diese drei Werkzeuge, siehe
Phase-5-Bericht Abschnitt 12.6c für den Hintergrund dieser Unterscheidung).

## 10. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat a1a43c9..350d5d5` (`a1a43c9` = Berichts-Commit Phase 5,
`350d5d5` = Implementierungs-Commit dieser Phase): **35 Dateien geändert,
4.752 Zeilen hinzugefügt, 66 Zeilen entfernt.**

```
PHASE_6_IMPLEMENTATION_PLAN.md                                    | 801 +++++++++++
docs/ANALYTICS_AND_KPIS.md                                        |  36 +
docs/CONSULTATION_UI.md                                           |  38 +
docs/DATA_MODEL.md                                                |   2 +-
docs/DEAL_CAPTURE.md                                              | 139 ++
prisma/migrations/20260817170000_deal_unique_consultation_session/
  migration.sql                                                   |  34 +
prisma/schema.prisma                                              |   6 +
scripts/verify_migration_pglite.mjs                               |  64 +-
src/app/analytics/page.tsx                                        |  55 +
src/app/api/consultation/sessions/[id]/deals/route.ts             |  40 +
src/app/consultation/page.tsx                                     |   5 +
src/app/globals.css                                               | 235 ++-
src/components/analytics/AnalyticsDashboardContent.tsx            | 151 ++
src/components/consultation/DealClosureForm.tsx                   | 189 ++
src/components/consultation/SessionSummaryView.tsx                |  75 +-
src/server/analytics/dashboard-view.ts                            | 133 ++
src/server/analytics/kpis.ts                                      | 222 ++
src/server/consultation-ui/http-errors.ts                         |  33 +
src/server/consultation-ui/schemas.ts                              |  26 +
src/server/consultation-ui/view-models.ts                          | 102 +-
src/server/deals/errors.ts                                         |  64 +
src/server/deals/financial-snapshot.ts                             | 162 ++
src/server/deals/service.ts                                        | 273 ++
src/server/pricing/commission.ts                                   | 143 ++
src/server/questionnaire/service.ts                                 |  20 +
src/server/recommendation/service.ts                                |  65 +-
tests/component/AnalyticsDashboardContent.test.tsx                  | 128 ++
tests/component/DealClosureForm.test.tsx                            | 171 ++
tests/component/fixtures.ts                                         |  30 +
tests/e2e/deal-closure.spec.ts                                      |  84 +
tests/integration/analytics-kpis.test.ts                            | 463 ++
tests/integration/deals-service.test.ts                             | 540 ++
tests/integration/questionnaire-engine.test.ts                      |  26 +
tests/unit/deals/financial-snapshot.test.ts                         | 192 ++
tests/unit/pricing/commission.test.ts                                |  71 +
35 files changed, 4752 insertions(+), 66 deletions(-)
```

Zusätzlich mit diesem Berichts-Commit: `docs/ABSCHLUSSBERICHT_PHASE6.md`
(neu, dieses Dokument), Präzisierungen in `docs/DEAL_CAPTURE.md`
(Abschnitt 5/6 an den finalen AP12-Stand angepasst) und
`docs/ANALYTICS_AND_KPIS.md` (Provision/Marge-Formulierung), Ergänzung
`PHASE_6_IMPLEMENTATION_PLAN.md` Abschnitt 12.12 (AP12.7-Ergebnis).

## 11. Vollständige bekannte Einschränkungen

- **Zentrale Sandbox-Einschränkung (unverändert seit Phase 2):** kein
  Zugriff auf `binaries.prisma.sh`, `@rollup/rollup-linux-arm64-gnu`-Problem
  weiterhin ungelöst – `prisma generate` und `npx vitest run` liefen in
  dieser Sitzung nicht direkt, Verifikation ausschließlich über CI (siehe
  Abschnitt 9).
- **CI #31 (behoben, siehe Abschnitt 5):** echter, wertvoller Hardening-Fund
  – neuer Unique-Constraint deckte einen bestehenden Test-Fixture-
  Widerspruch auf, sauber korrigiert, CI #32 grün.
- **Kein RBAC für `/analytics`** – wie `/consultation` für jeden
  authentifizierten Mitarbeiter des Mandanten erreichbar; deshalb werden
  Provisions-/Margendaten dort bewusst nicht angezeigt (siehe Abschnitt 4).
  Ein RBAC-geschützter Management-Analytics-Bereich ist explizit einer
  späteren Phase vorbehalten (ChatGPT-Vorgabe).
- **Kein Mitarbeiterfilter im Dashboard-UI** – nur Zeitraum + Filiale;
  `kpis.ts` unterstützt `employeeId` bereits, ist aber noch nicht ans UI
  angebunden.
- **Testzahlen in Abschnitt 8 sind grep-basiert gezählt**, nicht aus einem
  in dieser Sitzung tatsächlich ausgeführten Testlauf – die tatsächliche
  Ausführung ist ausschließlich über CI-Lauf #32 belegt.
- **Kein Nachtragen weiterer Positionen zu einem bereits geschlossenen
  Deal** – bewusst kein CRM-Auftragsprozess (ChatGPT "Out of Scope"), ein
  zweiter Abschlussversuch für dieselbe Session schlägt strukturell fehl
  (App- und DB-Ebene, siehe Abschnitt 5).

## 12. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **RBAC-geschützter Management-Analytics-Bereich** (Provision, Marge,
  Deckungsbeitrag, Mitarbeitervergleich sichtbar) – von ChatGPT für eine
  spätere Phase vorgesehen, sobald echte RBAC existiert.
- **Mitarbeiterfilter im Analytics-Dashboard-UI** – Datenschicht
  vorhanden, UI-Anbindung fehlt.
- **`KpiSnapshot`/periodische Snapshot-Aggregation** – bewusst
  zurückgestellt, solange Live-Aggregation aus den bestehenden
  append-only-Daten performant genug bleibt.
- **`CONSULTATION_TOPIC_OPENED`, `NEED_DETECTED`, `FOLLOW_UP_CREATED`
  als Analytics-Events** – benötigen jeweils einen noch nicht existierenden
  echten fachlichen Trigger im Produkt (Themenwechsel-Tracking,
  Wiedervorlagen-Erfassung, eigenständige Bedarfserkennung); wären jeweils
  ein eigener, mit ChatGPT gesondert abzustimmender Fachprozess.
- **Deckungsbeitrags-Formel v2** (echte Rabattfunktion mit definierter
  Quelle, ggf. Vertragslaufzeit-Projektion) – Formel v1 bewusst
  konservativ gehalten (siehe Abschnitt 4).
- **Cross-Selling-Quote, Ø Produkte pro Verkauf, häufige
  Kundenbedürfnisse/Produkte, Ablehnungsgründe, Zeitersparnis-Vergleich,
  Datenqualitäts-KPIs** – im ursprünglichen KPI-Katalog vorhanden, aber
  nicht Teil der von ChatGPT priorisierten Kern-KPIs für Phase 6 (siehe
  `docs/ANALYTICS_AND_KPIS.md` Abschnitt "Implementierungsstatus").
- Aus Phase 5 weiterhin zurückgestellt/offen (unverändert): produktionsreifer
  Auth-Mechanismus, AP-Sidebar-Feature, Freitext-KI-Feature (siehe
  Phase-5-Bericht Abschnitt 13).

## 13. GO/NO-GO

**a) Technische Freigabe (Code/Tests) — CI-Lauf #32, Commit `350d5d5`:**
Aus technischer Sicht: **GO.** Alle vier Testebenen (487 Testfälle) sind
laut CI-Lauf #32 grün (`success`), die einzige neue Migration dieser Phase
(Deal-Unique-Constraint) ist per PGlite-Skript verifiziert, der einzige
CI-Fehlschlag dieser Phase (#31) ist auf seine Grundursache zurückgeführt,
behoben und durch erneuten grünen CI-Lauf bestätigt.

**b) Fachliche/architektonische Abnahme:** ChatGPT (Projektleiter) hat nach
Vorlage des AP12.7-Ergebnisses (CI-Fix, CI #32 grün) explizit **AP13
freigegeben** (Chat "Phase 6 Scope und Dashboard", 2026-08-17) und Phase 6
als "technisch und fachlich ausreichend abgenommen" eingeordnet, mit der
Einordnung des AP12-Fundes als "wertvollen Hardening-Befund" und der
Anweisung, diesen sowie die bewussten Scope-Entscheidungen (Abschnitt 6)
in diesem Bericht transparent zu dokumentieren (umgesetzt in den
Abschnitten 5/6).

Endgültige Freigabe von Phase 6 sowie Entscheidung über den nächsten
Schritt (Phase 7) obliegt – wie in den Vorphasen – der gemeinsamen Prüfung
durch den Projektleiter (ChatGPT) und den Auftraggeber, nachdem beide
diesen Bericht gelesen haben. ChatGPT hat hierzu bereits vorab angemerkt:
kein Phase-7-Code, bevor dieser Bericht geprüft und offene
Entscheidungen/Folgearbeiten daraus extrahiert wurden.
