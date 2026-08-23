# Management-Analytics (Phase 7)

Dieses Dokument beschreibt das tatsächlich implementierte RBAC-Modell für
die Management-Sicht auf Analytics-Daten (`/analytics/management`,
`GET /api/analytics/management`) sowie die verbindlichen
Architekturregeln, unter denen es entstanden ist (siehe
`PHASE_7_IMPLEMENTATION_PLAN.md` und `PHASE_7_DISCOVERY.md` für den vollen
Entscheidungsverlauf). Es ergänzt [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md)
(dortiges Konzept) um den tatsächlich durchgesetzten Ausschnitt und
[ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md) um die Sichtbarkeitsregeln
für Provision/Deckungsbeitrag.

## Warum ein eigenes Dokument

Vor Phase 7 existierte das RBAC-Datenmodell (`Role`/`RoleAssignment` mit
`scope_type` TENANT/COMPANY/STORE) bereits vollständig im Schema, wurde
aber **nirgends im Code für Autorisierung ausgewertet** — ein reines,
ungenutztes Datenmodell (siehe `PHASE_7_DISCOVERY.md`). Phase 7 hat dieses
Modell erstmals scharf geschaltet, um Provision/Deckungsbeitrag (bislang im
Mitarbeiter-Dashboard bewusst unterdrückt, siehe `DEAL_CAPTURE.md`
Abschnitt 5) einer RBAC-geschützten Management-Sicht zugänglich zu machen.

## Zentrale Leitplanke: Autorisierung VOR Aggregation

Die verbindliche Reihenfolge (ChatGPT, wörtlich): **User authentifizieren
→ Rolle+Scope ermitteln → zulässige Datenmenge bestimmen → KPI
AUSSCHLIESSLICH auf dieser Datenmenge berechnen** — nicht "KPI berechnen →
danach prüfen ob der Nutzer sie sehen darf". Diese Reihenfolge ist in
jedem beteiligten Modul strukturell erzwungen, nicht nur eine Konvention:

```
Session (managementScope, beim Login serverseitig aufgelöst)
  ↓
GET /api/analytics/management (src/app/api/analytics/management/route.ts)
  ↓  reicht session.managementScope unverändert durch, trifft KEINE eigene Entscheidung
buildManagementAnalyticsView() (src/server/analytics/management-view.ts)
  ↓  ruft AUSSCHLIESSLICH resolveAuthorizedStoreFilter() für den Store-/Employee-Filter auf
resolveAuthorizedStoreFilter() (src/server/analytics/management-authz.ts)
  ↓  liefert den geprüften, autorisierten Filter — wirft ManagementAccessDeniedError bei Verstoß
getConsultationVolumeKpi() / getRecommendationOutcomeKpi() / getDealKpi() (src/server/analytics/kpis.ts)
  ↓  berechnen NUR auf dem bereits autorisierten Filter, kennen keine eigene Berechtigungslogik
ManagementAnalyticsView
  ↓
ManagementAnalyticsContent.tsx
  trifft KEINE eigene Scope-Entscheidung, zeigt nur was die API liefert
```

Keine Schicht darf diese Kette abkürzen: `kpis.ts` enthält keine eigene
Berechtigungslogik, `management-view.ts` konstruiert keinen eigenen
Filter, und die UI-Komponente trifft keine eigene Autorisierungsentscheidung.

## Scope-Modell

`ManagementScope` (`src/server/authz/management-scope.ts`) hat drei Stufen:

| Stufe   | Bedeutung                              | erforderliche Permission |
| ------- | -------------------------------------- | ------------------------ |
| STORE   | genau die zugewiesene(n) Filiale(n)    | `analytics.view_store`   |
| COMPANY | alle Filialen der zugewiesenen Company | `analytics.view_company` |
| TENANT  | alle Filialen des Mandanten            | `analytics.view_tenant`  |

Ableitungsregeln (`deriveManagementScope()`, reine, DB-lose Funktion,
Unit-getestet):

- **Deny-by-default:** Kann keine qualifizierende `RoleAssignment` (aktiv,
  `revokedAt IS NULL`, mit zur eigenen Scope-Ebene passender Permission)
  gefunden werden, liefert die Funktion `null` — **niemals** ein impliziter
  "alle Filialen"-Fallback. `null` bedeutet in jeder nachgelagerten Schicht
  konsequent "kein Zugriff", nicht "leeres Ergebnis".
- **Höchste Stufe gewinnt:** TENANT > COMPANY > STORE. Hält ein Nutzer
  mehrere `RoleAssignment`s unterschiedlicher Stufe (z. B. eine STORE- und
  eine COMPANY-Zuweisung), gilt ausschließlich die höchste — nicht die
  Vereinigung aller Stufen.
- **Union + Dedup bei gleicher Stufe:** Mehrere Zuweisungen derselben
  höchsten Stufe (z. B. STORE-Zuweisungen zu zwei unterschiedlichen
  Filialen) werden zu einer deduplizierten Store-ID-Menge vereinigt.
- **Leere Store-Menge → `null`:** Auch eine höchste Stufe, die (z. B. wegen
  einer Company ohne Filialen) auf keine konkrete Store-ID auflöst, liefert
  `null` — nie einen "leeren, aber gültigen" Scope, der später fälschlich
  als "0 Ergebnisse im erlaubten Scope" statt "kein erlaubter Scope"
  interpretiert werden könnte.

Die DB-seitige Auflösung der konkreten Store-IDs (COMPANY → alle Stores der
Company, TENANT → alle Stores des Mandanten) sowie das Laden/Filtern der
`RoleAssignment`-Kandidaten erfolgt in
`resolveManagementScopeForUser()` (`src/server/auth/dev-users.ts`) — bewusst
getrennt von der reinen Auswahllogik, damit letztere ohne DB unit-testbar
bleibt.

## Session statt Live-DB-Reabgleich

`managementScope` wird **einmalig beim Login serverseitig** aus den
`RoleAssignment`-Daten abgeleitet (`buildSessionPayloadForEmployee()`) und
als Teil des signierten Session-Tokens (`src/server/auth/session.ts`)
transportiert — **kein** erneuter DB-Abgleich pro Analytics-Request. Das ist
dieselbe Semantik wie beim bestehenden `roles`-Feld der Session.

**Bewusst akzeptierter Trade-off:** Wird einem Nutzer eine
`RoleAssignment` während einer laufenden Session entzogen, bleibt der zum
Login-Zeitpunkt aufgelöste `managementScope` bis zum nächsten Login
gültig (Session-Staleness). Diese Eigenschaft ist identisch zum
bestehenden Verhalten von `roles` und wurde von ChatGPT für Phase 7
ausdrücklich als akzeptabel bestätigt — Echtzeit-RBAC (sofortiger
Rechteentzug innerhalb einer aktiven Session) ist kein Phase-7-Ziel.

## IDOR-Schutz: Request-Filter dürfen nur einschränken, nie erweitern

`resolveAuthorizedStoreFilter()` (`src/server/analytics/management-authz.ts`)
ist die **einzige** erlaubte Quelle für den Store-/Mitarbeiter-Filter, den
die KPI-Funktionen erhalten. Zentraler Invariant (durch AP7 mit echten
Postgres-Fixtures bewiesen, siehe
`tests/integration/analytics-management-security.test.ts`):

> Ein vom Client angefragter `storeId`-/`employeeId`-Filter darf den
> bereits durch `managementScope` autorisierten Datenbereich **nur
> einschränken**, niemals erweitern.

Konkret:

- Kein angefragter Filter → der volle autorisierte Scope gilt.
- Angefragte `storeId` **innerhalb** des Scopes → Einschränkung auf genau
  diese eine Filiale (z. B. TENANT-Scope + `storeId=<eigene Filiale>` →
  nur diese Filiale, nicht der volle Mandant).
- Angefragte `storeId` **außerhalb** des Scopes → `ManagementAccessDeniedError`
  (403), auch bei vollem TENANT-Scope, auch bei einer `storeId` aus einem
  fremden Mandanten.
- Angefragte `employeeId` wird zusätzlich per DB-Lookup gegen die (ggf.
  bereits eingeschränkte) autorisierte Store-Menge geprüft — ein nicht
  existierender oder außerhalb liegender Mitarbeiter führt zum selben
  Fehler wie eine fremde Filiale (kein Information-Leak über "existiert
  nicht" vs. "keine Berechtigung").
- Ein Zugriffsversuch außerhalb des Scopes wirft immer einen Fehler
  (`ManagementAccessDeniedError` → HTTP 403) — es wird bewusst **kein**
  leeres Ergebnis zurückgegeben, das einen echten "0 Datensätze im
  erlaubten Scope"-Fall verschleiern würde.

## Financial-KPI-Sichtbarkeit: Management vs. Mitarbeitersicht

`ManagementAnalyticsView` enthält das **volle** `DealKpiByCurrency`
inklusive `commissionAmountMinor`/`contributionMarginMinor`. Die
bestehende Mitarbeitersicht (`buildAnalyticsDashboardView()`,
`/analytics`) bleibt unverändert und liefert diese beiden Felder weiterhin
**nicht** — Provision und Deckungsbeitrag sind ausschließlich in der
RBAC-geschützten Management-Sicht sichtbar. Diese Trennung ist durch
Regressionstests in beide Richtungen abgesichert (AP5: Mitarbeitersicht
enthält die Felder nachweislich nicht, auch nicht bei nicht-leeren
Finanzwerten; AP7: Management-Sicht liefert sie korrekt aggregiert über
mehrere Filialen).

## Kein `KpiSnapshot`, weiterhin Live-Aggregation

Wie in Phase 6 entschieden, führt Phase 7 **keine** `KpiSnapshot`-Persistenz
ein — Management-KPIs werden weiterhin live aus den Kernentitäten
aggregiert. Da der Management-Scope zusätzliche Filtermuster erzeugt (z. B.
Abfragen ohne Store-/Employee-Einschränkung für TENANT-Scope), wurden in
AP6 fünf zusätzliche Indizes ergänzt, die strikt aus den tatsächlichen
`WHERE`-Mustern in `kpis.ts` abgeleitet sind (siehe Migration
`20260817220000_analytics_kpi_indexes`): `(tenant_id, started_at)` auf
`ConsultationSession`, `(tenant_id, generated_at)` auf `Recommendation`,
`(tenant_id, decided_at)` auf `RecommendationOutcome`, sowie
`(tenant_id, closed_at)` und `(employee_id, closed_at)` auf `Deal`. Ein
Wechsel zu Snapshots bleibt für später vorgesehen, sobald ein
nachgewiesenes Performance- oder Revisionssicherheitsproblem vorliegt —
nicht vorsorglich.

## Permission-Katalog (Ausschnitt)

Drei Permission-Keys steuern ausschließlich den Management-Analytics-Zugriff
(siehe `src/server/authz/seed-role-permissions.ts`):

| Permission-Key           | qualifiziert für Scope-Stufe |
| ------------------------ | ---------------------------- |
| `analytics.view_store`   | STORE                        |
| `analytics.view_company` | COMPANY                      |
| `analytics.view_tenant`  | TENANT                       |

Verbindliche Seed-Rollentabelle (Phase 7 AP1, behebt einen echten Bug: vor
der Korrektur bekam `sales_employee` fälschlich alle Permissions inklusive
`analytics.view_tenant`, `store_admin` keine):

| Seed-Rolle             | Management-Analytics-Scope |
| ---------------------- | -------------------------- |
| `sales_employee`       | keiner                     |
| `store_admin`          | STORE                      |
| `company_management`   | COMPANY                    |
| `executive_management` | TENANT                     |

## Tenant-Isolation

Die Store-ID-Auflösung für COMPANY/TENANT-Scopes erfolgt ausschließlich
innerhalb des Mandanten der aufrufenden Session (`resolveManagementScopeForUser(tenantId, ...)`);
`RoleAssignment`-Zeilen sind selbst tenant-gebunden. Ein TENANT-Scope-User
von Mandant A kann daher weder über eine manipulierte `storeId` noch über
eine manipulierte `employeeId` Daten von Mandant B erreichen — die
`employeeId`-Prüfung nutzt den mandantengescopten `db`-Client, findet einen
Mitarbeiter eines anderen Mandanten also grundsätzlich nicht (siehe AP7,
Abschnitt "Tenant-Isolation" der Testdatei).

## Getestet in AP7

Alle oben beschriebenen Invarianten sind mit echten Postgres-Fixtures
integrationsgetestet (`tests/integration/analytics-management-security.test.ts`,
kein `vi.mock`): Scope-Auflösung (STORE/COMPANY/TENANT, höchste Stufe
gewinnt, Union+Dedup, fehlende/revoked Permission → `null`), IDOR/AuthZ mit
echtem `employeeId`-DB-Check (inkl. Cross-Tenant-IDs trotz vollem
TENANT-Scope), KPI-Daten-Isolation mit bewusst unterscheidbaren
Finanzwerten je Filiale, Financial-KPI-Trennung Management vs.
Mitarbeiter, Tenant-Isolation, sowie ein echter End-to-End-Test über den
realen HTTP-Route-Handler mit signiertem Session-Cookie (200/403/401-Fälle).
