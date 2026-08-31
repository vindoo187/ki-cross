# Empfehlungslogik

## Grundprinzip

Tarife und Produkte werden **nicht** von einem Sprachmodell frei ausgewählt. Die Empfehlung entsteht in drei klar getrennten Schritten, die einzeln nachvollziehbar und testbar sind.

```
1. Eignungsprüfung (objektiv, regelbasiert)
        ↓
2. Geschäftliche Priorisierung (konfigurierbar, regelbasiert)
        ↓
3. Darstellung/Begründung (optional KI-unterstützt für Formulierung, nicht für Auswahl)
```

## Schritt 1: Eignung (Eligibility)

Rein faktenbasiert aus `CustomerAnswer` + `ProductVersion`-Attributen. Beispiele für Regelarten:

- **EligibilityRule** (positiv): "Datenvolumen des Tarifs ≥ genannter Bedarf", "Vertragslaufzeit passt zu gewünschter Bindung".
- **ExclusionRule** (hart, harte Kante): "aktuelle Mindestvertragslaufzeit noch nicht erreicht und keine Sonderkündigung möglich" → Produkt wird nicht vorgeschlagen, unabhängig von Marge.

Ergebnis: eine Menge objektiv passender Produkte je Kategorie, mit einem `eligibility_score` (z. B. Grad der Bedarfsdeckung), **ohne** wirtschaftliche Gewichtung.

## Schritt 2: Geschäftliche Priorisierung

Auf der eignungsgeprüften Menge wirken konfigurierbare `PrioritizationRule`s, z. B.:

- Deckungsbeitrag/Marge des `CommissionModelVersion`
- aktive `Campaign`-Schwerpunkte (zeitlich begrenzt)
- unternehmensweite `Goal`-Vorgaben (z. B. Cross-Selling-Schwerpunkt DSL im Quartal)

Ergebnis: ein `priority_score` **zusätzlich** zum `eligibility_score`. Beide Werte werden **getrennt gespeichert und angezeigt** (Vorgabe: "klare Trennung zwischen objektiver Kundeneignung und geschäftlicher Priorisierung") – der Mitarbeiter sieht z. B. "3 passende Tarife, davon einer aktuell mit Kampagnen-Priorität", nicht nur einen anonymen "Top-Vorschlag".

## Schritt 3: Darstellung und Begründung

Jede Empfehlung enthält eine strukturierte Begründung, z. B.:

> "Empfohlen, weil: Datenvolumen 40 GB deckt genannten Bedarf (30 GB) ✓ · Laufzeit 24 Monate entspricht Kundenwunsch ✓ · Aktuelle Kampagne 'Glasfaser Q3' erhöht Priorität."

Die KI-Komponente darf diese strukturierten Fakten in natürliche Sprache übersetzen ("Formulierung"), aber **keine zusätzlichen Fakten, Preise oder Eigenschaften erfinden**. Technisch: die KI erhält nur bereits berechnete, strukturierte Werte als Input (Template-/Grounding-Zwang), nicht die Erlaubnis, eigenständig Produktdaten zu recherchieren oder zu schätzen.

## Wo KI zulässig ist – und wo nicht

| Bereich                                                                   | KI zulässig?                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Auswahl des empfohlenen Tarifs/Produkts                                   | **Nein** – ausschließlich Regeln                                   |
| Berechnung von Marge/Provision                                            | **Nein** – ausschließlich Stammdaten aus `CommissionModelVersion`  |
| Vorschlag sinnvoller nächster Frage                                       | Ja, als Komfortfunktion, mit deterministischem Fallback            |
| Zusammenfassung des Gesprächs                                             | Ja, aus strukturierten Antworten generiert                         |
| Sprachliche Formulierung der Begründung                                   | Ja, nur Umformulierung bereits vorhandener Fakten                  |
| Erkennen/Kategorisieren von Freitext ("weitere individuelle Bedürfnisse") | Ja, als Hinweis, nicht als Entscheidungsgrundlage für Tarifauswahl |

**Sales Playbook (Phase 14) ist bewusst NICHT an dieser Stelle integriert.** Das
Playbook-Subsystem (`Playbook`/`PlaybookVersion`/`PlaybookSection`, siehe
[DATA_MODEL.md](DATA_MODEL.md) Abschnitt "Sales Playbook") liefert Argumentations-/
Einwandbehandlungs-Text für Mitarbeitende, hat aber bis Phase 14 AP8 keinerlei
Code-Kopplung zu dieser Engine – kein Verzeichnis unter `src/server/recommendation/`
referenziert das Playbook-Subsystem (statischer Grep-Test, dauerhaft als Regression
abgesichert in `tests/integration/playbook-security.test.ts`). Tarifauswahl und
Priorisierung bleiben damit ausschließlich regelbasiert; Playbook-Inhalte können
diese Entscheidung strukturell nicht beeinflussen. Eine echte Verknüpfung (z. B.
Playbook-Text als Kontext für einen KI-Provider) ist erst für den späteren
Phase-12-AP5c-/Prompt-Integrationsschritt vorgesehen und dann explizit als
Kontext/Daten, nicht als höherpriorisierte Instruktion zu behandeln (siehe
[DECISION_LOG.md](DECISION_LOG.md), Phase 14 AP5).

## Umgang mit Ablehnung/Änderung durch den Mitarbeiter

Der Mitarbeiter kann jede Empfehlung:

- **annehmen** (→ `Deal`-Kandidat),
- **ändern** (anderes Produkt aus der eignungsgeprüften Menge oder frei, mit Kennzeichnung "manuell abweichend"),
- **ablehnen** (mit Pflichtangabe eines Ablehnungsgrunds aus fester Liste + optional Freitext, siehe `RecommendationOutcome` in [DATA_MODEL.md](DATA_MODEL.md)).

Diese drei Fälle sind für das Geschäftsführer-Dashboard zentral (angenommene/abgelehnte Empfehlungen, Gründe).

## Umgang mit unvollständigen Daten

Fehlen Pflichtangaben, wird **keine** finale Empfehlung mit hoher Konfidenz ausgegeben, sondern:

- die Engine zeigt an, welche fehlenden Angaben die Empfehlung einschränken ("Risiko/fehlende Angabe" in der UI, Vorgabe aus Auftrag),
- optional eine vorläufige Empfehlung mit reduziertem `eligibility_score` und sichtbarem Hinweis "unvollständige Datenbasis".

## Keine erfundenen Preise/Konditionen

Jede Empfehlung referenziert eine konkrete `ProductVersion`-ID mit `valid_from/valid_to`. Existiert für eine Kombination (Provider × Kategorie × Zeitpunkt) keine gepflegte, aktuell gültige `ProductVersion`, wird **keine** Empfehlung für diese Kombination generiert – die Engine zeigt stattdessen "kein aktuell hinterlegtes Angebot" statt eine KI-geschätzte Alternative.

## Testbarkeit

Da Schritt 1 und 2 reine Funktionen (Antworten + Stammdaten → Scores) sind, sind sie mit klassischen Unit-Tests vollständig abdeckbar, unabhängig vom Sprachmodell. Das ist Voraussetzung für die Abnahmekriterien in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Technischer Umsetzungsstand (Phase 3B)

Die drei oben beschriebenen Schritte sind seit Phase 3B als
`src/server/recommendation/`-Service-Schicht implementiert (bisher rein
konzeptionell). Fachlogik siehe oben unverändert; dieser Abschnitt ergänzt,
**wie** sie technisch umgesetzt ist.

**Regelmodell:** `RuleSetVersion` (genau eine `ACTIVE`-Version je Tenant zu
jedem Zeitpunkt, per PostgreSQL-`EXCLUDE`-Constraint erzwungen) bündelt vier
Regeltypen: `EligibilityRule` (mit `isRequired`-Hartgate und optionalem
`fitWeight`-Beitrag zum `customerFitScore`), `ExclusionRule` (harter
Ausschluss, `reasonCode` eindeutig je `RuleSetVersion`), `PrioritizationRule`
(Beitrag zum `businessPriorityScore`, optional provisionsbasiert mit
`commissionRequired`-Flag) und `CrossSellingRule`. Jede Regel besitzt
`RuleCondition`-Zeilen mit `sourceType ∈ {ANSWER, PRODUCT_ATTRIBUTE,
SESSION_ATTRIBUTE}` — Produkt-/Sitzungsattribute laufen über eine
geschlossene Attribute-Registry (`attribute-registry.ts`), Antworten über
den jeweiligen `QuestionVersion.answerType`.

**Orchestrierung (`evaluate()`):** Sitzung laden → Auswertbarkeit prüfen
(Status `IN_PROGRESS` oder `COMPLETED` — `ABANDONED` bleibt gesperrt; seit
AP14/CI#22-Fix explizit auch nach Abschluss des Fragebogens auswertbar, da
`completeQuestionnaire()` den Status bereits vor dem eigentlichen
"Empfehlung auswerten"-Schritt auf `COMPLETED` setzt, siehe
`assertSessionEvaluable()` in `service.ts`; Vollständigkeit über dieselbe
`computeVisiblePath()`/`computeProgress()`-Logik wie die Fragen-Engine aus
Phase 3A, aktive `RuleSetVersion` vorhanden) → Produktkandidaten laden →
je Kandidat Eignung, `customerFitScore`, Ausschluss und Priorisierung
(inkl. Provisionsauflösung) berechnen → `priorityRank` über alle Kandidaten
vergeben (Tie-Break: `businessPriorityScore DESC` → `customerFitScore
DESC` → `monthlyPriceMinor ASC` → `productVersionId ASC`) →
Cross-Selling-Regeln auswerten → Idempotenz-Fingerprint bilden (siehe
unten) → transaktionales Schreiben (`Recommendation` +
`RecommendationItem` + `RecommendationRationale` +
`RecommendationCrossSellingSignal` + `AnalyticsEvent`) → erst nach einem
tatsächlich neuen Schreibvorgang werden `SalesOpportunity`-Zeilen aus den
Cross-Selling-Signalen erzeugt (entkoppelt von der Auswertungstransaktion,
siehe unten). `getLatestRecommendation()` ist ein reiner Lesezugriff ohne
Auswertbarkeitsprüfung und funktioniert auch für `COMPLETED`-Sitzungen.

**Idempotenz statt Duplikate:** Jeder Auswertungslauf erhält einen
SHA-256-Fingerprint (`fingerprint.ts`) über eine kanonische
JSON-Repräsentation aller Eingaben (Antworten, Produktattribute,
Sitzungsattribute, Regelset-/Fragebogenversion, Algorithmusversion,
tenant-weit gültige Provisionsversionen, seit Phase 13 AP8 zusätzlich
tenant-/filialweit zum Auswertungszeitpunkt aktive `CampaignVersion`-IDs –
siehe Abschnitt "Campaign-Priorisierung und Attribution" unten). Zwei
Auswertungen derselben Sitzung mit identischem Fingerprint erzeugen
**keinen** neuen Datensatz
(Fast-Path-`SELECT` auf `(consultationSessionId, evaluationFingerprint)`
vor jedem Schreibversuch, außerhalb der Transaktion) — die bestehende
`Recommendation` wird unverändert zurückgegeben, insbesondere ohne erneute
`SalesOpportunity`-Erzeugung. Bei einer echten Race-Condition (zwei
parallele Auswertungsläufe mit identischem Fingerprint) sorgt der
Unique-Constraint für einen kontrollierten `P2002`-Konflikt; der Service
sucht danach erneut per `SELECT` und gibt den gewinnenden Datensatz
zurück, statt einen Duplikat-Fehler nach außen zu geben.

**Unveränderlichkeit vs. Vertriebs-Workflow:** `Recommendation`,
`RecommendationItem`, `RecommendationRationale` und
`RecommendationCrossSellingSignal` sind append-only (DB-Trigger, keine
`UPDATE`/`DELETE` möglich) — ein einmal erzeugter Auswertungslauf bleibt
für immer nachvollziehbar. `SalesOpportunity` ist bewusst **davon
ausgenommen** und bleibt mutable, da sie den tatsächlichen
Vertriebs-Workflow (Status, Zuweisung, Bearbeitung durch Mitarbeitende)
abbildet, nicht die unveränderliche Auswertungs-Momentaufnahme.

**Fehlerfälle:** `SessionNotEvaluableError`, `InsufficientAnswerDataError`
(inkl. `missingQuestionIds`), `RuleSetNotConfiguredError`,
`NoValidProductVersionError`, `CommissionModelUnresolvedError` (nur wenn
eine provisionspflichtige Regel keine gültige `CommissionModelVersion`
auflösen kann), `RecommendationConsistencyError` (P2002 ohne
Fingerprint-Treffer bei der Recovery-Suche — deutet auf Datenkorruption
oder einen Fingerprint-Berechnungsfehler hin). Vollständige Liste in
`src/server/recommendation/errors.ts`.

## Campaign-Priorisierung und Attribution (Phase 13)

**Bedingungstyp `CAMPAIGN_ACTIVE` (AP4):** `PrioritizationRule` und
`CrossSellingRule` können seit Phase 13 zusätzlich zu `ANSWER`/
`PRODUCT_ATTRIBUTE`/`SESSION_ATTRIBUTE` eine Bedingung vom
`sourceType = CAMPAIGN_ACTIVE` besitzen (`attributeKey` = Campaign-Key,
Operator `IS_ANSWERED`/`IS_NOT_ANSWERED` als "ist aktiv"/"ist nicht
aktiv"). Welche `Campaign`s zu einem Auswertungszeitpunkt aktiv sind, wird
über `loadActiveCampaignContext()` (`service.ts`) aufgelöst: genau wie
`ruleSetAt` (siehe oben) wird bewusst **JETZT** (der tatsächliche
Auswertungszeitpunkt), nicht der Session-Start verwendet – eine spätere
Kampagnen-Aktivierung/-Deaktivierung soll eine laufende Beratung
beeinflussen können, anders als das bewusst session-gepinnte
`commercialAt` für Preise/Provisionen (siehe DECISION_LOG.md,
Phase-13-AP4-Eintrag). `activeCampaignKeys` (reine Präsenzprüfung für die
Bedingungsauswertung) und `activeCampaignContext`
(`campaignId`/`campaignVersionId` je Key, für die Attribution unten)
stammen aus derselben Query/demselben Zeitpunkt, damit beide garantiert
konsistent sind.

**Attribution (`RecommendationCampaignSignal`, AP7):** Trägt eine
tatsächlich **getroffene** `PrioritizationRule`-Bedingung zu einer
Empfehlung bei einer Kampagne bei, wird dies als eigene, append-only
Analytics-Zeile (`RecommendationCampaignSignal`, FK auf
`RecommendationItem` + `Campaign` + `CampaignVersion`) atomar in derselben
Transaktion wie `Recommendation`/`RecommendationItem` gespeichert – nicht
als weiteres `RecommendationRationale`-Feld, um Attribution und
Begründungstext strukturell getrennt zu halten. Nur der Operator
`IS_ANSWERED` erzeugt ein Signal (`IS_NOT_ANSWERED` – "Kampagne ist gerade
NICHT aktiv" – ist eine gültige Bedingung, aber keine inhaltliche
Zurechnung zu dieser Kampagne). Referenzieren mehrere Regeln dieselbe
Kampagne für dasselbe `RecommendationItem`, entsteht **maximal ein**
Signal (Deduplizierung in `evaluatePrioritizationRules()`). **Bewusst
zurückgestellte Lücke:** `CrossSellingRule` kann `CAMPAIGN_ACTIVE`
ebenfalls als Bedingung nutzen, aber `RecommendationCampaignSignal` hat
strukturell nur eine FK auf `RecommendationItem`, nicht auf
`RecommendationCrossSellingSignal` – ein CrossSelling-Treffer erzeugt
daher aktuell **kein** Attributions-Signal (siehe DECISION_LOG.md,
Phase-13-AP7-Eintrag).

**Fingerprint-Fix (AP8, echter Befund):** Der Reproduzierbarkeits-
Regressionstest aus AP8 deckte auf, dass `evaluationFingerprint`
ursprünglich keine aktiven `CampaignVersion`-IDs enthielt. Da sich
zwischen zwei `evaluate()`-Aufrufen derselben Sitzung oft **nur** der
Kampagnenstatus ändert (keine Antworten/Produkte/Provisionsmodelle),
blieb der Fingerprint in diesem Fall identisch, der Idempotenz-Fast-Path
griff fälschlich, und eine erneute Auswertung nach einer
Kampagnen-Änderung lieferte weiterhin die alte, veraltete Empfehlung samt
altem Signal zurück, statt neu auszuwerten. Behoben durch
`FingerprintInput.campaignVersionIds` (siehe oben) – exakt analog zu
`commissionModelVersionIds`, aus dem ohnehin bereits geladenen
`activeCampaignContext` befüllt, keine Schemaänderung. Ein expliziter
Testschritt bestätigt zusätzlich, dass der Fast-Path bei unverändertem
Kampagnenstatus weiterhin korrekt greift (der Fix darf die Idempotenz
nicht generell deaktivieren). Details siehe DECISION_LOG.md,
Phase-13-AP8-Eintrag, und `tests/integration/recommendation-campaign-attribution.test.ts`.

Details und die vollständige Historie der Entscheidungsrevisionen (inkl.
aller vom Projektleiter geforderten Korrekturen) siehe
`PHASE_3B_IMPLEMENTATION_PLAN.md` sowie die Phase-3B-Einträge in
[DECISION_LOG.md](DECISION_LOG.md). Verifikationsstatus siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
