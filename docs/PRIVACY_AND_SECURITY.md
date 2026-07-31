# Datenschutz und Sicherheit

Dieses Dokument ist integraler Bestandteil der Architektur, nicht ein späterer Zusatz. Alle folgenden Punkte gelten bereits für MVP und Pilot.

## Zweckbindung

Das System erfasst Daten ausschließlich für zwei klar getrennte Zwecke:

1. **Beratungsunterstützung im Gespräch** (Fragen/Antworten/Empfehlung während der aktiven Session).
2. **Aggregierte, unternehmensbezogene Auswertung** (KPIs auf Filial-/Mitarbeiter-/Zeitraumebene).

Was **nicht** Zweck des Systems ist: individuelle Mitarbeiterüberwachung als Selbstzweck, Verhaltensprofile einzelner Kunden über mehrere Besuche hinweg (sofern nicht gesondert entschieden, siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md)), Weitergabe von Beratungsdaten an Provider ohne Rechtsgrundlage.

## Datensparsamkeit

- Kundenantworten werden **ohne Klarnamen-Zwang** erfasst (siehe `CustomerAnswer` in [DATA_MODEL.md](DATA_MODEL.md)); ein Name/Kontakt wird nur erfasst, wenn für den Abschluss (`Deal`) zwingend nötig, in einer separaten Entität.
- Freitextfelder werden nicht ungeprüft in Analytics-Aggregationen übernommen, um versehentliche Erfassung personenbezogener Angaben in KPI-Auswertungen zu vermeiden.
- Analytics-Events referenzieren `session_id`, nicht Kundenname/Kundennummer.

## Trennung personenbezogener Daten von Analysedaten

- `ConsultationSession`/`CustomerAnswer` (potenziell personenbeziehbar über den Gesprächskontext) und `AnalyticsEvent`/`KpiSnapshot` (aggregiert) liegen konzeptionell getrennt; Aggregationen sind nach Aufbereitung nicht mehr auf einzelne Kunden rückführbar (**Anforderung**, technisch bei Aggregationsschritt sicherzustellen, z. B. Mindestgruppengröße bei kleinteiligen Auswertungen).
- Rohdaten einzelner Sessions und aggregierte Geschäftsführungs-KPIs haben unterschiedliche Zugriffsrechte (siehe [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md)).

## Aufbewahrung und Löschung

**Offene Entscheidung** (siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md)): konkrete Aufbewahrungsfristen für `ConsultationSession`/`CustomerAnswer` mit Kundenbezug. Vorschlag als Ausgangsbasis:

| Datenart                                               | Vorschlag Aufbewahrung                                                                                                                                          | Begründung                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Session-/Antwortdaten mit Kundenbezug (kein Abschluss) | zeitnah löschen/anonymisieren nach Ablauf einer kurzen Frist (**Annahme:** 90 Tage), sofern kein Abschluss und keine Wiedervorlage vereinbart                   | kein fortlaufender Bedarf ohne Vertragsbezug     |
| Session-/Antwortdaten mit Abschluss (`Deal`)           | Aufbewahrung entsprechend vertrags-/handelsrechtlicher Fristen (**Annahme:** an bestehende Aufbewahrungspflichten des Unternehmens koppeln, nicht neu erfinden) | rechtliche Nachweispflichten                     |
| Aggregierte, nicht personenbeziehbare KPI-Daten        | langfristig, zeitlich unbegrenzt (kein Personenbezug mehr)                                                                                                      | Grundlage für Jahresvergleiche                   |
| Audit-Logs                                             | an bestehende Compliance-Vorgaben des Unternehmens koppeln (**offen**)                                                                                          | Nachvollziehbarkeit vs. Datensparsamkeit abwägen |

Löschung muss technisch als Prozess (nicht nur Regel auf Papier) umgesetzt werden: zeitgesteuerter Job, der Fristen aus der Konfiguration liest.

## Rollen- und Rechtekonzept

Siehe [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md) – serverseitig erzwungenes RBAC ist Voraussetzung für DSGVO-konforme Zugriffskontrolle (Art. 25, 32 DSGVO – Datenschutz durch Technikgestaltung).

## Keine sensiblen Daten in Logs

- Anwendungs-/Fehler-Logs (technische Logs, nicht `AuditLog`) dürfen keine Kundenantworten, Namen oder Kontaktdaten enthalten – nur IDs, Zeitstempel, technische Fehlermeldungen.
- `AuditLog` (fachliche Nachvollziehbarkeit von Konfigurationsänderungen) speichert bewusst **keine** Kundendaten, sondern nur Konfigurationsänderungen (siehe [DATA_MODEL.md](DATA_MODEL.md)).

## Keine echten Kundendaten in Tests

Test- und Entwicklungsumgebungen verwenden ausschließlich synthetische Daten. Dies ist eine bindende Qualitätsanforderung für alle Implementierungsphasen (siehe [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)), nicht optional.

## EU-Hosting

Pflichtkriterium bei der Wahl von Hosting-Anbieter und ggf. externem KI-Dienst: Datenverarbeitung muss innerhalb der EU (oder mit gleichwertigem Schutzniveau, z. B. durch Standardvertragsklauseln) möglich sein. Konkrete Anbieterwahl ist offene Entscheidung (siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md)).

Bei Nutzung eines externen KI-Dienstes (z. B. für Gesprächszusammenfassung) gilt: nur strukturierte, bereits von Regeln verarbeitete Daten werden übermittelt, keine direkten Namens-/Kontaktdaten; Auftragsverarbeitungsvertrag (AVV) mit dem KI-Anbieter ist Voraussetzung vor Produktivbetrieb.

## Einwilligungs- und Informationsprozesse (spätere Phase, aber jetzt mitzudenken)

- Kunden müssen (abhängig von der finalen Entscheidung zu Kundendatenerfassung) über die Verarbeitung informiert werden, sobald personenbezogene Daten über die reine Bedarfsanalyse hinaus erfasst werden (z. B. Kontaktdaten für Wiedervorlage).
- Das Datenmodell sieht bereits jetzt vor, dass ein `CustomerRef` (falls genutzt) unabhängig von den Analyse-/Antwortdaten löschbar ist, um spätere Einwilligungswiderrufe technisch sauber umsetzen zu können.

## Sicherheitsmaßnahmen (Basis, nicht abschließend)

- Transportverschlüsselung (TLS) für alle Client-Server-Kommunikation.
- Serverseitige Autorisierungsprüfung vor jedem Datenzugriff (kein "Security by UI").
- Passwort-/Zugangsdaten niemals im Klartext, Standard-Hashing-Verfahren für Zugangsdaten.
- Eingabevalidierung serverseitig (Zod-Schemas oder vergleichbar), nicht nur clientseitig.
- Audit-Log ist unveränderlich (append-only) für Konfigurationsänderungen.

Ein dedizierter, tieferer Sicherheits-Review (z. B. Threat Modeling, Penetrationstest) ist vor Produktivbetrieb mit echten Kundendaten vorzusehen – als eigener Meilenstein im [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), nicht als vage "später"-Notiz.
