# Risikoregister

Bewertung: Eintrittswahrscheinlichkeit (E) und Auswirkung (A) jeweils niedrig/mittel/hoch, Stand der Erstanalyse (Greenfield, keine Codebasis).

## Technische Risiken

| Risiko                                                                                                             | E       | A      | Gegenmaßnahme                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Regel-Engine wird im Projektverlauf so komplex, dass Nachvollziehbarkeit leidet (viele verschachtelte Bedingungen) | mittel  | hoch   | strikte Trennung Eignung/Priorisierung beibehalten (siehe [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md)), Regeln testgetrieben entwickeln, keine impliziten Regelketten |
| KI-Komponente wird im Projektverlauf "mission-critical", obwohl als optional geplant                               | niedrig | hoch   | architektonische Trennung (siehe [ARCHITECTURE.md](ARCHITECTURE.md)) konsequent einhalten, Fallback-Pfade testen                                                               |
| Versionierungslogik (Tarife/Provisionen) wird nachträglich umgangen (direktes Überschreiben statt neue Version)    | mittel  | hoch   | append-only auf DB-Ebene erzwingen (kein Update-Recht auf abgeschlossene Versionen), nicht nur Konvention                                                                      |
| Clientseitige Fragen-Engine (Performance) gerät bei komplexem Regelwerk aus dem Takt                               | niedrig | mittel | frühzeitiger Lasttest mit realistischer Fragebogengröße in Phase 3                                                                                                             |

## Wirtschaftliche Risiken

| Risiko                                                                                                                | E       | A      | Gegenmaßnahme                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Aufwand für vollständige Produktabdeckung (5 Kategorien × mehrere Anbieter) wird unterschätzt                         | mittel  | mittel | MVP bewusst auf eine Kategorie begrenzt (siehe [MVP_SCOPE.md](MVP_SCOPE.md)), keine "Big Bang"-Umsetzung              |
| Provisionsdaten sind in der Praxis schwerer zu pflegen als angenommen (häufige, uneinheitliche Anbieteränderungen)    | mittel  | hoch   | offene Entscheidung #7 in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) früh klären, Pflegeprozess vor Phase 10 definieren   |
| Kein belastbarer Vorher-Vergleich verfügbar → Nutzen des Systems lässt sich der Geschäftsführung nicht sauber belegen | mittel  | hoch   | Baseline-Entscheidung (#5) vor Rollout treffen, nicht nachträglich versuchen zu rekonstruieren                        |
| Investition in Plattform-/Mandantenfähigkeit, obwohl Fremdverkauf nie verfolgt wird                                   | niedrig | mittel | Mandantenfähigkeit bewusst nur im Datenmodell, nicht im Betrieb vorgezogen (siehe [ARCHITECTURE.md](ARCHITECTURE.md)) |

## Operative Risiken

| Risiko                                                                                                           | E      | A      | Gegenmaßnahme                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Mitarbeiter empfinden System als zusätzliche Bürokratie statt Hilfe, Akzeptanz sinkt                             | mittel | hoch   | frühes echtes Nutzertesten in MVP (Abnahmekriterium 2), UI-Grundsatz "wenige, relevante Fragen" konsequent umsetzen            |
| Uneinheitliche Nutzung zwischen Filialen (manche nutzen es kaum) verfälscht Filialvergleich                      | mittel | mittel | Datenqualitäts-KPI (siehe [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md)) transparent mitausweisen, nicht nur Ergebnis-KPIs    |
| Fachadmin-Rolle wird nicht besetzt/geschult, Konfigurationspflege bleibt am Entwicklungsteam hängen              | mittel | mittel | Schulung/Übergabe als expliziter Teil von Phase 8, nicht implizit vorausgesetzt                                                |
| Wiedervorlage-Mechanismus wird nicht in bestehende CRM-/Kalenderprozesse der Mitarbeiter integriert und verpufft | mittel | mittel | Prüfen, ob echte Integration nötig ist oder eine einfache interne Liste ausreicht (Scope-Frage, ggf. neue offene Entscheidung) |

## Datenschutzbezogene Risiken

| Risiko                                                                                                                              | E       | A      | Gegenmaßnahme                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Freitextfelder enthalten doch personenbezogene/sensible Angaben, die in Auswertungen landen                                         | mittel  | hoch   | Freitext technisch von KPI-Aggregation getrennt halten (siehe [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md)), keine automatische Übernahme in Analytics |
| Löschkonzept existiert nur auf Papier, kein technischer Prozess                                                                     | mittel  | hoch   | Löschjob als Pflichtbestandteil vor Produktivbetrieb mit echten Kunden (siehe Phase 11 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md))                  |
| Externer KI-Dienst ohne AVV/EU-Konformität wird "schnell mal" angebunden                                                            | niedrig | hoch   | AVV-Prüfung als Abnahmekriterium vor Aktivierung jeder KI-Komfortfunktion                                                                                    |
| Mitarbeiter-KPIs werden faktisch zur Leistungsbewertung genutzt, ohne dass das arbeitsrechtlich/mitbestimmungsrechtlich geklärt ist | mittel  | hoch   | offene Entscheidung #13 vor Dashboard-Rollout an Geschäftsführung zwingend klären                                                                            |
| Kundendaten-Erfassung (Entscheidung #1) fällt erst spät, nachdem Datenmodell schon anders gebaut wurde                              | mittel  | mittel | Phase 0 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) verhindert das, wenn eingehalten                                                                 |

## Übergreifendes Risiko

Da der Projektordner leer war, existiert noch **keine** technische Validierung der hier getroffenen Annahmen (z. B. Performance der clientseitigen Regel-Engine, tatsächliche Komplexität der Provisionsdaten). Alle Risikoeinschätzungen sind Ersteinschätzungen auf Basis der fachlichen Anforderungen, nicht auf Basis von Code oder Prototyp – das Risikoregister sollte nach Phase 3/4 (erste lauffähige Engine) aktualisiert werden.
