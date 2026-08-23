# Produktvision

## Ausgangslage

Fünf Filialen eines Mobilfunkhändlers verkaufen Verträge (O2/Telefónica, Telekom, Freenet, später weitere), Geräte, DSL/Glasfaser, Family- und Streaming-Produkte sowie Zubehör. Die Beratungsqualität hängt heute vom einzelnen Mitarbeiter ab: Fragen werden unterschiedlich gestellt, Cross-Selling-Chancen unterschiedlich genutzt, Empfehlungen unterschiedlich begründet.

## Produktidee

Ein **dynamischer Verkaufsassistent**, der Mitarbeiter live während des Kundengesprächs begleitet: er stellt situationsabhängige Fragen, leitet daraus nachvollziehbare Tarif- und Produktempfehlungen ab und macht das Ergebnis für die Geschäftsführung messbar. Kein starres Formular, kein Chatbot, der frei antwortet – sondern eine Kombination aus geführtem Dialog, regelbasierter Logik und optionaler KI-Unterstützung für Sprache und Zusammenfassung.

**Nicht-Ziele (explizit ausgeschlossen):**

- Das System trifft keine automatischen Vertragsabschlüsse und ersetzt nicht die Entscheidung des Mitarbeiters oder Kunden.
- Das System ist kein Chatbot mit freiem KI-generiertem Produkt- oder Preisvorschlag.
- Keine automatisierte Anbindung an Provider-Portale in dieser Phase.
- Keine Bewertung oder Sanktionierung einzelner Mitarbeiter als primärer Zweck der Analytics (siehe [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md), Zweckbindung).

## Nutzergruppen

| Rolle                                      | Nutzung                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Verkaufsmitarbeiter (Filiale)              | führt das Gespräch mit Unterstützung des Assistenten, sieht Empfehlungen inkl. Begründung, kann jederzeit abweichen                           |
| Filialleitung                              | sieht Ergebnisse der eigenen Filiale, keine unternehmensweite Sicht (**Annahme**, siehe [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md)) |
| Geschäftsführung                           | sieht unternehmensweites Dashboard mit KPIs, Zielen, Filial-/Mitarbeitervergleich                                                             |
| Administrator (fachlich, keine Entwickler) | konfiguriert Fragen, Regeln, Ziele, Kampagnen ohne Code-Änderung                                                                              |
| (später) Mandant/Vertriebspartner          | eigene Instanz mit eigenen Produkten, Zielen, Nutzern – siehe Mandantenfähigkeit in [ARCHITECTURE.md](ARCHITECTURE.md)                        |

## Zielbild in einem Satz

Jeder Mitarbeiter in jeder Filiale führt ein strukturiert gleichtes, aber vollständiges Beratungsgespräch, das relevante Bedarfe erkennt, passende und wirtschaftlich sinnvolle Angebote vorschlägt, Cross-Selling nicht vergisst – und dessen Ergebnis für die Geschäftsführung auswertbar ist, ohne dass eine KI die Tarifentscheidung "erfindet".

## Kernprinzipien (bindend für alle weiteren Entwürfe)

1. **Erklärbarkeit vor Automatisierung** – jede Empfehlung muss auf strukturierte Daten und Regeln zurückführbar sein.
2. **Mitarbeiter behält die Kontrolle** – Empfehlungen sind Vorschläge, keine Vorgaben; Ablehnung/Änderung muss genauso leicht sein wie Annahme.
3. **Kein Dark Pattern** – keine künstliche Dringlichkeit, keine versteckten Vorbelegungen, keine Manipulation der Darstellung zugunsten margenstärkerer, aber ungeeigneter Produkte.
4. **Datensparsamkeit zuerst** – es wird nur erfasst, was für Beratung oder klar definierte Auswertung nötig ist.
5. **Versionierung von Wahrheit** – Tarife, Provisionen, Fragebögen und Regeln sind zeitlich versioniert; nachträgliche Änderungen verfälschen keine historischen Auswertungen.
6. **Mandantenfähigkeit von Anfang an im Datenmodell**, auch wenn Pilot und MVP nur intern laufen.
