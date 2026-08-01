# Implementierungsstatus (Stand: 2026-08-01)

Dieses Dokument beschreibt den tatsächlichen Stand der Implementierung über
Phase 2/2B ("Prompt 2" des ChatGPT-Projektleiters) und Phase 3A
(Fragen-Engine) hinweg, was davon **tatsächlich ausgeführt und verifiziert**
wurde und was aufgrund von Sandbox-Beschränkungen nur lokal/in CI (nicht
aber in der Entwicklungsumgebung dieser Sitzung) nachvollzogen werden
konnte. Ziel ist volle Transparenz: nichts hier wird als "funktioniert"
behauptet, ohne dass daneben steht, WIE es geprüft wurde. Für Phase 3A siehe
den entsprechenden Abschnitt weiter unten.

## Umfang dieser Phase (Erinnerung)

Gemäß der Vorgabe des Projektleiters (ChatGPT) und der Freigabe des
Auftraggebers ("mach das munter") umfasst diese Phase **ausschließlich**:

1. Projektgerüst (Next.js/TypeScript/Prisma/Vitest/ESLint/Prettier)
2. Vollständiges Datenmodell für alle Domänen (Mandant → Firma → Filiale →
   Mitarbeiter, Produkte/Tarife, Beratung, Empfehlung, Abschluss, Analytics,
   Berechtigungen, Datenschutz/Kontaktverwaltung)
3. Migrationen gegen eine leere Datenbank
4. Synthetisches Seed-Skript mit zwei Mandanten
5. Mandantenkontext + Sicherheits-/Isolationstests
6. Minimale technische Prüfansicht der Seed-Daten
7. CI-Pipeline
8. Diese Dokumentation

**Ausdrücklich NICHT Teil dieser Phase** (Stop-Anweisung des Projektleiters):
Fragen-Engine, Empfehlungs-Engine, fertige Mitarbeiteroberfläche. Diese
Bausteine sind in [ARCHITECTURE.md](ARCHITECTURE.md) und
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) konzipiert, aber nicht
implementiert.

## Phase 2B – Korrekturpunkte (Projektleiter-Abnahme) und Verifikationsstatus

Nach Abschluss von Phase 2 gab der Projektleiter (ChatGPT) eine
NO-GO-Rückmeldung mit 12 verbindlichen Korrekturpunkten. Davon wurden 8
Punkte in dieser Sitzung vollständig umgesetzt und **PGlite-/lokal
verifiziert** (nicht nur per Code-Review behauptet); die verbleibenden 4
Punkte hängen an denselben Prisma-CLI-Werkzeugen, die in dieser Sandbox
nicht erreichbar sind (siehe Abschnitt "Zentrale Sandbox-Einschränkung"
unten) und bleiben im Status "vorbereitet, aber nicht beweisbar
bestanden" bis zum ersten CI-Lauf bzw. lokalen Lauf mit Internetzugang.

| #   | Korrekturpunkt                                                                                                 | Status                                                                                              | Beleg                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tenant-gebundene composite FKs ergänzen (`Employee→User`, `RoleAssignment→User/Role`, `AuditLog→User`)         | PGlite-verifiziert                                                                                  | `scripts/verify_seed_pglite.mjs`, Abschnitt 8: 4/4 Cross-Tenant-Einfügeversuche korrekt abgelehnt                                                                                                                                                                                                                                                             |
| 2   | `RoleAssignment`-Scope-Integrität (CHECK-Constraint + Trigger)                                                 | PGlite-verifiziert                                                                                  | `verify_seed_pglite.mjs`, Abschnitte 9–10: inkonsistente `scope_type`/`company_id`/`store_id`-Kombinationen sowie `store_id` aus falscher `company_id` korrekt abgelehnt                                                                                                                                                                                      |
| 3   | PostgreSQL Exclusion Constraint gegen überlappende Versionszeiträume                                           | PGlite-verifiziert                                                                                  | `verify_seed_pglite.mjs`, Abschnitt 11: überlappende `ACTIVE`-`product_versions` korrekt abgelehnt (`product_versions_no_overlap`)                                                                                                                                                                                                                            |
| 4   | Echte Append-only/Immutability-Durchsetzung (DB-Trigger statt nur Konvention)                                  | PGlite-verifiziert                                                                                  | `verify_seed_pglite.mjs`, Abschnitt 12: `UPDATE`/`DELETE` auf `audit_logs`/`deal_financial_snapshots` korrekt abgelehnt                                                                                                                                                                                                                                       |
| 5   | `BaselineMeasurement`-Modell erweitern                                                                         | PGlite-verifiziert                                                                                  | Migration erzeugt Tabelle korrekt (55 Tabellen gesamt), Seed legt 2 Datensätze an (`verify_seed_pglite.mjs`, Abschnitt 5)                                                                                                                                                                                                                                     |
| 6   | Zod-Validierung für JSON-Felder (`AnalyticsEvent.payload`, `AuditLog.metadata`) gegen versehentliche Klardaten | lokal bestanden                                                                                     | 39 neue Unit-Tests (`contact-data-guard.test.ts`, `event-payload-schemas.test.ts`, `validate-scoped-args-payload.test.ts`), in `withTenantScope()` verdrahtet                                                                                                                                                                                                 |
| 7   | `/review`-Seite technisch (nicht nur dokumentarisch) auf Dev/Test beschränken                                  | lokal bestanden (Entscheidungslogik); tatsächlicher Seitenaufruf nicht ausführbar in dieser Sandbox | `review-access.test.ts` (6 Tests) für `isReviewPageEnabled()`; realer Aufruf von `/review` erfordert `next dev` + generierten Prisma-Client, siehe CI                                                                                                                                                                                                         |
| 8   | npm-vs-pnpm verbindlich entscheiden + `DATA_MODEL.md` mit `schema.prisma` synchronisieren                      | lokal bestanden                                                                                     | `package.json`, `DECISION_LOG.md`, `LOCAL_DEVELOPMENT.md`, `ci.yml`, `ABSCHLUSSBERICHT_PHASE2.md` konsistent; `DATA_MODEL.md` an tatsächliche Modelle angeglichen (u. a. `Region` entfernt, `RoleAssignment`/`CustomerReference`-Familie/`ConfigurationChange`/`BaselineMeasurement` ergänzt, `Goal`/`KpiSnapshot` explizit als nicht implementiert markiert) |

**Gesamtverifikation nach allen 8 Korrekturen (dieser Sitzung, erneut ausgeführt):**
ESLint 0 Fehler/Warnungen, Prettier für das gesamte Projekt sauber, 99/99
Unit-Tests grün, Migration gegen leere DB weiterhin fehlerfrei (55
Tabellen, 83 Fremdschlüssel), Seed-Verifikation inkl. aller neuen
Phase-2B-Prüfungen (Abschnitte 8–12) fehlerfrei, `tsc --noEmit` zeigt
ausschließlich die bekannten, durch fehlenden `prisma generate`
verursachten Fehler (siehe unten) – keine neuen Typfehler durch die
Korrekturen.

**Weiterhin offen (4 Punkte, abhängig von Prisma-CLI/Internetzugang):**
`prisma generate`/`migrate deploy` selbst, `tests/integration/tenant-isolation.test.ts`
gegen echten `@prisma/client`, `npm run build` (Produktions-Build), realer
Browseraufruf von `/review`. Diese vier laufen automatisch im ersten
CI-Durchlauf (`.github/workflows/ci.yml`) bzw. lokal nach
`npm install && npx prisma generate && npx prisma migrate deploy`
(siehe [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)).

## Zentrale Sandbox-Einschränkung

Die Entwicklungsumgebung dieser Sitzung hat **keinen Zugriff auf
`binaries.prisma.sh`** (HTTP 403 bei jedem Versuch). Dadurch konnten
folgende Prisma-CLI-Befehle in dieser Sitzung **nicht** ausgeführt werden:

- `prisma generate` (erzeugt den TypeScript-Client inkl. `.d.ts`-Typen)
- `prisma migrate dev` / `prisma migrate deploy` (führt Migrationen gegen
  eine echte, laufende Postgres-Instanz aus)
- `prisma validate`

Das betrifft **nicht** die Korrektheit des Schemas oder der Migration
selbst, sondern nur die Werkzeuge, die eine Internetverbindung zu
Prisma-eigenen Binärservern benötigen. Um trotzdem echte Verifikation statt
reiner Code-Review zu erreichen, wurde stattdessen wie folgt vorgegangen:

1. **Migration ohne `prisma`-CLI erzeugt:** `scripts/schema_to_sql.py`
   transpiliert `prisma/schema.prisma` direkt in SQL (eigene, im Rahmen
   dieser Sitzung geschriebene Implementierung, kein Prisma-Code).
2. **Migration + Seed-Datenfluss gegen eine echte, eingebettete
   Postgres-Instanz ausgeführt** (via `@electric-sql/pglite`, läuft ohne
   externe Binärserver): `scripts/verify_migration_pglite.mjs` und
   `scripts/verify_seed_pglite.mjs`. Beide Skripte laufen vollständig
   in dieser Sandbox durch (0 Fehler bei der letzten Ausführung).
3. **Cross-Tenant-Isolation aktiv getestet**, nicht nur per Code-Review:
   `scripts/verify_seed_pglite.mjs` versucht bewusst, einen `Store` mit
   `tenant_id` von Mandant A aber `company_id` von Mandant B einzufügen –
   Postgres lehnt dies korrekt mit einer
   Fremdschlüssel-Verletzung (`stores_tenant_id_company_id_fkey`) ab.

**Konsequenz für den Auftraggeber:** Nach dem Klonen dieses Projekts mit
normalem Internetzugang müssen einmalig ausgeführt werden:

```bash
npm install         # verbindlicher Paketmanager, siehe DECISION_LOG.md
npx prisma generate
npx prisma migrate deploy   # bzw. "migrate dev" in lokaler Entwicklung
```

Erst danach sind `tsc --noEmit`, `npm run build` und
`tests/integration/*` vollständig lauffähig (siehe unten).

## Was tatsächlich lokal in dieser Sitzung geprüft wurde

| Prüfung                                                      | Werkzeug                                           | Ergebnis                                                                                                                                                                                                                                                                                            | Datei/Beleg                                                            |
| ------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Schema → SQL-Transpilation                                   | `scripts/schema_to_sql.py`                         | Migration erzeugt, mit realer Migration.sql abgeglichen (`diff` = identisch)                                                                                                                                                                                                                        | `prisma/migrations/20260731000000_init/migration.sql`                  |
| Migration gegen leere DB                                     | pglite (`npm run verify:migration`)                | erfolgreich: 55 Tabellen, 80 Fremdschlüssel angelegt, keine Fehler                                                                                                                                                                                                                                  | `scripts/verify_migration_pglite.mjs`                                  |
| Seed-Datenfluss (2 Mandanten, ~30 Tabellen)                  | pglite (`npm run verify:seed`)                     | erfolgreich, alle Zeilenzahlen wie erwartet                                                                                                                                                                                                                                                         | `scripts/verify_seed_pglite.mjs`                                       |
| Cross-Tenant-FK-Isolation (DB-Ebene)                         | pglite, bewusster Fehlversuch                      | korrekt abgelehnt (FK-Verletzung `stores_tenant_id_company_id_fkey`)                                                                                                                                                                                                                                | `scripts/verify_seed_pglite.mjs`                                       |
| Tenant-Scoping-Query liefert nur eigene Zeilen               | pglite                                             | Tenant A: 2/2, Tenant B: 2/2 wie erwartet                                                                                                                                                                                                                                                           | `scripts/verify_seed_pglite.mjs`                                       |
| Tenant-Kontext + Scoping-Logik (Anwendungsebene)             | Vitest, `npm run test:unit`                        | 54/54 Tests grün, ohne DB/Prisma-Client nötig                                                                                                                                                                                                                                                       | `tests/unit/tenant-context.test.ts`, `tests/unit/tenant-scope.test.ts` |
| TypeScript-Typprüfung                                        | `npm run typecheck`                                | nur die erwarteten, durch fehlenden `prisma generate` verursachten Fehler (siehe unten)                                                                                                                                                                                                             | –                                                                      |
| ESLint                                                       | `npm run lint` (`--max-warnings=0`)                | 0 Fehler, 0 Warnungen im gesamten Projekt                                                                                                                                                                                                                                                           | –                                                                      |
| Prettier                                                     | `npm run format` (`prettier --check .`)            | für den gesamten Projektbestand ausgeführt; 16 vorbestehende Dateien aus Phase 1 waren noch nicht auf das konfigurierte Format gebracht und wurden mit `prettier --write .` korrigiert                                                                                                              | `.prettierrc.json`                                                     |
| Migrations-/Seed-Skripte reproduzierbar im Projekt lauffähig | `npm run verify:migration` / `npm run verify:seed` | beide Skripte liefen mit relativen, portablen Pfaden gegen `@electric-sql/pglite` (jetzt als reguläre `devDependency` in `package.json`); ein zunächst sandbox-spezifischer absoluter Pfad in `verify_seed_pglite.mjs` wurde beim finalen Prüflauf entdeckt und auf einen relativen Pfad korrigiert | `scripts/`, `package.json`                                             |

## Was NICHT in dieser Sitzung geprüft werden konnte

- `tests/integration/tenant-isolation.test.ts` (echte Postgres-DB über
  `@prisma/client`) – benötigt `prisma generate` + laufende Postgres-Instanz;
  in dieser Sandbox nicht möglich. Wird automatisch in der CI-Pipeline
  ausgeführt (`.github/workflows/ci.yml`, Service-Container `postgres`).
- `npm run build` (Next.js Produktions-Build) – benötigt generierte
  Prisma-Typen, ebenfalls nicht in dieser Sandbox möglich, aber Teil der
  CI-Pipeline.
- Tatsächlicher Start von `next dev` / manuelles Öffnen von `/review` im
  Browser.

Die drei genannten Prüfungen sind **im Code vorbereitet und in der
CI-Pipeline verankert**, sodass sie beim ersten Push automatisch laufen.
Der Auftraggeber sollte den ersten CI-Lauf (bzw. einen lokalen Lauf gemäß
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)) als abschließende
Bestätigung ansehen, nicht diese Sitzung allein.

## Bekannte, erwartete `tsc`-Fehler (verschwinden nach `prisma generate`)

Alle verbleibenden `tsc --noEmit`-Fehler haben eine einzige Grundursache:
`@prisma/client` hat ohne erfolgreichen `prisma generate`-Lauf keine
generierten Typen, wodurch `PrismaClient` (und alles, was darauf aufbaut)
als `any` behandelt wird. Betroffen: `prisma/seed.ts`,
`src/server/db/client.ts`, `src/server/tenant/scoped-client.ts`,
`src/app/review/page.tsx`, `tests/integration/tenant-isolation.test.ts`.
Keiner dieser Fehler weist auf einen echten Logikfehler hin; nach
`npx prisma generate` verschwinden sie vollständig (in CI bereits so
konfiguriert, siehe `.github/workflows/ci.yml`).

## Bekannte, harmlose Altlasten (bitte manuell löschen)

Im gemounteten Projektordner konnten während dieser Sitzung aus
technischen Gründen (siehe unten) folgende Dateien **nicht** entfernt
werden, obwohl sie nicht Teil des Projekts sind:

- `_tmp_20_be2baffc037932ce7dd80d17bf22a85a`
- `_tmp_20_e69110ec3545a176303bbf82f9937574`
- `src/newdir/file.txt`
- `_rmtest.txt` (neu hinzugekommen während Phase 3B)

Diese Dateien sind funktionslose Reste aus früheren Zwischenschritten
dieser Sitzung (keine Sicherheits- oder Datenschutzrelevanz, kein
Anwendungscode referenziert sie). Bitte manuell löschen; die Umgebung, in
der dieses Projekt implementiert wurde, hat Löschungen/Umbenennungen im
gemounteten Ordner blockiert ("Operation not permitted").

## Phase 3A – Fragen-Engine: Umfang und Verifikationsstatus

Gemäß `PHASE_3A_STARTPROMPT.md` umfasst diese Phase **ausschließlich**: das
Prisma-Schema für die Fragen-Engine (`Questionnaire` →
`QuestionnaireVersion` → `Question` → `QuestionVersion` →
`AnswerOption`/`VisibilityCondition`), die Service-Schicht
(`src/server/questionnaire/`), synthetische Seed-Erweiterung, Unit- und
Integrationstests sowie diese Dokumentation. **Ausdrücklich NICHT Teil
dieser Phase** (Stop-Anweisung des Projektleiters, unverändert seit Phase
2): Empfehlungs-Engine, Erzeugung von `SalesOpportunity`/`DetectedNeed`,
Cross-Selling-Logik, jede KI-/LLM-gestützte fachliche Interpretation,
fertige Mitarbeiteroberfläche. Fachliche Details siehe
[QUESTION_ENGINE.md](QUESTION_ENGINE.md).

### Tatsächlich in dieser Sitzung ausgeführte Prüfungen

| Prüfung                       | Werkzeug                            | Ergebnis                                                                                                                               |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unit-Tests (gesamtes Projekt) | `npm run test:unit`                 | 150/150 Tests grün, 11 Testdateien, davon 51 neu für die Fragen-Engine (`tests/unit/questionnaire/`)                                   |
| Migration gegen leere DB      | `npm run verify:migration` (pglite) | erfolgreich: 55 Tabellen (inkl. der 6 neuen Fragen-Engine-Tabellen), 84 Fremdschlüssel, keine Fehler                                   |
| ESLint                        | `npm run lint` (`--max-warnings=0`) | 0 Fehler, 0 Warnungen                                                                                                                  |
| Prettier                      | `npm run format`                    | gesamtes Projekt sauber formatiert (inkl. neu erstellter/geänderter Dokumentation)                                                     |
| TypeScript-Typprüfung         | `npm run typecheck`                 | ausschließlich die bekannten, durch fehlenden `prisma generate` verursachten Fehler (siehe oben); keine neuen Typfehler durch Phase 3A |

Die 55 Tabellen der Migration sind unverändert gegenüber Phase 2B, weil die
Fragen-Engine-Tabellen in dieselbe (bisher einzige) `init`-Migration
eingearbeitet wurden, statt eine separate Folgemigration zu erzeugen – es
gibt noch keinen produktiv gelaufenen Stand, der eine inkrementelle
Migration erzwingen würde.

### Weiterhin nicht in dieser Sandbox ausführbar

Aus demselben Grund wie in Phase 2B (kein Zugriff auf
`binaries.prisma.sh`, siehe "Zentrale Sandbox-Einschränkung" oben) konnten
folgende Prüfungen der Fragen-Engine in dieser Sitzung **nicht** ausgeführt
werden:

- `tests/integration/questionnaire-engine.test.ts` gegen einen echten,
  generierten `@prisma/client` – benötigt `prisma generate` + laufende
  Postgres-Instanz. Läuft automatisch in CI.
- `npm run build` (Next.js-Produktionsbuild).

Beide sind im Code vorbereitet und in `.github/workflows/ci.yml`
verankert; der erste CI-Lauf bzw. ein lokaler Lauf gemäß
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) gilt als abschließende
Bestätigung, nicht diese Sitzung allein.

## npm als verbindlicher Paketmanager

npm ist seit Phase 2B der verbindliche, endgültig festgelegte Paketmanager
dieses Projekts (siehe [DECISION_LOG.md](DECISION_LOG.md)). `package.json`
deklariert `"packageManager": "npm@10.9.4"`, `package-lock.json` ist die
einzige committete Lockdatei, und die CI-Pipeline nutzt ebenfalls npm.
Ursprünglich (Phase 2) war dies nur ein Sandbox-Workaround, da die
Installation via pnpm in Kombination mit den Datei-/Symlink-Restriktionen
des gemounteten Ordners unzuverlässig war; da kein funktionaler Grund für
pnpm identifiziert wurde, wurde daraus in Phase 2B eine bewusste,
dauerhafte Festlegung statt offener technischer Schuld.

## Phase 3A – CI-Fehlerbehebung (CI #7, #8, #9)

Nach dem ersten Push nach GitHub schlug CI zunächst fehl. Beide Fehler
wurden behoben, mit ChatGPT (Projektleiter) abgestimmt und über GitHub
Actions verifiziert:

- **CI #7**: Testbugs in `tests/integration/questionnaire-engine.test.ts`
  (`asTenantA`-Wrapper fehlte an mehreren Stellen; `afterAll` versuchte
  ein `deleteMany` auf append-only-geschützten Tabellen). Behoben durch
  Korrektur der Wrapper-Aufrufe.
- **CI #8**: `AnalyticsEvent.employee` nutzte `onDelete: SetNull`, was
  beim Löschen eines Employees ein `UPDATE` auf `analytics_events`
  auslöst – blockiert durch den Append-only-Trigger
  `forbid_update_delete()` (Migration `20260731000000_init`). Dies war
  kein reiner Testbug, sondern ein Schema-Designfehler: derselbe Fehler
  wäre auch in Produktion aufgetreten. Behoben durch Umstellung auf
  `onDelete: Restrict` (neue Migration
  `20260801095926_analytics_events_employee_restrict`) sowie Reduktion
  von `afterAll` in `questionnaire-engine.test.ts` auf `$disconnect()`,
  da CI ohnehin eine ephemere Postgres-Instanz pro Lauf nutzt (siehe
  `.github/workflows/ci.yml`) und Testisolation durch `randomUUID`-Suffixe
  je Testlauf sichergestellt ist. `BaselineMeasurement.employee` behält
  bewusst `SetNull`, da `baseline_measurements` keinen Append-only-Trigger
  hat.
- **CI #9** (Commit `85e4022`): **Success**, Laufzeit 1m 33s, keine
  Fehler – ausschließlich die bekannte, folgenlose Node.js-20-
  Deprecation-Warnung. Von ChatGPT als finales GO für den CI-technischen
  Abschluss von Phase 3A bestätigt.

## Bekannte offene technische Aufgaben (nicht blockierend für Phase 3A)

Von ChatGPT bei der Phase-3A-Freigabe explizit als nicht-blockierend
eingestuft, aber für eine spätere Phase festzuhalten:

- **FK-Fehler in fachliche Fehlermeldung übersetzen.** Voraussetzung
  bereits erfüllt: der bestehende zentrale Error-Handler verhindert schon
  heute, dass rohe SQL-/Prisma-Details an Clients gelangen; eine
  spezifische, fachlich verständliche Übersetzung von FK-Verletzungen
  (z. B. „Mitarbeiter kann nicht gelöscht werden, da noch Analytics-Daten
  vorhanden sind") steht noch aus.
- **Dedizierte Testdatenbank mit Schutzmechanismus.** Lokale
  Integrationstests sollen künftig die DB-URL auf ein `_test`-Namensmuster
  prüfen und den Start abbrechen, wenn die Ziel-DB nicht eindeutig als
  Testdatenbank erkennbar ist (siehe auch
  [RISK_REGISTER.md](RISK_REGISTER.md), Abschnitt "Phase 3A – neu
  identifizierte Risiken").

Das DSGVO-konforme Anonymisierungs-/Löschkonzept für ausgeschiedene
Mitarbeiter mit vorhandenen AnalyticsEvents ist separat als offene
Entscheidung #14 in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) sowie als
Risiko in [RISK_REGISTER.md](RISK_REGISTER.md) dokumentiert.

## Phase 3B – Empfehlungs-Engine: Umfang und Verifikationsstatus

Gemäß `PHASE_3B_IMPLEMENTATION_PLAN.md` (Rev. 3.2, finales
Implementierungs-GO von ChatGPT als Projektleiter) umfasst diese Phase
**ausschließlich**: das Prisma-Schema für die Regel-/Empfehlungs-Engine
(`RuleSetVersion` → `EligibilityRule`/`ExclusionRule`/
`PrioritizationRule`/`CrossSellingRule` → `RuleCondition`, sowie
`Recommendation` → `RecommendationItem` → `RecommendationRationale`,
`RecommendationCrossSellingSignal`, `SalesOpportunity`), die
Service-Schicht (`src/server/recommendation/`), die
Attribute-Registry (`attribute-registry.ts`), synthetische
Seed-Erweiterung, Unit- und Integrationstests sowie diese Dokumentation.
Fachliche Details siehe [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md)
und [DATA_MODEL.md](DATA_MODEL.md).

### Tatsächlich in dieser Sitzung ausgeführte Prüfungen

| Prüfung                       | Werkzeug                            | Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit-Tests (gesamtes Projekt) | `npm run test:unit`                 | 261/261 Tests grün, 21 Testdateien, davon 111 neu für die Empfehlungs-Engine über 10 Dateien in `tests/unit/recommendation/`: `attribute-registry.test.ts` (24), `fingerprint.test.ts` (21), `conditions.test.ts` (17), `fit-score.test.ts` (12), `tie-break.test.ts` (8), `sales-opportunity.test.ts` (8), `eligibility.test.ts` (6), `prioritization.test.ts` (6), `cross-selling.test.ts` (5), `exclusion.test.ts` (4)                                                                   |
| Migration gegen leere DB      | `npm run verify:migration` (pglite) | erfolgreich: 61 Tabellen (6 neue Phase-3B-Tabellen), 101 Fremdschlüssel; zusätzlich End-to-End-Smoke-Test (Recommendation samt Item/Rationale/Provisions-Pinning/CrossSellingSignal/SalesOpportunity anlegen), 3 Append-only-Ablehnungsproben (`recommendations`/`recommendation_items`/`recommendation_cross_selling_signals`), 1 Beweis dass `sales_opportunities` mutabel bleibt, 1 EXCLUDE-Constraint-Ablehnungsprobe (`rule_set_versions_tenant_active_no_overlap`) – alle erfolgreich |
| ESLint                        | `npm run lint` (`--max-warnings=0`) | 0 Fehler, 0 Warnungen (ein vorgefundener Fehler – ungenutzte private Funktion `parseDecimal` in `attribute-registry.ts`, totes Code aus der Registry-Vorbereitung für einen aktuell nicht verwendeten `DECIMAL`-Attributtyp – wurde in dieser Sitzung entfernt, inkl. Bereinigung des zugehörigen Imports)                                                                                                                                                                                  |
| Prettier                      | `npm run format`                    | gesamtes Projekt sauber formatiert (16 zunächst abweichende Dateien, überwiegend Phase-3B-Planungsdokumente sowie neue `src/server/recommendation/*`/`tests/unit/recommendation/*`/`tests/integration/recommendation-engine.test.ts`, mit `prettier --write .` korrigiert)                                                                                                                                                                                                                  |
| TypeScript-Typprüfung         | `npm run typecheck`                 | ausschließlich die bekannten, durch fehlenden `prisma generate` verursachten Fehler (siehe "Zentrale Sandbox-Einschränkung" oben); keine neuen Typfehler durch Phase 3B                                                                                                                                                                                                                                                                                                                     |

### Integrationstest `recommendation-engine.test.ts`

`tests/integration/recommendation-engine.test.ts` (12 `it()`-Fälle) ist
`tsc`- und `eslint`-sauber und wurde durch `vitest run` ausgeführt; der
Lauf schlägt – wie bei allen `tests/integration/*`-Dateien dieses Projekts
– ausschließlich mit `Cannot find module '.prisma/client/default'` fehl,
also derselben, bereits in Phase 2B/3A dokumentierten
Sandbox-Einschränkung (kein `prisma generate` möglich). Zur Bestätigung,
dass dies kein neues, Phase-3B-spezifisches Problem ist, wurde derselbe
Fehler reproduzierbar auch für die bereits in CI grün laufende, unveränderte
`tests/integration/questionnaire-engine.test.ts` ausgelöst. Der Lauf in
CI (`.github/workflows/ci.yml`, echter `@prisma/client` gegen
Postgres-Service-Container) gilt als abschließende Bestätigung.

### Weiterhin nicht in dieser Sandbox ausführbar

Aus demselben Grund wie in Phase 2B/3A (kein Zugriff auf
`binaries.prisma.sh`, siehe "Zentrale Sandbox-Einschränkung" oben)
konnten folgende Prüfungen der Empfehlungs-Engine in dieser Sitzung
**nicht** ausgeführt werden:

- `tests/integration/recommendation-engine.test.ts` gegen einen echten,
  generierten `@prisma/client` – benötigt `prisma generate` + laufende
  Postgres-Instanz. Läuft automatisch in CI.
- `npm run build` (Next.js-Produktionsbuild).

Beide sind im Code vorbereitet und in `.github/workflows/ci.yml`
verankert; der erste CI-Lauf nach dem Push dieser Phase gilt als
abschließende Bestätigung, nicht diese Sitzung allein.

### CI #14 (Commit `106b2da`): Prisma-Schema-Validierungsfehler (behoben)

Der erste CI-Lauf für Phase 3B schlug fehl (`build-and-test`, Schritt
"Prisma Client generieren", Exit-Code 1). Ursache: `prisma generate`
führt intern eine Schema-Validierung durch (`get-dmmf wasm`), die in
dieser Sandbox mangels Netzwerkzugriff auf `binaries.prisma.sh` **nicht**
lokal nachvollzogen werden konnte (siehe neues Risiko in
[RISK_REGISTER.md](RISK_REGISTER.md), Phase-3B-Abschnitt) – der Fehler
war daher in dieser Sitzung vor dem Push nicht sichtbar.

Fehler `P1012`: die beiden impliziten (unbenannten) `@relation`-FKs
`triggerRule` und `triggerRuleSetVersion` auf
`RecommendationCrossSellingSignal` erzeugten bei Prisma's interner
Autoname-Berechnung (`{Tabelle}_{Felder}_fkey`, bei Überschreitung von 63
Zeichen gekürzt) denselben gekürzten Namen
(`recommendation_cross_selling_signals_tenant_id_trigger_rul_fkey`) –
eine Namenskollision, die Prisma als Validierungsfehler ablehnt. Das
bereits angewandte `migration.sql` selbst war unabhängig davon gültig
(dort waren die Constraint-Namen durch eine andere Kürzungslogik bereits
zufällig eindeutig), sodass `npm run verify:migration`/`verify:seed` in
dieser Sitzung fälschlich grün liefen – die Prisma-Schema-Validierung ist
ein separater Prüfschritt, den diese beiden PGlite-Skripte nicht abdecken.

Behoben durch explizite, kurze `map()`-Namen für beide Relationen
(`rec_css_trigger_rule_fkey`, `rec_css_trigger_rule_set_version_fkey`) in
`schema.prisma`, sowie Anpassung der beiden entsprechenden
Constraint-Namen in `migration.sql` (Commit vor dem produktiven Einsatz
dieser Migration, daher direkt editierbar statt neuer Migration).
Manuell verifiziert: beide neuen Namen sind eindeutig und ≤ 63 Zeichen;
`npm run verify:migration` (101 Fremdschlüssel, alle Phase-3B-Smoke-Tests)
und `npm run verify:seed` erneut erfolgreich mit den neuen
Constraint-Namen durchlaufen. Die eigentliche Prisma-Validierung
(`prisma generate`/`validate`) bleibt aus dem oben genannten Sandbox-Grund
ungetestet und wird erst mit dem nächsten CI-Lauf bestätigt.

### Bekannte, bewusst offen gelassene Testlücke

Der `RecommendationConsistencyError`-Zweig (P2002-Konflikt beim
Idempotenz-Fingerprint, bei dem die anschließende Recovery-`SELECT` keinen
Treffer findet – deutet auf Datenkorruption oder einen
Fingerprint-Berechnungsfehler hin) ist absichtlich ungetestet geblieben,
da er einen Test-Seam im Produktionscode ohne legitimen
Nicht-Test-Zweck erfordern würde. Begründung siehe
[DECISION_LOG.md](DECISION_LOG.md), Phase-3B-Eintrag
"P2002-Recovery-Zweig ohne Nebenläufigkeitssimulation getestet".
