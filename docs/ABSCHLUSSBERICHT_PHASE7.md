# Abschlussbericht Phase 7 – Management Analytics & Vertriebssteuerung

Stand: 2026-08-18. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (gleiches Prinzip wie in den Abschlussberichten der Vorphasen).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Commit-Verlauf dieser Phase** (`git log --oneline 282a766..9db0970`,
`282a766` = Berichts-Commit Phase 6):

| Commit    | Inhalt                                                                            | CI-Lauf |  Ergebnis   |
| --------- | --------------------------------------------------------------------------------- | :-----: | :---------: |
| `61c0158` | AP0 – Discovery & Scope (`PHASE_7_DISCOVERY.md`, keine Implementierung)           |         |      –      |
| `19b2a69` | Implementierungsplan (`PHASE_7_IMPLEMENTATION_PLAN.md`, AP1–AP10, ChatGPT-GO)     |         |      –      |
| `fbb4a3e` | AP1 – RBAC-Grundlage (Seed-Fix, `deriveManagementScope()`, Session-Verdrahtung)   |         |      –      |
| `c7a16ce` | AP2 – Analytics Authorization Layer (`resolveAuthorizedStoreFilter()`)            |         |      –      |
| `0dcaf2e` | AP3 – Management KPI API (`GET /api/analytics/management`)                        | CI #34  | **Success** |
| `dd12b38` | AP4 – Management Dashboard (`/analytics/management`, gemeinsame Komponente)       |         |      –      |
| `4208bbf` | AP5 – Regressionsschutz Mitarbeitersicht `/analytics`                             |         |      –      |
| `d36f985` | AP6 – Performance-Indizes für die KPI-Abfragen                                    |         |      –      |
| `e88b324` | AP7 – Security-/Integrationstests volle Kette Scope→AuthZ→KPI→UI                  |         |      –      |
| `dcecbe4` | AP7-Ergänzung – positiver TENANT-Scope-Einschränkungstest                         | CI #35  | **Success** |
| `9db0970` | AP8 – Dokumentation (`MANAGEMENT_ANALYTICS.md` u. a.) + `DATA_MODEL.md`-Korrektur | CI #36  | **Success** |

Nicht jeder Commit wurde einzeln über CI geprüft (mehrere Commits wurden
gebündelt gepusht); maßgeblich für den technischen Nachweis dieser Phase
ist **CI #36** auf dem finalen Stand `9db0970` – dieser Lauf deckt den
gesamten kumulierten Codestand von AP1 bis AP8 ab, da CI bei jedem Push auf
`main` die vollständige Suite (inkl. aller vorher gepushten Commits)
ausführt. `git status` zum Zeitpunkt der Fertigstellung dieses Berichts:
sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen
und eine bekannte, harmlose untracked Altdatei (`.gitignore_smoke_tmp_1786993826`,
siehe Abschnitt 11).

## 1. Technische Versionen

Unverändert gegenüber Phase 6 – **keine neuen Abhängigkeiten** in Phase 7
(`git diff --stat 282a766..9db0970 -- package.json package-lock.json`
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

Vor Phase 7 existierte das RBAC-Datenmodell (`Role`/`RoleAssignment` mit
`scope_type` TENANT/COMPANY/STORE) bereits vollständig im Schema — wurde
aber **nirgends im Code für Autorisierung ausgewertet** (Kernbefund aus
AP0, `PHASE_7_DISCOVERY.md`). Provision (`commissionAmountMinor`) und
Deckungsbeitrag (`contributionMarginMinor`) wurden in `kpis.ts` bereits
korrekt berechnet, aber im Mitarbeiter-Dashboard `/analytics` bewusst
unterdrückt (Phase-6-Entscheidung). Ziel von Phase 7: dieses ungenutzte
RBAC-Modell erstmals scharf schalten und darauf aufbauend eine
RBAC-geschützte Management-Sicht bauen, in der Provision/Marge sichtbar
werden — für Nutzer mit qualifizierender Rolle, serverseitig durchgesetzt.

**Zentrale architektonische Leitplanke** (ChatGPT, wörtlich, verbindlich
für die gesamte Phase): **Autorisierung MUSS VOR der KPI-Berechnung
erfolgen** — "User authentifizieren → Rolle+Scope ermitteln → zulässige
Datenmenge bestimmen → KPI AUSSCHLIESSLICH auf dieser Datenmenge
berechnen", nicht umgekehrt.

## 3. Umfang dieser Phase (AP0–AP10)

- **AP0** – Discovery (`PHASE_7_DISCOVERY.md`, 212 Zeilen): Ist-Analyse von
  10 Untersuchungspunkten, siehe Abschnitt 2. Vier bindende
  Scope-Entscheidungen von ChatGPT: (1) eine gemeinsame
  Management-Analytics-Komponente statt dreier separater UIs, (2)
  Autorisierung MUSS auf `RoleAssignment` aufbauen, kein einfaches
  `isManagement`-Flag, (3) kein `KpiSnapshot`, stattdessen fehlende
  Indizes ergänzen, (4) `DATA_MODEL.md`-Korrektur "5 Filialen" →
  tatsächliche Testdatenanzahl.
- **AP1** – RBAC-Grundlage: Seed-Korrektur (`sales_employee` verliert
  fälschlich zugewiesene Management-Rechte, `store_admin` bekommt sie
  korrekt für STORE-Scope; zwei neue Rollen `company_management`
  (COMPANY) und `executive_management` (TENANT), je mit synthetischem
  Testnutzer pro Tenant), reine Selektionsfunktion
  `deriveManagementScope()` (`src/server/authz/management-scope.ts`,
  deny-by-default, TENANT>COMPANY>STORE-Präzedenz, Store-Union bei
  gleicher Stufe), Verdrahtung von `managementScope` durch
  `SessionPayload`/`TenantContext`/`request-context.ts`
  (`resolveManagementScopeForUser()`, einmalig beim Login serverseitig
  aufgelöst).
- **AP2** – Analytics Authorization Layer: `KpiPeriodFilter` um
  `storeIds?: string[]` erweitert; neues Modul
  `src/server/analytics/management-authz.ts` mit
  `resolveAuthorizedStoreIds()` (reine Prüfung) und
  `resolveAuthorizedStoreFilter()` (async Wrapper mit
  `employeeId`-DB-Prüfung), `ManagementAccessDeniedError`. Zentraler
  Invariant: ein Request-Filter darf den autorisierten Scope nur
  einschränken, nie erweitern.
- **AP3** – Management KPI API: `buildManagementAnalyticsView()`
  (`src/server/analytics/management-view.ts`) komponiert die
  KPI-Read-Funktionen zu einem View-Model mit dem **vollen**
  `DealKpiByCurrency` inkl. Provision/Marge; neue Route
  `GET /api/analytics/management` (dünner Wrapper), 403 bei
  `ManagementAccessDeniedError`.
- **AP4** – Management Dashboard: neue Route `/analytics/management`
  (Server Component) + **eine** gemeinsame Komponente
  `ManagementAnalyticsContent.tsx` für STORE/COMPANY/TENANT (Datenumfang
  ausschließlich aus dem bereits autorisierten View-Model, keine eigene
  Rollen-Fallunterscheidung in der UI); generische Kein-Zugriff-Seite bei
  `managementScope === null`.
- **AP5** – Regressionsschutz Mitarbeitersicht: neuer Integrationstest
  `tests/integration/analytics-dashboard-view.test.ts` beweist, dass
  `/analytics` nach AP1–AP4 unverändert bleibt (keine Provision/Marge,
  keine Nutzung von `managementScope`).
- **AP6** – Performance-Indizes: 5 neue Indizes, strikt aus den
  tatsächlichen `WHERE`-Mustern in `kpis.ts` abgeleitet (siehe
  Abschnitt 4), kein `KpiSnapshot`.
- **AP7** – Security-/Integrationstests der vollen Kette
  Scope→AuthZ→KPI→UI: eine umfassende Datei
  `tests/integration/analytics-management-security.test.ts` (998 Zeilen,
  30 Testfälle) gegen echte Postgres-Fixtures (siehe Abschnitt 8).
- **AP8** – Dokumentation: neue Datei `docs/MANAGEMENT_ANALYTICS.md` (209
  Zeilen, vollständiges RBAC-Modell), Updates in
  `docs/ROLES_AND_PERMISSIONS.md`, `docs/ANALYTICS_AND_KPIS.md`,
  `docs/DEAL_CAPTURE.md`; `docs/DATA_MODEL.md`-Korrektur "5 Filialen" →
  "2 Filialen pro Tenant" (Testdaten).
- **AP9** – Hardening/CI: lokale Vollverifikation, Push, CI #36 grün
  (siehe Abschnitt 9).
- **AP10** – dieser Abschlussbericht.

## 4. Architektur der Management-Analytics-Autorisierung

Vollständig beschrieben in `docs/MANAGEMENT_ANALYTICS.md`. Kernpunkte:

**Aufrufkette (strukturell erzwungen, nicht nur Konvention):**

```
Session (managementScope, beim Login serverseitig aufgelöst)
  → GET /api/analytics/management (reicht Scope unverändert durch)
  → buildManagementAnalyticsView() (ruft ausschließlich resolveAuthorizedStoreFilter() auf)
  → resolveAuthorizedStoreFilter() (liefert geprüften Filter oder wirft ManagementAccessDeniedError)
  → getConsultationVolumeKpi()/getRecommendationOutcomeKpi()/getDealKpi() (berechnen nur auf autorisiertem Filter)
  → ManagementAnalyticsView → ManagementAnalyticsContent.tsx (keine eigene Scope-Entscheidung)
```

**Scope-Modell** (`ManagementScope`, drei Stufen):

| Stufe   | Bedeutung                              | erforderliche Permission |
| ------- | -------------------------------------- | ------------------------ |
| STORE   | genau die zugewiesene(n) Filiale(n)    | `analytics.view_store`   |
| COMPANY | alle Filialen der zugewiesenen Company | `analytics.view_company` |
| TENANT  | alle Filialen des Mandanten            | `analytics.view_tenant`  |

Ableitungsregeln: deny-by-default (keine qualifizierende `RoleAssignment`
→ `null`, niemals ein "alle Filialen"-Fallback), höchste Stufe gewinnt
(TENANT>COMPANY>STORE, keine Vereinigung unterschiedlicher Stufen),
Union+Dedup bei gleicher Stufe, leere Store-Menge → `null` (nie ein
"leerer, aber gültiger" Scope).

**Session statt Live-DB-Reabgleich:** `managementScope` wird einmalig beim
Login aus `RoleAssignment`-Daten abgeleitet und im signierten
Session-Token transportiert — kein DB-Reabgleich pro Analytics-Request
(dieselbe Semantik wie beim bestehenden `roles`-Feld). Bewusst
akzeptierter Trade-off: Session-Staleness bei Rollenentzug während einer
laufenden Session, von ChatGPT für Phase 7 ausdrücklich bestätigt.

**IDOR-Schutz (zentraler, mit echten Postgres-Fixtures bewiesener
Invariant):** Ein vom Client angefragter `storeId`-/`employeeId`-Filter
darf den bereits autorisierten Datenbereich nur einschränken, niemals
erweitern. Kein Filter → voller autorisierter Scope. Filter innerhalb des
Scopes → Einschränkung auf genau diesen Teilbereich. Filter außerhalb des
Scopes (auch bei vollem TENANT-Scope, auch bei einer `storeId`/
`employeeId` aus einem fremden Mandanten) → `ManagementAccessDeniedError`
(403) statt eines stillschweigend leeren Ergebnisses.

**Financial-KPI-Sichtbarkeit:** `ManagementAnalyticsView` enthält das
volle `DealKpiByCurrency` inkl. `commissionAmountMinor`/
`contributionMarginMinor`. Die Mitarbeitersicht (`/analytics`) bleibt
unverändert und liefert diese Felder weiterhin nicht.

**Kein `KpiSnapshot`:** weiterhin Live-Aggregation; stattdessen 5 neue
Indizes (siehe unten), abgeleitet aus den durch den Management-Scope neu
hinzugekommenen Abfragemustern (z. B. TENANT-Scope ohne Filialfilter).

## 5. Schema-/Migrationsänderungen

**Eine neue Migration** in Phase 7:

`prisma/migrations/20260817220000_analytics_kpi_indexes/migration.sql` —
5 rein additive Indizes (keine Datenänderung, kein Vorab-Datencheck
nötig), strikt aus den tatsächlichen `WHERE`-Mustern in
`src/server/analytics/kpis.ts` abgeleitet:

- `consultation_sessions_tenant_id_started_at_idx` — `(tenant_id, started_at)`
- `recommendations_tenant_id_generated_at_idx` — `(tenant_id, generated_at)`
- `recommendation_outcomes_tenant_id_decided_at_idx` — `(tenant_id, decided_at)`
- `deals_tenant_id_closed_at_idx` — `(tenant_id, closed_at)`
- `deals_employee_id_closed_at_idx` — `(employee_id, closed_at)` (bislang
  fehlte für `deals` überhaupt ein `employeeId`-Index)

`ls prisma/migrations/` bestätigt 5 Migrationen insgesamt: die drei aus
Phase 2/3B/6 plus die Phase-6-Deal-Unique-Constraint-Migration plus diese
eine neue. Zusätzlich `prisma/schema.prisma`: 28 Zeilen geändert (u. a.
Anpassungen im Zusammenhang mit den neuen Seed-Rollen/Permissions und den
neuen Indizes, keine neuen Tabellen).

## 6. Bewusste Scope-Entscheidungen (transparent dokumentiert)

- **Eine gemeinsame UI-Komponente statt drei separater Management-Views**
  (ChatGPT-Vorgabe AP0): Datenumfang ergibt sich ausschließlich aus dem
  bereits autorisierten View-Model, keine rollenspezifische UI-Logik.
- **Kein `isManagement`-Flag** — Autorisierung baut ausschließlich auf dem
  bestehenden `RoleAssignment`-System auf.
- **Kein `KpiSnapshot`** — Live-Aggregation weiterhin ausreichend,
  stattdessen gezielte Indizes (Abschnitt 5).
- **Kein Echtzeit-Rechteentzug** — Session-Staleness bei Rollenentzug
  bewusst akzeptiert (siehe Abschnitt 4).
- **Kein Mitarbeiterfilter-Dropdown im Management-UI** — `employeeId`
  bleibt über Query-Parameter erreichbar und wird durch
  `resolveAuthorizedStoreFilter()` geprüft, aber kein
  `employeeOptions`-Feld im View-Model (zusätzliche Query außerhalb des
  Plans).
- **Kein pauschales Ersetzen von "5 Filialen"** in der Dokumentation: nur
  die testdatenspezifische Zeile in `docs/DATA_MODEL.md` wurde korrigiert
  (→ "2 Filialen pro Tenant"); Vorkommen in `ARCHITECTURE.md`,
  `OPEN_DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, `MVP_SCOPE.md` und
  `README.md` beziehen sich auf das reale Pilotunternehmen der
  Produktvision und wurden bewusst unverändert gelassen.
- **Kein RBAC-Umbau der Mitarbeitersicht** — `/analytics` bleibt
  unverändert erreichbar für jeden authentifizierten Mitarbeiter des
  Mandanten (bestehender, in Phase 5/6 dokumentierter Stop-Punkt, hier
  nicht neu entschieden).

## 7. Tenant-Isolation und Datenschutz

Die Store-ID-Auflösung für COMPANY/TENANT-Scopes erfolgt ausschließlich
innerhalb des Mandanten der aufrufenden Session
(`resolveManagementScopeForUser(tenantId, ...)`); `RoleAssignment`-Zeilen
sind selbst tenant-gebunden. Ein TENANT-Scope-Nutzer von Mandant A kann
daher weder über eine manipulierte `storeId` noch über eine manipulierte
`employeeId` Daten von Mandant B erreichen — die `employeeId`-Prüfung
nutzt den mandantengescopten `db`-Client, findet einen Mitarbeiter eines
anderen Mandanten also grundsätzlich nicht. Dieser Invariant ist mit
manipulierten IDs aus Tenant B gegen einen TENANT-Scope-Nutzer aus Tenant A
in AP7 mit echten Postgres-Fixtures bewiesen (siehe Abschnitt 8). Keine
neuen personenbezogenen Datenfelder in Phase 7.

## 8. Anzahl und Art aller Tests

Vier Testebenen, insgesamt **544 Testfälle** (487 aus Phase 6 + 57 neu in
Phase 7), grep-basiert gezählt (`grep -crE '^\s*it\(|^\s*test\('` je
Verzeichnis, konsistent mit der Zählmethode der Vorphasen-Berichte):

| Ebene                                    | Phase 6 | Neu in Phase 7 | Gesamt Phase 7 | Neue/geänderte Dateien                                                                                                                                                                                                                  |
| ---------------------------------------- | ------: | -------------: | -------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`npm run test:unit`)               |     278 |             25 |            303 | `tests/unit/authz/management-scope.test.ts` (10), `tests/unit/authz/seed-role-permissions.test.ts` (6), `tests/unit/analytics/management-authz.test.ts` (8), `tests/unit/analytics/management-view.test.ts` (1)                         |
| Component (`npm run test:component`)     |     117 |              0 |            117 | keine neuen Component-Tests in Phase 7                                                                                                                                                                                                  |
| Integration (`npm run test:integration`) |      85 |             32 |            117 | `tests/integration/analytics-management-security.test.ts` (30, siehe unten), `tests/integration/analytics-dashboard-view.test.ts` (2, AP5); 8 bestehende Integrationsdateien um `managementScope`-Kontext ergänzt (kein neuer Testfall) |
| E2E (`npm run test:e2e`)                 |       7 |              0 |              7 | keine neuen E2E-Tests in Phase 7                                                                                                                                                                                                        |
| **Gesamt**                               | **487** |         **57** |        **544** |                                                                                                                                                                                                                                         |

**Inhalt der zentralen Testdatei** (`analytics-management-security.test.ts`,
998 Zeilen, 30 Fälle, ausschließlich echte Postgres-Fixtures, kein
`vi.mock`), deckt die von ChatGPT geforderten sechs Abschnitte ab:

1. **Scope-Auflösung** — 8 Manager-Akteure über STORE/COMPANY/TENANT,
   höchste Stufe gewinnt, Union+Dedup, fehlende/revoked Permission → `null`.
2. **IDOR/AuthZ mit echtem `employeeId`-DB-Check** — inkl.
   Cross-Tenant-`employeeId`/`storeId` trotz vollem TENANT-Scope →
   abgelehnt; positiver Gegenpart (COMPANY- und TENANT-Scope +
   `storeId` = eigene Filiale → Einschränkung auf genau diese Filiale,
   nicht der volle Scope).
3. **KPI-Daten-Isolation** — bewusst unterscheidbare Finanzwerte je
   Filiale (1.111 / 2.222 / 3.333 / 9.999 EUR), um eine unzulässige
   Aggregation sofort sichtbar zu machen.
4. **Financial-KPI-Trennung** Management vs. Mitarbeiter, end-to-end über
   echte aggregierte Daten geprüft.
5. **Tenant-Isolation** — manipulierte IDs aus fremdem Tenant.
6. **HTTP-Sicherheitsgrenze** — echter API+UI-End-to-End-Test über den
   realen Route-Handler mit echtem signiertem Session-Cookie: gültige
   Session → 200, fehlender Cookie → 401, beschädigter Cookie → 401,
   fehlender/revoked Management-Scope → 403, fremder Employee → 403,
   fremde Filiale → 403.

`tests/integration/analytics-dashboard-view.test.ts` (AP5, 2 Fälle)
beweist zusätzlich, dass die Mitarbeitersicht `/analytics` nach AP1–AP4
unverändert bleibt (keine Provision/Marge, keine Nutzung von
`managementScope`).

## 9. Vollständige Prüfkommandos mit Ergebnissen

| Kommando                                                            | Ergebnis                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git status` (Stand `9db0970`)                                      | sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen und die bekannte Altdatei `.gitignore_smoke_tmp_1786993826`                                                      |
| `npx tsc --noEmit`                                                  | sauber                                                                                                                                                                                     |
| `npx eslint .`                                                      | sauber bis auf die bekannte, gitignorete, Next.js-generierte `next-env.d.ts` (kein Codebefund, betrifft CI nicht, da CI vor dem Lint-Schritt keinen `next build` ausführt)                 |
| `npx prettier --check .`                                            | sauber                                                                                                                                                                                     |
| `node scripts/verify_migration_pglite.mjs`                          | "ALLE MIGRATIONSPRUEFUNGEN (PHASE 3B + PHASE 6 + PHASE 7 AP6) ERFOLGREICH" — 5 Migrationen, 61 Tabellen, 101 Fremdschlüssel, alle Smoke-Tests inkl. der 5 neuen AP6-Indizes                |
| `npx vitest run` (alle vier Testebenen)                             | in dieser Sandbox nicht ausführbar (bekannte, sandboxweite `@rollup/rollup-linux-arm64-gnu`-Limitierung, siehe unten) — Verifikation ausschließlich über CI                                |
| GitHub Actions (`vindoo187/ki-cross/actions`, via Claude-in-Chrome) | CI #34 (`0dcaf2e`): Success; CI #35 (`dcecbe4`): Success, 4m 35s; **CI #36 (`9db0970`): Success, Gesamtdauer 11m 9s, Job `build-and-test` 11m 4s** — maßgeblicher Nachweis für diese Phase |

**CI #36 im Detail:** einzige Annotation ist eine reine
GitHub-Infrastrukturwarnung ("Node.js 20 is deprecated" für einzelne
Actions), kein Code- oder Testbefund. Die ungewöhnlich lange Laufzeit
(11m 9s gegenüber 1–8 Minuten bei früheren Läufen) wurde geprüft: der
Schritt "Playwright-Browser installieren" brauchte diesmal deutlich
länger (apt-Mirror-Latenz), kein Hänger und keine Fehlermeldung im Log.
Der Lauf deckt Build/TypeScript, Migrationen gegen echtes Postgres,
Unit-Tests, Integrationstests (inklusive der 30 neuen AP7-Security-Tests)
und alle bestehenden Regressionstests ab.

**Sandbox-Einschränkung dieser Sitzung (unverändert seit Phase 2):** `npx
vitest run` konnte in dieser Sandbox nicht direkt ausgeführt werden
(fehlendes natives `@rollup/rollup-linux-arm64-gnu`-Binary). Die
tatsächliche Ausführung aller 544 Testfälle ist ausschließlich über CI-Lauf
#36 (Commit `9db0970`, Ergebnis `success`) belegt, dessen Status über
Claude-in-Chrome-Browserzugriff auf die GitHub-Actions-Oberfläche
ausgelesen wurde (clientseitig gerenderte Seite, daher kein statischer
`WebFetch`-Abruf). `tsc`/`eslint`/`prettier`/die PGlite-Migrationsprüfung
wurden in dieser Sitzung tatsächlich lokal ausgeführt (kein
Sandbox-Problem für diese vier Werkzeuge).

## 10. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat 282a766..9db0970` (`282a766` = Berichts-Commit Phase 6,
`9db0970` = letzter Implementierungs-/Dokumentations-Commit dieser Phase):
**44 Dateien geändert, 3.507 Zeilen hinzugefügt, 34 Zeilen entfernt.**

```
PHASE_7_DISCOVERY.md                                          | 212 +
PHASE_7_IMPLEMENTATION_PLAN.md                                | 339 +
docs/ANALYTICS_AND_KPIS.md                                    |  16 +-
docs/DATA_MODEL.md                                             |   2 +-
docs/DEAL_CAPTURE.md                                            |  16 +-
docs/MANAGEMENT_ANALYTICS.md                                    | 209 + (neu)
docs/ROLES_AND_PERMISSIONS.md                                   |  31 +
prisma/migrations/20260817220000_analytics_kpi_indexes/
  migration.sql                                                 |  34 + (neu)
prisma/schema.prisma                                            |  28 +
prisma/seed.ts                                                  | 150 +-
scripts/verify_migration_pglite.mjs                             |  32 +-
src/app/analytics/management/page.tsx                           |  76 + (neu)
src/app/api/analytics/management/route.ts                       |  46 + (neu)
src/app/consultation/page.tsx                                   |  11 +
src/app/globals.css                                              |  15 +
src/components/analytics/ManagementAnalyticsContent.tsx          | 186 + (neu)
src/server/analytics/dashboard-view.ts                           |  14 +-
src/server/analytics/kpis.ts                                     |  13 +
src/server/analytics/management-authz.ts                         | 116 + (neu)
src/server/analytics/management-view.ts                          | 131 + (neu)
src/server/analytics/schemas.ts                                  |  18 +
src/server/auth/dev-users.ts                                     |  91 +-
src/server/auth/request-context.ts                               |   1 +
src/server/auth/session.ts                                       |  36 +
src/server/authz/management-scope.ts                             | 101 + (neu)
src/server/authz/seed-role-permissions.ts                        |  61 + (neu)
src/server/consultation-ui/http-errors.ts                        |   8 +
src/server/tenant/context.ts                                     |   9 +
tests/integration/analytics-dashboard-view.test.ts               | 208 + (neu)
tests/integration/analytics-kpis.test.ts                         |   5 +-
tests/integration/analytics-management-security.test.ts          | 998 + (neu)
tests/integration/consultation-abandonment.test.ts                |   5 +-
tests/integration/consultation-completion.test.ts                 |   5 +-
tests/integration/deals-service.test.ts                           |   5 +-
tests/integration/questionnaire-engine.test.ts                    |  10 +-
tests/integration/recommendation-engine.test.ts                   |   5 +-
tests/integration/recommendation-outcome.test.ts                  |   5 +-
tests/integration/sales-opportunity-status.test.ts                |   5 +-
tests/integration/tenant-isolation.test.ts                        |   8 +-
tests/unit/analytics/management-authz.test.ts                     |  64 + (neu)
tests/unit/analytics/management-view.test.ts                      |  19 + (neu)
tests/unit/authz/management-scope.test.ts                         | 128 + (neu)
tests/unit/authz/seed-role-permissions.test.ts                    |  67 + (neu)
tests/unit/tenant-context.test.ts                                  |   2 +
44 files changed, 3507 insertions(+), 34 deletions(-)
```

Zusätzlich mit diesem Berichts-Commit: `docs/ABSCHLUSSBERICHT_PHASE7.md`
(neu, dieses Dokument).

## 11. Vollständige bekannte Einschränkungen

- **Zentrale Sandbox-Einschränkung (unverändert seit Phase 2):**
  `@rollup/rollup-linux-arm64-gnu`-Problem weiterhin ungelöst — `npx
vitest run` lief in dieser Sitzung nicht direkt, Verifikation
  ausschließlich über CI #36 (siehe Abschnitt 9).
- **FUSE-Mount-Eigenheit dieser Sandbox** (wiederholt aufgetreten, jedes
  Mal folgenlos gelöst): Git-Befehle können phantomhafte
  `index.lock`/`HEAD.lock`-Dateien hinterlassen, die auch für die
  Git-Tools auf dem echten Mac-Dateisystem des Nutzers sichtbar sind. In
  dieser Phase führte das einmal dazu, dass der Nutzer in GitHub Desktop
  einen blockierenden Lock sah, obwohl der zugrunde liegende
  Git-Vorgang aus der Sandbox bereits erfolgreich war — gelöst durch
  manuelles Löschen von `.git/index.lock` über Finder.
- **Kein Echtzeit-Rechteentzug** — Session-Staleness bei Rollenentzug
  bewusst akzeptiert (siehe Abschnitt 4/6).
- **Kein Mitarbeiterfilter-Dropdown im Management-UI** — Datenschicht/
  Autorisierung vorhanden, UI-Anbindung fehlt (bewusst außerhalb des
  AP4-Plans, siehe Abschnitt 6).
- **Kein RBAC-Umbau der Mitarbeitersicht** `/analytics` — bleibt wie in
  Phase 5/6 für jeden authentifizierten Mitarbeiter des Mandanten
  erreichbar; nur die neue Management-Sicht ist RBAC-geschützt.
- **Bekannte Altlast** (unverändert seit AP1 dieser Phase): die Datei
  `.gitignore_smoke_tmp_1786993826` (Rest eines gescheiterten
  tsx-Smoketests aus einer früheren Sitzung) ließ sich aus der Sandbox
  heraus nicht löschen (FUSE "Operation not permitted") — untracked,
  nicht committet, Nutzer muss sie manuell per Finder entfernen.
- **Testzahlen in Abschnitt 8 sind grep-basiert gezählt**, nicht aus einem
  in dieser Sitzung tatsächlich ausgeführten Testlauf — die tatsächliche
  Ausführung ist ausschließlich über CI-Lauf #36 belegt.

## 12. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **Echtzeit-Rechteentzug innerhalb einer laufenden Session** — würde
  einen Live-DB-Reabgleich pro Request erfordern, bewusst nicht
  Phase-7-Ziel.
- **`KpiSnapshot`/periodische Snapshot-Aggregation** — weiterhin
  zurückgestellt, solange Live-Aggregation performant genug bleibt
  (jetzt durch 5 zusätzliche Indizes gestützt).
- **Mitarbeiterfilter im Management-Dashboard-UI** — Autorisierungsschicht
  unterstützt `employeeId` bereits vollständig, UI-Anbindung fehlt.
- **RBAC für die bestehende Mitarbeitersicht `/analytics`** — bleibt
  unverändert offen für jeden authentifizierten Mitarbeiter.
- **Weitere in `docs/ROLES_AND_PERMISSIONS.md` konzeptionell skizzierte
  Rollen** (Filialleitung, Regionalleitung, Fachadministrator,
  Systemadministrator, Mandanten-Owner) und die volle
  Berechtigungsmatrix — bleiben konzeptioneller Phase-1-Ausgangsvorschlag,
  nicht Teil des implementierten Schemas.

## 13. Fazit

Phase 7 hat kein neues Feature "obendrauf" gesetzt, sondern die erste
echte, durchgesetzte Autorisierungsschicht für sensible Finanzdaten
eingeführt: ein zuvor ungenutztes RBAC-Datenmodell wurde scharf geschaltet,
mit einer strukturell erzwungenen Reihenfolge (Autorisierung vor
Aggregation), einem zentralen, mit echten Postgres-Integrationstests
bewiesenen IDOR-Schutz-Invariant ("Request-Filter dürfen den autorisierten
Scope nur einschränken, nie erweitern") und einer sauberen Trennung
zwischen Autorisierungs-, KPI-Berechnungs- und UI-Schicht. Der
technische Nachweis dafür ist CI #36 (Commit `9db0970`, grün, 11m 9s),
der neben Build/TypeScript und den bestehenden Regressionstests auch die
30 neuen AP7-Security-Tests gegen eine echte Postgres-Datenbank
erfolgreich ausführt.
