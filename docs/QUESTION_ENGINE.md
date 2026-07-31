# Fragen-Engine (Phase 3A)

Dieses Dokument beschreibt die **tatsächlich implementierte** Fragen-Engine
(`src/server/questionnaire/*`, `prisma/schema.prisma`) – nicht mehr das
Phase-1-Konzept. Verbindliche Quelle für Feldnamen ist immer
`prisma/schema.prisma`; verbindliche Quelle für Verhalten ist
`src/server/questionnaire/service.ts` und die dort re-exportierten Module.
Alle Beispiele in diesem Dokument verwenden ausschließlich synthetische
Testdaten (Muster: `"DemoTel"`, `hat_streaming_bedarf`, `farbe: rot`, keine
echten Kunden- oder Anbieterdaten).

## Verantwortungsbereich der Engine

Die Fragen-Engine verwaltet einen versionierten, verzweigten Fragebogen und
den Antwortfortschritt genau einer `ConsultationSession`:

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

Implementiert in `src/server/questionnaire/`: `types.ts`, `errors.ts`,
`decimal.ts`, `visibility.ts`, `answer-validation.ts`, `path.ts`,
`status.ts` (reine, DB-freie Logikmodule) sowie `service.ts`
(Orchestrierung mit `db`/Prisma, tenant-gescoped über
`src/server/db/client.ts`).

## Ausdrücklich ausgeschlossene Funktionen

Gemäß `PHASE_3A_STARTPROMPT.md` **nicht** Teil dieser Engine und nicht in
diesem Modul implementiert:

- Empfehlungs-Engine, Tarif-/Produktvorschlag (`RECOMMENDATION_ENGINE.md`)
- Erzeugung von `SalesOpportunity`/`DetectedNeed` aus Antworten
- Cross-Selling-Logik
- jede KI-/LLM-gestützte fachliche Interpretation von Antworten (Ranking,
  Zusammenfassung, Formulierungsvorschlag)
- fertige Mitarbeiteroberfläche (nur eine minimale technische Dev-Ansicht,
  falls überhaupt gebaut)
- Autorenoberfläche/Admin-UI zum Anlegen von Fragebögen (Fragebögen werden
  in Phase 3A ausschließlich per Seed-/Migrationsskript angelegt)

`completeQuestionnaire()` erzeugt **weder** eine `Recommendation` **noch**
eine `SalesOpportunity` – das ist über einen Integrationstest abgesichert
(`tests/integration/questionnaire-engine.test.ts`, Fall 25).

## Frage- und Antworttypen

`AnswerType`-Enum (`prisma/schema.prisma`): `SINGLE_CHOICE`,
`MULTIPLE_CHOICE`, `BOOLEAN`, `INTEGER`, `DECIMAL`, `SHORT_TEXT`, `DATE`.

Jeder Typ wird in `CustomerAnswer` in einer eigenen, typisierten Spalte
gespeichert (nie ein generisches `value: string`-Feld):

| AnswerType        | Speicherfeld(er)                                                             |
| ----------------- | ---------------------------------------------------------------------------- |
| `BOOLEAN`         | `booleanValue`                                                               |
| `INTEGER`         | `integerValue`                                                               |
| `DECIMAL`         | `decimalValue` (`Decimal(18,4)`, als String verglichen – siehe `decimal.ts`) |
| `SHORT_TEXT`      | `freeTextValue`                                                              |
| `DATE`            | `dateValue` (ISO-8601, `Timestamptz`)                                        |
| `SINGLE_CHOICE`   | `choiceValues` (genau 1 Element)                                             |
| `MULTIPLE_CHOICE` | `choiceValues` (1..n Elemente)                                               |

`DECIMAL`-Werte werden **niemals** als JavaScript-`Float` verglichen,
sondern über `parseDecimalToScaledBigInt()`/`compareDecimalStrings()`
(`decimal.ts`) als auf Ganzzahlen skalierte `BigInt`-Vergleiche – konsistent
mit dem projektweiten Grundsatz "kein Float, wo Genauigkeit zählt" (siehe
`DECISION_LOG.md`, Geldbeträge).

## Validierungsregeln

Zentral in `answer-validation.ts::validateAnswerInput()`. Sammelt **alle**
gefundenen Verstöße (nicht nur den ersten) in `InvalidAnswerError.issues`:

- **BOOLEAN:** `booleanValue` muss ein echter Boolean sein.
- **INTEGER:** muss eine ganze Zahl sein; optional begrenzt durch
  `QuestionVersion.minValue`/`maxValue` (Vergleich über `compareDecimalStrings`).
- **DECIMAL:** muss ein gültiger Dezimalstring sein (`isValidDecimalString`);
  optional begrenzt durch `minValue`/`maxValue`.
- **SHORT_TEXT:** darf nicht leer sein; optional begrenzt durch
  `QuestionVersion.maxLength`.
- **DATE:** muss ein gültiges ISO-8601-Datum sein.
- **SINGLE_CHOICE:** `choiceValues` muss genau ein Element enthalten, das ein
  gültiger `AnswerOption.key` dieser `QuestionVersion` ist.
- **MULTIPLE_CHOICE:** `choiceValues` muss 1..n eindeutige, gültige
  `AnswerOption.key`-Werte enthalten; zusätzlich begrenzt durch
  `QuestionVersion.minSelections`/`maxSelections` (Default: min 0, max
  unbegrenzt).
- Für jeden `AnswerType` dürfen **nur** die zu ihm gehörenden Wertfelder
  gesetzt sein – ein `booleanValue` bei einer `INTEGER`-Frage ist ein
  Validierungsfehler, keine stille Ignorierung.

Ein komplett leerer Input (kein Wertfeld gesetzt) gilt als "keine Antwort"
und wird **hier nicht** abgelehnt – Pflichtfeldprüfung (`isRequired`)
passiert erst bei der Fortschritts-/Abschlussprüfung (siehe unten), da eine
Frage jederzeit unbeantwortet bleiben darf, solange der Fragebogen noch
läuft.

## Versionsauflösung

Zwei unterschiedliche Zeitbezüge, bewusst getrennt (siehe `DECISION_LOG.md`):

1. **Beim Start** (`startQuestionnaire()`): Die zum Zeitpunkt `input.at ??
new Date()` gültige `QuestionnaireVersion` wird gesucht: `status =
ACTIVE`, `validFrom <= atTime`, (`validTo IS NULL` oder `validTo >
atTime`), bei mehreren Treffern die mit dem neuesten `validFrom`. `DRAFT`-
   und `EXPIRED`-Versionen werden nie ausgewählt. Die gefundene
   `questionnaireVersionId` wird **fest** in der neuen
   `ConsultationSession` gespeichert.
2. **Für eine bereits existierende Sitzung** (`loadQuestionnaireState()`,
   `saveAnswer()`, `changeAnswer()`, `completeQuestionnaire()`): Es wird
   **immer** `session.questionnaireVersionId` (fixiert bei Start) und
   `session.startedAt` (nicht "jetzt") verwendet, um die zugehörigen
   `Question`/`QuestionVersion`-Knoten zu laden. Eine später neu
   veröffentlichte `QuestionnaireVersion` verändert also nie rückwirkend
   eine laufende oder abgeschlossene Beratung.

`questionnaireVersionId` ist auf `ConsultationSession` `NOT NULL` und zusätzlich
per DB-Trigger `forbid_questionnaire_version_change()` gegen jede
nachträgliche Änderung geschützt (siehe Abschnitt "Nebenläufigkeitsstrategie"
und `DECISION_LOG.md`).

## Sichtbarkeitsmodell

Jede `QuestionVersion` kann null oder mehr `VisibilityCondition`-Zeilen
haben. Eine Bedingung sagt: "Zeige diese Frage nur, wenn die Antwort auf
`targetQuestionId` (eine andere Frage **derselben** `QuestionnaireVersion`)
den Vergleich `operator`/`comparisonValue` erfüllt." Ohne Bedingungen ist
eine Frage immer sichtbar.

Ausgewertet in `visibility.ts::isQuestionVisible()`, rein auf Basis bereits
bekannter Antworten anderer Fragen (`answersByQuestionId`) – **nicht**
abhängig davon, ob die Zielfrage selbst gerade sichtbar ist. Dadurch ist
keine topologische Auswertungsreihenfolge nötig; `sortOrder` steuert nur die
Anzeige-/Bearbeitungsreihenfolge, nicht die Auswertungsreihenfolge.

**Freitext-Verbot:** `SHORT_TEXT`-Fragen dürfen nie Ziel einer
`VisibilityCondition` sein (`OPERATORS_BY_ANSWER_TYPE.SHORT_TEXT` ist eine
leere Menge; `evaluateSingleCondition()` wirft sonst einen Fehler). Grund:
Freitext ist nicht normalisiert genug für einen zuverlässigen Vergleich
(siehe `DECISION_LOG.md`).

## Unterstützte Operatoren

`VisibilityOperator`-Enum: `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`,
`GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `IN`, `NOT_IN`,
`CONTAINS`, `IS_ANSWERED`, `IS_NOT_ANSWERED`.

Welcher Operator für welchen `AnswerType` der **Zielfrage** zulässig ist, ist
statisch in `OPERATORS_BY_ANSWER_TYPE` (`visibility.ts`) festgelegt und wird
sowohl zur Laufzeit (`evaluateSingleCondition()`) als auch vorab bei
`validateQuestionnaireVersion()` geprüft:

| Ziel-AnswerType   | zulässige Operatoren                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `BOOLEAN`         | `EQUALS`, `NOT_EQUALS`, `IS_ANSWERED`, `IS_NOT_ANSWERED`                                                            |
| `SINGLE_CHOICE`   | `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `IS_ANSWERED`, `IS_NOT_ANSWERED`                                            |
| `MULTIPLE_CHOICE` | `CONTAINS`, `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `IS_ANSWERED`, `IS_NOT_ANSWERED`                                |
| `INTEGER`         | alle Vergleichsoperatoren + `IN`/`NOT_IN` + `IS_ANSWERED`/`IS_NOT_ANSWERED`                                         |
| `DECIMAL`         | alle Vergleichsoperatoren (ohne `IN`/`NOT_IN`, da Dezimallisten mehrdeutig wären) + `IS_ANSWERED`/`IS_NOT_ANSWERED` |
| `DATE`            | alle Vergleichsoperatoren (ohne `IN`/`NOT_IN`) + `IS_ANSWERED`/`IS_NOT_ANSWERED`                                    |
| `SHORT_TEXT`      | **keiner** (siehe oben)                                                                                             |

`IS_ANSWERED`/`IS_NOT_ANSWERED` ignorieren `comparisonValue` und prüfen nur,
ob die Zielfrage überhaupt eine aktive Antwort hat.

## AND-/OR-Logik

Alle `VisibilityCondition`-Zeilen mit derselben `questionVersionId` bilden
**eine** Gruppe mit **einem** gemeinsamen `combinator` (`AND` oder `OR`).
Gemischte Kombinatoren innerhalb derselben Gruppe sind ein
Konfigurationsfehler (`MixedCombinatorError`) und werden sowohl zur
Laufzeit als auch bei `validateQuestionnaireVersion()` abgelehnt. Phase 3A
unterstützt **keine Verschachtelung** (kein `(A AND B) OR C`) – nur eine
einzige, flache Ebene pro Frage.

## Pfadneuberechnung

Nach jeder Antwortänderung (`saveAnswer()`, `changeAnswer()`) wird der
sichtbare Pfad **komplett neu berechnet** (`path.ts::computeVisiblePath()`),
nicht inkrementell fortgeschrieben. Das ist bei der Fragenanzahl dieses
Projekts unproblematisch und vermeidet eine ganze Klasse von
Inkrementalisierungsfehlern (z. B. vergessene Kaskaden bei mehrstufigen
Abhängigkeiten).

## Umgang mit nicht mehr sichtbaren Antworten

Wird durch eine Antwortänderung eine zuvor sichtbare, bereits beantwortete
Folgefrage unsichtbar (`path.ts::findNewlyHiddenAnsweredQuestionIds()`,
Vergleich Pfad vor/nach der Änderung), wird deren aktive `CustomerAnswer`
**deaktiviert** (`isActive = false`), **nicht gelöscht**. Sie zählt danach
weder zum Fortschritt noch zur Abschlussprüfung. Wird die Frage später durch
eine erneute Antwortänderung wieder sichtbar, muss sie **erneut**
beantwortet werden – der alte, deaktivierte Wert wird nicht automatisch
reaktiviert (bewusst konservativ, um eine veraltete Antwort nicht
stillschweigend wieder gültig zu machen).

## Fortschrittsberechnung

`path.ts::computeProgress()` aggregiert den aktuell sichtbaren Pfad:

- `totalVisibleQuestions` / `answeredVisibleQuestions`
- `requiredVisibleQuestions` / `answeredRequiredVisibleQuestions`
- `percentComplete` = `round(answeredVisibleQuestions /
totalVisibleQuestions * 100)`, `100` wenn keine Frage sichtbar ist
- `nextQuestionId`: erste unbeantwortete sichtbare Frage in
  `sortOrder`-Reihenfolge, oder `null`
- `missingRequiredQuestionIds`: sichtbare, unbeantwortete **Pflicht**fragen
- `canComplete`: `true` genau dann, wenn `missingRequiredQuestionIds` leer
  ist

Optionale, unbeantwortete Fragen blockieren `canComplete` nicht.

## Abschlussbedingungen

`completeQuestionnaire()`:

1. Session muss `IN_PROGRESS` sein (siehe Nebenläufigkeitsstrategie), sonst
   `QuestionnaireRunNotModifiableError`.
2. Sichtbarer Pfad wird zum Zeitpunkt `session.startedAt` neu berechnet;
   ist `progress.canComplete === false`, wird `IncompleteQuestionnaireError`
   mit der vollständigen Liste der fehlenden Pflichtfragen geworfen.
3. Sonst: `ConsultationSession.status` wird per `updateMany({ where: {
status: "IN_PROGRESS" } })` auf `COMPLETED` gesetzt (Nebenläufigkeitsschutz,
   siehe unten), `endedAt` gesetzt, ein `AnalyticsEvent`
   (`QUESTIONNAIRE_COMPLETED`) und ein `AuditLog`-Eintrag geschrieben – beide
   **ohne** Antwortinhalte (siehe "Datenschutzgrenzen").
4. Es wird **keine** `Recommendation` und **keine** `SalesOpportunity`
   erzeugt (außerhalb des Scopes dieser Engine).

**Wiederöffnung:** Nach `COMPLETED` lehnt `assertSessionModifiable()` jeden
weiteren `saveAnswer()`/`changeAnswer()`-Aufruf mit
`QuestionnaireRunNotModifiableError` ab – es gibt in Phase 3A **keinen**
Service-Aufruf, der eine abgeschlossene Sitzung wieder öffnet.
`status.ts::deriveQuestionnaireRunStatus()` kennt zwar einen abgeleiteten
Zustand `NEEDS_REVIEW` (aktive Antwort nach `endedAt` geändert), dieser ist
über die aktuelle Service-API **nicht erreichbar** und dient als
Vorbereitung für eine mögliche spätere, explizite
Korrektur-/Wiederöffnungsfunktion – siehe `DECISION_LOG.md`.

## Tenant-Isolation

Wie im übrigen Projekt zweistufig: zusammengesetzte DB-Fremdschlüssel
`(tenant_id, x_id) → (tenant_id, id)` auf allen neuen Tabellen
(`questionnaires`, `questionnaire_versions`, `questions`,
`question_versions`, `answer_options`, `visibility_conditions`) als primäre
Garantie, plus `withTenantScope()` (`src/server/tenant/scoped-client.ts`) als
Anwendungsebene. Jeder Service-Aufruf läuft über `db` aus
`src/server/db/client.ts`, das ohne aktiven `TenantContext`
(`runWithTenantContext()`) mit `MissingTenantContextError` verweigert.
Verifiziert in `tests/integration/questionnaire-engine.test.ts` (Fälle
30–32): Tenant B kann weder eine `ConsultationSession` von Tenant A lesen
noch Antworten dafür schreiben; eine neu gestartete Sitzung erhält immer die
`tenantId` aus dem aktiven Kontext.

## Nebenläufigkeitsstrategie

Drei unabhängige Mechanismen für drei unterschiedliche Race-Conditions:

1. **Erstantwort-Doppel-Request:** `saveAnswer()` ist bewusst nur für die
   erste Antwort einer Frage gedacht; ein zweiter `saveAnswer()`-Aufruf für
   dieselbe Frage schlägt sowohl an einem Anwendungscheck als auch am
   partiellen Unique-Index `customer_answers_one_active_per_question` fehl
   (`P2002` → `AnswerAlreadyExistsError`).
2. **Antwortänderung (Compare-And-Swap):** `changeAnswer()` erwartet
   `expectedAnswerVersion`. In einer Transaktion wird zuerst versucht, die
   aktive Zeile mit genau dieser Version zu deaktivieren
   (`UPDATE ... SET is_active = false WHERE ... AND answer_version =
$erwartet`); nur wenn genau eine Zeile betroffen war, wird die neue
   Antwort mit `answerVersion = $erwartet + 1` eingefügt. Sonst
   `StaleAnswerVersionError` – ein anderer Request hat die Antwort
   zwischenzeitlich bereits geändert.
3. **Abschluss-Rennen:** `completeQuestionnaire()` verwendet
   `updateMany({ where: { id, status: "IN_PROGRESS" } })` statt eines
   ungefilterten `update()`; betrifft der Aufruf `0` Zeilen (weil die
   Sitzung parallel bereits abgeschlossen/abgebrochen wurde), wird
   `QuestionnaireRunNotModifiableError` geworfen statt eine zweite
   `COMPLETED`-Transition stillschweigend zu erlauben.

Zusätzlich schützt der DB-Trigger `forbid_questionnaire_version_change()`
`ConsultationSession.questionnaireVersionId` gegen jede nachträgliche
Änderung – unabhängig von Nebenläufigkeit, als strukturelle
Unveränderlichkeitsgarantie.

## API- beziehungsweise Service-Schnittstellen

Alle Funktionen in `src/server/questionnaire/service.ts`, laufen unter
aktivem `TenantContext`:

| Funktion                                               | Zweck                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `startQuestionnaire(input)`                            | Neue `ConsultationSession` starten, passende `QuestionnaireVersion` fixieren            |
| `loadQuestionnaireState(consultationSessionId)`        | Sichtbaren Pfad, Antworten und Fortschritt einer bestehenden Sitzung laden              |
| `saveAnswer(input)`                                    | Erstantwort auf eine sichtbare Frage speichern                                          |
| `changeAnswer(input)`                                  | Bestehende Antwort per CAS ändern, Pfad neu berechnen, verdeckte Antworten deaktivieren |
| `recalculateVisiblePath(consultationSessionId)`        | Sichtbaren Pfad ohne Schreiboperation neu berechnen                                     |
| `getProgress(consultationSessionId)`                   | Nur die Fortschrittsübersicht liefern                                                   |
| `completeQuestionnaire(consultationSessionId)`         | Sitzung abschließen (siehe Abschlussbedingungen)                                        |
| `validateQuestionnaireVersion(questionnaireVersionId)` | Strukturelle Vorab-Prüfung einer Version vor Veröffentlichung (`ACTIVE`)                |
| `assertQuestionnaireVersionIsEditable(...)`            | Prüft, ob eine Version noch `DRAFT` (und damit inhaltlich änderbar) ist                 |

Ein- und Ausgabetypen (`QuestionForAnswering`, `QuestionnaireState`,
`StartQuestionnaireInput`, `SaveAnswerInput`, `ChangeAnswerInput`,
`AnswerWriteResult`, `CompleteQuestionnaireResult`) sind ebenfalls aus
`service.ts` exportiert.

## Fehlercodes

Alle Fehlerklassen erben von `QuestionEngineError`
(`src/server/questionnaire/errors.ts`) und sind per `instanceof`
unterscheidbar:

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

## Datenschutzgrenzen

- Antworten sind fachlich strukturierte Werte (Zahl, Datum, Auswahl,
  begrenzter Freitext) für eine Beratungssitzung, **kein**
  Kundenstammdaten-Objekt mit Klarnamen – konsistent mit dem in
  `DATA_MODEL.md` beschriebenen Trennungsprinzip.
- `AnalyticsEvent`- und `AuditLog`-Einträge zu Fragebogen-Ereignissen
  (`QUESTIONNAIRE_STARTED`, `QUESTIONNAIRE_COMPLETED`) enthalten
  ausschließlich IDs und Zählwerte (`consultationSessionId`,
  `questionnaireVersionId`, `answeredVisibleQuestions`,
  `totalVisibleQuestions`) – **niemals** die eigentlichen Antwortwerte.
  Verifiziert in `tests/integration/questionnaire-engine.test.ts`, Fall 36.
- `AnalyticsEvent.payload`/`AuditLog.metadata` bleiben zusätzlich durch die
  bereits in Phase 2B eingeführte Zod-Validierung (`event-payload-schemas.ts`)
  gegen versehentliche Klardaten abgesichert.
- Jeder Zugriff läuft mandantengescoped (siehe "Tenant-Isolation") – es gibt
  keinen Pfad, über den ein Mandant Antworten eines anderen Mandanten lesen
  oder verändern kann.

## Beispiele (ausschließlich synthetische Daten)

Alle Beispiele stammen aus `prisma/seed.ts` (Tenants `demotel-nord`/
`demotel-sued`) bzw. `tests/integration/questionnaire-engine.test.ts`.

**Einfache Pflichtfrage (BOOLEAN):**

```
Question "hat_streaming_bedarf" (sortOrder 1)
QuestionVersion: answerType = BOOLEAN, isRequired = true
```

**Bedingte Folgefrage (Sichtbarkeits-Branching):**

```
Question "bevorzugtes_streaming_paket" (sortOrder 8)
QuestionVersion: answerType = SINGLE_CHOICE
  AnswerOption[]: netflix, disney_plus, amazon_prime
VisibilityCondition:
  questionVersionId = <Version von "bevorzugtes_streaming_paket">
  targetQuestionId  = <Question-ID von "hat_streaming_bedarf">
  operator = EQUALS, comparisonValue = "true", combinator = AND
```

Solange `hat_streaming_bedarf` unbeantwortet oder `false` ist, taucht
`bevorzugtes_streaming_paket` weder im sichtbaren Pfad noch im Fortschritt
auf; ein `saveAnswer()`-Versuch dafür wird mit `QuestionNotVisibleError`
abgelehnt.

**Numerische Grenzen (INTEGER):**

```
Question "anzahl_sim_karten"
QuestionVersion: answerType = INTEGER, minValue = 1, maxValue = 10
```

Eine Antwort `integerValue = 0` oder `integerValue = 11` wird mit
`InvalidAnswerError` abgelehnt.

**Mehrfachauswahl mit Obergrenze (MULTIPLE_CHOICE):**

```
Question "gewuenschte_zusatzleistungen"
QuestionVersion: answerType = MULTIPLE_CHOICE, minSelections = 0, maxSelections = 2
  AnswerOption[]: geraeteschutz, auslandsflat, cloud_speicher
```

Eine Antwort mit allen drei Optionen wird mit `InvalidAnswerError`
abgelehnt ("Höchstens 2 Auswahl(en) erlaubt").

## Verwandte Dokumente

- [DATA_MODEL.md](DATA_MODEL.md) – Datenmodell inkl. Fragebogen-Tabellen
- [DECISION_LOG.md](DECISION_LOG.md) – Begründungen der Entscheidungen aus
  diesem Dokument
- [TEST_STRATEGY.md](TEST_STRATEGY.md) – Teststrategie der Fragen-Engine
- [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md) – Abgrenzung zur
  (nicht in Phase 3A implementierten) Empfehlungslogik
