# Entscheidungsprotokoll (Implementierungsphase)

Dieses Dokument hält technische Entscheidungen fest, die während der
Implementierung getroffen wurden und die nicht bereits durch die
Phase-1-Dokumente ([ARCHITECTURE.md](ARCHITECTURE.md),
[DATA_MODEL.md](DATA_MODEL.md) etc.) oder die Vorgaben des
ChatGPT-Projektleiters ("Prompt 2") festgelegt waren. Ziel: Nachvollziehbarkeit
für spätere Entwicklerinnen und Entwickler, warum etwas so und nicht anders
gebaut wurde.

## Geld als Integer in Minor-Units, niemals Float

**Entscheidung:** Alle Geldbeträge (`DealFinancialSnapshot`, Kommissionsmodelle,
Produktkosten) werden als `Int` in der kleinsten Währungseinheit (Cent)
gespeichert, begleitet von einem `currency Char(3)`-Feld (ISO 4217). Niemals
als JavaScript-`Float`/`Decimal`-Fließkommazahl.

**Warum:** Fließkommazahlen führen bei Geldbeträgen zu Rundungsfehlern
(z. B. `0.1 + 0.2 !== 0.3` in JavaScript), die sich bei Provisions- und
Preisberechnungen akkumulieren können. Ganzzahlige Minor-Units sind der
in der Branche etablierte Standard (vgl. Stripe, ISO-4217-Praxis).

## Mandantentrennung auf zwei unabhängigen Ebenen

**Entscheidung:** Primär über zusammengesetzte Datenbank-Fremdschlüssel
`(tenant_id, x_id) → (tenant_id, id)`, sekundär (defense in depth) über
einen Prisma Client Extension (`withTenantScope()`), der jede Query eines
mandantengebundenen Modells automatisch um `tenantId` ergänzt/validiert.

**Warum:** Die Datenbankebene ist die einzige Ebene, die nicht durch einen
vergessenen `where`-Filter im Anwendungscode umgangen werden kann – sie ist
daher die primäre Garantie. Die Anwendungsebene fängt zusätzlich Fälle ab,
die keinen Fremdschlüssel-Bezug haben (z. B. ein reiner `findUnique` per ID
ohne Verknüpfung zu einer Elterntabelle) und macht Fehler für
Entwicklerinnen und Entwickler sofort sichtbar (lauter Fehler statt
stillem Cross-Tenant-Leak).

**Alternative verworfen:** Ausschließlich Anwendungsebene (z. B. nur ein
ORM-Mixin/eine Middleware ohne DB-Constraints) – verworfen, weil ein
einzelner vergessener Filter dann direkt zu einem Datenleck zwischen
Mandanten führen würde, ohne dass die Datenbank dies verhindert.

## Prisma Client Extensions statt Middleware

**Entscheidung:** `client.$extends(...)` mit `query.$allModels.$allOperations`
statt des (in Prisma 5+ als deprecated markierten) `client.$use()`-Middleware-
Mechanismus.

**Warum:** Middleware ist in aktuellen Prisma-Versionen der veraltete Pfad;
Extensions sind der empfohlene, langfristig unterstützte Mechanismus für
genau diesen Anwendungsfall (Query-Argumente vor Ausführung modifizieren).

## `buildScopedArgs()` als reine, isolierte Funktion

**Entscheidung:** Die eigentliche Scoping-Logik (`src/server/tenant/scoped-client.ts`)
ist als reine Funktion `buildScopedArgs()` implementiert, die nur Objekte
entgegennimmt und zurückgibt – unabhängig vom eigentlichen Prisma-Client.
Der Client-Extension-Wrapper (`withTenantScope()`) ist nur eine dünne Hülle
darum.

**Warum:** Dadurch ist die sicherheitskritische Logik (welche Query-Form
bekommt welchen Tenant-Filter, welche Schreibversuche werden abgelehnt)
vollständig durch Unit-Tests ohne Datenbank und ohne generierten
Prisma-Client abdeckbar (`tests/unit/tenant-scope.test.ts`, 47 Testfälle).
Das war in der Sandbox dieser Sitzung zusätzlich notwendig, da kein
`prisma generate` möglich war – ist aber unabhängig davon die robustere
Testarchitektur.

## Ausnahmeliste statt Einschlussliste für globale Modelle

**Entscheidung:** `withTenantScope()` pflegt eine explizite Liste von
Modellen OHNE `tenantId` (`Tenant`, `Permission`, `Provider`), für die keine
Filterung stattfindet. Alle anderen Modelle werden automatisch als
mandantengebunden behandelt.

**Warum:** Wird dem Schema künftig ein neues mandantengebundenes Modell
hinzugefügt, greift der Schutz dafür automatisch, ohne dass diese Datei
angepasst werden muss. Ein neues globales Modell (ohne `tenantId`) muss
dagegen bewusst eingetragen werden – andernfalls schlägt jeder Zugriff
darauf sofort und laut fehl (da `tenantId` kein gültiges Feld wäre), statt
still falsch gefiltert zu werden.

## AsyncLocalStorage für Tenant-Kontext

**Entscheidung:** `src/server/tenant/context.ts` nutzt Node.js'
eingebautes `AsyncLocalStorage` statt z. B. eines globalen Singletons oder
manueller Parameterdurchreichung durch jede Funktionssignatur.

**Warum:** Jede Anfrage (und alle davon abgeleiteten asynchronen Aufrufe)
braucht einen isolierten, nicht überschreibbaren Kontext – insbesondere
bei parallel laufenden Requests in Next.js. `AsyncLocalStorage` ist dafür
der Node.js-native Mechanismus und wurde in
`tests/unit/tenant-context.test.ts` explizit gegen parallele/verschachtelte
Nutzung getestet.

## npm als verbindlicher Paketmanager (Phase 2B, endgültig)

**Entscheidung:** npm ist der verbindliche Paketmanager für dieses Projekt –
für lokale Entwicklung, CI und alle Skripte. `package.json` deklariert
`"packageManager": "npm@10.9.4"`, `package-lock.json` ist die einzige
committete Lockdatei. Es gibt kein offenes "Rückumstieg auf pnpm"-Vorhaben
mehr; eine ursprünglich in Phase 2 nur als Sandbox-Workaround dokumentierte
Abweichung wurde in Phase 2B zur endgültigen Festlegung erhoben.

**Warum:** pnpm führte in der Entwicklungs-Sandbox in Kombination mit
Datei-/Symlink-Restriktionen des gemounteten Projektordners zu
Installationsfehlern, während npm durchgängig verifiziert werden konnte
(lokal wie in CI). Da kein funktionaler Vorteil von pnpm für dieses Projekt
identifiziert wurde, der einen Wechsel rechtfertigen würde, wird die
pragmatisch gewählte Lösung zur dauerhaften Festlegung erklärt statt als
technische Schuld offengehalten. Siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) für den historischen
Kontext.

## `/review`-Seite als `force-dynamic`

**Entscheidung:** `src/app/review/page.tsx` setzt
`export const dynamic = "force-dynamic";`.

**Warum:** Die Seite soll immer den aktuellen Stand der Seed-Daten zeigen
(kein gecachtes/statisches Snapshot), und `next build` soll nicht von einer
zur Build-Zeit erreichbaren Datenbank abhängen.

## Fehlende Array-Defaults in zwei Schema-Feldern nachgezogen

**Entscheidung:** `CustomerAnswer.choiceValues` und
`RecommendationItem.exclusionReasonCodes` erhielten nachträglich
`@default([])`.

**Warum:** Beim tatsächlichen Ausführen des Seed-Datenflusses gegen eine
echte (eingebettete) Postgres-Instanz schlug die Insertion fehl
(`null value ... violates not-null constraint`), da das Seed-Skript diese
Felder für bestimmte Antworttypen (boolesch/numerisch) bewusst wegließ. Der
Fehler wurde durch tatsächliche Ausführung gefunden, nicht durch reines
Code-Review – siehe [TEST_STRATEGY.md](TEST_STRATEGY.md) zum Prinzip
"Verifikation statt Behauptung".

## Phase 3A: `CustomerAnswer` als Append-only-Antwort-Historie statt In-Place-Update

**Entscheidung:** Eine Antwortänderung überschreibt nie eine bestehende
`CustomerAnswer`-Zeile, sondern fügt eine neue ein. Genau eine Zeile pro
`(tenantId, consultationSessionId, questionVersionId)` darf `isActive = true`
haben (durchgesetzt über einen partiellen Unique Index
`customer_answers_one_active_per_question`). Der Service-Layer ändert eine
Antwort per Compare-And-Swap in einer Transaktion: zuerst
`UPDATE ... SET is_active = false WHERE ... AND answer_version = $erwartet`,
und nur wenn genau eine Zeile betroffen war, wird die neue Zeile mit
`answerVersion = $erwartet + 1` eingefügt; sonst `StaleAnswerVersionError`.

**Warum:** Ein reines `isActive`/`answerVersion`-Feldpaar mit
In-Place-Update hätte den vorherigen Antwortwert beim Überschreiben
verloren – es gäbe keine echte Historie, nur den letzten Stand. Das wurde
vom ChatGPT-Projektleiter in der Prüfung des Phase-3A-Implementierungsplans
bemängelt und mit dem Append-only-Muster korrigiert.

**Bewusste Abweichung:** Anders als bei den anderen historischen/finanziellen
Tabellen (`deal_financial_snapshots`, `audit_logs`,
`configuration_changes`, `analytics_events`) bekommt `customer_answers`
**keinen** `forbid_update_delete()`-Trigger. Der CAS-Flip von `is_active`
ist ein kontrolliertes, beabsichtigtes UPDATE durch den Service-Layer
selbst (nicht durch einen externen/fremden Zugriff) und muss möglich
bleiben; ein blanker Append-only-Trigger würde die eigene
CAS-Logik blockieren.

## Phase 3A: `ConsultationSession.questionnaireVersionId` per DB-Trigger unveränderlich

**Entscheidung:** Zusätzlich zur Pflichtspalte (`NOT NULL`, gesetzt bei
Sitzungsstart) verhindert ein `BEFORE UPDATE`-Trigger
(`forbid_questionnaire_version_change()`) jede nachträgliche Änderung des
Werts.

**Warum:** Reine Konvention auf Service-Ebene ("wir ändern das Feld
einfach nie") wurde vom ChatGPT-Projektleiter als unzureichend bewertet,
da sie keinen Schutz gegen zukünftigen, versehentlichen Code bietet. Die
DB-Ebene ist – wie bei der Mandantentrennung oben – die einzige Ebene, die
nicht durch vergessenen Anwendungscode umgangen werden kann.

**Migrationsmodell-Hinweis:** Dieses Projekt generiert pro Phase eine
einzige, frische init-Migration (siehe Abschnitt "npm-vs-pnpm" oben zum
Sandbox-Kontext); es gibt keinen inkrementellen `prisma migrate
dev`-Verlauf gegen eine befüllte Produktions-DB. Die Spalte wurde daher
direkt als `NOT NULL` modelliert statt über die klassische
Drei-Schritt-Sequenz (ADD COLUMN nullable → Backfill-UPDATE → SET NOT
NULL). Die korrekte Sequenz für eine echte inkrementelle Migration ist als
Kommentar in `migration.sql` (Abschnitt "Phase 3A", Punkt 5) dokumentiert.

## Phase 3A: `CustomerAnswer.integerValue` statt geteiltem `numberValue: Float`

**Entscheidung:** Das bisherige `numberValue Float?`-Feld wurde durch zwei
getrennte Felder ersetzt: `integerValue Int?` (für `AnswerType.INTEGER`)
und `decimalValue Decimal? @db.Decimal(18,4)` (für `AnswerType.DECIMAL`,
bereits mit dem Projektleiter abgestimmt).

**Warum:** Der neue `AnswerType`-Enum unterscheidet `INTEGER` und
`DECIMAL` explizit als getrennte Antworttypen. Ein gemeinsames
`Float`-Feld für beide hätte für `INTEGER`-Antworten unnötig
Fließkomma-Ungenauigkeit eingeführt und wäre inkonsistent mit dem
projektweiten Grundsatz "kein Float für Werte, bei denen Genauigkeit
zählt" (vgl. Geldbeträge oben). `Int` ist für ganzzahlige Antworten
(z. B. "Wie viele SIM-Karten benötigen Sie?") exakt und einfacher zu
validieren als `Decimal`.

## Phase 3A: `QuestionVersion` um Validierungsgrenzen erweitert + Transpiler-Bug behoben

**Entscheidung:** `QuestionVersion` erhält vier neue optionale Felder:
`minValue`/`maxValue` (`Decimal(18,4)`, für `INTEGER`/`DECIMAL`),
`maxLength` (`Int`, für `SHORT_TEXT`), `minSelections`/`maxSelections`
(`Int`, für `MULTIPLE_CHOICE`). NULL bedeutet "kein Limit".

**Warum:** Der Phase-3A-Auftrag verlangt explizit serverseitige Grenzwerte
("Mindest- und Höchstwert für numerische Antworten", "maximale Länge für
SHORT_TEXT", "Mindest- und Höchstauswahl bei MULTIPLE_CHOICE"). Das
bestehende Schema hatte dafür keine Felder – ohne sie könnte die
Fragen-Engine diese Vorgabe nicht serverseitig durchsetzen, nur clientseitig
behaupten.

**Zusätzlich gefunden und behoben:** Beim Verifizieren der neuen
`Decimal(18,4)`-Felder gegen die generierte Migration fiel auf, dass
`scripts/schema_to_sql.py` die Präzisions-/Skalenangabe von
`@db.Decimal(p,s)` verlor und stattdessen ein unbegrenztes `NUMERIC` erzeugte
– ein vorbestehender Bug, unabhängig von Phase 3A, der bereits die
Phase-2B-Felder `BaselineMeasurement.metricValue` (`Decimal(18,4)`) und
`ConsultationSession.dataCompletenessScore` (`Decimal(5,4)`) betraf. Ursache:
`parse_attrs()` speichert den Klammerinhalt eines Attributs ohne die
Klammern selbst (z. B. `"18, 4"` statt `"(18, 4)"`), die Typzuordnung in
`sql_type()` erwartete aber ein `db_attr`, das mit `"decimal("` beginnt.
Behoben durch erneutes Einklammern beim Zusammenbau von `db_attr`. Nach dem
Fix erzeugt der Transpiler korrekt `NUMERIC(18,4)` bzw. `NUMERIC(5,4)` für
alle betroffenen Felder; gegen die PGlite-Test-DB erneut verifiziert (55
Tabellen, 84 Fremdschlüssel, keine Fehler).

## Phase 3A: Fixierung der `QuestionnaireVersion` beim Beratungsstart

**Entscheidung:** `startQuestionnaire()` löst die passende
`QuestionnaireVersion` einmalig zum Startzeitpunkt (`input.at ?? new
Date()`) auf und schreibt sie fest in `ConsultationSession.
questionnaireVersionId`. Jede spätere Operation auf derselben Sitzung
(`loadQuestionnaireState()`, `saveAnswer()`, `changeAnswer()`,
`completeQuestionnaire()`) verwendet ausschließlich diese fixierte
`questionnaireVersionId` zusammen mit `session.startedAt` – nie "jetzt" und
nie eine neuere `ACTIVE`-Version.

**Warum:** Reproduzierbarkeit. Wird während einer laufenden Beratung eine
neue `QuestionnaireVersion` veröffentlicht (z. B. weil Fragen redaktionell
angepasst wurden), darf sich der Fragenkatalog einer bereits begonnenen
Sitzung nicht rückwirkend ändern – sonst könnten mitten in der Beratung
neue Pflichtfragen auftauchen oder bereits gegebene Antworten plötzlich zu
nicht mehr existierenden Fragen gehören. Siehe
[QUESTION_ENGINE.md](QUESTION_ENGINE.md), Abschnitt "Versionsauflösung".
Verifiziert in `tests/integration/questionnaire-engine.test.ts`, Fälle 1–2.

## Phase 3A: Umgang mit nicht mehr sichtbaren Antworten (Deaktivieren statt Löschen)

**Entscheidung:** Wird eine zuvor sichtbare, beantwortete Folgefrage durch
eine Antwortänderung unsichtbar, wird ihre aktive `CustomerAnswer` auf
`isActive = false` gesetzt statt gelöscht. Wird sie später wieder sichtbar,
muss sie erneut beantwortet werden – der alte Wert wird nicht automatisch
reaktiviert.

**Warum:** Konsistent mit dem Append-only-Prinzip oben (keine Antwort wird
je physisch gelöscht) und mit der Fortschritts-/Abschlusslogik, die nur
aktive Antworten zählt. Automatische Reaktivierung wurde bewusst verworfen,
weil ein alter Wert unter neuen Umständen (z. B. nach mehreren
Zwischenänderungen) nicht mehr zuverlässig als weiterhin gültig gelten
kann – eine explizite Neubeantwortung ist die konservativere, weniger
fehleranfällige Wahl. Siehe [QUESTION_ENGINE.md](QUESTION_ENGINE.md),
Abschnitt "Umgang mit nicht mehr sichtbaren Antworten". Verifiziert in
`tests/integration/questionnaire-engine.test.ts`, Fälle 20–22.

## Phase 3A: Erlaubte Bedingungsoperatoren pro Zielfragetyp

**Entscheidung:** Welcher `VisibilityOperator` für welchen `AnswerType` der
Zielfrage zulässig ist, ist als statische Tabelle
(`OPERATORS_BY_ANSWER_TYPE` in `visibility.ts`) festgelegt und wird sowohl
zur Laufzeit als auch vorab bei `validateQuestionnaireVersion()` geprüft.
`DECIMAL` und `DATE` bekommen bewusst **kein** `IN`/`NOT_IN` (im Unterschied
zu `INTEGER`), `SHORT_TEXT` bekommt **gar keinen** Operator.

**Warum:** `IN`/`NOT_IN` vergleicht gegen eine kommagetrennte Werteliste;
bei Dezimalzahlen und Daten ist die Formatierung dieser Liste (Trennzeichen
vs. Dezimaltrennzeichen, Zeitzonen) fehleranfällig genug, dass ein
begrenzter, eindeutig auswertbarer Operatorsatz (Vergleichsoperatoren
einzeln) vorgezogen wurde. Für `SHORT_TEXT` siehe das eigene "Verbot von
Freitext"-Kapitel unten. Siehe
[QUESTION_ENGINE.md](QUESTION_ENGINE.md), Abschnitt "Unterstützte
Operatoren".

## Phase 3A: Verbot von Freitext (`SHORT_TEXT`) als Bedingungsziel

**Entscheidung:** Eine `VisibilityCondition`, deren `targetQuestionId` auf
eine `SHORT_TEXT`-Frage zeigt, ist ein Konfigurationsfehler – zur Laufzeit
wirft `evaluateSingleCondition()` einen Fehler, strukturell wird das bereits
bei `validateQuestionnaireVersion()`/`validateVisibilityGraph()` abgefangen
(`OPERATORS_BY_ANSWER_TYPE.SHORT_TEXT` ist eine leere Menge).

**Warum:** Freitext ist nicht normalisiert (Groß-/Kleinschreibung,
Tippfehler, Synonyme) und daher als Grundlage einer deterministischen
Sichtbarkeitsentscheidung ungeeignet – ein Vergleich à la "sichtbar, wenn
Freitext-Antwort gleich 'Telekom'" wäre unzuverlässig und schwer wartbar.
Wo eine bedingte Verzweigung fachlich nötig ist, muss die entsprechende
Frage stattdessen als `SINGLE_CHOICE`/`BOOLEAN` modelliert werden.

## Phase 3A: Abschluss ist endgültig, keine Wiederöffnung in dieser Phase

**Entscheidung:** `completeQuestionnaire()` setzt `ConsultationSession.
status` auf `COMPLETED`. Ab diesem Zeitpunkt lehnt `assertSessionModifiable()`
jeden weiteren `saveAnswer()`/`changeAnswer()`-Aufruf mit
`QuestionnaireRunNotModifiableError` ab. Es gibt in Phase 3A **keine**
Service-Funktion, die eine `COMPLETED`- oder `ABANDONED`-Sitzung wieder auf
`IN_PROGRESS` zurücksetzt.

**Bewusst vorbereitet, aber nicht angebunden:** `status.ts::
deriveQuestionnaireRunStatus()` leitet einen zusätzlichen Zustand
`NEEDS_REVIEW` ab (aktive Antwort mit `answeredAt` nach `session.endedAt`).
Dieser Zustand ist über die aktuelle Service-API nicht erreichbar (da
`changeAnswer()` nach Abschluss ohnehin blockiert ist) – er ist bewusst als
Vorbereitung für eine mögliche spätere, explizite
Korrektur-/Wiederöffnungsfunktion modelliert, ohne dass Phase 3A diese
Funktion bereits ausliefert.

**Warum:** Der Phase-3A-Auftrag verlangt eine klare, prüfbare
Abschlusslogik, aber keine Wiederöffnung. Statt ein zusätzliches,
potenziell divergierendes Statusfeld einzuführen, wird `NEEDS_REVIEW` rein
abgeleitet berechnet (siehe Kommentar in `status.ts`) – falls eine spätere
Phase eine Korrekturfunktion einführt, kann sie auf dieser Ableitung
aufbauen, ohne das bestehende Schema zu ändern.

## Phase 3A: Nebenläufigkeitskontrolle – drei getrennte Mechanismen statt einem generischen Lock

**Entscheidung:** Statt eines einzelnen generischen Sperr-/Locking-Mechanismus
für die gesamte Sitzung werden drei unabhängige, jeweils minimale
Mechanismen für drei unterschiedliche Race-Conditions eingesetzt:
Idempotenzschutz für Erstantworten (Unique-Index + Anwendungscheck →
`AnswerAlreadyExistsError`), Compare-And-Swap für Antwortänderungen
(`answerVersion` + bedingtes `UPDATE` → `StaleAnswerVersionError`), und
gefiltertes `updateMany()` für den Abschluss (→
`QuestionnaireRunNotModifiableError` bei 0 betroffenen Zeilen).

**Warum:** Ein sitzungsweiter Lock (z. B. `SELECT ... FOR UPDATE` über die
gesamte Sitzungsdauer) würde parallele, voneinander unabhängige
Antwortänderungen auf unterschiedliche Fragen unnötig serialisieren und wäre
bei einer mehrminütigen Beratungssitzung ein Langzeit-Lock-Risiko. Die
gewählten, feingranularen Mechanismen schützen exakt die Stellen, an denen
tatsächlich ein Konflikt entstehen kann (dieselbe Frage, derselbe
Status-Übergang), ohne unbeteiligte Operationen zu blockieren. Siehe
[QUESTION_ENGINE.md](QUESTION_ENGINE.md), Abschnitt
"Nebenläufigkeitsstrategie". Verifiziert in
`tests/integration/questionnaire-engine.test.ts`, Fälle 34–35.

## Phase 3A: Klare Trennung zwischen Fragen-Engine und späterer Empfehlungs-Engine

**Entscheidung:** `completeQuestionnaire()` und alle übrigen
Fragen-Engine-Funktionen erzeugen ausschließlich `AnalyticsEvent`- und
`AuditLog`-Einträge zum Sitzungsverlauf – **keine** `Recommendation`,
**keine** `SalesOpportunity`, **keine** `DetectedNeed`. Diese Modelle
existieren zwar bereits im Schema (aus der ursprünglichen Datenmodell-
Planung), werden aber von keinem Code-Pfad der Fragen-Engine befüllt.

**Warum:** Ausdrückliche Stop-Vorgabe aus `PHASE_3A_STARTPROMPT.md`: die
Empfehlungs-Engine ist bewusst eine spätere, eigenständige Phase. Eine
vermischte Implementierung (Fragen-Engine ruft "nebenbei" schon
Empfehlungslogik auf) würde die Abnahme dieser Phase erschweren und die
spätere Empfehlungs-Engine an Annahmen binden, die noch nicht mit dem
Projektleiter abgestimmt sind. Verifiziert in
`tests/integration/questionnaire-engine.test.ts`, Fall 25.

## Phase 3B: Idempotenz-Fingerprint verwendet `answerId`, nicht `questionId`

**Entscheidung:** `computeEvaluationFingerprint()`
(`src/server/recommendation/fingerprint.ts`) kanonisiert `answers` je
`CustomerAnswer.id` (`answerId`), nicht je `QuestionVersion`/`Question`-ID.
Antwortwerte werden dabei strikt gemäß `QuestionVersion.answerType` über
`canonicalizeAnswerValue()` normalisiert (BOOLEAN → `true`/`false`,
INTEGER/DECIMAL → normalisierter String, SINGLE_CHOICE → erster Wert,
MULTIPLE_CHOICE → sortiertes Array, DATE → Rohwert, SHORT_TEXT → wirft
einen Fehler, da Freitext laut Phase 3A für Bedingungen/Fingerprints
verboten ist) statt über die Attribute-Registry.

**Warum:** Der Fingerprint muss exakt die Datensätze widerspiegeln, die
tatsächlich in die Auswertung eingeflossen sind. `answerId` identifiziert
eine konkrete, unveränderliche `CustomerAnswer`-Zeile (append-only seit
Phase 3A); eine Kanonisierung über `questionId` würde bei einer
Antwortänderung (neue `CustomerAnswer`-Zeile, alte auf `isActive = false`)
denselben Fingerprint-Schlüssel wiederverwenden und könnte so eine
tatsächlich geänderte Antwort mit dem alten Fingerprint verwechseln. Die
Attribute-Registry wurde bewusst nicht wiederverwendet (Korrekturpunkt 2,
Revision 3.2), weil Antworten keine Attribute sind — Attribute gelten für
`ProductVersion`/`ConsultationSession`, während Antworten über ihren
eigenen `AnswerType` bereits typisiert sind; eine zusätzliche
Registry-Zuordnung hätte nur eine parallele, potenziell abweichende
Typisierung geschaffen.

## Phase 3B: `CommissionModelVersion`-Tie-Break bei mehreren gültigen Versionen

**Entscheidung:** `buildResolveCommission()` (`service.ts`) wählt bei
mehreren zum Auswertungszeitpunkt gültigen `CommissionModelVersion`-Zeilen
für dasselbe `productId` (das Schema erzwingt hierfür keine Eindeutigkeit)
deterministisch die Zeile mit der lexikographisch kleinsten `id`.

**Warum:** Der reguläre Fall ist genau eine gültige Version je Produkt zum
Zeitpunkt X (analog zum `RuleSetVersion`-`EXCLUDE`-Constraint, der dies für
Regelsets bereits auf DB-Ebene erzwingt); für `CommissionModelVersion`
existiert bewusst kein äquivalenter DB-Constraint (Provisionsmodelle können
sich pro Produkt aus fachlichen Gründen zeitlich überschneiden, z. B.
Sonderaktionen). Damit die Fingerprint-Berechnung und die tatsächliche
Provisionsauflösung trotzdem reproduzierbar bleiben, braucht es einen
festen, dokumentierten Tie-Break statt eines von der Abfragereihenfolge der
Datenbank abhängigen "ersten Treffers". Lexikographisch kleinste `id` ist
willkürlich, aber stabil und ohne zusätzliches Sortierfeld umsetzbar.

## Phase 3B: `commissionModelVersionId`-Pinning ausschließlich auf `RecommendationRationale`

**Entscheidung:** `RecommendationItem` besitzt **kein**
`commissionModelVersionId`-Feld. Das Pinning existiert ausschließlich auf
`RecommendationRationale.commissionModelVersionId` (nullable, `null` für
nicht provisionsbasierte Rationale-Zeilen), zusammen mit dem numerischen
Snapshot `commissionValueMinor: Int?`.

**Warum:** Ein einzelnes `RecommendationItem` kann mehrere
provisionsbasierte `RecommendationRationale`-Beiträge mit potenziell
unterschiedlichen `CommissionModelVersion`-Pins haben (mehrere
`PrioritizationRule`-Treffer mit `commissionRequired = true`). Eine frühere
Planungsrevision (3.1) hatte zusätzlich ein Item-weites Feld vorgesehen und
für den Mehrdeutigkeitsfall eine Konvention ("zuletzt ausgewertete bzw.
gewichtsstärkste Regel") definiert – vom Projektleiter (ChatGPT) als
fachlich nicht eindeutig zurückgewiesen ("zuletzt ausgewertet" und
"gewichtsstärkste" sind zwei unterschiedliche Regeln). Ein denormalisiertes
Item-Feld würde eine fachlich nicht existierende Eindeutigkeit vortäuschen.
Braucht eine spätere Oberfläche eine Item-weite Übersicht, wird sie zur
Lesezeit über eine `DISTINCT`-Abfrage der zugehörigen
`RecommendationRationale`-Zeilen gebildet, nicht als gespeicherter
Einzelwert. Siehe `PHASE_3B_IMPLEMENTATION_PLAN.md`, Abschnitt 3.8.

## Phase 3B: Integrationstest-Fixture mit einer gemeinsamen "rec-a"-Basis statt Fixture pro Testfall

**Entscheidung:** `tests/integration/recommendation-engine.test.ts` baut in
`beforeAll` einen einzigen, umfangreichen Tenant-Fixture ("rec-a": zwei
Produkte BASIC/PREMIUM, ein vollständiges Regelset mit allen vier
Regeltypen) auf, den die meisten Positivfälle (vollständige Auswertung,
Idempotenz, Nebenläufigkeit, Ausschluss, Cross-Selling) gemeinsam nutzen.
Nur die vier Negativfälle, die jeweils eine ganz bestimmte, frühe
Abbruchbedingung isolieren sollen (`InsufficientAnswerDataError`,
`RuleSetNotConfiguredError`, `NoValidProductVersionError`, sowie
`SessionNotEvaluableError` auf einer `COMPLETED`-Session der "rec-a"-Basis),
bekommen eigene, bewusst minimale Tenant-Fixtures.

**Warum:** `evaluate()` prüft mehrere Vorbedingungen in fester Reihenfolge
(siehe Abschnitt 5 des Implementierungsplans); ein Test, der z. B.
`InsufficientAnswerDataError` prüfen will, darf kein RuleSet und keine
Produkte anlegen müssen, weil diese Prüfung ohnehin vor jeder RuleSet-/
Produktauflösung greift – ein vollständiges Fixture hätte hier nur
unnötigen Testaufwand ohne zusätzlichen Aussagewert erzeugt. Umgekehrt
vermeidet die gemeinsame "rec-a"-Basis für die Positivfälle Duplikation von
Regel-/Produktaufbau über sechs Testfälle hinweg. Analog zum
"rec-a"/"rec-b"-Muster aus `tests/integration/questionnaire-engine.test.ts`
(Tenant-Isolationstest).

## Phase 3B: P2002-Recovery-Zweig ohne Nebenläufigkeitssimulation getestet

**Entscheidung:** Der Recovery-Zweig in `evaluate()` (bei einer
`P2002`-Unique-Constraint-Verletzung auf
`(consultationSessionId, evaluationFingerprint)` wird erneut per `SELECT`
nach einer bereits existierenden `Recommendation` gesucht; wird sie
gefunden, wird sie zurückgegeben, sonst `RecommendationConsistencyError`
geworfen) wird im Integrationstest über **echte** Nebenläufigkeit
(`Promise.all()` mit zwei parallelen `evaluate()`-Aufrufen auf derselben
Session) geprüft, nicht über eine künstlich injizierte, deterministisch
ausgelöste `P2002`-Fehlersimulation.

**Warum:** Eine deterministische Simulation (z. B. Mocken des
Prisma-Clients, um bei einem gezielten Aufruf einen `P2002`-Fehler
zurückzugeben) hätte den Produktionscode um Testbarkeits-Seams erweitern
müssen, die außerhalb von Tests keinen Zweck haben. Da eine echte
Postgres-Instanz (CI-Service-Container) zur Verfügung steht, prüft der
`Promise.all()`-Ansatz denselben Codepfad unter realistischeren
Bedingungen: beide parallelen Aufrufe erzeugen denselben Fingerprint, genau
einer gewinnt den `INSERT`, der andere durchläuft den echten
`P2002`-Recovery-Zweig der Datenbank. Der Test prüft dabei nur das
beobachtbare Ergebnis (ein Datensatz, beide Aufrufe liefern dieselbe
`Recommendation`-ID), nicht den internen Kontrollfluss – der reine
Fehlerfall "P2002, aber Retry-`SELECT` findet nichts"
(`RecommendationConsistencyError`) bleibt dadurch ungetestet und ist als
bekannte Lücke dokumentiert (siehe `PHASE_3B_IMPLEMENTATION_PLAN.md`,
Abschnitt 11 – ein solcher Zustand deutet laut Planung auf Datenkorruption
oder einen Fingerprint-Berechnungsfehler hin, nicht auf ein reguläres
Race-Verhalten, und lässt sich ohne Test-Seam im Produktionscode nicht
gezielt provozieren).

## Phase 5: Nicht-modales "Embedded Panel"-Muster statt `<dialog>`-Modals

**Entscheidung:** Wiederkehrende UI-Elemente, die zusätzliche Details oder
Aktionen zu einer Empfehlung/Sitzung anzeigen (`RationaleDrawer`,
`OutcomeDialog`, `OpportunityCard`, `AbandonConsultationButton`), werden
als nicht-modale, eingebettete Panels statt als `<dialog>`-Modals
umgesetzt. Auf Mobil/Tablet-Hochformat wird `RationaleDrawer` zu einem
fixierten Bottom-Sheet mit Scrim (siehe AP11), bleibt aber weiterhin kein
echtes Modal (kein Fokus-Trap, der die übrige Seite blockiert).

**Warum:** Der Mitarbeiter soll während der Beratung jederzeit den Bezug
zu den übrigen, gleichzeitig sichtbaren Empfehlungskarten behalten
können. Ein echtes Modal würde die restliche Seite verdecken/blockieren
und den Vergleich mehrerer Empfehlungen erschweren – siehe
`PHASE_5_IMPLEMENTATION_PLAN.md`, Abschnitt 4.7.

## Phase 5: Kein Freitext für Ablehnungs-/Abbruchgründe

**Entscheidung:** Sowohl `OutcomeDialog` (Ablehnung einer Empfehlung) als
auch `AbandonConsultationButton` (Beratungsabbruch) bieten ausschließlich
eine feste, kleine Menge strukturierter Gründe/Codes zur Auswahl an –
kein freies Textfeld.

**Warum:** Konsistent mit dem seit Phase 3A geltenden Grundsatz "kein
Freitext als Grundlage einer strukturierten, auswertbaren Entscheidung"
(siehe Abschnitt "Phase 3A: Verbot von Freitext" oben) sowie mit
[PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md): Freitext birgt das
Risiko, dass personenbezogene/sensible Angaben unbeabsichtigt in
Analytics-Auswertungen landen. Strukturierte Codes sind zudem
konsistent auswertbar (KPIs/Filialvergleich), während Freitext das nicht
wäre.

## Phase 5: Abschluss und Abbruch einer Beratungssitzung sind endgültig

**Entscheidung:** Sowohl `completeConsultation()` als auch
`abandonConsultation()` sind endgültige, nicht rückgängig machbare
Zustandsübergänge (analog zur Phase-3A-Entscheidung "Abschluss ist
endgültig" oben). Es gibt in Phase 5 keine Service-Funktion, die eine
`COMPLETED`- oder `ABANDONED`-Sitzung zurücksetzt. Beide Aktionen sind
über eine zweistufige Bestätigung in der UI abgesichert, um versehentliche
Auslösung zu verhindern.

**Warum:** Konsistent mit dem append-only-/Unveränderlichkeits-Grundsatz,
der das Projekt seit Phase 3A durchzieht. Eine Wiedereröffnungsfunktion
würde zusätzliche Zustandsübergänge und Testfälle erfordern, ohne dass ein
fachlicher Bedarf dafür bereits nachgewiesen ist; siehe neu identifiziertes
Risiko in [RISK_REGISTER.md](RISK_REGISTER.md), Abschnitt "Phase 5".

## Phase 5: Dev-Auth-Mechanismus bewusst minimal und explizit nicht produktionsreif

**Entscheidung:** Der in AP3 eingeführte Authentifizierungsmechanismus
(einfache Auswahl eines synthetischen Mitarbeiters ohne Passwort/Session-
Sicherheitsmerkmale) dient ausschließlich dazu, `runWithTenantContext()`
pro Request mit einem echten Mitarbeiter-/Mandantenbezug zu befüllen und
die übrige UI durchgängig testbar zu machen.

**Warum:** Ein vollwertiger, produktionstauglicher Auth-Mechanismus
(Passwort-Hashing, Session-Management, ggf. SSO) war ausdrücklich nicht
Teil des Phase-5-Auftrags (Fokus: Mitarbeiter-UI-Qualität) und hätte den
Umfang erheblich vergrößert, ohne für den MVP-Test (AP15, interne
Mitarbeiter, synthetische Daten) notwendig zu sein. Verbindlich
dokumentiert als Einschränkung in [CONSULTATION_UI.md](CONSULTATION_UI.md)
und [RISK_REGISTER.md](RISK_REGISTER.md), damit dies vor einem echten
Produktivbetrieb nicht übersehen wird.

## Phase 9 AP9: RuleSetVersion-Auswahl auf Auswertungszeitpunkt korrigiert; ProductVersion/CommissionModelVersion bewusst weiter auf Session-Start gepinnt

**Befund:** `evaluate()` (`src/server/recommendation/service.ts`, seit
Phase 3B) verwendete für alle vier zeitabhängigen Konfigurationsquellen
(`QuestionVersion`, `RuleSetVersion`, `ProductVersion`,
`CommissionModelVersion`) einheitlich einen einzigen Zeitpunkt
`atTime = session.startedAt`. Für `RuleSetVersion` war das ein
vorbestehender Korrektheitsfehler: `loadActiveRuleSetVersion()` filtert
auf `validFrom <= atTime AND (validTo IS NULL OR validTo > atTime)`. Eine
`RuleSetVersion`, die nach Session-Start per Publish EXPIRED wird (Phase 9
AP2/AP5), erfüllt diese Bedingung für `atTime = session.startedAt`
weiterhin (`validTo` liegt ja NACH dem Session-Start) – eine erneute
Auswertung derselben, noch laufenden Session verwendete dadurch dauerhaft
die zum Session-Start aktive, ggf. längst abgelöste `RuleSetVersion`, nie
die tatsächlich aktuell aktive. Das widersprach der Architekturentscheidung
"RuleSet-Version = pro Evaluation aktueller Snapshot" und wurde erst durch
den in Phase 9 eingeführten echten Publish-Workflow praktisch relevant.
Der Befund wurde vor jeder Änderung mit dem ChatGPT-Projektleiter
abgestimmt (verbindliche Vorgabe, siehe
[[feedback_chatgpt_massnahmen_abstimmung]]).

**Entscheidung (ChatGPT-Vorgabe 2026-08-18):**

- `RuleSetVersion`-Auflösung verwendet ab sofort den tatsächlichen
  Auswertungszeitpunkt (`ruleSetAt = new Date()`), nicht mehr
  `session.startedAt`. Jede `evaluate()`-Auswertung nutzt damit die zum
  Zeitpunkt DIESER Auswertung aktuell `ACTIVE` `RuleSetVersion`.
  `Recommendation.ruleSetVersionId` speichert weiterhin unveränderlich
  (append-only) je Auswertung, welche Version tatsächlich verwendet wurde.
- `QuestionVersion`-Auflösung (`questionnaireAt = session.startedAt`)
  bleibt unverändert auf Session-Start gepinnt: der Fragenstand einer
  laufenden Beratung soll sich rückwirkend nicht ändern.
- `ProductVersion`- und `CommissionModelVersion`-Auflösung
  (`commercialAt = session.startedAt`) bleiben ABSICHTLICH ebenfalls auf
  Session-Start gepinnt und wurden NICHT auf den Auswertungszeitpunkt
  umgestellt, obwohl dieselbe Query-Struktur denselben theoretischen Effekt
  hätte. Das ist eine eigenständige, bewusst zurückgestellte fachliche
  Entscheidung (Preis-/Provisionsstabilität während einer laufenden
  Beratung), keine versehentliche Inkonsistenz.

**Code:** die drei Zeitpunkte sind in `evaluate()` als explizite,
semantisch benannte Variablen (`questionnaireAt`/`ruleSetAt`/
`commercialAt`) geführt statt verstreuter `new Date()`-Aufrufe, mit
Inline-Kommentar, der genau diese Begründung wiederholt.

**Test:** `tests/integration/recommendation-ruleset-snapshot.test.ts`
bildet den von ChatGPT vorgegebenen Kern-Testfall nach: Session startet mit
RuleSet v1 (aktiv), v2 wird über den echten `publishRuleSetVersion()`-Pfad
veröffentlicht (v1 dadurch mandantenweit EXPIRED), dieselbe Session wird
erneut ausgewertet und muss v2 verwenden, während `questionnaireVersionId`
der Session unverändert bleibt; zusätzlich verwendet eine neu gestartete
Session ebenfalls v2.

## Phase 13 AP4: Campaign-Aktivität wird zum Auswertungszeitpunkt (`ruleSetAt`) aufgelöst, nicht an den Session-Start gepinnt

**Kontext:** AP4 führt `CAMPAIGN_ACTIVE` als neuen `ConditionSourceType`
ein, mit dem `PrioritizationRule`/`CrossSellingRule` prüfen können, ob
eine Campaign für die aktuelle Beratung gerade aktiv ist. Damit stellte
sich dieselbe Zeitpunkt-Frage wie bereits bei `RuleSetVersion`
(siehe [[Phase 9 AP9: RuleSetVersion-Auswahl auf Auswertungszeitpunkt korrigiert]]
oben): soll Campaign-Aktivität an `session.startedAt` gepinnt werden
(stabil über die gesamte Beratung) oder am tatsächlichen
Auswertungszeitpunkt (`new Date()` bei jedem `evaluate()`-Aufruf)
aufgelöst werden? ChatGPT hat vor der AP4-Abnahme explizit verlangt, diese
Entscheidung als bewusste, dokumentierte Wahl festzuhalten statt sie
implizit im Code zu belassen.

**Entscheidung:** `loadActiveCampaignKeys()` (`service.ts`) verwendet
denselben `ruleSetAt = new Date()`, der bereits für die
`RuleSetVersion`-Auflösung existiert -- Campaign-Aktivität folgt also
bewusst der "JETZT"-Semantik, NICHT der Session-Pinning-Semantik von
`questionnaireAt`/`commercialAt`. Begründung: eine Campaign kann während
einer laufenden, ggf. langen Beratung starten oder enden (z. B. eine
zeitlich befristete Wochenend-Aktion), und die Empfehlungslogik soll das
sofort bei der naechsten Auswertung widerspiegeln -- analog zur
`RuleSetVersion`, die ebenfalls "der zum Auswertungszeitpunkt aktuell
gueltige Regelstand" ist, nicht ein bei Session-Start eingefrorener
Snapshot. Das unterscheidet sich bewusst von Fragebogen (inhaltliche
Konsistenz waehrend der Beratung) und Preis-/Provisionsstand
(Preisstabilitaet waehrend der Beratung), wo Session-Pinning die richtige
Wahl ist.

**Konsequenz:** Zwei identische `evaluate()`-Aufrufe fuer dieselbe, noch
laufende Session koennen unterschiedliche `CAMPAIGN_ACTIVE`-Ergebnisse
liefern, wenn zwischen den Aufrufen eine Campaign-Version veroeffentlicht
wird oder ihr Gueltigkeitsfenster beginnt/endet -- das ist beabsichtigtes
Verhalten, kein Bug.

**Code:** `loadActiveCampaignKeys()` erhaelt `ruleSetAt` als Parameter
(dieselbe Variable, kein zweiter `new Date()`-Aufruf), mit Inline-
Kommentar im Funktionskopf, der genau diese Begründung wiederholt.

**Test:** `tests/integration/recommendation-campaign-active.test.ts`
deckt Zeitfenster-Grenzen (DRAFT/EXPIRED/noch-nicht-gueltig zaehlen nicht
als aktiv), TENANT-/STORE-Scope, mehrere gleichzeitig aktive Campaigns
sowie Tenant-Isolation (identischer `Campaign.key` in fremdem Mandanten
zaehlt nicht als aktiv) ab.

## Phase 13 AP7: Campaign-Attribution nur fuer PrioritizationRule -> RecommendationItem, Cross-Selling-Attribution ist eine bekannte, bewusst zurueckgestellte Luecke

**Kontext:** AP7 sollte technisch nachvollziehbar machen, WELCHE aktiven
Campaigns tatsaechlich zu einer Empfehlung beigetragen haben (Vorstufe fuer
spaetere Campaign-Analytics/Reporting, siehe
[[Phase 13 AP4: Campaign-Aktivitaet wird zum Auswertungszeitpunkt (ruleSetAt) aufgeloest, nicht an den Session-Start gepinnt]]
oben, das die CAMPAIGN_ACTIVE-Bedingung selbst eingefuehrt hat). Bereits
in der `20260824180000_campaign_management`-Migration (gleichzeitig mit
AP1) existierte im Schema eine dedizierte Tabelle
`RecommendationCampaignSignal` mit FK ausschliesslich auf
`RecommendationItem` -- ohne dass zu diesem Zeitpunkt Code hineinschrieb.
Diese FK-Struktur legt die Architektur strukturell fest: eine Signal-Zeile
kann nur einem `RecommendationItem` zugeordnet werden, es gibt KEINE
FK-Moeglichkeit auf `RecommendationCrossSellingSignal`.

**Entscheidung 1 (ChatGPT, 2026-08-30):** `RecommendationCampaignSignal`
bleibt die Architektur -- kein Rueckbau auf eine polymorphe Erweiterung
von `RecommendationRationale`, keine Ruecknahme der Migration.

**Entscheidung 2 (ChatGPT, 2026-08-30):** Der AP7-Scope ist bewusst auf
**PrioritizationRule -> RecommendationItem** beschraenkt. Eine
`CrossSellingRule` kann seit AP4 ebenfalls eine `CAMPAIGN_ACTIVE`-Bedingung
nutzen und ueber sie matchen (siehe
`tests/integration/recommendation-campaign-active.test.ts`, Testfall
"CrossSellingRule: CAMPAIGN_ACTIVE-Bedingung erzeugt ein Signal") -- diese
Treffer erzeugen bewusst KEIN `RecommendationCampaignSignal`, weil die
Tabelle dafuer strukturell keinen Attributionspunkt vorsieht
(`RecommendationCrossSellingSignal` ist keine `RecommendationItem`-Zeile).
Diese Luecke ist ChatGPTs ausdruecklicher, dokumentierter Beschluss, keine
versehentliche Unvollstaendigkeit: eine polymorphe Erweiterung der
Signal-Tabelle (z. B. optionale `recommendationCrossSellingSignalId`-
Spalte) waere moeglich, wurde aber bewusst NICHT im Rahmen von AP7
nachgezogen, um den Scope klein und pruefbar zu halten. Cross-Selling-
Campaign-Attribution bleibt damit ein bekannter, spaeter zu behebender
Nachtrag fuer eine kuenftige Phase, sobald ein konkreter
Reporting-/Analytics-Bedarf dafuer entsteht.

**Entscheidung 3 (ChatGPT, 2026-08-30):** Statt den bestehenden
Rueckgabevertrag von `loadActiveCampaignKeys()` (`Set<string>`, siehe AP4)
zu aendern, erhaelt `service.ts` eine NEUE Funktion
`loadActiveCampaignContext()` mit Rueckgabetyp
`Map<campaignKey, { campaignId, campaignVersionId }>`. Der bisherige
`Set<string>`-Pfad (fuer die reine, bereits abgenommene
Bedingungsauswertung in `conditions.ts`) wird direkt aus
`context.keys()` abgeleitet -- eine einzige Query/ein einziger
Auswertungszeitpunkt fuer Campaign-Aktivitaet UND -Attribution, kein
zweiter, potenziell inkonsistenter Datenbankzugriff. Das Verfahren, WELCHE
Campaigns tatsaechlich zu einer getroffenen `PrioritizationRule`
beigetragen haben, dupliziert bewusst die DNF-Gruppierungslogik von
`evaluateConditionGroups()` in einer neuen, rein lesenden Funktion
`extractMatchedCampaignActiveKeys()` (`conditions.ts`), statt die bereits
abgenommene Funktion umzubauen -- beide verwenden dieselbe
`evaluateCondition()`-Primitive und sind daher garantiert konsistent.

**Attributionsregeln (verbindlich, ChatGPT 2026-08-30):**

- Nur tatsaechlich GETROFFENE `PrioritizationRule`s werden attribuiert;
  eine referenzierte, aber ueber ihre DNF-Gruppe nicht getroffene Campaign
  (z. B. in einem nicht erfuellten OR-Zweig) wird NICHT attribuiert.
- Nur der Operator `IS_ANSWERED` traegt zur Attribution bei.
  `IS_NOT_ANSWERED` (Abwesenheits-Match: "diese Campaign ist gerade NICHT
  aktiv") erzeugt bewusst KEIN Signal fuer die referenzierte Campaign --
  hier war die Abwesenheit die Matchbedingung, keine inhaltliche
  Zurechnung zu dieser Campaign.
- Mehrere `PrioritizationRule`s, die dieselbe Campaign fuer dasselbe
  `RecommendationItem` referenzieren, erzeugen MAXIMAL EIN Signal
  (Deduplizierung ueber ein `Set` in `evaluatePrioritizationRules()`,
  explizit getestet).
- `campaignId`/`campaignVersionId` stammen aus derselben
  `loadActiveCampaignContext()`-Aufloesung wie die Regelbewertung selbst
  (identischer `ruleSetAt`-Zeitpunkt, siehe AP4-Eintrag oben).
- Die Signal-Schreibung erfolgt ATOMAR in derselben Transaktion wie
  `recommendation.create()`/`recommendationItem.create()` -- bei Rollback
  bleibt kein Signal zurueck.
- Fuer lediglich aktive, aber von keiner getroffenen Regel referenzierte
  Campaigns entsteht kein Signal.

**Code:** `conditions.ts::extractMatchedCampaignActiveKeys()` (neu),
`types.ts::PrioritizationResult.matchedCampaignKeys` (neu),
`prioritization.ts::evaluatePrioritizationRules()` (dedupliziert und
sortiert `matchedCampaignKeys` ueber alle getroffenen Regeln),
`service.ts::loadActiveCampaignContext()` (ersetzt
`loadActiveCampaignKeys()`), `service.ts::evaluate()` (Signal-Schreibpfad
in der bestehenden Transaktion je `RecommendationItem`),
`service.ts::loadRecommendationResult()` (einfache Lesefunktion:
`campaignSignals`-Include + Mapping auf `RecommendationCampaignSignalResult`,
bewusst KEINE neue Reporting-API/KPI-Berechnung).

**Test:** `tests/unit/recommendation/conditions.test.ts`
("extractMatchedCampaignActiveKeys") und
`tests/unit/recommendation/prioritization.test.ts`
("evaluatePrioritizationRules - matchedCampaignKeys") decken die reine
Zuordnungslogik ab (inkl. OR-Gruppen, AND-Gruppen, IS_NOT_ANSWERED,
Dedup/Sortierung). `tests/integration/recommendation-campaign-attribution.test.ts`
deckt gegen eine echte Postgres-DB ab: Signal-Erzeugung bei Treffer,
Deduplizierung ueber zwei Regeln mit derselben Campaign, kein Signal bei
IS_NOT_ANSWERED, kein Signal bei einem CrossSellingRule-Match (dokumentierte
Luecke), kein Signal bei einer lediglich aktiven, unreferenzierten
Campaign, OR-Gruppen-Korrektheit sowie Tenant-Isolation der Signal-Tabelle.

## Phase 13 AP8: `evaluationFingerprint` fehlte `campaignVersionIds` -- echter Reproduzierbarkeits-Defekt, kein Testfehler

**Kontext:** AP8 (Security/Regression/E2E) forderte einen expliziten
Reproduzierbarkeits-Regressionstest fuer `RecommendationCampaignSignal`
(`tests/integration/recommendation-campaign-attribution.test.ts`). Dieser
Test deckte in CI #132 einen echten Fehler in der bestehenden Implementierung
auf (kein Testfehler): eine erneute `evaluate()`-Auswertung derselben Session
NACH einem echten `publishCampaignVersion()`-Aufruf (der die zuvor aktive
CampaignVersion V1 EXPIRED und eine neue V2 aktiviert) referenzierte
weiterhin V1, obwohl keine neue Recommendation und kein neues Signal fuer V2
geschrieben wurde.

**Root Cause:** `evaluationFingerprint` (`fingerprint.ts`) ist die Grundlage
des Idempotenz-Fast-Path in `service.ts::evaluate()` (identischer Fingerprint
fuer dieselbe Session -> die bestehende Recommendation wird unveraendert
zurueckgegeben, keine neue Zeile). Der Fingerprint enthielt bereits bewusst
`commissionModelVersionIds`, damit eine spaetere Provisionsaenderung den
Fingerprint aendert -- fuer aktive CampaignVersion-IDs (seit Phase 13 AP4
ebenfalls ein zeitabhaengiger Auswertungs-Input, siehe CAMPAIGN_ACTIVE) gab
es aber KEIN Aequivalent. Aendert sich zwischen zwei `evaluate()`-Aufrufen
derselben Session NUR der Campaign-Status (keine Antworten/Produkte/
Session-Attribute/Provisionsmodelle), blieb der Fingerprint identisch, der
Fast-Path griff faelschlich, und weder die CAMPAIGN_ACTIVE-Bedingungs-
auswertung noch die `RecommendationCampaignSignal`-Attribution wurden fuer
die neue Campaign-Version neu berechnet.

**ChatGPT-Entscheidung (2026-08-30, verbindlich):** Echter AP8-Befund, kein
Testproblem -- Fix gehoert in AP8, kein separater Vorab-Fix. Der Fix darf den
Fast-Path nicht generell deaktivieren; ein zusaetzlicher Test muss beweisen,
dass er bei UNVERAENDERTEM Campaign-Zustand weiterhin greift.

**Fix:** `FingerprintInput.campaignVersionIds: string[]` (additiv, kein
Schema-Change) -- exakt analog zu `commissionModelVersionIds`: sortiert in
`buildFingerprintObject()` aufgenommen, in `service.ts::evaluate()` aus dem
dort bereits fuer die Bedingungsauswertung/Signal-Schreibung geladenen
`activeCampaignContext` befuellt (kein zusaetzlicher DB-Zugriff).

**Test:** `tests/integration/recommendation-campaign-attribution.test.ts`
("Reproduzierbarkeit") beweist explizit: Signal referenziert V1 vor dem
Publish (Direkt-DB-Lesung), ein wiederholter `evaluate()`-Aufruf OHNE
Campaign-Aenderung liefert weiterhin dieselbe Recommendation/denselben
Fingerprint (Fast-Path bleibt aktiv), das urspruengliche Signal bleibt nach
dem Publish unveraendert bei V1, und eine NEUE Auswertung NACH dem Publish
erzeugt eine neue Recommendation mit einem neuen Signal fuer V2. Zusaetzlich
deckt `tests/unit/recommendation/fingerprint.test.ts` die reine
Sortierungs-/Hash-Aenderung fuer `campaignVersionIds` ab.

## Phase 13 AP10: `publishCampaignVersion()` bestimmte `now` VOR statt NACH dem Campaign-Row-Lock -- echter Nebenlaeufigkeits-Defekt, sichtbar erst durch den AP10-CI-Lauf

**Kontext:** Der Abschlussbericht-Commit fuer AP10 (`docs/ABSCHLUSSBERICHT_PHASE13.md`,
reine Dokumentation, keine Code-Aenderung) loeste dennoch einen roten CI-Lauf
(CI #136) aus: der bestehende AP2-Regressionstest
`tests/integration/campaign-admin.test.ts` > "zwei GLEICHZEITIGE
Publish-Versuche fuer ZWEI VERSCHIEDENE DRAFT-Versionen DERSELBEN Campaign"
schlug fehl. Der Test garantiert, dass bei zwei gleichzeitigen
`publishCampaignVersion()`-Aufrufen niemals ein roher, unuebersetzter
DB-Fehler an den Aufrufer durchschlaegt (nur
`CampaignVersionPublishConflictError`/`CampaignVersionNotDraftError` sind
zulaessig). Aus dem CI-Log: der tatsaechlich geworfene Fehler war Postgres
Code 22000 "range lower bound must be less than or equal to range upper
bound" bei `tx.campaignVersion.update()` (Schritt "vorherige Version
expiren").

**Root Cause:** `publishCampaignVersion()` (`campaign-admin.ts`) bestimmte
`const now = new Date()` VOR dem `db.$transaction()`-Aufruf, also VOR dem
Warten auf den Campaign-Row-Lock (`SELECT ... FOR UPDATE`, der die
Publish-Transaktionen DERSELBEN Campaign serialisiert). Bei zwei echt
gleichzeitigen Publish-Versuchen kann die zweite Transaktion (die den Lock
erst NACH der ersten erhaelt) einen `now`-Zeitstempel besitzen, der bereits
VOR dem `validFrom` liegt, das die ERSTE Transaktion soeben fuer die von ihr
aktivierte Version gesetzt hat. Versucht die zweite Transaktion danach,
genau diese frisch aktivierte Version mit `validTo = now(frueher)` zu
expiren (weil sie sie als "vorherige ACTIVE-Version" liest), entsteht ein
Bereich mit `validFrom > validTo` -- Postgres lehnt das mit Fehler 22000 ab,
NICHT mit der von `translatePublishError()` erwarteten
EXCLUDE-Constraint-Verletzung. Der rohe 22000-Fehler wird daher unveraendert
weitergereicht.

**ChatGPT-Entscheidung (2026-08-30, verbindlich):** Root-Cause-Diagnose
bestaetigt, echter Concurrency-Bug (kein Testfehler, kein Flake). GO fuer
den Fix mit der Auflage, den Test NICHT abzuschwaechen und 22000 NICHT
zusaetzlich als "erwarteten" Fehler zu akzeptieren -- der Publish-Pfad soll
bei korrekter Serialisierung deterministisch funktionieren. Zusaetzlich GO
fuer einen separaten, nicht-prophylaktischen Audit desselben
Zeitstempel-vor-Lock-Musters in anderen Draft-&gt;Publish-Workflows
(Commission-Modelle Phase 10, RuleSet-Publish, Questionnaire-Publish,
Goal-Publish) -- Ergebnis siehe ggf. separater Eintrag/Abschlussbericht.

**Fix:** `now = new Date()` wird jetzt INNERHALB der Transaktion, UNMITTELBAR
NACH dem erfolgreichen Erwerb des Campaign-Row-Locks, bestimmt (statt davor).
Der Row-Lock serialisiert die Publish-Transaktionen DERSELBEN Campaign daher
zusammen mit der Zeitstempel-Bestimmung: eine durch den Lock blockierte
Transaktion bestimmt ihren `now`-Wert garantiert ERST NACH Freigabe des
Locks und damit garantiert NACH dem `validFrom`, das eine vorausgegangene
Transaktion gesetzt hat. Kein Schema-Change, keine Aenderung an
`translatePublishError()` noetig.

**Test:** Der bestehende Regressionstest
(`tests/integration/campaign-admin.test.ts`, "zwei GLEICHZEITIGE
Publish-Versuche...") deckt dies bereits vollstaendig ab und wurde
unveraendert gelassen -- er ist die Regression, die den Fix beweist.

**Projektweiter Audit (ChatGPT-Auflage, nicht-prophylaktisch, nur
identifizieren -- bei Fund sauber beheben statt nur dokumentieren):**
Geprueft wurden alle bestehenden Draft-&gt;Publish-Workflows mit
Row-Lock-Muster auf denselben Fehler (`now` vor statt nach dem Lock):

- `publishCommissionModelVersion()` (`commission-admin.ts`, Phase 10 AP5):
  IDENTISCHES Muster gefunden -- `now` wurde vor dem
  CommissionModel-Row-Lock bestimmt. Ebenfalls behoben (`now` jetzt nach
  Lock-Erwerb innerhalb der Transaktion), exakt analog zum Campaign-Fix.
  Der bestehende Regressionstest in `commission-admin.test.ts`
  ("gleichzeitig ... DASSELBE CommissionModel") deckt dies unveraendert ab.
- `publishRuleSetVersion()` (`rule-admin.ts`, Phase 9): IDENTISCHES Muster
  gefunden -- `now` wurde vor dem Tenant-Row-Lock bestimmt. Ebenfalls
  behoben, exakt analog. Der bestehende Regressionstest in
  `rule-admin-publish.test.ts` deckt dies unveraendert ab.
- `publishDraftVersion()` (`question-admin.ts`, Fragebogen, Phase 8): KEIN
  Row-Lock vorhanden -- dieser Workflow verlaesst sich ausschliesslich auf
  den EXCLUDE-Constraint (`questionnaire_versions_no_overlap`) als
  Nebenlaeufigkeitsschutz, es gibt daher keine Lock-Wartephase, in der ein
  vorab bestimmter Zeitstempel veralten koennte. Das Muster ist nicht
  anwendbar, kein Fund.
- Goals (`goal-admin.ts`): kein Draft-&gt;Publish-&gt;ACTIVE/EXPIRED-
  Lebenszyklus (siehe Modulkommentar), Muster nicht anwendbar.

Alle drei betroffenen Publish-Pfade (Campaign, CommissionModel, RuleSet)
folgen jetzt demselben korrigierten Muster: Row-Lock zuerst, `now` danach,
innerhalb derselben Transaktion.

## Phase 14 AP5: Playbook-Content-Trust-Boundary strukturell statt heuristisch abgesichert -- keine Prompt-Injection-Pattern-Blacklist

**Kontext:** Phase 14 baut ein Sales-Playbook-Subsystem, dessen
`PlaybookSection.content`-Feld spaeter (nach Phase 12 AP5c, echter
KI-Provider) als Kontext in einen LLM-Prompt einfliessen soll. AP5
("Security-Grundgeruest") musste klaeren, wie dieser Content bis dahin
strukturell abgesichert wird.

**Verworfene Option:** regex-/heuristikbasierte "Prompt-Injection-
Filterung" beim Speichern (z. B. Blacklist von Phrasen wie "ignore
previous instructions"). ChatGPTs ausdrueckliche Begruendung fuer die
Ablehnung: solche Filter sind leicht zu umgehen (Umschreibungen,
Encodings, andere Sprachen) und beschaedigen gleichzeitig legitime
Inhalte (ein Playbook-Abschnitt zur Einwandbehandlung koennte legitim
Formulierungen wie "vergessen Sie den Preis" enthalten). Eine
Schein-Sicherheit, kein echter Schutz.

**Gewaehlte Loesung (strukturelle Trust Boundary, kein Content-
Scanning):**

- `content` wird durchgaengig als Daten behandelt, niemals als
  Systeminstruktion -- technisch dadurch erzwungen, dass kein Codepfad
  in Phase 14 den Content interpretiert/ausfuehrt/eval'iert. Belegt durch
  `tests/integration/playbook-security.test.ts` (byte-identische
  Speicherung/Rueckgabe von HTML-/Script-/Prompt-Injection-aehnlichen
  Testinhalten -- explizit KEIN Escaping, KEIN Filtern).
- `playbook-retrieval.ts::selectPlaybookSections()` liest niemals
  `content` selbst, nur dessen Zeichenlaenge (`contentLength`) -- die
  Selektionslogik kann den Content damit strukturell gar nicht
  interpretieren.
- Strukturelle Entkopplung von der Recommendation Engine: kein Modul
  unter `src/server/recommendation/` referenziert das Playbook-
  Subsystem in irgendeiner Form (durch einen Test in
  `playbook-security.test.ts` als Dauer-Regression abgesichert) --
  Playbook-Content kann eine Rule-/Campaign-Entscheidung damit
  strukturell nicht beeinflussen, unabhaengig von seinem Inhalt.
- Eingabehygiene bleibt Zod-basiert (Groessenlimits aus
  `playbook-schemas.ts`, AP1/AP2) -- reine Speicher-/Kostenkontrolle,
  ausdruecklich kein Ersatz fuer Injection-Abwehr.
- `AuditLog`-Eintraege beim Publish enthalten keinerlei Section-Content
  (nur IDs/Zaehler), um sensible Playbook-Inhalte nicht unnoetig in Logs
  zu duplizieren.

**Bewusst NICHT Teil von AP5 (verschoben auf ein spaeteres, an Phase 12
AP5c gekoppeltes AP):** die eigentliche Prompt-Injection-Abwehr beim
tatsaechlichen Bau eines LLM-Prompts (Trust Hierarchy technisch
durchsetzen, sobald ein echter Prompt-Assembler existiert). Ohne echten
Provider gibt es noch keinen Ort, an dem diese Pruefung sinnvoll
verifiziert werden koennte (identische Begruendung wie die
Scope-Grenze aus PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 7).

**ChatGPT-Entscheidung (2026-08-31, verbindlich):** GO fuer AP5 exakt
mit dieser strukturellen Herangehensweise, ausdruecklich OHNE
Pattern-Blacklist. Wichtigste von ChatGPT formulierte Regel: "AP5 darf
keine Prompt-Injection-Scheinloesung bauen, solange es noch keinen
echten Prompt-Assembler gibt."
