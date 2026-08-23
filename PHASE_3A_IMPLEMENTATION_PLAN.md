# Phase 3A – Kurzer Implementierungsplan (vor Codeänderungen)

Stand: 2026-07-31. Grundlage: `PHASE_3A_STARTPROMPT.md`. Dieses Dokument
erfüllt die im Startprompt geforderte Pflicht "Erstelle einen kurzen
Implementierungsplan, bevor du mit der Codeänderung beginnst" und wird vor
Beginn der Schema-Arbeiten ChatGPT (Projektleiter) vorgelegt.

## 1. Bestandsaufnahme (bereits vorhanden, wiederverwendbar)

Im Phase-2B-Schema existiert bereits eine "logische Hülle" der Fragen-Engine:
`Questionnaire`, `QuestionnaireVersion`, `Question`, `QuestionVersion`,
`AnswerOption`, `VisibilityCondition`, `CustomerAnswer`. Diese werden
erweitert, nicht neu gebaut. Wiederverwendet werden außerdem: das
Versionierungsmuster (`validFrom`/`validTo`/`status: VersionStatus`), das
Tenant-Scoping (`withTenantScope()`, `runWithTenantContext()`), die
Zod-Validierungskonventionen (`event-payload-schemas.ts`), das
Exclusion-Constraint-Muster (`EXCLUDE USING gist` gegen Überlappung) und das
Append-only-Trigger-Muster.

## 2. Erkannte Lücken / Widersprüche gegenüber dem Phase-3A-Auftrag

1. **`AnswerType`-Enum unvollständig:** aktuell
   `{SINGLE_CHOICE, MULTI_CHOICE, NUMBER, BOOLEAN, FREE_TEXT}`, gefordert sind
   7 Typen `{SINGLE_CHOICE, MULTIPLE_CHOICE, BOOLEAN, INTEGER, DECIMAL,
SHORT_TEXT, DATE}`.
2. **`VisibilityOperator`-Enum unvollständig:** aktuell 6 Operatoren, gefordert
   11 (fehlen: `NOT_IN`, `CONTAINS`, `GREATER_THAN_OR_EQUAL`,
   `LESS_THAN_OR_EQUAL`, `IS_NOT_ANSWERED`).
3. **`VisibilityCondition` kennt keine AND/OR-Gruppierung** – aktuell genau
   eine Bedingung pro Datensatz, keine Verknüpfung mehrerer Bedingungen.
4. **`ConsultationSession` hat kein Feld, das die verwendete
   `QuestionnaireVersion` bei Sessionstart fixiert** – größte Lücke, da der
   Auftrag explizit verlangt, dass eine spätere Neuveröffentlichung laufende
   Sessions nicht rückwirkend verändert.
5. **`CustomerAnswer` fehlen:** ein `DATE`-Wertfeld, ein
   dezimalgenaues Feld für `DECIMAL`-Antworten (kein `Float`), ein
   Aktiv/Inaktiv-Flag für "nicht mehr sichtbare, aber historisch erhaltene"
   Antworten, sowie ein Feld zur Idempotenz-/Konkurrenzkontrolle.
6. **`Question.needType` ist verpflichtend** – koppelt jede Frage an eine
   `NeedType`-Kategorie der (nicht Teil dieser Phase befindlichen)
   Empfehlungslogik. Für reine Fragen-Engine-Fragen ohne Kreuzverkaufsbezug
   nicht sinnvoll erzwingbar.
7. **Namenskollision:** `docs/QUESTION_ENGINE.md` existiert bereits als
   Phase-1-Konzeptdokument; der Auftrag verlangt zusätzlich ein NEUES,
   technisches Dokument exakt unter diesem Pfad.
8. **`question_versions` hat noch keinen Exclusion-Constraint** gegen
   überlappende Gültigkeitszeiträume (im Gegensatz zu `product_versions` etc.
   in Phase 2B) – bestehende Lücke, die im Zuge dieser Phase mit
   geschlossen wird, da dieselbe Tabelle jetzt aktiv genutzt wird.

## 3. Vorgeschlagene Entscheidungen (zur Bestätigung durch ChatGPT)

- **AnswerType:** Enum wird um die 7 geforderten Werte neu gefasst
  (`SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `BOOLEAN`, `INTEGER`, `DECIMAL`,
  `SHORT_TEXT`, `DATE`). Da ausschließlich synthetische Daten existieren und
  noch kein Produktivbetrieb stattfand, ist ein sauberer Cut zulässig
  (kein Migrations-Downgrade-Risiko). Wird in `DECISION_LOG.md` festgehalten.
- **VisibilityOperator:** um die 5 fehlenden Werte ergänzt (additiv, keine
  Umbenennung nötig).
- **AND/OR-Gruppierung:** bewusst **einstufig** (keine beliebig verschachtelte
  Boolesche Logik): Jede `VisibilityCondition`-Gruppe gehört zu genau einer
  Zielfrage und hat einen `combinator: AND | OR`, der für ALLE Einträge der
  Gruppe gilt. Verschachtelte Gruppen (AND von ORs) sind **explizit außerhalb
  des Scopes** dieser Phase und werden als offene Entscheidung vermerkt.
- **`ConsultationSession.questionnaireVersionId`:** ~~Durchsetzung nur auf
  Service-Ebene~~ **korrigiert nach ChatGPT-Rückmeldung, siehe Abschnitt 4a**:
  Feld wird zusätzlich per DB-Trigger unveränderlich gemacht, inkl.
  migrationssicherem Backfill vor NOT NULL.
- **`CustomerAnswer`:** ~~Update derselben Zeile mit `isActive`/
  `answerVersion`~~ **korrigiert nach ChatGPT-Rückmeldung, siehe Abschnitt
  4a**: echte Historisierung durch neue Zeile pro Änderung, atomarer
  Compare-and-Swap statt reinem Zähler-Update. Zusätzlich weiterhin:
  `dateValue DateTime?`, `decimalValue Decimal(18,4)?` (Prisma `Decimal`-Typ,
  keine Float-Ungenauigkeit).
- **`Question.needType`:** wird **nullable** – Begründung konkretisiert und
  per Grep verifiziert, siehe Abschnitt 4a (kein vorsorglicher Change mehr,
  sondern belegt notwendig).
- **Dokumentation:** bestehendes `docs/QUESTION_ENGINE.md` (Phase-1-Konzept)
  wird nach `docs/QUESTION_ENGINE_CONCEPT.md` verschoben (Inhalt unverändert,
  nur Dateiname), das neue, technische `docs/QUESTION_ENGINE.md` wird gemäß
  Auftrag neu geschrieben und referenziert das Konzept-Dokument.
- **`question_versions`-Exclusion-Constraint:** wird ergänzt, analog zu den
  bestehenden 7 Constraints in `migration.sql`.

## 4. Nicht angetastete Bereiche (Bestätigung der Abgrenzung)

Keine Änderung an: `RuleSet*`, `EligibilityRule`, `ExclusionRule`,
`PrioritizationRule`, `Recommendation*`, `DetectedNeed`, `SalesOpportunity`,
`ConsultationStatus`-Enum, `Deal*`, Provisions-/Produktmodell. Kein
KI-/LLM-Aufruf, keine Freitext-Auswertung für Business-Logik.

## 4a. Rückmeldung von ChatGPT (Projektleiter) und Klärung der vier offenen Punkte

ChatGPT hat den Plan **nicht unbedingt freigegeben**, sondern vier Punkte zur
verbindlichen Klärung vor Codebeginn verlangt. Klärung je Punkt (Ergebnis von
gezielter Prüfung des Bestandscodes, keine Annahme):

1. **`questionnaireVersionId`-Fixierung nur auf Service-Ebene reicht nicht.**
   Lösung: Spalte wird in derselben Migration zunächst NULLABLE angelegt,
   per Backfill-UPDATE (deterministisch: zum `startedAt`-Zeitpunkt gültige
   `ACTIVE`-`QuestionnaireVersion` der Session-Questionnaire) befüllt und
   danach in derselben Migration auf NOT NULL gesetzt (unkritisch, da nur
   synthetische Bestandsdaten). Zusätzlich neue Trigger-Funktion
   `forbid_questionnaire_version_change()` (analog zu
   `check_role_assignment_store_company()` in `migration.sql`), die JEDE
   Änderung von `questionnaire_version_id` per `RAISE EXCEPTION` ablehnt –
   echte DB-Absicherung statt reiner Konvention.
2. **`isActive` + `answerVersion` allein verlieren den Altwert.** Lösung:
   `CustomerAnswer` wird pro Änderung als neue Zeile eingefügt statt
   überschrieben (Historie bleibt vollständig erhalten). Eindeutigkeit über
   Partial Unique Index `(tenant_id, consultation_session_id,
question_version_id) WHERE is_active = true`. Ändern einer Antwort läuft
   als Transaktion mit atomarem Compare-and-Swap:
   `UPDATE ... SET is_active = false WHERE ... AND is_active = true AND
answer_version = $expectedVersion`; nur bei genau 1 betroffener Zeile wird
   die neue Zeile mit `answer_version = expectedVersion + 1` eingefügt, sonst
   `StaleAnswerVersionError`. Bewusst KEIN pauschaler `forbid_update_delete()`
   -Trigger auf dieser Tabelle, da der CAS-Flip selbst ein kontrolliertes
   Update ist – Abweichung von der sonstigen Append-only-Trigger-Konvention
   wird hier explizit begründet und in `DECISION_LOG.md` festgehalten.
3. **`Question.needType` nullable nur falls tatsächlich blockierend.**
   Geprüft per Grep: `needType` wird aktuell nur in `schema.prisma` (Feld auf
   `Question`, plus ein separates, hiervon unabhängiges `needType`-Feld auf
   einem anderen Modell in Zeile ~951) und in `seed.ts` (2 Stellen, beide
   `NeedType.STREAMING`) verwendet – keine Service- oder Auswertungslogik
   verzweigt aktuell auf `Question.needType`. Da Phase 3A ≥8 Fragen
   unterschiedlichen Typs verlangt (u. a. DATE/SHORT_TEXT/INTEGER ohne
   natürlichen Cross-Selling-Bezug), würde eine Pflichtfeld-Beibehaltung eine
   künstliche, fachlich unzutreffende `NeedType`-Zuordnung erzwingen – das
   blockiert die reine Fragen-Engine konkret, nicht nur vorsorglich.
   Änderung bleibt daher wie geplant, mit dieser Begründung dokumentiert.
4. **Exclusion Constraint `question_versions` – exakte Definition.** Wird 1:1
   analog zum bestehenden `questionnaire_versions_no_overlap` gebaut:
   Partitionierung über `tenant_id` + `question_id` (die Stammfrage),
   `tstzrange(valid_from, valid_to, '[)')`, Geltung nur `WHERE status IN
('ACTIVE', 'EXPIRED')` (DRAFT-Zeilen dürfen sich frei überlappen, exakt
   wie bei allen bestehenden 7 Constraints). Offene Zeiträume (`valid_to =
NULL`) werden von `tstzrange` nativ als unbeschränkt behandelt – keiner
   der bestehenden 7 Constraints verwendet ein explizites `infinity`, daher
   hier ebenfalls keine Abweichung nötig.

Zusätzliche verbindliche Vorgaben aus der Rückmeldung, die in die
Umsetzungsreihenfolge aufgenommen werden:

- Vor dem `AnswerType`-Enum-Umbau: vollständige Grep-Suche nach allen
  Verwendungsstellen (Schema, Seed, Services, Tests) – "nur synthetische
  Daten" verhindert keine Build-/Migrationsfehler.
- Einstufiges AND/OR pro Zielfrage ist freigegeben; verschachtelte/gemischte
  Gruppen bleiben explizit out of scope.
- `MULTIPLE_CHOICE` bleibt über die strukturierte `AnswerOption`-Relation
  gelöst (nicht über Skalarfelder) – bereits so modelliert, wird durch
  Validierung/Tests abgesichert, keine Schemaänderung nötig.
- Beim Verschieben von `docs/QUESTION_ENGINE.md` nach
  `docs/QUESTION_ENGINE_CONCEPT.md`: vorher alle internen Verweise per Grep
  suchen und aktualisieren.
- Keine Änderung an RuleSet/Recommendation/DetectedNeed/SalesOpportunity/Deal
  bleibt bestätigt.

## 5. Umsetzungsreihenfolge

1. Schema erweitern (Punkte oben) → 2. Migration erzeugen + gegen
   PGlite/Test-DB verifizieren → 3. Service-Schicht (Start, Laden,
   Beantworten, Sichtbarkeit neu berechnen, Abschließen, Version validieren)
   → 4. Seed-Daten erweitern → 5. ~40 Tests → 6. Doku (inkl. neues
   `QUESTION_ENGINE.md`, `DECISION_LOG.md`-Einträge) → 7. Lokale
   Prüfungen (Lint/Format/Typecheck/Tests/Build) → 8. Commit/Push, CI prüfen
   → 9. Abschlussbericht.
