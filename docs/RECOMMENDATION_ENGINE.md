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
(Status `IN_PROGRESS`, Vollständigkeit über dieselbe
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
tenant-weit gültige Provisionsversionen). Zwei Auswertungen derselben
Sitzung mit identischem Fingerprint erzeugen **keinen** neuen Datensatz
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

Details und die vollständige Historie der Entscheidungsrevisionen (inkl.
aller vom Projektleiter geforderten Korrekturen) siehe
`PHASE_3B_IMPLEMENTATION_PLAN.md` sowie die Phase-3B-Einträge in
[DECISION_LOG.md](DECISION_LOG.md). Verifikationsstatus siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
