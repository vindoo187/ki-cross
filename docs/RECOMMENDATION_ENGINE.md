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
