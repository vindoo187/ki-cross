# Phase 12 AP5 – Discovery: Echter externer KI-Provider

**Status:** Reines Discovery-/Entscheidungsdokument. Kein Code, keine API-Schlüssel,
kein Prompt-Produktivbetrieb, keine Aktivierung des Features (`Tenant.aiExtractionEnabled`
bleibt `false`). Grundlage: ChatGPTs GO vom 2026-08-23 nach Abnahme von AP4
(siehe `project_ki_cross_phase11_plan_go`-Memory). Ziel dieses Dokuments ist
eine konkrete Entscheidungsvorlage (Provider + Datenschutzmodell + Datenfluss
+ Kostenmodell + Timeout/Fallback + Prompt/Structured-Output-Vertrag), die
ChatGPT anschließend bestätigt oder korrigiert. Erst danach folgt ein
separates Implementierungs-GO.

## 0. Ausgangslage (bereits bestehende, architektonisch fixierte Fakten)

Diese Punkte sind bereits durch AP1–AP4 gebaut und werden durch AP5 NICHT
verändert — sie bilden die Leitplanken, innerhalb derer die folgenden acht
Punkte beantwortet werden:

- **Provider-Abstraktion existiert bereits:** `AiExtractionProvider`
  (`src/server/ai-extraction/contract.ts`) ist das einzige Interface, über
  das ein Provider jemals Kontakt mit dem System hat: `extract(request):
  Promise<AiExtractionCandidate[]>`. Ein echter Provider ersetzt lediglich
  `MockExtractionProvider` in `service.ts` (aktuell als Modul-Singleton
  instanziiert) — keine Änderung an Route, Validator oder UI nötig.
- **Freitext-Grenze ist bereits hart gezogen:** `freeText` verlässt den
  Request-Handler ausschließlich über `AiExtractionProvider.extract()`
  (`contract.ts`-Modulkommentar). Kein anderer Code-Pfad (Validator,
  Analytics, Audit, Logs) fasst diesen Wert an — bereits durch AP4s
  PII-Scanner-Regressionstest sowie den Modulkommentar in `service.ts`
  dokumentiert und verifiziert.
- **Structured Output ist bereits erzwungen:** `AiExtractionCandidate[]`
  (`types.ts`) ist die einzige Rückgabeform; ein Provider kann strukturell
  keine `CustomerAnswer` erzeugen — das passiert ausschließlich über den
  unveränderten `saveAnswer()`/`changeAnswer()`-Pfad nach expliziter
  Mitarbeiterbestätigung (AP3). `extraction-validator.ts` prüft danach jeden
  Kandidaten serverseitig (Fragenkatalog-Zugehörigkeit, Typkonsistenz,
  Wertebereich, Mehrdeutigkeit) — ein Provider gilt als nicht
  vertrauenswürdig, unabhängig davon, was er liefert.
- **Sichtbarer Fragenkatalog ist bereits serverseitig fixiert:**
  `buildVisibleQuestionContext()` liefert ausschließlich bereits sichtbare,
  unbeantwortete, NICHT-`SHORT_TEXT`-Fragen (`visible-question-context.ts`).
  Ein Provider bekommt nie mehr als diesen Katalog.
- **Zugriffsschutz ist bereits vollständig:** Route + Service prüfen in
  fester Reihenfolge Auth → Tenant → Session-Ownership → Permission
  (`consultation.ai_extraction.use`) → Tenant-Feature-Flag
  (`Tenant.aiExtractionEnabled`, aktuell überall `false`) → Session-Status
  (`IN_PROGRESS`). Ein echter Provider ändert an dieser Kette nichts.
- **Kein bestehendes Secret-Management für externe API-Schlüssel:** Das
  Projekt hat aktuell keine Konvention für Provider-API-Schlüssel (nur
  `DATABASE_URL`, implizit über Prisma). Dies muss als Teil der eigentlichen
  AP5-Implementierung (nicht dieser Discovery) neu etabliert werden —
  Umgebungsvariable pro Deployment, niemals im Repo, niemals in Logs.

## 1. Provider/Modell

**Offene Entscheidung — noch keine Festlegung durch diese Discovery.**

Kandidaten (rein zur Diskussion, keine Vorfestlegung):

| Kriterium | Anforderung (aus `PRIVACY_AND_SECURITY.md`, EU-Hosting-Abschnitt) |
| --- | --- |
| Datenverarbeitung | innerhalb der EU oder gleichwertiges Schutzniveau (z. B. Standardvertragsklauseln) |
| Training auf übermittelten Daten | ausgeschlossen — muss vertraglich zugesichert sein (Opt-out/"kein Training" ist bei den meisten großen Anbietern per API-Vertrag Standard, muss aber explizit verifiziert werden) |
| AVV/Unterauftragsverarbeiter | Pflicht vor Produktivbetrieb (`PRIVACY_AND_SECURITY.md`, EU-Hosting-Abschnitt) |
| Drittlandtransfer | falls unvermeidbar: Standardvertragsklauseln + Transfer Impact Assessment |
| Structured-Output-Fähigkeit | Anbieter muss zuverlässiges JSON-Schema-/Function-Calling-Format unterstützen (Anthropic/OpenAI/Mistral bieten das alle an) |

Diese Discovery trifft **keine Anbieterentscheidung** — das ist eine
Geschäfts-/Kostenentscheidung, die über den technischen Scope einer
Codebase-Analyse hinausgeht und explizit von ChatGPT (Projektleiter) bzw.
dem Nutzer getroffen werden muss (AVV-Abschluss, Vertragskosten). Vorschlag:
ChatGPT benennt den bevorzugten Anbieter/Modell auf Basis dieser Tabelle,
danach wird `providers/<name>-provider.ts` als zusätzliche
`AiExtractionProvider`-Implementierung gebaut (kein Umbau bestehender
Schichten).

## 2. Datenschutz des Freitexts

**Empfehlung (zur Bestätigung durch ChatGPT):**

- Der Freitext wird **ausschließlich transient** für den einzelnen
  Extraktionsaufruf verwendet — keine Persistierung in der eigenen DB, weder
  vor noch nach dem Provideraufruf. Dies verlängert lediglich die bereits
  bestehende Regel (`contract.ts`: "wird NICHT persistiert") auf den echten
  Provider-Request selbst.
- Beim Provider gilt dieselbe Anforderung: kein Speichern des Requests über
  die Dauer der Anfrage hinaus (bei den großen Anbietern typischerweise per
  API-Vertrag/Zero-Data-Retention-Option einstellbar — muss vertraglich
  geprüft werden, nicht nur technisch angenommen).
- **Kein vorgelagertes PII-Redigieren des Freitexts geplant.** Begründung:
  der bestehende PII-Scanner (`contact-data-guard.ts`) ist für strukturierte
  `AnalyticsEvent`/`AuditLog`-Payloads gebaut (Objektfelder, nicht Fließtext)
  und hat einen bekannten Fehlalarm bei Datumsstrings (Phase 11 AP2/CI #85,
  AP4-Regressionstest) — auf Fließtext angewendet, wäre das Fehlalarmrisiko
  deutlich höher (z. B. würde eine Postleitzahl oder Hausnummer im Freitext
  fälschlich als Telefonnummer erkannt und der Extraktionslauf grundlos
  blockiert). Stattdessen: der Freitext soll laut Fachkonzept ohnehin nur
  Bedarfsangaben enthalten ("Kunde zieht im September um, braucht mehr
  Datenvolumen"), keine Namens-/Kontaktfelder — das ist eine
  Prozess-/Schulungsfrage (Mitarbeiterhinweis in der UI), keine technische
  Filterung. **Offene Frage an ChatGPT:** reicht ein UI-Hinweistext ("Bitte
  keine Namen oder Kontaktdaten eingeben") oder wird eine technische
  Vorprüfung dennoch verlangt?
- Löschfristen: da keine Persistenz stattfindet, entsteht keine neue
  Lösch-/Aufbewahrungspflicht (anders als bei `ConsultationSession`/
  `CustomerAnswer`, siehe `PRIVACY_AND_SECURITY.md`).
- Zugriffsmöglichkeiten: kein Mitarbeiter/Admin kann den Freitext im
  Nachhinein einsehen, da er nirgends gespeichert wird — auch nicht in
  Server-Logs (bereits bestehende Anforderung, `PRIVACY_AND_SECURITY.md`,
  "Keine sensiblen Daten in Logs").
- Tenant-Isolation außerhalb der DB: der Provider-Request muss pro Aufruf
  ausschließlich die Daten EINES Tenants enthalten (strukturell bereits so,
  da `buildVisibleQuestionContext()` immer nur die aktuelle Session einer
  Tenant-Session lädt) — kein Batching mehrerer Tenants in einem
  Provider-Call.
- Datenschutzhinweis vor dem Absenden: **Empfehlung ja**, ein kurzer,
  einmalig einblendbarer Hinweis am Freitext-Panel ("Freitext wird zur
  Analyse an einen externen KI-Dienst übermittelt, nicht dauerhaft
  gespeichert") — Umsetzung wäre Teil der eigentlichen AP5-Implementierung,
  nicht dieser Discovery.

## 3. Prompt-/Kontextdesign

- Übertragen wird ausschließlich: der eingegebene Freitext +
  `AiExtractionVisibleQuestion[]` (bereits exakt der Typ, den
  `AiExtractionRequest` heute an `MockExtractionProvider` übergibt — ein
  echter Provider bekommt strukturell nicht mehr Daten als der Mock).
  `AiExtractionVisibleQuestion` enthält: `questionId`, `label`,
  `answerType`, `answerOptions` (`key`+`label`), `minValue`/`maxValue`,
  `maxLength`, `minSelections`/`maxSelections` — keine anderen
  Kunden-/Tenant-/Sessiondaten.
- Systeminstruktion (Vorschlag, noch nicht implementiert): strikte
  Anweisung, ausschließlich JSON nach vorgegebenem Schema zurückzugeben,
  ausschließlich `questionId`s aus der übergebenen Liste zu verwenden, bei
  Unsicherheit die Frage schlicht wegzulassen ("nicht raten") — deckt sich
  mit dem bereits im Mock umgesetzten Grundsatz
  ("lieber 'nicht erkannt' als eine falsche strukturierte Antwort",
  `contract.ts`-Kommentar).
- Keine Session-Historie, keine vorherigen Freitexteingaben, keine bereits
  beantworteten Fragen im Prompt (bereits durch
  `buildVisibleQuestionContext()`s Filter auf unbeantwortete Fragen
  strukturell ausgeschlossen).
- `SHORT_TEXT` bleibt ausgeschlossen (bereits im Typsystem erzwungen:
  `AiExtractionVisibleQuestion.answerType` ist
  `Exclude<AnswerType, "SHORT_TEXT">`).
- Keine neuen Fragen/Keys: der Provider darf niemals `questionId`s erfinden
  — bereits von `extraction-validator.ts` hart durchgesetzt (Kandidat mit
  unbekannter `questionId` wird verworfen).

## 4. Structured Output

Bereits vollständig durch die bestehende Architektur erzwungen (siehe
Abschnitt 0) — für AP5 nur zu bestätigen, nicht neu zu entscheiden:
Freitext → `AiExtractionProvider.extract()` → `AiExtractionCandidate[]` →
`extraction-validator.ts` → Mitarbeiter bestätigt/ändert/verwirft →
bestehender `saveAnswer()`-Pfad. Ein echter Provider müsste sein natives
Function-Calling-/JSON-Mode-Format auf genau diese
`AiExtractionCandidate`-Struktur abbilden — reine Mapping-Aufgabe innerhalb
der neuen Provider-Implementierung, keine Änderung an Schicht 4–6.

## 5. Modellstrategie

**Empfehlung (zur Bestätigung durch ChatGPT), noch nicht implementiert:**

- Temperatur/Randomness minimieren (niedrige oder Null-Temperatur), da
  keine Kreativität, sondern zuverlässige Extraktion gefragt ist —
  konsistent mit dem Determinismus-Anspruch, den `MockExtractionProvider`
  bereits für die Testbarkeit der Pipeline erfüllt (der echte Provider wird
  naturgemäß NICHT bit-genau deterministisch sein wie der Mock — das ist
  laut ChatGPTs ursprünglicher Mock-Begründung auch nicht das Ziel, aber
  eine möglichst konsistente Ausgabe bei gleichem Input bleibt wünschenswert).
- Striktes JSON-Schema/Function-Calling statt Freiform-Text-Parsing, um
  Parsing-Fehler zu minimieren.
- Token-/Kostenlimit pro Aufruf (siehe Abschnitt 8).
- Timeout: klar definierter Wert (Vorschlag als Diskussionsgrundlage:
  5–10 Sekunden, da der Mitarbeiter im laufenden Kundengespräch wartet) —
  bei Überschreitung kein Vorschlag, kein Fehlerzustand für den
  Fragebogen (siehe Abschnitt 6).
- Providerfehler/ungültige/leere Antwort: einheitlich wie ein leeres
  `AiExtractionCandidate[]`-Ergebnis behandeln (das Interface erlaubt dies
  bereits explizit — `contract.ts`: "Ein leeres Array ist ein vollkommen
  valides Ergebnis") — kein Sonderfehlerpfad in Route/UI nötig.
- Rate Limit: providerseitig vorhanden, zusätzlich eigene Begrenzung
  sinnvoll (siehe Abschnitt 8).

## 6. Fallback

Bereits architektonisch angelegt, keine neue Entscheidung nötig: das
Feature ist rein additiv (`AiExtractionForm` nur sichtbar bei Permission
UND Feature-Flag, AP3). Bei Providerausfall/-timeout liefert
`requestAiExtraction()` schlicht keine bzw. wenige Kandidaten zurück (siehe
Abschnitt 5) — der normale Fragen-Flow (`QuestionFlow.tsx`, manuelle
Eingabe) ist davon vollständig unberührt, da er nicht von der
KI-Extraktion abhängt. Für AP5 zu ergänzen: eine klare Unterscheidung
zwischen "Provider antwortet, aber liefert 0 Kandidaten" (normal, kein
Fehler) und "Provider ist technisch nicht erreichbar" (sollte dem
Mitarbeiter dezent signalisiert werden, z. B. "KI-Vorschläge aktuell nicht
verfügbar" statt eines harten Fehlers) — UI-Detail, Teil der
Implementierung, nicht dieser Discovery.

## 7. Provider-Abstraktion

Bereits vorhanden (siehe Abschnitt 0) — für AP5 nur zu bestätigen:
`AiExtractionProvider`-Contract bleibt unverändert, `MockExtractionProvider`
bleibt als Testimplementierung bestehen (weiterhin von der bestehenden
Unit-/Integrationstestsuite verwendet, damit diese unabhängig von
Providerkosten/-verfügbarkeit lauffähig bleibt), ein echter Provider wird
als zusätzliche Klasse in `src/server/ai-extraction/providers/` ergänzt.
Welche Implementierung `service.ts` instanziiert, wird sinnvollerweise über
eine Umgebungsvariable gesteuert (z. B. für Tests/CI weiterhin Mock, für
einen späteren Piloten der echte Provider) — konkrete Umsetzung ist
Implementierungsdetail von AP5, nicht dieser Discovery.

## 8. Kostenkontrolle

**Besonders relevant, da das Feature bereits über Permission UND
Tenant-Feature-Flag abgesichert ist** (ChatGPTs Hinweis) — Vorschläge zur
Diskussion, keine finale Festlegung:

- Maximale Zeichenlänge des Freitexts: bereits eine Konvention im Projekt
  erwähnt (AP2-Bericht nennt "4000-Zeichen-Grenze" als Eingabe-Hygiene,
  von ChatGPT als "korrekt nur als Input-Hygiene eingeordnet" bestätigt) —
  dieselbe Grenze reduziert automatisch auch das Token-Volumen pro Anfrage.
  Zu klären: reicht diese bestehende Grenze auch als Kostenobergrenze, oder
  ist ein zusätzliches, enger gefasstes Limit spezifisch für den
  Provider-Prompt sinnvoll?
- Maximale Extraktionsaufrufe: aktuell keine Begrenzung pro Session/
  Mitarbeiter/Tenant vorhanden (der Mock verursacht keine Kosten, daher
  bisher nicht nötig) — für AP5 zu klären, ob ein Aufruflimit pro Session
  (z. B. "maximal N KI-Anfragen pro Beratung") und/oder pro
  Mitarbeiter/Tag sinnvoll ist.
- Rate Limit pro Mitarbeiter/Tenant: providerseitig vorhanden, zusätzlich
  eigene Begrenzung auf Anwendungsebene sinnvoll, um einen einzelnen
  Tenant/Mitarbeiter nicht das gesamte Kostenbudget verbrauchen zu lassen.
- Kostenmessung über Analytics: bereits vorhandene Infrastruktur nutzbar —
  `AI_EXTRACTION_REQUESTED`/`AI_EXTRACTION_COMPLETED` (AP4) könnten um ein
  rein numerisches, nicht-PII-behaftetes Feld ergänzt werden (z. B.
  `promptTokenCount`/`completionTokenCount`, sofern der Provider diese
  Werte zurückliefert) — wäre eine additive Erweiterung des bestehenden
  Payload-Schemas (`event-payload-schemas.ts`), keine neue Struktur.
  **Offene Frage an ChatGPT:** soll dies bereits Teil von AP5 sein, oder
  bewusst zurückgestellt?

## 9. Zusammenfassung / Entscheidungsvorlage

| Punkt | Vorschlag dieser Discovery | Entscheidung ChatGPT |
| --- | --- | --- |
| Provider/Modell | Kein Vorschlag — Geschäftsentscheidung (Kosten/AVV), Kriterientabelle Abschnitt 1 | offen |
| Datenschutz Freitext | Transient, keine Persistenz, kein technisches PII-Redigieren des Freitexts, UI-Hinweistext | offen |
| Prompt-/Kontextdesign | Nur `freeText` + `AiExtractionVisibleQuestion[]`, striktes JSON, "nicht raten" | offen |
| Structured Output | Bereits erzwungen, nur Bestätigung nötig | — |
| Modellstrategie | Niedrige Temperatur, Timeout 5–10s (Vorschlag), leeres Array bei Fehler | offen |
| Fallback | Bereits additiv/non-blocking, UI-Unterscheidung "0 Kandidaten" vs. "nicht erreichbar" ergänzen | offen |
| Provider-Abstraktion | Bereits vorhanden, Mock bleibt Testimplementierung | — |
| Kostenkontrolle | Bestehende 4000-Zeichen-Grenze prüfen, Aufruflimit + Rate Limit + optionale Token-Zählung in Analytics | offen |

## 10. Ausdrücklich NICHT Teil dieser Discovery

Kein Code, kein API-Schlüssel, keine Anbieterentscheidung, keine
Aktivierung von `Tenant.aiExtractionEnabled`, keine Änderung an
`saveAnswer()`/`changeAnswer()`, keine KI in `computeVisiblePath()`/
Eligibility/Prioritization/Recommendation, keine Vertragsautomatisierung,
kein automatisches Überschreiben bestehender Antworten, keine
Bulk-Bestätigung, keine dauerhafte Speicherung des Freitextes als
Kundendatenfeld — exakt die von ChatGPT am 2026-08-23 genannte Liste.
