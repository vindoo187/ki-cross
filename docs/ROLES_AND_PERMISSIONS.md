# Rollen- und Berechtigungsmodell

## Prinzip

Rollenbasierte Zugriffskontrolle (RBAC), Berechtigungen immer im Kontext eines Scopes (Mandant/Unternehmen/Region/Filiale). Eine Rolle allein sagt nichts – erst Rolle + Scope ergibt eine Berechtigung ("Filialleitung von Filiale 3", nicht "Filialleitung" ohne Bezug).

## Rollen (Ausgangsvorschlag, konfigurierbar)

| Rolle                    | Typischer Scope           | Kernrechte                                                                                                                                                            |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verkaufsmitarbeiter      | eigene Filiale            | Sessions starten/führen/abschließen, eigene Sessions einsehen                                                                                                         |
| Filialleitung            | eigene Filiale            | zusätzlich: alle Sessions/Ergebnisse der Filiale einsehen, keine unternehmensweite Sicht                                                                              |
| Regionalleitung          | Region (mehrere Filialen) | Ergebnisse aller Filialen der Region einsehen (**Annahme:** falls Regionsebene überhaupt genutzt wird)                                                                |
| Geschäftsführung         | Unternehmen/Mandant       | volles Dashboard, alle Filialen/Mitarbeiter, KPI-Konfiguration (Ziele)                                                                                                |
| Fachadministrator        | Unternehmen/Mandant       | Fragen, Regeln, Kampagnen, Produktimport, Ziele – **kein** automatischer Zugriff auf personenbezogene Rohdaten einzelner Sessions, sofern nicht zusätzlich zugewiesen |
| Systemadministrator      | Mandant (technisch)       | Benutzer-/Filialverwaltung, Rollenvergabe, technische Konfiguration                                                                                                   |
| (später) Mandanten-Owner | Mandant                   | bei Fremdverkauf an Telekom/O2/Freenet/Handelspartner: administriert eigenen Mandanten unabhängig von anderen Mandanten                                               |

**Wichtige Trennung:** Fachliche Konfiguration (Fragen/Regeln/Kampagnen) und Zugriff auf personenbezogene/Kundendaten sind **getrennte Rechte**, nicht automatisch gekoppelt – ein Admin, der Fragen konfiguriert, sieht dadurch nicht automatisch einzelne Kundenantworten.

## Berechtigungsmatrix (Auszug, nicht abschließend)

| Aktion                             | Mitarbeiter | Filialleitung | Geschäftsführung    | Fachadmin                          | Systemadmin |
| ---------------------------------- | ----------- | ------------- | ------------------- | ---------------------------------- | ----------- |
| Session starten/führen             | ✓           | ✓             | –                   | –                                  | –           |
| eigene Sessions einsehen           | ✓           | ✓             | ✓                   | –                                  | –           |
| alle Sessions der Filiale einsehen | –           | ✓             | ✓                   | –                                  | –           |
| unternehmensweites KPI-Dashboard   | –           | –             | ✓                   | teilweise (KPIs ja, Rohdaten nein) | –           |
| Fragen/Regeln konfigurieren        | –           | –             | ✓ (freigeben)       | ✓ (bearbeiten)                     | –           |
| Ziele/Kampagnen festlegen          | –           | –             | ✓                   | ✓ (Vorschlag/Umsetzung)            | –           |
| Produkte/Tarife importieren        | –           | –             | –                   | ✓                                  | –           |
| Mitarbeiter/Filialen verwalten     | –           | –             | ✓ (Übersicht)       | –                                  | ✓           |
| Rollen vergeben                    | –           | –             | –                   | –                                  | ✓           |
| Audit-Log einsehen                 | –           | –             | ✓ (eigener Mandant) | ✓ (Konfigurationsänderungen)       | ✓           |
| Rollback von Konfiguration         | –           | –             | –                   | ✓ (mit Freigabe)                   | ✓           |

**Annahme:** Genaue Freigabeprozesse (z. B. muss Geschäftsführung Regeländerungen des Fachadmins bestätigen?) sind offen – siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

## Technische Umsetzung

- Jede API-Anfrage trägt Nutzer-, Rollen- und Scope-Information (z. B. via signierter Session/Token).
- Datenbankabfragen sind grundsätzlich scope-gefiltert (kein "Vergiss den WHERE-Filter"-Risiko) – serverseitig erzwungen, nicht nur UI-seitig verborgen.
- Rollenprüfung erfolgt serverseitig vor jeder schreibenden und lesenden Operation auf sensiblen Daten; UI-Ausblendung ist zusätzlich, aber kein Ersatz für die Serverprüfung.
- Rollenzuweisung selbst ist auditiert (`AuditLog`, siehe [DATA_MODEL.md](DATA_MODEL.md)).

## Mandantentrennung

Über alle Rollen hinweg gilt: kein Zugriff über Mandantengrenzen hinweg, unabhängig von der Rolle. Ein "Systemadministrator" agiert scope-gebunden auf genau einen Mandanten; ein globaler Anbieter-Betreiber-Zugriff (falls das System später an mehrere Mandanten verkauft wird) ist eine eigene, separat zu definierende Betreiberrolle außerhalb der mandantenspezifischen Rollen – **offene Entscheidung**, ob und wie diese Betreiberrolle in Phase 1 überhaupt vorgesehen wird.
