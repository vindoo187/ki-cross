# Teststrategie

## Grundprinzip

Für dieses Projekt gilt durchgängig: **Verifikation statt Behauptung.**
Jede Aussage über Korrektheit in diesem Repository (Migration, Seed,
Mandantentrennung) ist mit einer tatsächlich ausgeführten Prüfung
hinterlegt, nicht nur mit Code-Review. Siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) für den genauen Stand,
was davon in welcher Umgebung gelaufen ist.

## Ebenen

### 1. Unit-Tests (`tests/unit/`, `npm run test:unit`)

Reine Funktionstests ohne Datenbank und ohne generierten Prisma-Client.
Laufen überall, auch ohne Internetzugang oder laufende Postgres-Instanz.

- `tenant-context.test.ts`: prüft `src/server/tenant/context.ts`
  (AsyncLocalStorage-basierter Tenant-Kontext) – u. a. Isolation
  zwischen verschachtelten und parallelen `runWithTenantContext()`-Aufrufen,
  korrektes Werfen von `MissingTenantContextError`.
- `tenant-scope.test.ts`: prüft `buildScopedArgs()` aus
  `src/server/tenant/scoped-client.ts` – die reine Funktion, die
  Prisma-Query-Argumente um den Tenant-Scope ergänzt/validiert. Deckt alle
  relevanten Prisma-Operationskategorien ab (Lesen, `create`,
  `createMany`, `update`, `delete`, `upsert`) inkl. der
  sicherheitsrelevanten Fälle: Aufrufer versucht, eine abweichende
  `tenantId` zu setzen oder im `where` zu überschreiben.
- `tests/unit/questionnaire/` (Phase 3A): prüft die reinen, DB-freien
  Logikmodule der Fragen-Engine, insgesamt 51 Testfälle über 5 Dateien,
  keine Datenbank nötig, siehe [QUESTION_ENGINE.md](QUESTION_ENGINE.md):
  - `visibility.test.ts` (21 Fälle): `evaluateSingleCondition()` für
    jeden `AnswerType`/Operator, `isQuestionVisible()` (AND-/OR-Gruppen,
    gemischte Kombinatoren), `OPERATORS_BY_ANSWER_TYPE`,
    `validateVisibilityGraph()` (Zyklen, fragebogen-fremde Zielfragen).
  - `answer-validation.test.ts` (11 Fälle): `validateAnswerInput()` und
    `hasAnswerValue()` aus `src/server/questionnaire/answer-validation.ts`
    für alle sieben `AnswerType`-Varianten inkl. Grenzwerte
    (`minValue`/`maxValue`, `maxLength`, `minSelections`/`maxSelections`).
  - `decimal.test.ts` (6 Fälle): BigInt-basierte, floatfreie
    Dezimalvergleiche aus `src/server/questionnaire/decimal.ts`
    (`isValidDecimalString`, `parseDecimalToScaledBigInt`,
    `compareDecimalStrings`).
  - `path.test.ts` (8 Fälle): `computeVisiblePath()`, `computeProgress()`
    und `findNewlyHiddenAnsweredQuestionIds()` aus
    `src/server/questionnaire/path.ts`.
  - `status.test.ts` (5 Fälle): `deriveQuestionnaireRunStatus()` aus
    `src/server/questionnaire/status.ts`, inkl. der (über die aktuelle
    API nicht erreichbaren) `NEEDS_REVIEW`-Herleitung.

### 2. Integrationstests (`tests/integration/`, `npm run test:integration`)

Benötigen eine echte, erreichbare Postgres-Instanz (`DATABASE_URL`) sowie
einen erfolgreichen `prisma generate`-Lauf. Laufen automatisch in CI
(`.github/workflows/ci.yml`, Postgres-Service-Container) und lokal gemäß
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). Werden übersprungen (nicht:
fehlgeschlagen), wenn `DATABASE_URL` nicht gesetzt ist.

- `tenant-isolation.test.ts`: prüft beide Schutzschichten gemeinsam gegen
  ein echtes System:
  1. Datenbankebene: zusammengesetzter Fremdschlüssel lehnt einen
     Tenant/Parent-Mismatch beim Schreiben ab.
  2. Anwendungsebene: der gescopte Client (`withTenantScope`) verhindert
     Lese- und Schreibzugriffe außerhalb des aktiven Tenant-Kontexts
     (`findUnique` liefert `null` statt eines fremden Datensatzes,
     `create` injiziert automatisch die richtige `tenantId`, ein Versuch,
     eine fremde `tenantId` zu setzen, wirft `TenantMismatchError`).
- `questionnaire-engine.test.ts` (Phase 3A): prüft `src/server/questionnaire/
service.ts` gegen ein echtes System, organisiert entlang der 40-Punkte-
  Prüfliste aus `PHASE_3A_STARTPROMPT.md`. Fixture: zwei Tenants mit je
  eigenem Fragebogen; ein Fragebogen mit zwei zeitlich aufeinanderfolgenden
  `ACTIVE`-Versionen (V1/V2), einer nie aktivierten `DRAFT`-Version und
  einer bedingten Folgefrage. Abgedeckt u. a.: Versionsauflösung nach
  Zeitpunkt vs. fixierter Sitzungsversion, Sichtbarkeits-Branching,
  Deaktivierung verdeckter Antworten statt Löschung, Idempotenz-
  /CAS-Konfliktfälle, Tenant-Isolation von Beratungssitzungen und
  Antworten, Datenschutzgrenzen von Analytics-/Audit-Payloads,
  Unveränderlichkeit von `questionnaireVersionId`. Siehe
  [QUESTION_ENGINE.md](QUESTION_ENGINE.md) für die fachliche Beschreibung
  der geprüften Regeln.

### 3. Eingebettete Postgres-Verifikation (`scripts/`, kein Vitest)

Eigenständige Node-Skripte, die eine echte Postgres-Instanz **ohne**
externe Binärserver einbetten (`@electric-sql/pglite`). Ursprünglich
entstanden, weil in der Implementierungsumgebung dieser Phase kein
Zugriff auf `binaries.prisma.sh` bestand (siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)), aber auch darüber
hinaus nützlich als schnelle, netzwerkunabhängige Verifikation von Schema
und Migration:

- `scripts/verify_migration_pglite.mjs`: führt die generierte
  Migrations-SQL gegen eine leere Datenbank aus.
- `scripts/verify_seed_pglite.mjs`: führt den vollständigen
  Seed-Datenfluss (zwei Mandanten, ~30 Tabellen) aus und prüft
  anschließend aktiv die Mandantentrennung (inkl. eines bewussten
  Fehlversuchs: Cross-Tenant-Fremdschlüssel-Verletzung).

Diese Skripte sind **kein Ersatz** für `tests/integration/`, sondern eine
zusätzliche, von der Prisma-Engine unabhängige Kontrolle für Schema und
Migration selbst.

### 4. Statische Prüfungen

- ESLint (`npm run lint`, `--max-warnings=0`)
- Prettier (`npm run format`)
- TypeScript (`npm run typecheck`)

## Mandantentrennung: zwei unabhängige Schutzschichten

Absichtlich redundant abgesichert (Verteidigung in der Tiefe):

1. **Datenbankebene (primär):** zusammengesetzte Fremdschlüssel
   `(tenant_id, x_id) → (tenant_id, id)` auf praktisch jeder
   mandantengebundenen Tabelle. Ein Datensatz kann technisch gar nicht
   erst mit einer falschen Tenant/Parent-Kombination gespeichert werden –
   unabhängig davon, ob der Anwendungscode einen Fehler enthält.
2. **Anwendungsebene (sekundär, "defense in depth"):**
   `withTenantScope()` (Prisma Client Extension) ergänzt/validiert
   `tenantId` bei jeder Query eines mandantengebundenen Modells, bevor
   sie an die Datenbank geht. Fängt Fälle ab, die Ebene 1 nicht abdecken
   würde, z. B. eine vergessene `where`-Klausel bei einem reinen
   Lesezugriff (`findUnique`/`findMany`) ohne Fremdschlüssel-Bezug.

Beide Ebenen sind unabhängig voneinander getestet: Ebene 1 in
`scripts/verify_seed_pglite.mjs` und `tests/integration/`, Ebene 2 in
`tests/unit/tenant-scope.test.ts` und ebenfalls `tests/integration/`.

## Was diese Teststrategie bewusst NICHT abdeckt

Seit Phase 3A ist die Fragen-Engine getestet (siehe oben). Weiterhin **nicht**
getestet, weil nicht Teil dieser oder einer vorherigen Implementierungsphase:
Empfehlungs-Engine, Erzeugung von `SalesOpportunity`/`DetectedNeed`,
Cross-Selling-Logik, jede KI-/LLM-gestützte fachliche Interpretation, sowie
eine fertige Mitarbeiteroberfläche (siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) und
[QUESTION_ENGINE.md](QUESTION_ENGINE.md), Abschnitt "Ausdrücklich
ausgeschlossene Funktionen").
