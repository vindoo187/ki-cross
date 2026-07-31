# Dynamische Fragen- und Regel-Engine

## Zweck

Ersetzt eine starre Checkliste durch einen Fragenfluss, der sich aus vorherigen Antworten ergibt: Fragen erscheinen nur, wenn sie relevant sind, und nicht immer in derselben Reihenfolge.

## Grundmodell: gerichteter Graph statt linearer Liste

Jede `Question` gehört zu einem `Topic` (z. B. Vertragsstatus, Datenvolumen, Haushalt, Internet, Streaming, Zubehör). Ob und wann eine Frage angezeigt wird, bestimmt eine `VisibilityCondition`:

```
VisibilityCondition:
  question_id: "device_preference"
  show_if: answer("new_device_wanted") == true

VisibilityCondition:
  question_id: "partner_card_interest"
  show_if: answer("household_size") >= 2

VisibilityCondition:
  question_id: "young_tariff_check"
  show_if: answer("household_has_minors") == true OR answer("household_has_young_adults") == true

VisibilityCondition:
  question_id: "internet_contract_details"
  show_if: answer("has_existing_internet_contract") == true
```

Bedingungen sind **konfigurierbar (Daten), kein Code** – ein Admin legt sie über Fragebogen-Verwaltung fest (siehe unten "Administration").

## Ablaufsteuerung pro Session

1. Bei Sessionstart wird die **aktuell aktive** `QuestionnaireVersion` des Mandanten als Snapshot der Session zugeordnet (spätere Änderungen am Fragebogen wirken nicht rückwirkend auf laufende/abgeschlossene Sessions – Konsistenz mit dem Versionierungsprinzip).
2. Der Client hält den Fragebogen + Bedingungen lokal vor (siehe [ARCHITECTURE.md](ARCHITECTURE.md), Antwortgeschwindigkeit) und berechnet die nächste sinnvolle Frage clientseitig aus den bisherigen Antworten.
3. Nach jeder Antwort wird die Menge der noch offenen, sichtbaren Pflicht- und Optionalfragen neu berechnet ("Frage-Frontier"), nicht die gesamte Liste neu abgefragt.
4. Pflichtfragen (`is_required = true`) müssen beantwortet oder explizit als "nicht ermittelbar" markiert sein, bevor eine Empfehlung mit voller Konfidenz ausgegeben wird (siehe Datenqualität in [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md)).
5. Der Mitarbeiter kann jederzeit zu einer bereits übersprungenen oder späteren Frage springen (kein Zwang zur strikten Reihenfolge) – die UI zeigt Fortschritt nach **Themenblöcken abgeschlossen**, nicht nach starrer Fragennummer.

## Rolle der KI in der Fragen-Engine (optional, nicht kritisch)

Die KI-Komponente darf **zusätzlich** zur regelbasierten Sichtbarkeit eine Rangfolge unter den aktuell zulässigen (bereits durch Regeln freigeschalteten) Folgefragen vorschlagen – z. B. "diese Frage ist im Gesprächsverlauf gerade am natürlichsten". Sie darf **keine neuen Fragen erzeugen** und **keine Pflichtfrage unterdrücken**. Fällt die KI aus, greift eine feste Standardreihenfolge je Topic (deterministischer Fallback).

## Beispielhafte Themenblöcke (nicht abschließend, siehe Auftrag für Vollliste)

| Themenblock       | Auslöser für Vertiefung                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vertragsstatus    | immer zuerst: Neuvertrag oder Verlängerung, aktueller Anbieter                                                                                        |
| Nutzungsverhalten | immer: Datenvolumen, Telefonie                                                                                                                        |
| Gerät             | nur wenn `new_device_wanted = true`                                                                                                                   |
| Haushalt/Family   | nur wenn `household_size > 1` oder Family-relevante Vorantwort                                                                                        |
| Young-Tarife      | nur bei Minderjährigen/jungen Erwachsenen im Haushalt                                                                                                 |
| Internet          | nur bei geäußertem Bedarf oder bestehendem Vertrag                                                                                                    |
| Streaming         | nur wenn Bedarf nicht bereits verneint                                                                                                                |
| Geräteschutz      | nur bei Geräte-Neukauf oder geäußertem Sicherheitsbedürfnis                                                                                           |
| Zubehör           | am Ende, kurz, überspringbar                                                                                                                          |
| Wiedervorlage     | wenn Vertragsende weit in der Zukunft liegt (**Annahme:** Schwelle konfigurierbar, Default > 6 Monate – siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md)) |

## Administration (fachlich, ohne Code-Änderung)

Über eine Admin-Oberfläche (nicht Teil des MVP, siehe [MVP_SCOPE.md](MVP_SCOPE.md)) können berechtigte Rollen:

- Fragen anlegen/ändern/deaktivieren, Antwortoptionen festlegen
- `VisibilityCondition`/Folgefragen-Regeln definieren
- Fragen als Pflicht/optional markieren
- eine neue `QuestionnaireVersion` veröffentlichen (alte Version bleibt für laufende/historische Sessions erhalten)

## Antwortformen

- **Strukturiert:** single-choice, multi-choice, numeric, Skala, Datum – bevorzugt, da maschinell auswertbar und Basis der Regel-Engine.
- **Freitext:** zulässig für Fälle, die sich nicht sauber strukturieren lassen ("weitere individuelle Bedürfnisse"); Freitext fließt **nicht direkt** in die Eignungsregeln ein, sondern wird separat angezeigt und kann optional durch KI zusammengefasst/kategorisiert werden (nicht entscheidungsrelevant für Tarifauswahl, siehe [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md)).

## Abgrenzung zur Empfehlungslogik

Die Fragen-Engine liefert **Zustand** (welche Antworten liegen vor, welche Pflichtfragen fehlen). Was daraus an Empfehlungen folgt, ist nicht Teil dieser Engine, sondern der [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md).
