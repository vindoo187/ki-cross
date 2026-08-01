# Abschlussbericht Phase 3A – Fragen-Engine (Stand: 2026-08-01)

Dieser Bericht schließt Phase 3A (Fragen-Engine) ab, wie in
`PHASE_3A_STARTPROMPT.md` beauftragt und vom Projektleiter (ChatGPT) final
freigegeben. Er folgt derselben Ehrlichkeitsregel wie
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): jede Aussage ist mit
ihrer Prüfmethode belegt.

## 1. Auftrag und Rahmen

Beauftragt war ausschließlich: Prisma-Schema für die Fragen-Engine
(`Questionnaire` → `QuestionnaireVersion` → `Question` → `QuestionVersion`
→ `AnswerOption`/`VisibilityCondition`), die Service-Schicht
(`src/server/questionnaire/`), synthetische Seed-Erweiterung, Unit- und
Integrationstests sowie Dokumentation. Ausdrücklich **nicht** beauftragt:
Empfehlungs-Engine, Erzeugung von `SalesOpportunity`/`DetectedNeed`,
Cross-Selling-Logik, jede KI-/LLM-gestützte fachliche Interpretation,
fertige Mitarbeiteroberfläche. Diese Abgrenzung wurde eingehalten – **es
wurde keine Empfehlungs-, Tarif-, Cross-Selling- oder
Mitarbeiteroberflächenlogik begonnen.**

## 2. Umsetzung

Details zu Datenmodell, Service-Schicht und lokal ausgeführten Prüfungen
(150/150 Unit-Tests, ESLint 0 Fehler/Warnungen, Prettier sauber, Migration
gegen 55 Tabellen/84 Fremdschlüssel fehlerfrei) stehen in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#phase-3a--fragen-engine-umfang-und-verifikationsstatus)
und [QUESTION_ENGINE.md](QUESTION_ENGINE.md).

## 3. CI-Fehlerbehebung (CI #7, #8, #9)

Nach dem Push traten zwei CI-Fehlschläge auf, die vollständig behoben und
über GitHub Actions verifiziert wurden (Details in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#phase-3a--ci-fehlerbehebung-ci-7-8-9)):

- **CI #7**: Testbugs in `tests/integration/questionnaire-engine.test.ts`
  (fehlender `asTenantA`-Wrapper, `afterAll` griff append-only-geschützte
  Tabellen an) – behoben.
- **CI #8**: Schema-Designfehler, nicht nur Testbug –
  `AnalyticsEvent.employee` mit `onDelete: SetNull` löste beim Löschen
  eines Employees ein durch den Append-only-Trigger blockiertes `UPDATE`
  auf `analytics_events` aus. Behoben durch `onDelete: Restrict` (neue
  Migration `20260801095926_analytics_events_employee_restrict`) und
  Reduktion von `afterAll` auf `$disconnect()`.
- **CI #9** (geprüfter Commit `85e4022`): **Success**, Laufzeit **1m 33s**,
  keine Fehler – ausschließlich die bekannte, folgenlose
  Node.js-20-Deprecation-Warnung ohne Einfluss auf das Ergebnis.

## 4. Grenzen dieses Abschlusses

- **Docker-Compose- und Browser-/E2E-Smoke-Tests bleiben weiterhin offen**
  – sie wurden in dieser Phase nicht tatsächlich ausgeführt und sind nicht
  Teil der CI-#9-Bestätigung.
- Es wurde keine Empfehlungs-, Tarif-, Cross-Selling- oder
  Mitarbeiteroberflächenlogik begonnen (siehe Abschnitt 1).

## 5. Neu dokumentierte, nicht-blockierende Punkte

Auf Empfehlung des Projektleiters wurden drei zusätzliche Punkte, die den
eigentlichen Umfang der Fragen-Engine erweitern und nicht mehr in Phase 3A
implementiert werden müssen, verbindlich dokumentiert statt implementiert:

1. **FK-Fehler → fachliche Fehlermeldung**: als spätere technische Aufgabe
   in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#bekannte-offene-technische-aufgaben-nicht-blockierend-für-phase-3a)
   festgehalten. Der bestehende zentrale Error-Handler verhindert bereits
   heute, dass rohe SQL-/Prisma-Details an Clients gelangen.
2. **DSGVO-konformes Anonymisierungs-/Aufbewahrungs-/Löschkonzept** für
   Mitarbeiter mit vorhandenen AnalyticsEvents (seit `onDelete: Restrict`
   nicht mehr physisch löschbar): als offene Entscheidung #14 in
   [OPEN_DECISIONS.md](OPEN_DECISIONS.md) und als Risiko in
   [RISK_REGISTER.md](RISK_REGISTER.md) aufgenommen.
3. **Dedizierte Testdatenbank mit `_test`-Namensprüfung und
   Startabbruch** bei ungeeigneter DB-URL: als spätere technische Aufgabe
   in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#bekannte-offene-technische-aufgaben-nicht-blockierend-für-phase-3a)
   und als Risiko in [RISK_REGISTER.md](RISK_REGISTER.md) aufgenommen.

## 6. GO/NO-GO

**Finales GO** des Projektleiters (ChatGPT) für den Abschluss von Phase 3A
liegt vor: „Finales GO: Phase 3A – Fragen-Engine darf mit Abschlussbericht
als abgeschlossen gemeldet werden." Der nächste Phase-3-Schritt bleibt bis
zur Prüfung und ausdrücklichen Freigabe dieses Abschlussberichts durch den
Projektleiter gesperrt.

## 7. Nächste Schritte

Dieser Bericht wird dem Projektleiter zur Prüfung vorgelegt. Erst nach
dessen ausdrücklicher Freigabe beginnt der nächste Schritt in Phase 3.
