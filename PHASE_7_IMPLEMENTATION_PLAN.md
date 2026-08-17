# IMPLEMENTIERUNGSPLAN – PHASE 7: MANAGEMENT ANALYTICS & VERTRIEBSSTEUERUNG

## 0. Bestätigter Ausgangsstand

Phase 6 (Analytics-Grundlage & Deal-Erfassung) ist abgeschlossen: Abschlussbericht
`docs/ABSCHLUSSBERICHT_PHASE6.md`, Berichts-Commit `282a766`, CI #33 grün.
ChatGPT hat das finale GO für Phase 6 erteilt.

Phase 7 AP0 (Discovery & Scope, keine Implementierung) ist abgeschlossen:
`PHASE_7_DISCOVERY.md`, Commit `61c0158`. ChatGPT hat die Discovery akzeptiert
und vier verbindliche Scope-Entscheidungen getroffen:

1. **Eine gemeinsame Management-Analytics-Komponente** für Prokurist-/
   Geschäftsführungssicht (Datenumfang hängt vom RBAC-Scope ab, keine
   doppelte UI-Logik für "drei Sichten"). Die Mitarbeitersicht (`/analytics`)
   bleibt **unverändert**.
2. Autorisierung MUSS auf dem bestehenden `RoleAssignment`-System
   (Scope-Ebenen `TENANT`/`COMPANY`/`STORE`) aufbauen — **kein** einfaches
   `isManagement`-Flag. Serverseitige Durchsetzung ist Pflicht.
3. **Kein `KpiSnapshot`** in Phase 7 — weiterhin Live-Aggregation, stattdessen
   fehlende Indizes ergänzen.
4. `docs/DATA_MODEL.md` "5 Filialen" → "2 Filialen pro Tenant" korrigieren
   (kleine Doku-Korrektur, kein eigenes AP).

**Zentrale architektonische Leitplanke (ChatGPT, wörtlich verbindlich):**
Autorisierung MUSS **vor** der KPI-Berechnung erfolgen. Reihenfolge:
`Session/User authentifizieren → Rolle+Scope ermitteln → zulässige
Datenmenge (Store-IDs) bestimmen → KPI ausschließlich auf dieser Datenmenge
berechnen`. **Nicht** "KPI berechnen → danach prüfen, ob Nutzer sie sehen
darf". Dieser Plan verankert das strukturell in AP1/AP2 (siehe dort).

**Status dieses Plans:** ChatGPT hat den vollständigen Plan geprüft und am
2026-08-17 **GO für AP1–AP10 (Umsetzung darf beginnen)** erteilt, inklusive
Zustimmung zu beiden in Abschnitt 15 vorgelegten Detailfragen (Seed-
Korrektur, Session-basierte Scope-Auflösung). Ergänzend hat ChatGPT drei
verbindliche Präzisierungen vorgegeben, die in diesen Plan eingearbeitet
sind (siehe 3.1, 3.2, 3.4): Deny-by-default bei nicht eindeutig auflösbarem
Scope, verbindliche Semantik für kombinierte `RoleAssignment`s (höchste
Berechtigungsstufe gewinnt, keine Ad-hoc-Logik), und Regressionstests für
die Seed-Korrektur. **Ausstehend: explizites Implementierungs-GO des
Nutzers** (wie in allen Vorphasen), danach Start mit AP1.

## 1. Zusätzliche Ist-Analyse (über AP0 hinaus, für die Detailplanung nötig)

Beim Entwurf dieses Plans wurden folgende, in `PHASE_7_DISCOVERY.md` noch
nicht dokumentierte Detailbefunde code-verifiziert:

### 1.1 Permission-Katalog existiert bereits passgenau — aber falsch verdrahtet

`prisma/seed.ts` seedet bereits genau die drei Berechtigungsschlüssel, die
Phase 7 braucht: `analytics.view_store`, `analytics.view_company`,
`analytics.view_tenant` (neben `consultation.*`, `deal.*`,
`master_data.manage`, `user.manage`). **Echter Befund (Bug, keine
Designentscheidung):** Die Seed-Logik weist aktuell **alle** Permissions
(inkl. `analytics.view_tenant`!) pauschal der Rolle `sales_employee`
(gewöhnlicher Verkaufsberater) zu (`seed.ts` Zeilen 161–169), während die
Rolle `store_admin` (Filialleitung) **keine einzige** Permission zugewiesen
bekommt. Aktuell folgenlos, weil nirgends geprüft wird — würde aber, unverändert
übernommen, dazu führen, dass **jeder normale Mitarbeiter** die neue
Management-Autorisierungsprüfung auf TENANT-Ebene besteht. **Muss in AP1
korrigiert werden**, siehe 3.1.

Nur eine `RoleAssignment` existiert aktuell pro Tenant (Filialleitung von
Filiale 1, Scope `STORE`) — für COMPANY-/TENANT-Scope gibt es weder Rollen
noch Zuweisungen noch synthetische Testnutzer. Muss in AP1 ergänzt werden,
sonst gibt es für zwei der drei Scope-Ebenen keine Testgrundlage.

### 1.2 `KpiPeriodFilter.storeId` ist aktuell `string`, nicht `string[]`

`src/server/analytics/kpis.ts` (`KpiPeriodFilter`) filtert Store-gebunden nur
über ein einzelnes optionales `storeId: string`. Ein COMPANY- oder
TENANT-Scope umfasst aber typischerweise mehrere Filialen — die
Aggregationsschicht muss auf eine **Menge** zulässiger Store-IDs filtern
können. Bestehendes Verhalten der Mitarbeitersicht (`/analytics`, Einzel-
Filialfilter) darf sich dabei nicht ändern (Scope-Entscheidung 1).

### 1.3 Session-Payload trägt aktuell nur Rollen-Keys, keine Scope-Zuordnung

`SessionPayload.roles: string[]` (`src/server/auth/session.ts`) enthält nur
Rollen-Keys, nicht die zugehörigen `RoleAssignment`-Scope-Daten
(`scopeType`/`companyId`/`storeId`). Für die neue Autorisierungsprüfung wird
die aufgelöste Management-Scope-Information benötigt — Designfrage, ob diese
beim Login einmalig aufgelöst und in die Session gepackt wird (analog
`roles`) oder bei jeder Analytics-Anfrage frisch aus der DB gelesen wird.
Lösung und ChatGPT-Bestätigung siehe 3.2 und Abschnitt 15.

## 2. Scope-Rahmen (aus AP0-Review, verbindlich)

**In Scope:**

- RBAC-Durchsetzung auf Basis von `RoleAssignment` (Scope TENANT/COMPANY/STORE).
- Eine neue, RBAC-geschützte Management-Analytics-Ansicht, die die bereits
  berechneten, aber bislang unterdrückten `commissionAmountMinor`/
  `contributionMarginMinor`-Werte sichtbar macht.
- Ergänzende Indizes für historische Auswertbarkeit.
- Korrektur des Seed-Daten-Berechtigungsbugs (1.1) und Ergänzung der
  fehlenden COMPANY-/TENANT-Testrollen.
- Doku-Korrektur "5 Filialen" → "2 Filialen".

**Out of Scope (unverändert aus Phase 6, hier bestätigt):** vollständiges
CRM, Forecasting/KI-Umsatzprognosen, freie BI-Plattform, `KpiSnapshot`/
`Goal`-Modell, Regionsebene im Datenmodell, Änderungen an der
Mitarbeitersicht `/analytics` über reine Regressionssicherung hinaus.

## 3. Architektur-Entscheidungen dieses Plans

### 3.1 Seed-Daten-Korrektur (Voraussetzung für alles Weitere)

- `sales_employee` verliert `analytics.view_store`/`_company`/`_tenant`
  (behält `consultation.*`, `deal.create`, `deal.view_own` — keine
  Management-Sicht für normale Mitarbeiter).
- `store_admin` (Filialleitung) erhält `analytics.view_store`.
- Zwei neue Rollen je Tenant: `company_management` ("Prokurist/
  Regionalleitung", `analytics.view_company`) und `executive_management`
  ("Geschäftsführung", `analytics.view_tenant`), inkl. je einem
  synthetischen Testnutzer mit passender `RoleAssignment`
  (`scopeType: COMPANY` bzw. `TENANT`) pro Demo-Tenant.
- Bestehende `RoleAssignment` für `store_admin` (Filiale 1) bleibt erhalten.

### 3.2 Management-Scope-Auflösung: Login-Zeit, aus RoleAssignments (ChatGPT-GO)

**Entschieden: Auflösung einmalig beim Login**, analog zum bestehenden
`roles`-Feld — ein neues `managementScope`-Feld im `SessionPayload`
(`{ level: "STORE" | "COMPANY" | "TENANT"; storeIds: string[] } | null`,
`null` = keine Management-Berechtigung). Kein DB-Reabgleich pro
Analytics-Anfrage (ChatGPT: "Live-DB-RBAC bei jedem Analytics-Request: nicht
erforderlich/nicht gewünscht für Phase 7").

**Verbindliche Bedingungen (ChatGPT):**

- `managementScope` wird **ausschließlich serverseitig** aus den
  autoritativen `RoleAssignment`-Zeilen der DB abgeleitet — niemals vom
  Client übernommen oder beeinflusst. Fluss: `RoleAssignment (DB) →
  serverseitige Scope-Auflösung → managementScope → signierte Session`.
- `COMPANY`/`TENANT`-Level werden beim Login bereits auf die konkrete Menge
  zulässiger `storeIds` **aufgelöst** (nicht erst zur Anfragezeit) — bei
  `COMPANY` alle Stores der autorisierten Company, bei `TENANT` alle Stores
  des Tenants.
- **Akzeptierte, dokumentierte Freshness-Eigenschaft:** Ein Entzug der
  Berechtigung (z. B. `RoleAssignment.revokedAt` gesetzt) wirkt erst ab der
  nächsten Session-Erstellung, nicht sofort — identisch zum bestehenden
  Verhalten von `roles`. Für Phase 7 explizit akzeptiert; bei künftigem
  Bedarf an Echtzeit-RBAC wäre eine Session-Invalidierung/Permission-
  Versionierung nachzuziehen (nicht Teil von Phase 7).

### 3.3 Autorisierung strukturell vor Aggregation (Leitplanken-Umsetzung)

Neue Funktion `resolveAuthorizedStoreFilter()` (AP2) ist die **einzige**
erlaubte Quelle für den Store-Filter, den die Management-KPI-Funktionen
erhalten. Sie nimmt den `managementScope` aus der Session UND einen
optionalen, vom Client angefragten `storeId`/`employeeId`-Filter entgegen,
prüft den angefragten Filter gegen den erlaubten Scope (IDOR-Schutz — ein
Client kann sich nicht durch einen manipulierten Query-Parameter mehr Scope
erschleichen) und liefert **entweder** die tatsächlich zulässige Store-ID-
Menge **oder** wirft `ManagementAccessDeniedError`. Die API-Route (AP3) ruft
diese Funktion **vor** jedem Aufruf von `getDealKpi()`/
`getConsultationVolumeKpi()`/`getRecommendationOutcomeKpi()` auf — es gibt
keinen Codepfad, der KPI-Funktionen mit einem ungeprüften Store-Filter
aufruft.

### 3.4 Deny-by-default und kombinierte RoleAssignments (ChatGPT-Präzisierung)

- **Deny-by-default:** Kann `resolveManagementScopeForUser()` keinen
  eindeutigen Management-Scope ermitteln (keine passende `RoleAssignment`,
  unbekannte/unerwartete Scope-Kombination), ist das Ergebnis `null` →
  **kein** Zugriff auf Management-Daten. Explizit **nicht** erlaubt: ein
  fehlender Store-Scope wird niemals stillschweigend zu "alle Stores"
  aufgeweitet.
- **Kombinierte `RoleAssignment`s:** Hat ein User mehrere aktive
  Zuweisungen (z. B. `STORE`-Scope für Filiale A **und** `COMPANY`-Scope für
  deren Unternehmen), gilt die **höchste vorhandene Berechtigungsstufe**
  (`TENANT` > `COMPANY` > `STORE`) für den Umfang, plus Vereinigung der
  `storeIds` mehrerer Zuweisungen gleicher Stufe (z. B. Filialleitung zweier
  Filialen). Diese Semantik folgt der bestehenden `RoleAssignment`-Struktur
  und wird **nicht** Phase-7-spezifisch neu erfunden. Explizite Testfälle
  hierzu in AP7 (siehe dort).

## 4. AP1 – RBAC-Datengrundlage & Autorisierungs-Kern

- Seed-Korrektur wie 3.1 (`prisma/seed.ts`), inkl. Regressionstest, der die
  korrekte Permission-Zuordnung je Rolle prüft (ChatGPT-Auflage: "damit ein
  späterer Seed-Lauf die Berechtigungen nicht wieder falsch setzt").
- Neues Modul `src/server/authz/management-scope.ts`:
  - `resolveManagementScopeForUser(tenantId, userId): Promise<ManagementScope | null>`
    — liest aktive (`revokedAt IS NULL`) `RoleAssignment`-Zeilen des Users
    inkl. `Role → RolePermission → Permission`, ermittelt je Zuweisung die
    höchste vorhandene `analytics.view_*`-Berechtigung, löst COMPANY-/
    TENANT-Scope auf die konkrete Menge zulässiger `Store`-IDs auf, wendet
    bei mehreren Zuweisungen die Regel aus 3.4 an (höchste Stufe gewinnt,
    Union der `storeIds` gleicher Stufe), liefert `null` bei fehlendem/
    uneindeutigem Scope (deny-by-default, 3.4).
  - `ManagementScope`-Typ: `{ level: "STORE" | "COMPANY" | "TENANT"; storeIds: string[] }`.
- `session.ts`/`dev-users.ts`/Login-Route: `managementScope` zusätzlich zu
  `roles` einmalig serverseitig auflösen und signiert in die Session packen
  (3.2) — der Client liest/verwendet `managementScope` nur, definiert ihn
  nie.
- Tests (unit): alle drei Scope-Ebenen, kombinierte Zuweisungen
  unterschiedlicher Stufe (höchste gewinnt), mehrere Zuweisungen gleicher
  Stufe (Union der storeIds), widerrufene Zuweisung wird ignoriert, User
  ohne Management-Berechtigung → `null` (deny-by-default), Seed-Permission-
  Regressionstest (3.1).

## 5. AP2 – Analytics Authorization Layer

- `kpis.ts`: `KpiPeriodFilter` um optionales `storeIds?: string[]` erweitern
  (Prisma `in`-Filter), bestehendes `storeId: string` **unverändert** lassen
  (Mitarbeitersicht nutzt weiterhin `storeId`, Management-Sicht nutzt
  `storeIds`) — keine Verhaltensänderung für `/analytics`.
- Neues Modul `src/server/analytics/management-authz.ts`:
  `resolveAuthorizedStoreFilter(scope, requestedStoreId?, requestedEmployeeId?)`
  wie in 3.3 beschrieben, plus `ManagementAccessDeniedError`.
- Tests (unit): erlaubter Filter innerhalb Scope, Zugriffsversuch außerhalb
  Scope (STORE-User fragt fremde Filiale an → Fehler, nicht leeres Ergebnis
  — wichtige Unterscheidung, ein leeres Ergebnis würde den Fehler
  verschleiern), `null`-Scope → Fehler.

## 6. AP3 – Management KPI API

- Neue Route `GET /api/analytics/management` (dünner Wrapper, analog
  bestehender Routen-Konvention): `withServerSessionTenantContext()` →
  `resolveAuthorizedStoreFilter()` → `getConsultationVolumeKpi()`/
  `getRecommendationOutcomeKpi()`/`getDealKpi()` mit dem freigegebenen
  Store-Filter → View-Model **inklusive** `commissionAmountMinor`/
  `contributionMarginMinor` (im Gegensatz zu `dashboard-view.ts`, das diese
  bewusst herausfiltert).
- Fehler-Mapping: `ManagementAccessDeniedError` → HTTP 403 (neuer Eintrag im
  bestehenden `http-errors.ts`-Muster).
- Zod-Validierung der Query-Parameter (Zeitraum, optionaler `storeId`/
  `employeeId`) analog bestehender Schemas.

## 7. AP4 – Management Dashboard (eine gemeinsame Komponente)

- Neue Route `/analytics/management` (Server Component, analog
  `/analytics/page.tsx`-Struktur). Bei `managementScope === null`: generische
  "Kein Zugriff"-Seite, keine Preisgabe von Struktur-/Datenhinweisen.
- **Eine** Komponente rendert je nach `scope.level` unterschiedlichen
  Datenumfang (STORE: eigene Filiale, COMPANY: alle Filialen der Company mit
  Vergleich, TENANT: gesamter Mandant mit Vergleich) — keine drei getrennten
  Seiten/Komponenten (Scope-Entscheidung 1).
- Neue Kacheln gegenüber `/analytics`: Provision, Deckungsbeitrag/Marge.
  Bei COMPANY/TENANT zusätzlich optionale Aufschlüsselung nach Filiale
  (nutzt vorhandene `storeId`-Gruppierung in `kpis.ts`, sofern vorhanden —
  sonst minimale Erweiterung; bei Bedarf schlicht gehalten, kein
  Chart-Overengineering, analog Phase-6-Prinzip).

## 8. AP5 – Mitarbeiter-Sicht: Regressionsschutz

Kein neues Feature — Nachweis, dass `/analytics` nach AP1–AP4 unverändert
funktioniert (gleiches Verhalten, gleiche Datenfelder, weiterhin ohne
Provisions-/Margendaten, weiterhin ohne RBAC-Prüfung, wie in
Scope-Entscheidung 1 festgelegt). Regressionstest statt Neuentwicklung.

## 9. AP6 – Performance/Indizes

- Migration: Index auf `Recommendation.generatedAt` und
  `RecommendationOutcome.decidedAt` (Composite mit `tenantId`/`storeId`
  analog bestehender Konventionen bei `ConsultationSession`/`Deal`).
- Keine weiteren Schema-Änderungen. Verifikation über
  `scripts/verify_migration_pglite.mjs`.

## 10. AP7 – Tests/Security

- Integration: alle drei Scope-Ebenen gegen Seed-Fixtures (STORE sieht nur
  eigene Filiale, COMPANY sieht beide Filialen der eigenen Company, TENANT
  sieht den gesamten eigenen Mandanten), IDOR-Versuch (manipulierter
  `storeId`-Query-Parameter außerhalb des Scope → 403), Cross-Tenant-Versuch
  (nutzt bestehende Tenant-Isolationstest-Muster).
- Kombinierte-Scope-Tests (ChatGPT-Auflage, 3.4): User mit `STORE`- **und**
  `COMPANY`-Zuweisung → COMPANY-Umfang gilt; zwei `STORE`-Zuweisungen für
  unterschiedliche Filialen → Union beider `storeIds`; widerrufene
  Zuweisung wird bei der Kombination ignoriert.
- Deny-by-default-Tests: User ganz ohne `RoleAssignment` mit
  `analytics.view_*` → `null`-Scope → 403 (nicht "leeres Ergebnis, das wie
  ein gültiger 0-Wert aussieht").
- Component-Tests für die Management-Dashboard-Komponente (Datenumfang je
  Scope-Stufe, "Kein Zugriff"-Fall).
- Regressionstest AP5.

## 11. AP8 – Dokumentation

- Neu: `docs/MANAGEMENT_ANALYTICS.md` (RBAC-Scope-Modell,
  Autorisierung-vor-Aggregation-Leitplanke, Permission-Katalog-Nutzung).
- Update `docs/ROLES_AND_PERMISSIONS.md` (Konzept → tatsächlich
  durchgesetzter Teil-Katalog).
- Update `docs/ANALYTICS_AND_KPIS.md`/`docs/DEAL_CAPTURE.md` §5 (Provision/
  Marge jetzt sichtbar, aber ausschließlich in der RBAC-geschützten
  Management-Sicht).
- `docs/DATA_MODEL.md`: "5 Filialen" → "2 Filialen pro Tenant" (Scope-
  Entscheidung 4) + Grep auf weitere Stellen mit derselben veralteten Zahl.

## 12. AP9 – Hardening/CI

Lokale Vollverifikation (Lint, Format, `tsc --noEmit`, Tests), Commit, Push
durch Nutzer, CI-Prüfung — wie in jeder Vorphase.

## 13. AP10 – Abschlussbericht Phase 7

Analog `docs/ABSCHLUSSBERICHT_PHASE6.md`: Commit-Tabelle, Testzahlen,
Scope-Entscheidungen, Umsetzungsstand je AP, GO/NO-GO-Abschnitt.

## 14. Risiken

- **IDOR-Regression:** falsch verdrahteter Store-Filter würde Management-
  Daten mandanten-/filialübergreifend leaken — deshalb eigenes AP7 mit
  expliziten Negativtests, nicht nur Happy-Path.
- **Session-Staleness bei Rollenentzug** (siehe 3.2) — von ChatGPT
  ausdrücklich als für Phase 7 akzeptierte, dokumentierte Eigenschaft
  bestätigt (identisch zum bestehenden `roles`-Verhalten); Echtzeit-RBAC
  ist explizit kein Phase-7-Ziel.
- **Seed-Daten-Korrektur (3.1)** könnte bestehende Tests berühren, die
  implizit von der bisherigen (fehlerhaften) Permission-Zuordnung ausgehen —
  vor Umsetzung per Grep prüfen, ob irgendein bestehender Test
  `sales_employee`-Permissions voraussetzt (aktuell nicht ersichtlich, da
  `roles`/`permissions` bislang nirgends ausgewertet werden).

## 15. Klärungspunkte — von ChatGPT entschieden (2026-08-17)

Beide bei Planerstellung offenen Detailfragen wurden ChatGPT vorgelegt und
sind entschieden:

1. **Seed-Daten-Korrektur (3.1):** 🟢 GO. Rollentabelle bestätigt:
   `sales_employee` → kein Management-Analytics, `store_admin` → `STORE`,
   `company_management` → `COMPANY`, `executive_management` → `TENANT`.
   Auflage: Regressionstest, der die Permission-Zuordnung je Rolle absichert
   (siehe AP1).
2. **Session-Ansatz (3.2):** 🟢 GO für Login-Zeit-Auflösung statt Live-DB-
   Prüfung pro Anfrage, mit den in 3.2 dokumentierten verbindlichen
   Bedingungen (ausschließlich serverseitige Ableitung aus
   `RoleAssignment`, COMPANY/TENANT bereits beim Login auf `storeIds`
   aufgelöst, akzeptierte Freshness-Eigenschaft).

Zusätzlich hat ChatGPT zwei Präzisierungen als Auflage ergänzt (kein
GO-Blocker, in diesen Plan eingearbeitet): Deny-by-default (3.4) und
verbindliche Semantik für kombinierte `RoleAssignment`s (3.4). Damit sind
keine offenen Punkte mehr vor dem Implementierungs-GO des Nutzers
ausstehend.

Nach Klärung dieser zwei Punkte: Plan geht zur finalen Abnahme an ChatGPT,
danach explizites Nutzer-Implementierungs-GO (wie in allen Vorphasen).
