# Abschlussbericht Phase 3A – Fragen-Engine

Stand: 2026-08-01. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen. (Frühere Fassung wurde von ChatGPT als Projektleiter mit NO-GO
zurückgewiesen, weil sie auf andere Dokumente verwies statt Inhalte
einzubetten – das ist hier korrigiert.)

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`,
aktueller Commit `b11d3ce`.

## 1. Technische Versionen

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
  Sandbox-Verifikationsskripte, siehe Abschnitt 13)
- `tsx`: `^4.23.1`

## 2. Architektur der Fragen-Engine

Die Fragen-Engine verwaltet einen versionierten, verzweigten Fragebogen und
den Antwortfortschritt genau einer `ConsultationSession`. Verantwortlich für:

- Auflösung der zum Beratungsstart gültigen `QuestionnaireVersion`
- Auslieferung des aktuell **sichtbaren** Fragenpfads (inkl. Bedingungen)
- Validierung und Speicherung von Antworten (Erst- und Änderungsfall)
- Neuberechnung des sichtbaren Pfads nach jeder Antwortänderung und
  Deaktivierung nicht mehr sichtbarer Antworten
- Fortschrittsberechnung und Abschlussprüfung
- Tenant-Isolation und Nebenläufigkeitskontrolle für alle oben genannten
  Operationen
- Strukturelle Vorab-Validierung einer `QuestionnaireVersion`, bevor sie
  `ACTIVE` geschaltet werden darf

Code-Struktur, `src/server/questionnaire/`:

| Datei                  | Zeilen | Art                            | Zweck                                                                    |
| ---------------------- | -----: | ------------------------------ | ------------------------------------------------------------------------ |
| `types.ts`             |    100 | rein, DB-frei                  | Ein-/Ausgabetypen (`QuestionForAnswering`, `QuestionnaireState`, Inputs) |
| `errors.ts`            |    160 | rein, DB-frei                  | Alle Fehlerklassen (`QuestionEngineError`-Hierarchie, siehe Abschnitt 9) |
| `decimal.ts`           |     53 | rein, DB-frei                  | Präzise Dezimalvergleiche ohne Float                                     |
| `visibility.ts`        |    361 | rein, DB-frei                  | Sichtbarkeitsauswertung, Operatoren, AND/OR-Kombinatoren                 |
| `answer-validation.ts` |    192 | rein, DB-frei                  | Antwortvalidierung pro `AnswerType`                                      |
| `path.ts`              |     91 | rein, DB-frei                  | Pfadberechnung, Fortschritt, neu verdeckte Antworten                     |
| `status.ts`            |     49 | rein, DB-frei                  | Ableitung des Sitzungsstatus                                             |
| `service.ts`           |  1.133 | Orchestrierung mit `db`/Prisma | Öffentliche API, siehe Abschnitt 9                                       |

Die reinen Module sind bewusst ohne Datenbankzugriff geschrieben, damit sie
mit reinem Vitest (ohne Postgres/Prisma) unit-testbar sind (siehe
Abschnitt 10). `service.ts` orchestriert diese Module und läuft
ausschließlich über `db` aus `src/server/db/client.ts`, tenant-gescoped über
`src/server/tenant/scoped-client.ts` / `runWithTenantContext()`.

## 3. Schema- und Migrationsänderungen

Sechs neue Tabellen in `prisma/schema.prisma`, alle in dieselbe (bisher
einzige) Migration `20260731000000_init` eingearbeitet (keine separate
Folgemigration, da noch kein produktiv gelaufener Stand existiert):

- `questionnaires` (fachlicher Fragebogen-Schlüssel, z. B. `"basisberatung"`)
- `questionnaire_versions` (versionierte Fassung eines Fragebogens;
  `status`, `valid_from`/`valid_to`)
- `questions` (fachliche Frage, referenziert `questionnaire_version_id`)
- `question_versions` (versionierte Fassung einer Frage: `label`,
  `answer_type`, `is_required`, `min_value`/`max_value`, `max_length`,
  `min_selections`/`max_selections`, `valid_from`, `status`)
- `answer_options` (Auswahloptionen für `SINGLE_CHOICE`/`MULTIPLE_CHOICE`)
- `visibility_conditions` (Sichtbarkeitsbedingungen zwischen `QuestionVersion`en)

Zusätzlich Erweiterung von `ConsultationSession` um das Pflichtfeld
`questionnaireVersionId String @map("questionnaire_version_id") @db.Uuid`
(NOT NULL), mit Relation
`questionnaireVersion QuestionnaireVersion @relation(fields: [tenantId, questionnaireVersionId], references: [tenantId, id], onDelete: Restrict)`,
sowie Erweiterung von `CustomerAnswer` um `questionnaireVersionId` (ebenfalls
NOT NULL, gleiche Relation, plus Index `[tenantId, questionnaireVersionId]`).

Neue DB-Trigger/Constraints:

- `forbid_questionnaire_version_change()` – DB-Trigger, der jede
  nachträgliche Änderung von `ConsultationSession.questionnaireVersionId`
  ablehnt (strukturelle Unveränderlichkeitsgarantie, unabhängig von
  Anwendungslogik).
- Partieller Unique-Index `customer_answers_one_active_per_question` – stellt
  sicher, dass pro Frage/Sitzung nur eine aktive (`is_active = true`)
  Antwort existiert.

Migrationsergebnis (lokal gegen PGlite – eine eingebettete,
PostgreSQL-kompatible Laufzeit, keine "echte" Postgres-Instanz im Sinne des
Postgres-Service-Containers der CI – verifiziert, siehe Abschnitt 11): **55
Tabellen, 84 Fremdschlüssel**, keine Fehler. Die Tabellenzahl ist gegenüber Phase 2B unverändert in der Summe der
migrierten Tabellen, weil die 6 neuen Tabellen in dieselbe `init`-Migration
eingearbeitet wurden statt eine inkrementelle Folgemigration zu erzwingen.

Alle neuen Tabellen folgen dem projektweiten Tenant-Isolationsmuster:
zusammengesetzter Fremdschlüssel `(tenant_id, x_id) → (tenant_id, id)` statt
eines einfachen `id`-Fremdschlüssels.

## 4. Frage- und Antworttypen

`AnswerType`-Enum: `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `BOOLEAN`, `INTEGER`,
`DECIMAL`, `SHORT_TEXT`, `DATE`.

Jeder Typ wird in `CustomerAnswer` in einer eigenen, typisierten Spalte
gespeichert (kein generisches `value: string`-Feld):

| AnswerType        | Speicherfeld(er)                                                            |
| ----------------- | --------------------------------------------------------------------------- |
| `BOOLEAN`         | `booleanValue`                                                              |
| `INTEGER`         | `integerValue`                                                              |
| `DECIMAL`         | `decimalValue` (`Decimal(18,4)`, als String verglichen, siehe `decimal.ts`) |
| `SHORT_TEXT`      | `freeTextValue`                                                             |
| `DATE`            | `dateValue` (ISO-8601, `Timestamptz`)                                       |
| `SINGLE_CHOICE`   | `choiceValues` (genau 1 Element)                                            |
| `MULTIPLE_CHOICE` | `choiceValues` (1..n Elemente)                                              |

`DECIMAL`-Werte werden **nie** als JavaScript-`Float` verglichen, sondern
über `parseDecimalToScaledBigInt()`/`compareDecimalStrings()` (`decimal.ts`)
als auf Ganzzahlen skalierte `BigInt`-Vergleiche.

Validierungsregeln (`answer-validation.ts::validateAnswerInput()`, sammelt
alle gefundenen Verstöße, nicht nur den ersten):

- **BOOLEAN:** muss ein echter Boolean sein.
- **INTEGER:** muss eine ganze Zahl sein; optional begrenzt durch
  `QuestionVersion.minValue`/`maxValue`.
- **DECIMAL:** muss ein gültiger Dezimalstring sein; optional begrenzt durch
  `minValue`/`maxValue`.
- **SHORT_TEXT:** darf nicht leer sein; optional begrenzt durch
  `QuestionVersion.maxLength`.
- **DATE:** muss ein gültiges ISO-8601-Datum sein.
- **SINGLE_CHOICE:** `choiceValues` muss genau ein gültiges
  `AnswerOption.key`-Element enthalten.
- **MULTIPLE_CHOICE:** `choiceValues` muss 1..n eindeutige, gültige
  `AnswerOption.key`-Werte enthalten, begrenzt durch
  `minSelections`/`maxSelections` (Default: min 0, max unbegrenzt).
- Für jeden Typ dürfen nur die zu ihm gehörenden Wertfelder gesetzt sein –
  z. B. ist ein `booleanValue` bei einer `INTEGER`-Frage ein
  Validierungsfehler.
- Ein komplett leerer Input gilt als „keine Antwort" und wird hier nicht
  abgelehnt; Pflichtfeldprüfung passiert erst bei der
  Fortschritts-/Abschlussprüfung.

## 5. Sichtbarkeitsoperatoren

`VisibilityOperator`-Enum: `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`,
`GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `IN`, `NOT_IN`,
`CONTAINS`, `IS_ANSWERED`, `IS_NOT_ANSWERED`.

Zulässigkeit je Ziel-`AnswerType` (statisch in `OPERATORS_BY_ANSWER_TYPE`,
`visibility.ts`, geprüft sowohl zur Laufzeit als auch vorab bei
`validateQuestionnaireVersion()`):

| Ziel-AnswerType   | zulässige Operatoren                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `BOOLEAN`         | `EQUALS`, `NOT_EQUALS`, `IS_ANSWERED`, `IS_NOT_ANSWERED`                                                                     |
| `SINGLE_CHOICE`   | `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `IS_ANSWERED`, `IS_NOT_ANSWERED`                                                     |
| `MULTIPLE_CHOICE` | `CONTAINS`, `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `IS_ANSWERED`, `IS_NOT_ANSWERED`                                         |
| `INTEGER`         | alle Vergleichsoperatoren + `IN`/`NOT_IN` + `IS_ANSWERED`/`IS_NOT_ANSWERED`                                                  |
| `DECIMAL`         | alle Vergleichsoperatoren (ohne `IN`/`NOT_IN`, da Dezimallisten mehrdeutig wären) + `IS_ANSWERED`/`IS_NOT_ANSWERED`          |
| `DATE`            | alle Vergleichsoperatoren (ohne `IN`/`NOT_IN`) + `IS_ANSWERED`/`IS_NOT_ANSWERED`                                             |
| `SHORT_TEXT`      | **keiner** – Freitext darf nie Ziel einer Sichtbarkeitsbedingung sein (nicht normalisiert genug für zuverlässigen Vergleich) |

`IS_ANSWERED`/`IS_NOT_ANSWERED` ignorieren `comparisonValue` und prüfen nur,
ob die Zielfrage überhaupt eine aktive Antwort hat.

Auswertung (`visibility.ts::isQuestionVisible()`) basiert ausschließlich auf
bereits bekannten Antworten anderer Fragen derselben `QuestionnaireVersion`
– nicht darauf, ob die Zielfrage selbst gerade sichtbar ist; dadurch ist
keine topologische Auswertungsreihenfolge nötig. `sortOrder` steuert nur die
Anzeige-/Bearbeitungsreihenfolge.

**AND-/OR-Logik:** Alle `VisibilityCondition`-Zeilen mit derselben
`questionVersionId` bilden eine Gruppe mit einem gemeinsamen `combinator`
(`AND` oder `OR`). Gemischte Kombinatoren innerhalb derselben Gruppe sind ein
Konfigurationsfehler (`MixedCombinatorError`), sowohl zur Laufzeit als auch
bei `validateQuestionnaireVersion()` abgelehnt. Phase 3A unterstützt **keine
Verschachtelung** (kein `(A AND B) OR C`), nur eine flache Ebene pro Frage.

## 6. Versionierungs- und Reproduzierbarkeitsstrategie

Zwei unterschiedliche Zeitbezüge, bewusst getrennt:

1. **Beim Start** (`startQuestionnaire()`): Die zum Zeitpunkt `input.at ?? new
Date()` gültige `QuestionnaireVersion` wird gesucht (`status = ACTIVE`,
   `validFrom <= atTime`, `validTo IS NULL` oder `validTo > atTime`; bei
   mehreren Treffern die mit dem neuesten `validFrom`). `DRAFT`- und
   `EXPIRED`-Versionen werden nie ausgewählt. Die gefundene
   `questionnaireVersionId` wird **fest** in der neuen `ConsultationSession`
   gespeichert.
2. **Für eine bereits existierende Sitzung** (`loadQuestionnaireState()`,
   `saveAnswer()`, `changeAnswer()`, `completeQuestionnaire()`): Es wird
   immer `session.questionnaireVersionId` (fixiert bei Start) und
   `session.startedAt` (nicht „jetzt") verwendet. Eine später neu
   veröffentlichte `QuestionnaireVersion` verändert also nie rückwirkend eine
   laufende oder abgeschlossene Beratung.

`questionnaireVersionId` ist auf `ConsultationSession` NOT NULL und
zusätzlich per DB-Trigger `forbid_questionnaire_version_change()` gegen jede
nachträgliche Änderung geschützt (siehe Abschnitt 3). Das ergibt volle
Reproduzierbarkeit: Eine bereits abgeschlossene Beratung ist immer anhand der
zum Startzeitpunkt fixierten Fragebogenversion nachvollziehbar, unabhängig
davon, was später am Fragebogen geändert wird.

## 7. Verhalten bei Antwortänderungen und Pfadneuberechnung

Nach jeder Antwortänderung (`saveAnswer()`, `changeAnswer()`) wird der
sichtbare Pfad **komplett neu berechnet** (`path.ts::computeVisiblePath()`),
nicht inkrementell fortgeschrieben.

Wird durch eine Antwortänderung eine zuvor sichtbare, bereits beantwortete
Folgefrage unsichtbar (`path.ts::findNewlyHiddenAnsweredQuestionIds()`,
Vergleich Pfad vor/nach der Änderung), wird deren aktive `CustomerAnswer`
**deaktiviert** (`isActive = false`), **nicht gelöscht**. Sie zählt danach
weder zum Fortschritt noch zur Abschlussprüfung. Wird die Frage später
wieder sichtbar, muss sie **erneut** beantwortet werden – der alte,
deaktivierte Wert wird nicht automatisch reaktiviert (bewusst konservativ,
um keine veraltete Antwort stillschweigend wieder gültig zu machen).

**Nebenläufigkeit bei Antwortänderungen (Compare-And-Swap):**
`changeAnswer()` erwartet `expectedAnswerVersion`. In einer Transaktion wird
zuerst versucht, die aktive Zeile mit genau dieser Version zu deaktivieren
(`UPDATE ... SET is_active = false WHERE ... AND answer_version = $erwartet`);
nur wenn genau eine Zeile betroffen war, wird die neue Antwort mit
`answerVersion = $erwartet + 1` eingefügt. Sonst `StaleAnswerVersionError` –
ein anderer Request hat die Antwort zwischenzeitlich bereits geändert.

Für die Erstantwort gilt: ein zweiter `saveAnswer()`-Aufruf für dieselbe
Frage schlägt sowohl an einem Anwendungscheck als auch am partiellen
Unique-Index `customer_answers_one_active_per_question` fehl
(`AnswerAlreadyExistsError`).

**Fortschrittsberechnung** (`path.ts::computeProgress()`) aggregiert den
aktuell sichtbaren Pfad: `totalVisibleQuestions`/`answeredVisibleQuestions`,
`requiredVisibleQuestions`/`answeredRequiredVisibleQuestions`,
`percentComplete` (gerundet, 100 wenn keine Frage sichtbar ist),
`nextQuestionId` (erste unbeantwortete sichtbare Frage in
`sortOrder`-Reihenfolge), `missingRequiredQuestionIds`, `canComplete` (true
genau dann, wenn `missingRequiredQuestionIds` leer ist). Optionale,
unbeantwortete Fragen blockieren `canComplete` nicht.

**Abschluss:** `completeQuestionnaire()` prüft zuerst, dass die Sitzung
`IN_PROGRESS` ist, berechnet den sichtbaren Pfad zum Zeitpunkt
`session.startedAt` neu, wirft `IncompleteQuestionnaireError` mit der
vollständigen Liste fehlender Pflichtfragen falls `canComplete === false`,
setzt sonst `ConsultationSession.status` per
`updateMany({ where: { status: "IN_PROGRESS" } })` (Nebenläufigkeitsschutz:
betrifft der Aufruf 0 Zeilen, weil die Sitzung parallel bereits
abgeschlossen wurde, wird `QuestionnaireRunNotModifiableError` geworfen statt
eine zweite `COMPLETED`-Transition stillschweigend zuzulassen) auf
`COMPLETED`, setzt `endedAt`, schreibt ein `AnalyticsEvent`
(`QUESTIONNAIRE_COMPLETED`) und einen `AuditLog`-Eintrag – beide ohne
Antwortinhalte (siehe Abschnitt 8). Es wird **keine** `Recommendation` und
**keine** `SalesOpportunity` erzeugt. Nach `COMPLETED` lehnt
`assertSessionModifiable()` jeden weiteren `saveAnswer()`/`changeAnswer()`
mit `QuestionnaireRunNotModifiableError` ab; es gibt keinen Service-Aufruf,
der eine abgeschlossene Sitzung wieder öffnet.

## 8. Tenant-Isolation und Datenschutz

**Tenant-Isolation**, zweistufig wie im übrigen Projekt:

1. Zusammengesetzte DB-Fremdschlüssel `(tenant_id, x_id) → (tenant_id, id)`
   auf allen sechs neuen Tabellen als primäre, strukturelle Garantie.
2. `withTenantScope()`/`runWithTenantContext()`
   (`src/server/tenant/scoped-client.ts`) als Anwendungsebene. Jeder
   Service-Aufruf läuft über `db` aus `src/server/db/client.ts`, das ohne
   aktiven `TenantContext` mit `MissingTenantContextError` verweigert.

Verifiziert in `tests/integration/questionnaire-engine.test.ts`: Tenant B
kann weder eine `ConsultationSession` von Tenant A lesen noch Antworten
dafür schreiben; eine neu gestartete Sitzung erhält immer die `tenantId` aus
dem aktiven Kontext (siehe Abschnitt 10 für den Testlauf-Status dieser
konkreten Datei in dieser Sandbox).

**Datenschutz:**

- Antworten sind fachlich strukturierte Werte (Zahl, Datum, Auswahl,
  begrenzter Freitext) für eine Beratungssitzung, kein
  Kundenstammdaten-Objekt mit Klarnamen.
- `AnalyticsEvent`- und `AuditLog`-Einträge zu Fragebogen-Ereignissen
  (`QUESTIONNAIRE_STARTED`, `QUESTIONNAIRE_COMPLETED`) enthalten
  ausschließlich IDs und Zählwerte (`consultationSessionId`,
  `questionnaireVersionId`, `answeredVisibleQuestions`,
  `totalVisibleQuestions`) – **niemals** die eigentlichen Antwortwerte.
- `AnalyticsEvent.payload`/`AuditLog.metadata` bleiben zusätzlich durch die
  bereits in Phase 2B eingeführte Zod-Validierung
  (`event-payload-schemas.ts`) gegen versehentliche Klardaten abgesichert.
- Jeder Zugriff läuft mandantengescoped; es gibt keinen Pfad, über den ein
  Mandant Antworten eines anderen Mandanten lesen oder verändern kann.

## 9. API- und Service-Schnittstellen

Alle Funktionen aus `src/server/questionnaire/service.ts`, laufen unter
aktivem `TenantContext`:

| Funktion                                               | Zweck                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `startQuestionnaire(input)`                            | Neue `ConsultationSession` starten, passende `QuestionnaireVersion` fixieren            |
| `loadQuestionnaireState(consultationSessionId)`        | Sichtbaren Pfad, Antworten und Fortschritt einer bestehenden Sitzung laden              |
| `saveAnswer(input)`                                    | Erstantwort auf eine sichtbare Frage speichern                                          |
| `changeAnswer(input)`                                  | Bestehende Antwort per CAS ändern, Pfad neu berechnen, verdeckte Antworten deaktivieren |
| `recalculateVisiblePath(consultationSessionId)`        | Sichtbaren Pfad ohne Schreiboperation neu berechnen                                     |
| `getProgress(consultationSessionId)`                   | Nur die Fortschrittsübersicht liefern                                                   |
| `completeQuestionnaire(consultationSessionId)`         | Sitzung abschließen (siehe Abschnitt 7)                                                 |
| `validateQuestionnaireVersion(questionnaireVersionId)` | Strukturelle Vorab-Prüfung einer Version vor Veröffentlichung (`ACTIVE`)                |
| `assertQuestionnaireVersionIsEditable(...)`            | Prüft, ob eine Version noch `DRAFT` (und damit inhaltlich änderbar) ist                 |

Exportierte Ein-/Ausgabetypen: `QuestionForAnswering`, `QuestionnaireState`,
`StartQuestionnaireInput`, `SaveAnswerInput`, `ChangeAnswerInput`,
`AnswerWriteResult`, `CompleteQuestionnaireResult`.

**Fehlercodes** (alle erben von `QuestionEngineError`,
`src/server/questionnaire/errors.ts`, per `instanceof` unterscheidbar):

| Klasse                                 | Bedeutung                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `NoActiveQuestionnaireVersionError`    | Keine zeitlich gültige, `ACTIVE` `QuestionnaireVersion` gefunden                |
| `ConsultationSessionNotFoundError`     | Referenzierte Sitzung existiert nicht (oder falscher Mandant)                   |
| `QuestionNotFoundError`                | Referenzierte Frage existiert nicht in dieser `QuestionnaireVersion`            |
| `InvalidAnswerError`                   | Antwort verletzt Validierungsregeln (`issues`: alle Verstöße)                   |
| `StaleAnswerVersionError`              | CAS-Konflikt bei `changeAnswer()`                                               |
| `MixedCombinatorError`                 | Gemischte AND/OR-Kombinatoren in einer Sichtbarkeitsgruppe                      |
| `VisibilityCycleError`                 | Zyklus im Sichtbarkeits-Abhängigkeitsgraphen                                    |
| `QuestionnaireRunNotModifiableError`   | Schreibversuch auf eine nicht mehr `IN_PROGRESS`-Sitzung                        |
| `IncompleteQuestionnaireError`         | Abschluss trotz unbeantworteter sichtbarer Pflichtfrage(n) versucht             |
| `QuestionNotVisibleError`              | Antwortversuch auf eine aktuell nicht sichtbare Frage                           |
| `QuestionnaireVersionInvalidError`     | Strukturelle Validierung einer Version fehlgeschlagen (`issues`: alle Verstöße) |
| `QuestionnaireVersionNotEditableError` | Inhaltliche Änderung an einer nicht-`DRAFT`-Version versucht                    |
| `AnswerAlreadyExistsError`             | Zweiter `saveAnswer()`-Aufruf für dieselbe Frage (Idempotenzschutz)             |

## 10. Anzahl und Art aller neuen Tests

Gesamtprojekt (Stand dieses Commits): 13 Testdateien, davon 11 Unit- und 2
Integrationstestdateien.

**Unit-Tests (Vitest, DB-frei, `npm run test:unit`): 150 Tests in 11
Dateien**, tatsächlich ausgeführt am 2026-08-01, Exit-Code 0, alle grün.
Davon **51 neu für die Fragen-Engine** in `tests/unit/questionnaire/`:

| Datei                       | Tests | Zeilen |
| --------------------------- | ----: | -----: |
| `answer-validation.test.ts` |    11 |    117 |
| `visibility.test.ts`        |    21 |    315 |
| `path.test.ts`              |     8 |    124 |
| `status.test.ts`            |     5 |     41 |
| `decimal.test.ts`           |     6 |     53 |

Die übrigen 99 Unit-Tests stammen aus Phase 2B
(`tenant-context.test.ts`: 7, `event-payload-schemas.test.ts`: 12,
`validate-scoped-args-payload.test.ts`: 7, `tenant-scope.test.ts`: 47,
`contact-data-guard.test.ts`: 20, `review-access.test.ts`: 6) und sind
unverändert Teil der Gesamtzahl.

**Integrationstests (`npm run test:integration`, benötigen echten
`@prisma/client` + laufende Postgres-Instanz):**

- `tests/integration/questionnaire-engine.test.ts` – **neu in Phase 3A**,
  735 Zeilen, 17 Top-Level-Testfälle. Deckt unter anderem ab: kompletten
  Start-/Antwort-/Abschluss-Zyklus, bedingte Sichtbarkeit inkl.
  Deaktivierung verdeckter Antworten, alle Validierungsgrenzen (Numerik,
  Mehrfachauswahl), CAS-Konflikt bei `changeAnswer()`, Doppel-`saveAnswer()`,
  Tenant-Isolation (keine fremde Sitzung lesbar, keine fremde Antwort
  schreibbar), Datenschutzgrenze der `AnalyticsEvent`/`AuditLog`-Payloads
  (keine Antwortinhalte), Nicht-Erzeugung von
  `Recommendation`/`SalesOpportunity` bei Abschluss.
- `tests/integration/tenant-isolation.test.ts` – aus Phase 2B, in Phase 3A um
  15 Zeilen erweitert (Anpassung an das neue Pflichtfeld
  `questionnaireVersionId`), 6 Testfälle, unverändert aus Phase 2B in der
  Grundstruktur.

**Status der Integrationstests in dieser Sandbox (ehrlich dokumentiert):**
Beide Integrationstestdateien können in der aktuellen Entwicklungs-Sandbox
**nicht ausgeführt** werden. Fehler beim Laden: `Error: Cannot find module
'.prisma/client/default'`. Ursache ist die in Abschnitt 13 beschriebene
Sandbox-Einschränkung (kein Zugriff auf `binaries.prisma.sh`, daher kein
`prisma generate` möglich). Sie sind im Code vollständig vorhanden und in
`.github/workflows/ci.yml` verankert; laut der bisherigen CI-Historie in
GitHub Actions lief CI-Lauf #9 (Commit `85e4022`) erfolgreich in 1m 33s ohne
Fehler (einzige Ausgabe: eine folgenlose Node.js-20-Deprecation-Warnung).
Diese Aussage stützt sich auf die CI-Historie in GitHub Actions, nicht auf
einen in dieser Sitzung selbst durchgeführten Lauf, und wird hier explizit
als solche gekennzeichnet.

## 11. Vollständige Prüfkommandos mit Ergebnissen und Exit-Codes

Alle Befehle wurden am 2026-08-01 in der Entwicklungs-Sandbox tatsächlich
ausgeführt (nicht nur behauptet):

| Befehl                                        | Exit-Code | Ergebnis                                                                                                                                                                               |
| --------------------------------------------- | :-------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                |     0     | 0 Fehler, 0 Warnungen (`eslint . --max-warnings=0`)                                                                                                                                    |
| `npm run format`                              |     0     | „All matched files use Prettier code style!" für das gesamte Projekt                                                                                                                   |
| `npm run typecheck`                           |     1     | 22 Fehler, **alle** auf die fehlenden generierten Prisma-Typen zurückführbar (siehe Abschnitt 13); keine neuen Logikfehler                                                             |
| `npm test` (= `vitest run`, alle Testdateien) |     1     | 150/150 Unit-Tests grün (11 Dateien); 2 Integrationstestdateien scheitern beim Laden mit `Cannot find module '.prisma/client/default'` (siehe Abschnitt 10 und 13)                     |
| `npm run test:unit`                           |     0     | 150/150 Tests grün                                                                                                                                                                     |
| `npm run verify:migration` (PGlite)           |     0     | 55 Tabellen, 84 Fremdschlüssel, keine Fehler                                                                                                                                           |
| `npm run verify:seed` (PGlite)                |     0     | Beide Mandanten korrekt geseedet, alle 12 Prüfabschnitte (Zeilenzahlen, Cross-Tenant-Isolation, Scope-Integrität, Exclusion Constraint, Append-only) bestanden – siehe Korrektur unten |
| `npx prisma generate`                         |     1     | `Error: Failed to fetch sha256 checksum at https://binaries.prisma.sh/... - 403 Forbidden` (erwarteter Sandbox-Fehler, siehe Abschnitt 13)                                             |
| `npm run build`                               |     –     | in dieser Sandbox **nicht ausgeführt**, da abhängig von generierten Prisma-Typen (siehe Abschnitt 13); Teil der CI-Pipeline                                                            |

**Während der Erstellung dieses Berichts entdeckter und behobener Fehler
(Ehrlichkeitsregel):** Beim erneuten, unabhängigen Ausführen von
`npm run verify:seed` für diesen Bericht schlug der Lauf zunächst mit
`error: null value in column "questionnaire_version_id" of relation
"consultation_sessions" violates not-null constraint` fehl. Ursache: Das
Verifikationsskript `scripts/verify_seed_pglite.mjs` (nicht `prisma/seed.ts`
– dort war das Feld bereits korrekt gesetzt) hatte in seinem rohen
`INSERT INTO consultation_sessions (...)`-Statement das inzwischen
NOT-NULL-pflichtige Feld `questionnaire_version_id` schlicht vergessen zu
ergänzen, obwohl die zugehörige `questionnaireVersionId`-Variable im selben
Funktionsscope bereits existierte. Behoben durch Ergänzung der Spalte und
des Parameters im `INSERT`-Statement; anschließend erneut ausgeführt mit
Exit-Code 0 (siehe Tabelle oben) und zusätzlich mit Prettier neu formatiert
(`npx prettier --write scripts/verify_seed_pglite.mjs`, danach
`npm run format` erneut mit Exit-Code 0 bestätigt). Dieser Fehler betraf
ausschließlich das Sandbox-Verifikationsskript, nicht `prisma/seed.ts` oder
das Schema selbst, und war vor diesem Bericht nicht dokumentiert.

Zusätzlich wurde bei der Faktensammlung für diesen Bericht festgestellt,
dass `docs/OPEN_DECISIONS.md` und `docs/RISK_REGISTER.md` (in einer früheren
Sitzung um von ChatGPT geforderte Punkte ergänzt) nicht Prettier-formatiert
waren (`npm run format` Exit-Code 1). Behoben durch
`npx prettier --write docs/OPEN_DECISIONS.md docs/RISK_REGISTER.md`; danach
`npm run format` erneut mit Exit-Code 0 bestätigt (siehe Tabelle oben, die
bereits den korrigierten Zustand zeigt).

## 12. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat 90b8df4 HEAD` (Vergleich Ende Phase 2B → aktueller Commit
`b11d3ce`), 34 Dateien, 5.776 Zeilen hinzugefügt, 183 Zeilen entfernt:

```
PHASE_3A_IMPLEMENTATION_PLAN.md                         |  167 +++ (neu)
PHASE_3A_STARTPROMPT.md                                 |  653 +++++++++++ (neu)
README.md                                                |   19 +-
_write_test_file                                         |    0 (Artefakt ohne Inhaltsänderung, siehe unten)
docs/ABSCHLUSSBERICHT_PHASE3A.md                         |   88 ++ (neu, jetzt durch dieses Dokument ersetzt)
docs/ARCHITECTURE.md                                     |   14 +-
docs/DATA_MODEL.md                                       |   61 +-
docs/DECISION_LOG.md                                     |  229 ++++ (neu)
docs/IMPLEMENTATION_STATUS.md                            |  115 +-
docs/OPEN_DECISIONS.md                                   |    2 +
docs/PRIVACY_AND_SECURITY.md                             |   14 +
docs/QUESTION_ENGINE.md                                  |  442 +++++++- (grundlegend überarbeitet)
docs/RISK_REGISTER.md                                    |    7 +
docs/TEST_STRATEGY.md                                    |   45 +-
prisma/migrations/20260731000000_init/migration.sql      |  174 ++-
prisma/migrations/20260801095926_analytics_events_employee_restrict/migration.sql |   17 + (neu, CI-#8-Fix)
prisma/schema.prisma                                      |  127 ++-
prisma/seed.ts                                            |  238 ++ (Fragen-Engine-Seeddaten)
scripts/schema_to_sql.py                                  |    8 +-
src/server/questionnaire/answer-validation.ts             |  192 ++ (neu)
src/server/questionnaire/decimal.ts                        |   53 ++ (neu)
src/server/questionnaire/errors.ts                         |  160 ++ (neu)
src/server/questionnaire/path.ts                           |   91 ++ (neu)
src/server/questionnaire/service.ts                        | 1133 ++++++++++++++++++ (neu)
src/server/questionnaire/status.ts                         |   49 ++ (neu)
src/server/questionnaire/types.ts                           |  100 ++ (neu)
src/server/questionnaire/visibility.ts                      |  361 +++++ (neu)
tests/integration/questionnaire-engine.test.ts              |  735 +++++++++++ (neu)
tests/integration/tenant-isolation.test.ts                  |   15 +-
tests/unit/questionnaire/answer-validation.test.ts          |  117 ++ (neu)
tests/unit/questionnaire/decimal.test.ts                     |   53 ++ (neu)
tests/unit/questionnaire/path.test.ts                        |  124 ++ (neu)
tests/unit/questionnaire/status.test.ts                      |   41 ++ (neu)
tests/unit/questionnaire/visibility.test.ts                   |  315 ++++ (neu)
```

Zusätzlich außerhalb dieses Diff-Bereichs, aus der CI-#8-Fehlerbehebung
(Commit `85e4022`, ebenfalls Teil von Phase 3A): Änderung von
`AnalyticsEvent.employee` in `prisma/schema.prisma` von `onDelete: SetNull`
auf `onDelete: Restrict` (in obiger Zeilenzahl von `prisma/schema.prisma`
bereits enthalten) sowie die neue Migration
`20260801095926_analytics_events_employee_restrict` (oben aufgeführt).

Anmerkung zu `_write_test_file`: eine 0-Byte-Datei ohne Inhalt und ohne
Referenz aus Anwendungscode, technisches Artefakt eines
Dateisystem-Schreibtests aus einer früheren Sitzung. Keine funktionale
Bedeutung; sollte bei Gelegenheit gelöscht werden (siehe auch die unten
genannten harmlosen Altlasten `_tmp_20_*` und `src/newdir/file.txt`, die aus
technischen Gründen in der damaligen Sitzung nicht löschbar waren).

## 13. Vollständige bekannte Einschränkungen

**Zentrale Sandbox-Einschränkung:** Die Entwicklungsumgebung hat keinen
Zugriff auf `binaries.prisma.sh` (HTTP 403 bei jedem Versuch, siehe
Abschnitt 11). Dadurch nicht ausführbar in dieser Sandbox: `prisma generate`
(erzeugt den TypeScript-Client), `prisma migrate dev`/`deploy` (gegen eine
echte, laufende Postgres-Instanz), `prisma validate`, `npm run build`
(benötigt generierte Prisma-Typen), sowie beide
`tests/integration/*.test.ts`-Dateien (benötigen den generierten
`@prisma/client`). Das betrifft nicht die Korrektheit von Schema oder
Migration selbst, sondern nur Werkzeuge, die Internetzugriff auf
Prisma-eigene Binärserver benötigen. Workaround: Migration und
Seed-Datenfluss wurden stattdessen gegen PGlite verifiziert – eine
eingebettete, PostgreSQL-kompatible Laufzeit (`@electric-sql/pglite`), keine
"echte" Postgres-Instanz im Sinne des Postgres-Service-Containers der CI –
(`scripts/verify_migration_pglite.mjs`, `scripts/verify_seed_pglite.mjs`),
ohne Prisma-Binärserver zu benötigen. Alle 22 `tsc --noEmit`-Fehler sind auf
genau diese fehlenden generierten Typen zurückführbar (siehe Abschnitt 11),
keiner weist auf einen echten Logikfehler hin.

**Nicht in dieser Sandbox geprüft, aber in CI verankert und dort laut
bisheriger CI-Historie erfolgreich gelaufen (CI-Lauf #9, Commit `85e4022`,
1m 33s, keine Fehler):** beide Integrationstestdateien gegen echten
`@prisma/client` + Postgres-Service-Container, `npm run build`.

**Bekannte offene technische Aufgaben (von ChatGPT als nicht-blockierend für
Phase 3A eingestuft, für spätere Phase festgehalten):**

- FK-Fehler in fachliche Fehlermeldung übersetzen. Voraussetzung bereits
  erfüllt (zentraler Error-Handler verhindert schon heute, dass rohe
  SQL-/Prisma-Details an Clients gelangen); eine spezifische, fachlich
  verständliche Übersetzung von FK-Verletzungen steht noch aus.
- Dedizierte Testdatenbank mit Schutzmechanismus: lokale Integrationstests
  sollen künftig die DB-URL auf ein `_test`-Namensmuster prüfen und den
  Start abbrechen, wenn die Ziel-DB nicht eindeutig als Testdatenbank
  erkennbar ist.
- DSGVO-konformes Anonymisierungs-/Löschkonzept für ausgeschiedene
  Mitarbeiter mit vorhandenen `AnalyticsEvent`s – offene Entscheidung,
  separat in `docs/OPEN_DECISIONS.md` (Punkt 14) und
  `docs/RISK_REGISTER.md` dokumentiert.

**Bekannte harmlose Altlasten im gemounteten Projektordner** (technisch
bedingt nicht löschbar in der Sitzung, in der sie entstanden):
`_tmp_20_be2baffc037932ce7dd80d17bf22a85a`,
`_tmp_20_e69110ec3545a176303bbf82f9937574`, `src/newdir/file.txt`, sowie die
in Abschnitt 12 genannte `_write_test_file`. Keine Sicherheits- oder
Datenschutzrelevanz, kein Anwendungscode referenziert sie; bitte manuell
löschen.

## 14. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

Ausdrücklich **nicht** Teil dieser Phase und nicht in diesem Modul
implementiert:

- Empfehlungs-Engine, Tarif-/Produktvorschlag
- Erzeugung von `SalesOpportunity`/`DetectedNeed` aus Antworten
  (`completeQuestionnaire()` erzeugt nachweislich weder das eine noch das
  andere – integrationstestlich abgesichert in
  `tests/integration/questionnaire-engine.test.ts`)
- Cross-Selling-Logik
- jede KI-/LLM-gestützte fachliche Interpretation von Antworten (Ranking,
  Zusammenfassung, Formulierungsvorschlag)
- fertige Mitarbeiteroberfläche (nur die bereits aus Phase 2B bestehende,
  technisch auf Dev/Test beschränkte `/review`-Ansicht)
- Autorenoberfläche/Admin-UI zum Anlegen von Fragebögen (Fragebögen werden
  in Phase 3A ausschließlich per Seed-/Migrationsskript angelegt)
- Wiederöffnung einer bereits `COMPLETED`-Sitzung: `status.ts` kennt zwar
  einen abgeleiteten Zustand `NEEDS_REVIEW` (aktive Antwort nach `endedAt`
  geändert), dieser ist über die aktuelle Service-API nicht erreichbar und
  dient nur als Vorbereitung für eine mögliche spätere, explizite
  Korrektur-/Wiederöffnungsfunktion.
- verschachtelte Sichtbarkeitslogik (`(A AND B) OR C`) – nur eine flache
  Ebene pro Frage.

## 15. GO/NO-GO

**Klarstellung zum früheren „Finalen GO":** Das von ChatGPT nach CI-Lauf #9
ausgesprochene „finale GO" bezog sich ausschließlich auf den
CI-technischen Abschluss von Phase 3A (grüner CI-Lauf, keine offenen
CI-Fehler) – **nicht** auf den Inhalt bzw. die Vollständigkeit dieses
Abschlussberichts. Die vorherige Fassung dieses Dokuments wurde separat von
ChatGPT geprüft und mit NO-GO zurückgewiesen, weil sie auf andere Dokumente
verwies statt die geforderten Punkte selbst vollständig zu enthalten. Diese
Fassung korrigiert das.

**Status dieser Fassung:** Alle Prüfkommandos wurden für diesen Bericht am
2026-08-01 tatsächlich neu ausgeführt (siehe Abschnitt 11), inklusive der
Behebung eines bis dahin unentdeckten Fehlers im Seed-Verifikationsskript
und einer Prettier-Formatierungslücke in zwei Dokumentationsdateien. Dieser
Bericht ist zur erneuten Prüfung durch ChatGPT (Projektleiter) vorgesehen;
die endgültige GO/NO-GO-Entscheidung zum **Berichtsinhalt** liegt bei
ChatGPT.

**Offen für den Auftraggeber:** Nach dem Klonen dieses Projekts mit
normalem Internetzugang müssen einmalig ausgeführt werden:
`npm install`, `npx prisma generate`, `npx prisma migrate deploy` (bzw.
`migrate dev` in lokaler Entwicklung). Erst danach sind `tsc --noEmit`,
`npm run build` und beide `tests/integration/*`-Dateien lokal vollständig
lauffähig; im CI-System sind sie es laut bisheriger Historie bereits
(CI-Lauf #9).
