# Abschlussbericht Phase 3B – Regel-/Empfehlungs-Engine

Stand: 2026-08-01. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (Vorgabe aus der NO-GO-Rückmeldung zu einer früheren Fassung des
Phase-3A-Berichts, hier von Anfang an eingehalten).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Zu unterscheiden: Implementierungs-Commit vs. Berichts-Commits.** Weil
dieser Bericht selbst eine versionierte Datei im Repository ist
(`docs/ABSCHLUSSBERICHT_PHASE3B.md`), ändert jede redaktionelle Korrektur
an ihm den `HEAD` von `main` erneut — ein einzelner, fest im Fließtext
genannter „aktueller HEAD" würde direkt mit dem nächsten Push wieder
veralten. Deshalb wird hier stattdessen der vollständige, nachvollziehbare
Verlauf aller relevanten Commits seit Beginn dieser Phase tabellarisch
geführt; der tatsächlich aktuelle `HEAD` ist immer der zeitlich letzte
Eintrag dieser Tabelle:

| Commit    | Inhalt                                                                                                                                                                   | CI-Lauf | CI-Ergebnis                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-----: | ---------------------------------------------------------------------------------------------------- |
| `106b2da` | Implementierung Phase 3B (Schema, Service-Schicht, Tests, Skripte)                                                                                                       |   #14   | Fehlgeschlagen (FK-Constraint-Namenskollision)                                                       |
| `89d0f98` | Fix CI #14                                                                                                                                                               |   #15   | Fehlgeschlagen (unbekanntes Feld `name` in `Questionnaire.create()`)                                 |
| `3805af6` | Fix CI #15 — **Implementierungs-Commit**, letzter Commit mit Code-/Migrations-/Testinhalt dieser Phase                                                                   |   #16   | **Success**                                                                                          |
| `593f938` | Berichtskorrektur 1 (frühere ChatGPT-NO-GO-Punkte behoben: Append-only-Tabellenzahl, Testzahlen-Trennung, Upgrade-Test-Beleg) — reine Doku-Änderung, kein Code betroffen |   #17   | **Success**                                                                                          |
| `d34dbd0` | Berichtskorrektur 2 (Implementierungs-/Berichts-Commit-Unterscheidung in Abschnitt 11/12/15 ergänzt) — reine Doku-Änderung                                               |   #18   | Fehlgeschlagen (Prettier-Formatierungsfehler in der Berichtsdatei selbst, keine inhaltliche Ursache) |
| `8e3552f` | Fix CI #18 (Prettier-Formatierung), inhaltlich identisch zu `d34dbd0`                                                                                                    |   #19   | **Success**                                                                                          |

Alle Commits ab `593f938` sind reine Berichtskorrekturen ohne
Code-/Migrations-/Teständerung; der CI-Workflow läuft dennoch bei jedem
Push (auch bei Doku-only-Commits) vollständig durch und bestätigt damit
jeweils erneut den unveränderten, weiterhin grünen Code-Stand. Für die
inhaltliche/technische Substanz dieses Berichts (Code-Fakten, Testzahlen,
Dateilisten in Abschnitt 12) ist ausschließlich der **Implementierungs-
Commit `3805af6`** maßgeblich — dieser ändert sich durch nachfolgende
Berichtskorrekturen nicht.

## 1. Technische Versionen

Unverändert gegenüber Phase 3A:

- Node.js: `>=20.11 <23` (`package.json` `engines.node`), Entwicklungsstand
  `v22.22.0` (`.node-version`)
- Paketmanager: npm, verbindlich seit Phase 2B (`packageManager: "npm@10.9.4"`
  in `package.json`), `package-lock.json` ist die einzige committete
  Lockdatei
- Next.js: `^15.5.22`
- React / React-DOM: `^19.2.8`
- Prisma / `@prisma/client`: `^6.19.3`
- Zod: `^3.25.76`
- TypeScript: `^5.9.3`
- Vitest: `^3.2.7` (inkl. `@vitest/coverage-v8` `^3.2.7`)
- ESLint: `^9.19.0` (`eslint-config-next` `^15.1.6`)
- Prettier: `^3.4.2`
- `@electric-sql/pglite`: `^0.5.4` (devDependency; embedded Postgres für die
  Sandbox-Verifikationsskripte, siehe Abschnitt 11)
- `tsx`: `^4.23.1`

## 2. Architektur der Empfehlungs-Engine

Die Empfehlungs-Engine setzt die in `RECOMMENDATION_ENGINE.md` fachlich
beschriebenen drei Schritte (Eignung → geschäftliche Priorisierung →
Darstellung/Begründung) technisch um. Verantwortlich für:

- Prüfung, ob eine `ConsultationSession` überhaupt auswertbar ist (Status
  `IN_PROGRESS`, alle sichtbaren Pflichtfragen beantwortet, genau eine
  `ACTIVE` `RuleSetVersion` für den Tenant vorhanden)
- Eignungsprüfung und `customerFitScore`-Berechnung je Produktkandidat
- Ausschlussprüfung (harte Kante, unabhängig von Marge)
- Geschäftliche Priorisierung inkl. Provisionsauflösung und
  `businessPriorityScore`
- Deterministische Rangfolge bei Gleichstand (Tie-Break)
- Cross-Selling-Signalerkennung und daraus abgeleitete
  `SalesOpportunity`-Erzeugung
- Idempotente, transaktionale Persistierung eines Auswertungslaufs
- Tenant-Isolation für alle oben genannten Operationen

Code-Struktur, `src/server/recommendation/` (Zeilenzahlen aus `git diff
--stat b11d3ce..HEAD`, siehe Abschnitt 12):

| Datei                   | Zeilen | Art                            | Zweck                                                                                           |
| ----------------------- | -----: | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `types.ts`              |    164 | rein, DB-frei                  | Ein-/Ausgabetypen, `ConditionSourceType`                                                        |
| `errors.ts`             |    164 | rein, DB-frei                  | Alle Fehlerklassen (`RecommendationEngineError`-Hierarchie, siehe Abschnitt 9)                  |
| `attribute-registry.ts` |    288 | rein, DB-frei                  | Geschlossene Registry für `PRODUCT_ATTRIBUTE`/`SESSION_ATTRIBUTE`-Werte, Typprüfung, Operatoren |
| `conditions.ts`         |    137 | rein, DB-frei                  | Auswertung von `RuleCondition`-Gruppen (UND innerhalb, ODER zwischen Gruppen)                   |
| `eligibility.ts`        |     46 | rein, DB-frei                  | Eignungsprüfung + `customerFitScore`                                                            |
| `exclusion.ts`          |     38 | rein, DB-frei                  | Ausschlussprüfung                                                                               |
| `fit-score.ts`          |     46 | rein, DB-frei                  | Gewichtete `customerFitScore`-Berechnung aus nicht-verpflichtenden Regeln                       |
| `prioritization.ts`     |     79 | rein, DB-frei                  | `businessPriorityScore`-Berechnung inkl. Provisionsauflösung                                    |
| `tie-break.ts`          |     40 | rein, DB-frei                  | Deterministische Rangfolge bei Score-Gleichstand                                                |
| `cross-selling.ts`      |     60 | rein, DB-frei                  | Cross-Selling-Regelauswertung → Signal-Kandidaten                                               |
| `fingerprint.ts`        |    186 | rein, DB-frei                  | SHA-256-Idempotenz-Fingerprint über kanonische Eingaben (siehe Abschnitt 5)                     |
| `sales-opportunity.ts`  |    110 | Orchestrierung mit `db`/Prisma | `SalesOpportunity`-Erzeugung aus Cross-Selling-Signalen, Quellen-Invariante                     |
| `service.ts`            |    845 | Orchestrierung mit `db`/Prisma | Öffentliche API (`evaluate()`, `getLatestRecommendation()`), siehe Abschnitt 9                  |

Wie in Phase 3A sind die reinen Module bewusst ohne Datenbankzugriff
geschrieben, damit sie mit reinem Vitest (ohne Postgres/Prisma) unit-testbar
sind (siehe Abschnitt 10). `service.ts` und `sales-opportunity.ts`
orchestrieren diese Module über `db` aus `src/server/db/client.ts`,
tenant-gescoped über `src/server/tenant/scoped-client.ts` /
`runWithTenantContext()` — identisches Muster zur Fragen-Engine aus Phase
3A.

## 3. Schema- und Migrationsänderungen

Neue, dedizierte Migration `prisma/migrations/20260801130000_recommendation_engine/migration.sql`
(324 Zeilen) — im Unterschied zu Phase 3A **nicht** in die `init`-Migration
eingearbeitet, da inzwischen ein bereits gepushter, CI-geprüfter Stand
existiert.

**Zwei Pre-Migration-Sicherheitsprüfungen** (`DO $$ ... $$`-Blöcke), die die
Migration kontrolliert abbrechen statt stillschweigend zu erraten/zu
backfillen:

1. Abbruch, falls vorhandene `recommendation_items.business_priority_score`-
   Werte außerhalb des `INTEGER`-Wertebereichs liegen (Typwechsel von
   `DOUBLE PRECISION` auf `INTEGER`, siehe unten).
2. Abbruch, falls bereits vorhandene `RULE_BASED`-`SalesOpportunity`-Zeilen
   existieren, für die kein sicherer Backfill-Pfad zu einer
   `triggerSignalId` besteht.

**Neuer Enum-Typ:** `ConditionSourceType` (`ANSWER`, `PRODUCT_ATTRIBUTE`,
`SESSION_ATTRIBUTE`).

**Sechs neue Tabellen** (`CREATE TABLE`): `cross_selling_rules`,
`eligibility_rule_conditions`, `exclusion_rule_conditions`,
`prioritization_rule_conditions`, `cross_selling_rule_conditions`,
`recommendation_cross_selling_signals`.

**Geänderte Bestandstabellen** (additiv/umbenennend, eine dokumentierte
Ausnahme):

- `eligibility_rules`, `exclusion_rules`, `prioritization_rules`:
  `expression` → `legacy_expression` (umbenannt, nullable statt
  verpflichtend — physisches Entfernen erst in einer späteren
  Cleanup-Migration, siehe Abschnitt 14); neue Spalten `is_required`,
  `fit_weight` (`eligibility_rules`), `commission_required`
  (`prioritization_rules`), `justification_params` (`exclusion_rules`);
  neue Unique-Constraint `exclusion_rules(tenant_id, rule_set_version_id,
reason_code)` + CHECK auf nicht-leeren `reason_code`.
- `sales_opportunities`: neue, alle nullable/defaultete Spalten
  `trigger_signal_id`, `reason_code`, `justification_params`, `priority`,
  `follow_up_required`, `follow_up_reason_code`. Bewusst **kein**
  DB-CHECK-Constraint für die Quellen-Konsistenz (`RULE_BASED` ⇔
  `triggerSignalId` gesetzt) — diese Invariante liegt auf `DetectedNeed`,
  nicht auf `SalesOpportunity` selbst, und wird stattdessen in
  `sales-opportunity.ts` erzwungen (`SalesOpportunitySourceMismatchError`).
- `recommendation_items`: neue Spalte `customer_fit_score` (`INTEGER NOT
NULL`); **Typwechsel** `business_priority_score` von `DOUBLE PRECISION`
  auf `INTEGER` (einzige nicht rein-additive Änderung dieser Migration,
  durch Sicherheitsprüfung 1 oben abgesichert).
- `recommendation_rationales`: neue Spalten `commission_model_version_id`,
  `commission_value_minor` (Provisions-Pinning, siehe Abschnitt 7).
- `recommendations`: neue Spalten `algorithm_version` (`INTEGER`,
  Temp-Default dann `DROP DEFAULT`), `evaluation_fingerprint` (`CHAR(64)`,
  gleiches Muster), `input_data_completeness_score` (nullable `DOUBLE
PRECISION`); neue Unique-Constraint
  `recommendations_tenant_id_consultation_session_id_evaluation_fi` auf
  `(tenant_id, consultation_session_id, evaluation_fingerprint)`
  (Idempotenz-Durchsetzung, siehe Abschnitt 5).
- Zwei neue Unique-Indexe (`customer_answers_tenant_id_id_key`,
  `commission_model_versions_tenant_id_id_key`), da beide Tabellen zuvor nie
  Ziel einer zusammengesetzten (`tenant_id`, `id`) Fremdschlüsselbeziehung
  waren, dies für die neuen Conditions-/Rationale-Beziehungen aber
  benötigt wird.

**Neuer EXCLUDE-Constraint** `rule_set_versions_tenant_active_no_overlap`
(GiST, `btree_gist` bereits aus der `init`-Migration vorhanden): höchstens
eine `ACTIVE`-`RuleSetVersion` je Tenant über alle `RuleSet`s hinweg
gleichzeitig — zusätzlich zum bestehenden, je-`RuleSet`-scoped
`rule_set_versions_no_overlap`.

**Fünf neue Append-only-Trigger** (`forbid_update_delete()`, Funktion
bereits aus der `init`-Migration): `recommendations`,
`recommendation_items`, `recommendation_rationales`,
`recommendation_outcomes`, `recommendation_cross_selling_signals`.
Bewusst **nicht** auf `sales_opportunities` (bleibt mutabel, siehe
Abschnitt 6).

**Explizite `map()`-Constraint-Namen** für die beiden Fremdschlüssel
`recommendation_cross_selling_signals.trigger_rule_id`/
`trigger_rule_set_version_id` (`rec_css_trigger_rule_fkey`,
`rec_css_trigger_rule_set_version_fkey`) — Hintergrund und Notwendigkeit
in Abschnitt 13 (CI #13/#14).

`npm run verify:migration` bestätigt: 61 Tabellen (55 aus Phase 2B/3A + 6
neu), 101 Fremdschlüssel (Details in Abschnitt 11).

## 4. Regeltypen und Bedingungsmodell

Vier Regeltypen, alle an genau eine `RuleSetVersion` gebunden (`schema.prisma`
Zeilen 1197–1297):

- **`EligibilityRule`**: `isRequired` (Default `true`) = hartes Gate — nicht
  erfüllt ⇒ Produkt gilt als nicht geeignet; `isRequired=false` = Regel
  fließt stattdessen gewichtet (`fitWeight`) in `customerFitScore` (0–100)
  ein, ohne die Eignung selbst zu beeinflussen.
- **`ExclusionRule`**: harter, margenunabhängiger Ausschluss; `reasonCode`
  muss je `RuleSetVersion` eindeutig und nicht-leer sein
  (Unique-Constraint + CHECK, siehe Abschnitt 3); `justificationParams`
  liefert strukturierte Zusatzinfos für die zugehörige
  `RecommendationRationale`-Zeile (`factorKey = "exclusion:<reasonCode>"`).
- **`PrioritizationRule`**: wirkt ausschließlich auf bereits eignungsgeprüfte
  Produkte, trägt mit `weight` zum `businessPriorityScore` bei;
  `commissionRequired` steuert das Verhalten bei nicht auflösbarer
  `CommissionModelVersion` — `true`: Abbruch der gesamten
  Session-Auswertung (`CommissionModelUnresolvedError`), `false` (Default):
  Gewicht-0-Fallback mit `factorKey = "commission_model_unresolved"`.
- **`CrossSellingRule`**: erzeugt keine `RecommendationItem`-Zeilen, sondern
  unveränderliche `RecommendationCrossSellingSignal`-Snapshots
  (`needType`, `priority`, `reasonCode`, optionaler
  `suggestedProductVersionId`).

Jede Regel besitzt eigene `*RuleCondition`-Zeilen (identisches Schema für
alle vier Typen): `groupIndex` (gleicher Index = UND-Verknüpfung,
unterschiedlicher Index = ODER-Verknüpfung zwischen Gruppen, eine Ebene,
kein Nesting — analog `VisibilityCondition` aus Phase 3A),
`sourceType ∈ {ANSWER, PRODUCT_ATTRIBUTE, SESSION_ATTRIBUTE}`, sowie genau
eines von `questionId`/`attributeKey` (abhängig von `sourceType`,
Service-Layer-Validierung über `InvalidConditionSourceError`, keine
DB-CHECK-Constraint). `ANSWER`-Bedingungen werten die jeweilige
`CustomerAnswer` gegen den `AnswerType`-Operator aus (`questionnaire/
visibility.ts`, unverändert seit Phase 3A). `PRODUCT_ATTRIBUTE`/
`SESSION_ATTRIBUTE`-Bedingungen laufen über die geschlossene
Attribute-Registry (`attribute-registry.ts`): jedes Attribut hat einen
festen `valueType` (`INTEGER`, `DECIMAL`, `BOOLEAN`, `ENUM`, `STRING`) und
eine feste Menge erlaubter Operatoren; unbekannte `attributeKey`s werden
über `UnknownAttributeKeyError` konsequent abgelehnt, nicht toleriert oder
laufzeitkonfigurierbar erweitert (bewusste Design-Entscheidung, analog zur
`AnswerType`-Operator-Matrix aus Phase 3A).

Das alte, unstrukturierte `legacyExpression`-Feld bleibt aus
Kompatibilitätsgründen als nullable Spalte bestehen, ist aber **nicht** der
aktive Auswertungspfad — ausschließlich das strukturierte
`*RuleCondition`-Modell wird von `evaluate()` gelesen (siehe Abschnitt 14
für den Status dieser Altlast).

## 5. Idempotenz- und Reproduzierbarkeitsstrategie

Jeder Auswertungslauf (`evaluate()`) erhält einen SHA-256-Fingerprint
(`fingerprint.ts`, 186 Zeilen, 21 Unit-Tests) über eine kanonische
JSON-Repräsentation aller Eingaben: Antworten, Produktattribute,
Sitzungsattribute, `RuleSetVersion`-ID, `QuestionnaireVersion`-ID,
Algorithmusversion (`algorithmVersion`), sowie alle zum Auswertungszeitpunkt
tenant-weit gültigen `CommissionModelVersion`-IDs. Zwei Auswertungen
derselben Session mit identischem Fingerprint erzeugen **keinen** neuen
Datensatz:

1. **Fast-Path:** Vor jedem Schreibversuch, außerhalb der Transaktion, ein
   `SELECT` auf `(consultationSessionId, evaluationFingerprint)`. Bei
   Treffer wird die bestehende `Recommendation` unverändert zurückgegeben,
   insbesondere **ohne** erneute `SalesOpportunity`-Erzeugung.
2. **Race-Condition-Pfad:** Zwei parallele Auswertungsläufe mit identischem
   Fingerprint (Fast-Path-`SELECT` bei beiden ohne Treffer, dann
   gleichzeitiges `INSERT`) lösen auf dem Unique-Constraint
   `(tenant_id, consultation_session_id, evaluation_fingerprint)`
   kontrolliert einen `P2002`-Konflikt aus; der Service sucht danach erneut
   per `SELECT` und gibt den gewinnenden Datensatz zurück statt einen
   Duplikat-Fehler nach außen zu geben. Findet diese Recovery-Suche
   **keinen** Treffer, wird das als `RecommendationConsistencyError`
   behandelt (Hinweis auf Datenkorruption oder einen Fingerprint-Bug) —
   dieser Zweig wird nie stillschweigend geschluckt, ist aber mangels
   sinnvoller Test-Seam im Produktionscode absichtlich ungetestet
   geblieben (siehe Abschnitt 13).

Dieses Vorgehen ist mit 12 Integrationstest-Fällen in
`tests/integration/recommendation-engine.test.ts` abgedeckt, u. a.
expliziten Tests für "identischer Fingerprint erzeugt keinen zweiten
Datensatz" und "gleichzeitige Auswertung mit identischem Fingerprint"
(siehe Abschnitt 10).

## 6. Unveränderlichkeit vs. mutabler Vertriebs-Workflow

`Recommendation`, `RecommendationItem`, `RecommendationRationale`,
`RecommendationOutcome` und `RecommendationCrossSellingSignal` sind
append-only (DB-Trigger `forbid_update_delete()`, kein `UPDATE`/`DELETE`
möglich) — ein einmal erzeugter Auswertungslauf bleibt für immer
unverändert nachvollziehbar, konsistent mit der bereits in Phase 2B
eingeführten Append-only-Strategie für `AuditLog`/`DealFinancialSnapshot`.
`verify:migration` (Abschnitt 11) prüft für alle fünf Tabellen je mindestens
eine abgelehnte `UPDATE`- oder `DELETE`-Probe auf DB-Ebene: `recommendations`
(UPDATE), `recommendation_items` (DELETE), `recommendation_rationales`
(UPDATE + DELETE), `recommendation_outcomes` (UPDATE + DELETE) und
`recommendation_cross_selling_signals` (UPDATE).

`SalesOpportunity` ist bewusst **davon ausgenommen** und bleibt mutabel, da
sie den tatsächlichen Vertriebs-Workflow abbildet (Status `OPEN` →
`OFFERED`/`RESOLVED`, `offeredAt`/`resolvedAt`, Zuweisung/Bearbeitung durch
Mitarbeitende), nicht die unveränderliche Auswertungs-Momentaufnahme. Ein
Unit-Test (`sales-opportunity.test.ts`) bestätigt explizit, dass
`SalesOpportunity`-Zeilen im Gegensatz zu den fünf append-only-Tabellen
tatsächlich per `UPDATE` änderbar sind; `verify:migration` bestätigt
dasselbe auf DB-Ebene (Abschnitt 11).

`SalesOpportunity.triggerSignalId` verwendet bewusst `onDelete: Restrict`
statt `SetNull`: eine `SalesOpportunity` mit `RULE_BASED`-Herkunft
(`DetectedNeed.source`) darf ihren Signal-Snapshot nicht verlieren. Die
zugehörige Konsistenz-Invariante (`RULE_BASED` ⇔ `triggerSignalId`
gesetzt, `EMPLOYEE_MARKED` ⇔ `triggerSignalId = null`) liegt auf
`DetectedNeed`, nicht auf `SalesOpportunity` selbst, und ist daher nicht
per DB-CHECK auf `sales_opportunities` abbildbar — sie wird stattdessen in
`sales-opportunity.ts` erzwungen (`SalesOpportunitySourceMismatchError`,
in Abschnitt 13 des Risikoregisters als bewusst nur anwendungsseitig
durchgesetztes Risiko dokumentiert).

## 7. Provisions-Pinning

`commissionModelVersionId`/`commissionValueMinor` sitzen ausschließlich auf
`RecommendationRationale`, nicht auf `RecommendationItem`: mehrere
Rationale-Zeilen desselben Items (z. B. mehrere provisionsbasierte
`PrioritizationRule`-Treffer) können unterschiedliche
`CommissionModelVersion`-Stände referenzieren. `commissionValueMinor` ist
der zum Auswertungszeitpunkt gelesene Wert, getrennt von der reinen ID
gespeichert, damit spätere Änderungen an der Provisionslogik oder an
`CommissionModelVersion`-Stammdaten die Reproduzierbarkeit bereits
erzeugter Rationale-Zeilen nicht rückwirkend beeinflussen.

## 8. Tenant-Isolation und Datenschutz

Alle neuen Tabellen folgen unverändert dem Mandantenfähigkeits-Muster aus
Phase 2B/3A: jede Zeile trägt `tenant_id`, jede Fremdschlüsselbeziehung ist
zusammengesetzt (`tenant_id`, `id`) statt nur über `id`, und jeder
Datenbankzugriff läuft ausschließlich über `runWithTenantContext()` /
`scoped-client.ts`. `tests/integration/recommendation-engine.test.ts`
enthält einen dedizierten Tenant-Isolationstest (Auswertung für Tenant A
darf keine für Tenant B sichtbaren/schreibbaren Nebenwirkungen erzeugen).
Es werden ausschließlich bereits vorhandene, synthetische Antwort-/
Produkt-/Provisionsdaten verarbeitet; die Empfehlungs-Engine führt keine
neuen personenbezogenen Datenfelder ein (keine Freitext- oder
Kontaktdatenverarbeitung in dieser Phase).

## 9. API- und Service-Schnittstellen

Öffentliche API (`src/server/recommendation/service.ts`, 845 Zeilen):

- **`evaluate(consultationSessionId)`**: Session laden → Auswertbarkeit
  prüfen (Status `IN_PROGRESS`, Vollständigkeit über dieselbe
  `computeVisiblePath()`/`computeProgress()`-Logik wie die Fragen-Engine aus
  Phase 3A, genau eine `ACTIVE` `RuleSetVersion` vorhanden) → Fingerprint-
  Fast-Path-`SELECT` (Abschnitt 5) → Produktkandidaten laden → je Kandidat
  Eignung, `customerFitScore`, Ausschluss und Priorisierung (inkl.
  Provisionsauflösung) berechnen → `priorityRank` über alle Kandidaten
  vergeben (Tie-Break: `businessPriorityScore DESC` → `customerFitScore
DESC` → `monthlyPriceMinor ASC` → `productVersionId ASC`) →
  Cross-Selling-Regeln auswerten → transaktionales Schreiben
  (`Recommendation` + `RecommendationItem` + `RecommendationRationale` +
  `RecommendationCrossSellingSignal` + `AnalyticsEvent`) → erst nach einem
  tatsächlich neuen Schreibvorgang werden `SalesOpportunity`-Zeilen aus den
  Cross-Selling-Signalen erzeugt (entkoppelt von der Auswertungstransaktion,
  über `sales-opportunity.ts`).
- **`getLatestRecommendation(consultationSessionId)`**: reiner Lesezugriff
  ohne Auswertbarkeitsprüfung, funktioniert auch für `COMPLETED`-Sitzungen.

Vollständige Fehlerklassen-Hierarchie (`errors.ts`, alle erben von
`RecommendationEngineError extends Error`):

| Fehlerklasse                          | Auslöser                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SessionNotEvaluableError`            | `evaluate()` für eine Session mit Status ≠ `IN_PROGRESS` aufgerufen                                                |
| `InsufficientAnswerDataError`         | sichtbare Pflichtfragen unbeantwortet (`missingQuestionIds`)                                                       |
| `RuleSetNotConfiguredError`           | keine (oder mehr als eine) `ACTIVE` `RuleSetVersion` für den Tenant                                                |
| `NoValidProductVersionError`          | tenant-weit keine gültige `ProductVersion` zum Auswertungszeitpunkt                                                |
| `CommissionModelUnresolvedError`      | `commissionRequired=true`-Regel ohne auflösbare `CommissionModelVersion` — bricht die gesamte Auswertung ab        |
| `RecommendationConsistencyError`      | P2002 ohne Fingerprint-Treffer bei der Recovery-Suche (Abschnitt 5)                                                |
| `UnknownAttributeKeyError`            | `attributeKey` nicht in der geschlossenen Attribute-Registry                                                       |
| `InvalidOperatorForAttributeError`    | Operator für den `valueType` des referenzierten Attributs nicht erlaubt                                            |
| `InvalidComparisonValueError`         | `comparisonValue` nicht gemäß `valueType` parsbar                                                                  |
| `InvalidConditionSourceError`         | ungültiges Feld-Paar `questionId`/`attributeKey` für den gegebenen `sourceType`                                    |
| `SalesOpportunitySourceMismatchError` | `DetectedNeed.source`/`triggerSignalId`-Invariante verletzt (Abschnitt 6)                                          |
| `CrossSellingSignalNotFoundError`     | referenziertes `RecommendationCrossSellingSignal` existiert nicht oder gehört zu anderem Mandanten/anderer Session |

## 10. Anzahl und Art aller neuen Tests

**Unit-Tests** (`npm run test:unit`, reine Module ohne DB): 111 neue Tests
über 10 Dateien in `tests/unit/recommendation/`:

| Datei                        | Tests |
| ---------------------------- | ----: |
| `attribute-registry.test.ts` |    24 |
| `fingerprint.test.ts`        |    21 |
| `conditions.test.ts`         |    17 |
| `fit-score.test.ts`          |    12 |
| `tie-break.test.ts`          |     8 |
| `sales-opportunity.test.ts`  |     8 |
| `eligibility.test.ts`        |     6 |
| `prioritization.test.ts`     |     6 |
| `cross-selling.test.ts`      |     5 |
| `exclusion.test.ts`          |     4 |

Zusammen mit den 150 bereits bestehenden Tests aus Phase 2B (99) und Phase
3A (51) ergibt das **261/261 Tests grün, 21 Testdateien** (siehe Abschnitt
11). Diese 261 sind ausschließlich `test:unit`-Fälle (reine Module ohne DB);
Integrationstests sind davon vollständig getrennt und werden separat gezählt
(siehe unten).

**Integrationstests** (`npm run test:integration`, gegen echten
`@prisma/client` + Postgres-Service-Container in CI, siehe Abschnitt 13 zur
Sandbox-Einschränkung, lokal nicht ausführbar): Die Test-Suite umfasst
insgesamt 3 Dateien mit 35 Fällen, von denen **12 neu in Phase 3B**
hinzugekommen sind:

| Datei                                             | Tests | Phase                        |
| ------------------------------------------------- | ----: | ---------------------------- |
| `tests/integration/tenant-isolation.test.ts`      |     6 | bereits bestehend (Phase 2B) |
| `tests/integration/questionnaire-engine.test.ts`  |    17 | bereits bestehend (Phase 3A) |
| `tests/integration/recommendation-engine.test.ts` |    12 | **neu, Phase 3B**            |

Die 12 neuen Fälle in `recommendation-engine.test.ts` (815 Zeilen) decken
u. a. ab: vollständiger Auswertungspipeline-Durchlauf, Idempotenz bei
identischem Fingerprint, Nebenläufigkeit (gleichzeitige Auswertung mit
identischem Fingerprint), Ablehnung vor vollständiger Beantwortung
(`InsufficientAnswerDataError`), Ausschlussregel-Anwendung, Cross-Selling-
Signalerzeugung inkl. daraus abgeleiteter idempotenter
`SalesOpportunity`-Erzeugung, Tenant-Isolation, Append-only-
Unveränderlichkeit sowie vier separate Fehlerpfad-Tests
(`SessionNotEvaluableError`, `RuleSetNotConfiguredError`,
`NoValidProductVersionError`, `CommissionModelUnresolvedError`).

**Gesamtbild Phase 3B (neu hinzugekommene Tests):** 111 Unit + 12
Integration = **123 neue Tests**, nicht überlappend. **Gesamtbild
System (alle Phasen, laut CI-Lauf #16):** 261 Unit + 35 Integration =
**296 Tests, alle grün** (Beleg: Abschnitt 11).

## 11. Vollständige Prüfkommandos mit Ergebnissen und Exit-Codes

Alle Kommandos wurden in dieser Sitzung tatsächlich ausgeführt (nicht nur
per Code-Review behauptet):

| Kommando                                                                        |        Exit-Code         | Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | :----------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`                                                             |            0             | 261/261 Tests grün, 21 Testdateien, 3,99 s Laufzeit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run lint`                                                                  |            0             | 0 Fehler, 0 Warnungen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run format`                                                                |            0             | "All matched files use Prettier code style!"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run verify:migration`                                                      |            0             | 61 Tabellen, 101 Fremdschlüssel; vollständiger Phase-3B-Smoke-Test: End-to-End-Erzeugung `Recommendation` samt `RecommendationItem`/`RecommendationRationale` (inkl. Provisions-Pinning)/`RecommendationOutcome`/`RecommendationCrossSellingSignal`/`SalesOpportunity`, 7 Append-only-Ablehnungsproben über alle 5 append-only-Tabellen (`recommendations`: UPDATE; `recommendation_items`: DELETE; `recommendation_rationales`: UPDATE + DELETE; `recommendation_outcomes`: UPDATE + DELETE; `recommendation_cross_selling_signals`: UPDATE), 1 SalesOpportunity-Mutabilitätsbeweis, 1 EXCLUDE-Constraint-Ablehnungsprobe (`rule_set_versions_tenant_active_no_overlap`) — "ALLE PHASE-3B-MIGRATIONSPRUEFUNGEN ERFOLGREICH" |
| `node scripts/verify_migration_upgrade_pglite.mjs`                              |            0             | Upgrade-Test der Phase-3B-Migration auf einer bereits mit `init`- + Phase-3A-Migration befüllten DB, zwei Szenarien: (A) bestehende `RULE_BASED`-`SalesOpportunity` ohne `triggerSignalId` → Migration bricht wie vorgesehen kontrolliert per `RAISE EXCEPTION` ab; (B) bestehende `EMPLOYEE_MARKED`-`SalesOpportunity` → Migration läuft erfolgreich durch — "Upgrade-Test (beide Szenarien) ERFOLGREICH"                                                                                                                                                                                                                                                                                                                   |
| `npm run verify:seed`                                                           |            0             | alle Zeilenzahlen für neue Phase-3B-Tabellen wie erwartet, alle Phase-2B-Isolations-/Constraint-Regressionsprüfungen weiterhin erfolgreich — "ALLE PRUEFUNGEN ABGESCHLOSSEN"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx tsc --noEmit`                                                              |            1             | 38 Fehler, ausnahmslos auf die bekannte Sandbox-Einschränkung zurückführbar (11 Wurzelursache-Fehler "Cannot find module '@prisma/client'", Rest daraus kaskadierende `implicit any`/`unknown`-Folgefehler) — keine neuen Logikfehler (siehe Abschnitt 13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CI-Lauf #16 (Commit `3805af6`), Schritt „Integrationstests (echte Postgres-DB)" |       0 (Success)        | `npm run test:integration` → vitest: **Test Files 3 passed (3)**, **Tests 35 passed (35)** — `tests/integration/tenant-isolation.test.ts` (6 Tests, 409ms), `tests/integration/questionnaire-engine.test.ts` (17 Tests, 1040ms), `tests/integration/recommendation-engine.test.ts` (12 Tests, 998ms, **neu in Phase 3B**); Gesamtdauer 1,64s                                                                                                                                                                                                                                                                                                                                                                                 |
| CI-Lauf #16 (Commit `3805af6`), Gesamtjob `build-and-test`                      | Success (GitHub Actions) | 1m 27s, vollständiger Durchlauf inkl. `prisma generate`, `prisma migrate deploy` gegen echte Postgres-Service-Instanz, Lint/Format/Typecheck/Unit-Tests/Integrationstests (s. o.)/`npm run build` — abschließende Bestätigung, dass diese Phase auch außerhalb der Sandbox vollständig besteht                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CI-Lauf #17 (Commit `593f938`), Gesamtjob `build-and-test`                      | Success (GitHub Actions) | 1m 31s. Reine Berichtskorrektur (siehe Einleitungstabelle), keine Code-/Migrations-/Teständerung. Bestätigt erneut denselben, unveränderten grünen Code-Stand (identisch zu CI-Lauf #16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CI-Lauf #18 (Commit `d34dbd0`), Gesamtjob `build-and-test`                      | Failure (GitHub Actions) | 59s. Fehlgeschlagen am Schritt „Formatierung prüfen (Prettier)": Formatierungsabweichung ausschließlich in `docs/ABSCHLUSSBERICHT_PHASE3B.md` selbst (keine inhaltliche/Logik-Ursache, kein Code betroffen). Transparent dokumentiert statt verschwiegen, siehe Einleitungstabelle                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CI-Lauf #19 (Commit `8e3552f`), Gesamtjob `build-and-test`                      | Success (GitHub Actions) | 1m 44s. Behebt ausschließlich die Prettier-Formatierung aus CI-Lauf #18 (inhaltlich identisch zu `d34dbd0`), keine Code-/Migrations-/Teständerung. Aktueller `HEAD` von `main` zum Zeitpunkt dieses Berichtsstands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 12. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat b11d3ce..3805af6` (`b11d3ce` = letzter Commit vor Beginn
Phase 3B, `3805af6` = **Implementierungs-Commit**, d. h. der letzte Commit
mit tatsächlichem Code-/Migrations-/Testinhalt dieser Phase): **39 Dateien
geändert, 8.535 Zeilen hinzugefügt, 169 Zeilen entfernt.**

Diese Diff-Statistik reicht bewusst nur bis `3805af6` und **enthält nicht**
den späteren Commit `593f938` (Korrigierter Berichts-Commit). `593f938`
ändert ausschließlich `docs/ABSCHLUSSBERICHT_PHASE3B.md` (redaktionelle
Korrektur, keine Code-/Migrations-/Testdatei betroffen) und ist damit für
diese datei-/zeilenbasierte Implementierungsübersicht nicht relevant.

```
PHASE_3B_IMPLEMENTATION_PLAN.md                              | 1095 ++++++++++
PHASE_3B_STARTPROMPT.md                                      |  247 +++
docs/ABSCHLUSSBERICHT_PHASE3A.md                              |  707 +++++--
docs/DATA_MODEL.md                                            |   70 +-
docs/DECISION_LOG.md                                          |  122 ++
docs/IMPLEMENTATION_STATUS.md                                 |  102 ++
docs/OPEN_DECISIONS.md                                        |    2 +-
docs/RECOMMENDATION_ENGINE.md                                 |   75 ++
docs/RISK_REGISTER.md                                         |   18 +-
prisma/migrations/20260801130000_recommendation_engine/
  migration.sql                                               |  324 +++
prisma/schema.prisma                                          |  355 +++-
prisma/seed.ts                                                |  421 +++-
scripts/verify_migration_pglite.mjs                           |  247 ++-
scripts/verify_migration_upgrade_pglite.mjs                   |  181 ++
scripts/verify_seed_pglite.mjs                                |  233 ++-
src/server/recommendation/attribute-registry.ts               |  288 +++
src/server/recommendation/conditions.ts                       |  137 +++
src/server/recommendation/cross-selling.ts                    |   60 +
src/server/recommendation/eligibility.ts                      |   46 +
src/server/recommendation/errors.ts                           |  164 +++
src/server/recommendation/exclusion.ts                        |   38 +
src/server/recommendation/fingerprint.ts                      |  186 +++
src/server/recommendation/fit-score.ts                        |   46 +
src/server/recommendation/prioritization.ts                   |   79 +
src/server/recommendation/sales-opportunity.ts                |  110 +
src/server/recommendation/service.ts                          |  845 +++++++
src/server/recommendation/tie-break.ts                        |   40 +
src/server/recommendation/types.ts                             |  164 +++
tests/integration/recommendation-engine.test.ts               |  815 +++++++
tests/unit/recommendation/attribute-registry.test.ts          |  210 ++
tests/unit/recommendation/conditions.test.ts                  |  269 +++
tests/unit/recommendation/cross-selling.test.ts               |  128 +++
tests/unit/recommendation/eligibility.test.ts                 |   91 +
tests/unit/recommendation/exclusion.test.ts                   |  111 +
tests/unit/recommendation/fingerprint.test.ts                 |  229 +++
tests/unit/recommendation/fit-score.test.ts                   |   98 +
tests/unit/recommendation/prioritization.test.ts              |  132 +++
tests/unit/recommendation/sales-opportunity.test.ts            |  118 +++
tests/unit/recommendation/tie-break.test.ts                   |  101 +
39 files changed, 8535 insertions(+), 169 deletions(-)
```

`scripts/verify_migration_upgrade_pglite.mjs` ist neu: verifiziert, dass
die neue Migration `20260801130000_recommendation_engine` auf einer bereits
mit der `init`-Migration + Phase-3A-Migration befüllten Datenbank
(inkl. bestehender Phase-2B/3A-Testdaten) fehlerfrei anwendbar ist —
zusätzlich zur bisherigen Prüfung "Migration gegen leere DB" aus
`verify_migration_pglite.mjs`.

## 13. Vollständige bekannte Einschränkungen

**Zentrale Sandbox-Einschränkung (unverändert seit Phase 2B):** Die
Entwicklungsumgebung dieser Sitzung hat keinen Zugriff auf
`binaries.prisma.sh` (HTTP 403). Dadurch konnten `prisma generate`,
`prisma migrate deploy` und `prisma validate` in dieser Sitzung nicht
ausgeführt werden. Verifikation erfolgte stattdessen über eigene,
PGlite-gestützte Skripte (`verify:migration`, `verify:seed`, neu:
`verify_migration_upgrade_pglite.mjs`) sowie abschließend über den echten
CI-Lauf. Konsequenz: Prisma-eigene Schema-Validierung (inkl. Fremdschlüssel-
Namenslängenprüfung) und TypeScript-Prüfung von `.create()`-Aufrufen gegen
die tatsächlich generierten Client-Typen sind in dieser Sandbox strukturell
unsichtbar und wurden ausschließlich durch CI aufgedeckt — siehe die beiden
folgenden, in dieser Phase tatsächlich aufgetretenen Fälle:

**CI #13/#14 (behoben, Commit `89d0f98`):** Erster CI-Lauf für Phase 3B
schlug beim Schritt "Prisma Client generieren" fehl (`P1012`). Ursache: Die
beiden impliziten (unbenannten) `@relation`-Fremdschlüssel `triggerRule`
und `triggerRuleSetVersion` auf `RecommendationCrossSellingSignal` erzeugten
bei Prismas interner Autoname-Berechnung (`{Tabelle}_{Felder}_fkey`, bei
Überschreitung von 63 Zeichen gekürzt) denselben gekürzten Namen — eine
Namenskollision, die Prisma als Validierungsfehler ablehnt. Das bereits
angewandte `migration.sql` selbst war davon unabhängig gültig (dort waren
die Constraint-Namen durch eine andere Kürzungslogik bereits zufällig
eindeutig), weshalb `verify:migration`/`verify:seed` in dieser Sitzung
fälschlich grün liefen — die Prisma-Schema-Validierung ist ein separater
Prüfschritt, den diese beiden PGlite-Skripte nicht abdecken. Behoben durch
explizite, kurze `map()`-Namen (`rec_css_trigger_rule_fkey`,
`rec_css_trigger_rule_set_version_fkey`) in `schema.prisma` sowie
entsprechende Anpassung der beiden Constraint-Namen in `migration.sql`.
Der nachfolgende CI-Lauf kam erstmals über den Prisma-Generate-Schritt
hinaus, was den Fix bestätigt.

**CI #15 (behoben, Commit `3805af6`):** Nächster CI-Lauf schlug in einem
späteren Schritt (TypeScript-Kompilierung der Testdateien) fehl:
`error TS2353: Object literal may only specify known properties, and
'name' does not exist in type 'QuestionnaireUncheckedCreateInput'`
(`tests/integration/recommendation-engine.test.ts:105`). Ursache: Die
Test-Hilfsfunktion `createQuestionnaire()` übergab an
`rawClient.questionnaire.create()` ein Feld `name`, das im
`Questionnaire`-Modell nicht existiert (nur `id`, `tenantId`, `key`,
`createdAt`). Dieser Fehler war aus demselben Sandbox-Grund lokal
unsichtbar: ohne generierte Client-Typen kann `tsc --noEmit` nur die
generische "Cannot find module"-Kaskade melden, nicht die spezifische
Feld-Fehlermeldung. Behoben durch Entfernen des Felds; alle übrigen
`name:`-Feldverwendungen in derselben Datei (Provider, ProductCategory,
Product, CommissionModel) wurden gegen ihre jeweiligen `schema.prisma`-
Modelle geprüft und sind korrekt. CI-Lauf #16 (Commit `3805af6`) war
erfolgreich und ist die abschließende Bestätigung, dass Phase 3B
vollständig gegen einen echten, generierten `@prisma/client` sowie eine
echte Postgres-Service-Instanz besteht.

**Bewusst offen gelassene Testlücke:** Der
`RecommendationConsistencyError`-Zweig (P2002-Konflikt ohne
Fingerprint-Treffer bei der Recovery-Suche, Abschnitt 5) ist absichtlich
ungetestet geblieben, da er einen Test-Seam im Produktionscode ohne
legitimen Nicht-Test-Zweck erfordern würde.

**Weitere, im Risikoregister dokumentierte Risiken dieser Phase**
(`RISK_REGISTER.md`, Abschnitt "Phase 3B – neu identifizierte Risiken"):
künftige Erweiterungen der Fingerprint-Eingaben könnten vergessen werden
(Review-Pflicht als Gegenmaßnahme); die `DetectedNeed.source`/
`triggerSignalId`-Invariante ist nur anwendungsseitig, nicht per
DB-Constraint erzwungen (Abschnitt 6); das `legacyExpression`-Feld bleibt
als technische Schuld bestehen, bis ausschließlich `RuleCondition`-basierte
Regeln aktiv sind (Abschnitt 14); für den P2002-Recovery-Pfad existiert
kein automatisierter Vorab-Check.

**Bekannte, harmlose Altlasten im gemounteten Projektordner**
(unverändert aus Phase 2B/3A, technisch nicht entfernbar in dieser
Sitzung): `_tmp_20_be2baffc037932ce7dd80d17bf22a85a`,
`_tmp_20_e69110ec3545a176303bbf82f9937574`, `src/newdir/file.txt`,
`_rmtest.txt`. Keine Sicherheits- oder Datenschutzrelevanz, kein
Anwendungscode referenziert sie; bitte manuell löschen.

## 14. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **Physisches Entfernen von `legacyExpression`.** Die Spalte bleibt in
  dieser Phase nullable bestehen (Kompatibilitäts-/Migrationsgrund); vor
  einem produktiven Regel-Rollout muss geprüft werden, dass ausschließlich
  `RuleCondition`-basierte Regeln aktiv sind, danach kann eine
  Cleanup-Migration die Spalte entfernen.
- **DB-seitige Erzwingung der `DetectedNeed.source`/
  `SalesOpportunity.triggerSignalId`-Invariante** (aktuell nur
  Service-Layer, Abschnitt 6) — als spätere technische Aufgabe vorgemerkt,
  falls direkte DB-Schreibzugriffe außerhalb der Service-Schicht entstehen.
- **Automatisierter Vorab-Check für den P2002-Recovery-Pfad** (z. B.
  Migration-Dry-Run), der eine potenzielle
  `RecommendationConsistencyError`-Ursache vor Produktivbetrieb
  ausschließt.
- **Fertige Mitarbeiteroberfläche zur Anzeige von Empfehlungen** — weiterhin
  nicht Teil dieser oder einer vorherigen Phase (Stop-Anweisung des
  Projektleiters seit Phase 2).
- **KI-gestützte Formulierung der Begründungstexte** — fachlich in
  `RECOMMENDATION_ENGINE.md` als zulässig beschrieben, technisch in dieser
  Phase nicht umgesetzt; `RecommendationRationale` speichert ausschließlich
  strukturierte Fakten (`factorKey`/`factorValue`), keine generierten Texte.

## 15. GO/NO-GO

Diese Freigabe unterscheidet zwei getrennte Prüfinstanzen, die sich auf
zwei unterschiedliche Commits beziehen (siehe Einleitung und Abschnitt 12):

**a) Technische Freigabe (Code/Migration/Tests) — CI-Lauf #16, Commit
`3805af6`:** Aus technischer Sicht: **GO.** Alle 261 Unit-Tests grün,
Migration (inkl. Upgrade-Pfad auf bestehende Daten) fehlerfrei mit
vollständigem Smoke-Test verifiziert, ESLint/Prettier sauber, `tsc
--noEmit` zeigt ausschließlich die bekannte, folgenlose
Sandbox-Einschränkung, und CI-Lauf #16 (Commit `3805af6`) ist erfolgreich
— die einzige tatsächlich abschließende Prüfinstanz für `prisma
generate`, echte Postgres-Integrationstests und den Produktions-Build.
Beide während dieser Phase in CI aufgetretenen Fehler (#13/#14, #15)
wurden transparent dokumentiert, auf ihre Grundursache zurückgeführt,
behoben und durch einen erneuten grünen CI-Lauf bestätigt — keiner davon
deutete auf einen Fachlogikfehler hin, beide waren Instanzen derselben
bereits bekannten Sandbox-Einschränkung (kein lokaler `prisma generate`).

**b) Bestätigung des korrigierten Berichtsstands:** Der vorliegende Bericht
wurde nach vorheriger Rückmeldung mehrfach redaktionell korrigiert
(Append-only-Tabellenzahl, Testzahlen-Trennung, Upgrade-Test-Beleg,
Implementierungs-/Berichts-Commit-Unterscheidung, Prettier-Formatierung).
Alle diese Korrektur-Commits sind vollständig in der Tabelle in der
Einleitung dokumentiert und enthalten ausschließlich Änderungen an
`docs/ABSCHLUSSBERICHT_PHASE3B.md` — keinerlei Code-/Migrations-/
Teständerung. Jeder zugehörige CI-Lauf mit Ergebnis „Success" bestätigt
erneut denselben grünen Code-Stand (identisch zu `3805af6`); der einzige
Fehlschlag (CI-Lauf #18) betraf ausschließlich Formatierung und ist
transparent dokumentiert und behoben (CI-Lauf #19). Maßgeblich ist stets
der zeitlich letzte Eintrag der Einleitungstabelle mit Ergebnis „Success"
als aktueller `HEAD` von `main`.

Endgültige Freigabe obliegt wie in den Vorphasen dem Projektleiter
(ChatGPT) und dem Auftraggeber.
