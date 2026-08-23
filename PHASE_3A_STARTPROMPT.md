PHASE 3A – DYNAMISCHE FRAGEN-ENGINE OHNE EMPFEHLUNGS-ENGINE UND OHNE MITARBEITEROBERFLÄCHE

AUSGANGSLAGE

Phase 2B ist abgeschlossen und für die Kernprüfungen technisch freigegeben.

Der erfolgreiche GitHub-Actions-Lauf #3 für Commit 8f7836d hat unter anderem nachgewiesen:

- Installation der Abhängigkeiten
- Prisma Client Generation
- Migrationen gegen eine echte PostgreSQL-Testdatenbank
- ESLint
- Prettier
- TypeScript-Prüfung mit tsc --noEmit
- Unit-Tests
- Integrationstests gegen eine echte PostgreSQL-Datenbank
- Produktions-Build

Docker Compose und eine Browser-/E2E-Prüfung der vorhandenen /review-Seite wurden noch nicht durchgeführt. Diese beiden Smoke-Tests sind vor einem Pilotbetrieb separat nachzuholen. Sie blockieren den Beginn von Phase 3A nicht, dürfen aber auch nicht als bestanden dargestellt werden.

Beginne jetzt ausschließlich mit Phase 3A: der technischen, dynamischen Fragen-Engine.

Die bestehende Architektur, Tenant-Isolation, Historisierung, Datenschutzstruktur, Append-only-Regeln, Versionierungslogik und CI-Prüfungen müssen erhalten bleiben.

ZIEL VON PHASE 3A

Implementiere eine deterministische, versionierte und tenantfähige Fragen-Engine, die auf Basis eines veröffentlichten Fragebogens:

1. eine Beratungssitzung mit einer konkreten QuestionnaireVersion verbindet,
2. die jeweils nächste sichtbare und noch nicht beantwortete Frage bestimmt,
3. Antworten typisiert und serverseitig validiert,
4. abhängig von bisherigen Antworten Fragen ein- oder ausblendet,
5. bereits gespeicherte Antworten beim Fortsetzen einer Beratung berücksichtigt,
6. bei geänderten Antworten den weiteren Fragenpfad neu berechnet,
7. übersprungene oder nicht mehr sichtbare Antworten kontrolliert behandelt,
8. den Zustand einer Befragung nachvollziehbar und reproduzierbar zurückgibt,
9. bei Abschluss der Befragung einen eindeutigen technischen Abschlusszustand erzeugt.

Die Engine soll die Grundlage für eine spätere Mitarbeiter-Gesprächsführung schaffen. In diesem Schritt wird jedoch noch keine fertige Mitarbeiteroberfläche gebaut.

VERBINDLICHE ABGRENZUNG

IN PHASE 3A ENTHALTEN

- technische Fragen-Engine
- Verwaltung und Auflösung veröffentlichter QuestionnaireVersion-Datensätze
- typisierte Fragen und Antwortoptionen
- serverseitige Antwortvalidierung
- bedingte Sichtbarkeit und Verzweigungen
- deterministische Reihenfolge der sichtbaren Fragen
- Starten, Fortsetzen und Abschließen eines Fragebogenlaufs
- Änderung bereits gegebener Antworten
- Neuberechnung des weiteren Fragenpfads
- Speicherung versionssicherer CustomerAnswer-Datensätze
- technischer Beratungsfortschritt
- API- beziehungsweise Service-Schnittstellen für eine spätere Oberfläche
- automatisierte Unit- und Integrationstests
- kleine synthetische Seed-Erweiterung
- technische Dokumentation
- höchstens eine minimale interne Entwickler-Prüfansicht, falls sie für die Verifikation erforderlich ist

EXPLIZIT NICHT IN PHASE 3A ENTHALTEN

- keine Empfehlungs-Engine
- keine Tarif- oder Produktbewertung
- keine Berechnung von Produktempfehlungen
- keine Priorisierung nach Provision, Marge oder Kampagne
- keine SalesOpportunity-Erzeugung aus Antworten
- keine DetectedNeed-Erzeugung, sofern sie bereits fachliche Interpretation oder Empfehlung darstellt
- keine Cross-Selling-Logik
- keine Eligibility-, Exclusion- oder Prioritization-Auswertung für Produkte
- keine KI-, LLM- oder Freitextinterpretation
- keine fertige Mitarbeiteroberfläche
- kein Dashboard
- kein Kundenportal
- kein visuelles Fragebogen- oder Regel-Admin-Tool
- kein Drag-and-drop-Fragebogeneditor
- kein Reporting- oder Geschäftsführer-Dashboard
- keine Ziel-, KPI-, Margen- oder Zeitersparnis-Auswertung
- keine produktive Authentifizierung
- keine automatische Veröffentlichung fachlicher Konfigurationen
- keine Änderung des vorhandenen Produkt-, Provisions- oder Deal-Modells, sofern sie für die reine Fragen-Engine nicht zwingend erforderlich ist
- kein eigenmächtiger Beginn einer späteren Phase

Die Fragen-Engine darf Antworten sammeln und den Befragungsverlauf steuern. Sie darf aus den Antworten noch keine Produktentscheidung oder Verkaufsempfehlung ableiten.

BESTANDSAUFNAHME VOR DER IMPLEMENTIERUNG

Lies zuerst vollständig:

- README.md
- docs/CURRENT_STATE.md
- docs/ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/DECISION_LOG.md
- docs/IMPLEMENTATION_STATUS.md
- docs/PRIVACY_AND_SECURITY.md
- docs/TEST_STRATEGY.md
- docs/LOCAL_DEVELOPMENT.md
- das vollständige Prisma-Schema
- vorhandene Migrationen und Seeds
- vorhandene Tenant-, Service-, Repository- und Validierungsschichten
- vorhandene Tests und CI-Konfiguration

Prüfe anschließend, welche der bereits modellierten Entitäten für Phase 3A direkt verwendbar sind:

- Questionnaire
- QuestionnaireVersion
- Question
- QuestionVersion beziehungsweise bestehende versionssichere Zuordnung
- AnswerOption
- VisibilityCondition
- ConsultationSession
- ConsultationTopic
- CustomerAnswer
- AnalyticsEvent
- AuditLog
- ConfigurationChange

Erstelle vor Codeänderungen einen kurzen Implementierungsplan.

Falls das bestehende Modell für eine sichere Fragen-Engine nicht ausreicht, darfst du es gezielt erweitern. Begründe jede Schemaänderung. Führe keine großflächige Neumodellierung ohne zwingenden Grund durch.

FACHLICHE ANFORDERUNGEN

1. FRAGEBOGENVERSION AUSWÄHLEN UND FIXIEREN

Beim Start einer Befragung muss die Engine anhand von Tenant, Zeitpunkt, Status und gegebenenfalls Thema die passende veröffentlichte QuestionnaireVersion auswählen.

Nach Beginn einer Beratung muss die verwendete QuestionnaireVersion für diese Beratung fixiert bleiben.

Eine spätere Veröffentlichung einer neuen Version darf eine bereits begonnene oder abgeschlossene Befragung nicht rückwirkend verändern.

Eine neue Beratung soll zum Startzeitpunkt die dann gültige veröffentlichte Version erhalten.

Entwürfe, archivierte, zukünftige oder abgelaufene Versionen dürfen nicht versehentlich für neue Beratungen verwendet werden.

2. UNTERSTÜTZTE FRAGETYPEN

Unterstütze für Phase 3A mindestens:

- SINGLE_CHOICE
- MULTIPLE_CHOICE
- BOOLEAN
- INTEGER
- DECIMAL
- SHORT_TEXT
- DATE

Falls im vorhandenen Modell bereits andere Bezeichnungen existieren, verwende konsistente vorhandene Namen oder dokumentiere eine begründete Migration.

Für jeden Fragetyp müssen klare Validierungsregeln gelten.

Mindestens erforderlich:

- Pflichtfrage oder optionale Frage
- erlaubte AnswerOptions
- Mindest- und Höchstwert für numerische Antworten
- maximale Länge für SHORT_TEXT
- Mindest- und Höchstauswahl bei MULTIPLE_CHOICE
- gültiges ISO-Datumsformat für DATE
- keine beliebigen Werte bei SINGLE_CHOICE und MULTIPLE_CHOICE
- keine Float-Ungenauigkeit bei DECIMAL
- keine unvalidierten Antwortobjekte

Freitext wird ausschließlich gespeichert und validiert. Er darf in Phase 3A nicht für Empfehlungen, KPIs, Bedingungen oder fachliche Regeln verwendet werden.

3. BEDINGTE SICHTBARKEIT

Implementiere eine klar strukturierte, validierte und deterministische VisibilityCondition-Auswertung.

Für Phase 3A müssen mindestens folgende Operatoren für geeignete Antworttypen möglich sein:

- EQUALS
- NOT_EQUALS
- IN
- NOT_IN
- CONTAINS
- GREATER_THAN
- GREATER_THAN_OR_EQUAL
- LESS_THAN
- LESS_THAN_OR_EQUAL
- IS_ANSWERED
- IS_NOT_ANSWERED

Unterstütze nachvollziehbare AND- und OR-Verknüpfungen.

Jede Bedingung darf ausschließlich auf Fragen verweisen, die derselben QuestionnaireVersion zugeordnet sind.

Zyklische Abhängigkeiten müssen bei Veröffentlichung beziehungsweise Validierung eines Fragebogens erkannt und abgelehnt werden.

Eine Frage darf nicht von einer fachlich nachgelagerten Frage abhängen, wenn dadurch kein deterministisch auflösbarer Ablauf möglich ist.

Die Engine muss bei derselben Fragebogenversion und denselben Antworten immer denselben sichtbaren Fragenpfad liefern.

Keine Bedingungen auf Basis freien Kundentextes.

4. REIHENFOLGE UND NÄCHSTE FRAGE

Jede Frage benötigt innerhalb der Fragebogenversion eine stabile, eindeutige Reihenfolge.

Die Engine muss bestimmen können:

- alle aktuell sichtbaren Fragen
- alle beantworteten sichtbaren Fragen
- alle noch offenen Pflichtfragen
- die nächste sichtbare, noch nicht beantwortete Frage
- ob der Fragebogen abgeschlossen werden kann
- den technischen Fortschritt

Der Fortschritt darf nicht irreführend sein.

Gib mindestens getrennt zurück:

- Anzahl aktuell sichtbarer Fragen
- Anzahl beantworteter sichtbarer Fragen
- Anzahl offener sichtbarer Pflichtfragen
- aktuelle Position im sichtbaren Ablauf
- Status der Befragung

Erlaubte Statuswerte sollen mindestens fachlich abbilden:

- NOT_STARTED
- IN_PROGRESS
- COMPLETED
- gegebenenfalls INVALIDATED oder NEEDS_REVIEW, falls dies für geänderte Antworten erforderlich ist

Verwende vorhandene Statusmodelle, wenn sie dieselbe Bedeutung sicher abbilden.

5. ANTWORTEN SPEICHERN UND ÄNDERN

CustomerAnswer muss versionssicher mindestens auf Folgendes bezogen sein:

- Tenant
- ConsultationSession
- konkrete QuestionnaireVersion
- konkrete Question beziehungsweise QuestionVersion
- gegebenenfalls AnswerOption
- Antworttyp
- validierter Antwortwert
- Erfassungszeitpunkt
- gegebenenfalls Änderungszeitpunkt beziehungsweise nachvollziehbare Historie

Beim Speichern einer Antwort muss serverseitig geprüft werden:

- Tenant stimmt überein
- Beratung existiert und gehört zum Tenant
- Frage gehört zur fixierten QuestionnaireVersion der Beratung
- Frage ist im aktuellen Pfad sichtbar
- Antworttyp stimmt
- Antwort erfüllt alle Grenzen
- ausgewählte Antwortoptionen gehören zur richtigen QuestionVersion
- abgeschlossene oder gesperrte Beratungen werden nicht unkontrolliert verändert

Manipulierte IDs oder tenantId-Werte aus Requests dürfen keinen Fremdzugriff ermöglichen.

6. ÄNDERUNG FRÜHERER ANTWORTEN

Wenn eine frühere Antwort geändert wird, muss die Engine alle abhängigen Sichtbarkeiten neu berechnen.

Antworten auf Fragen, die danach nicht mehr sichtbar sind, dürfen nicht stillschweigend weiter als aktive Antworten verwendet werden.

Implementiere eine klar dokumentierte Strategie, zum Beispiel:

- Antwort historisch erhalten
- als inaktiv beziehungsweise durch Pfadänderung ungültig markieren
- nicht mehr für Sichtbarkeit, Fortschritt oder spätere Regelverarbeitung berücksichtigen
- bei erneut sichtbarer Frage nur nach klarer, dokumentierter Regel wieder aktivieren oder erneut bestätigen lassen

Historische Nachvollziehbarkeit darf nicht durch Hard Delete verloren gehen.

Die gewählte Strategie muss deterministisch, testbar und datenschutzkonform sein.

7. FRAGEBOGEN ABSCHLIESSEN

Ein Fragebogen darf nur abgeschlossen werden, wenn alle aktuell sichtbaren Pflichtfragen gültig beantwortet sind.

Beim Abschluss müssen mindestens gespeichert oder eindeutig ableitbar sein:

- verwendete QuestionnaireVersion
- Abschlusszeitpunkt
- final sichtbarer Fragenpfad
- final aktive Antworten
- Status COMPLETED
- nachvollziehbarer technischer Audit-Eintrag

Der Abschluss erzeugt in Phase 3A ausdrücklich noch keine Recommendation, SalesOpportunity, DetectedNeed oder Produktentscheidung.

Definiere klar, ob und unter welchen Bedingungen ein abgeschlossener Fragebogen wieder geöffnet werden darf. Verwende eine konservative, auditierbare Lösung.

8. FRAGEBOGENVALIDIERUNG VOR VERÖFFENTLICHUNG

Implementiere eine technische Validierungsfunktion für QuestionnaireVersion-Datensätze.

Sie muss mindestens erkennen:

- keine Fragen vorhanden
- doppelte oder ungültige Reihenfolge
- fehlende AnswerOptions bei Auswahlfragen
- ungültige Mindest-/Höchstwerte
- ungültige Textlängen
- ungültige Mindest-/Höchstauswahl
- Condition verweist auf fremde Fragebogenversion
- Condition verweist auf ungültige AnswerOption
- unpassender Operator für den Fragetyp
- zyklische Abhängigkeiten
- nicht erreichbare Fragen, soweit statisch erkennbar
- Pflichtfrage, die durch fehlerhafte Konfiguration niemals beantwortbar wäre
- unzulässige Freitextverwendung in Bedingungen

Eine QuestionnaireVersion mit kritischen Validierungsfehlern darf nicht als veröffentlicht und aktiv verwendet werden.

Eine bereits in Beratungen verwendete veröffentlichte Version darf nicht nachträglich inhaltlich verändert werden.

9. TENANT-ISOLATION

Alle neuen oder geänderten Relationen müssen die bereits in Phase 2B festgelegte Tenant-Isolation einhalten.

Wo fachlich erforderlich, sind zusammengesetzte Fremdschlüssel zu verwenden:

- fields: [tenantId, foreignId]
- references: [tenantId, id]

Service- und Repository-Zugriffe müssen den zentralen Tenant-Kontext erzwingen.

Tenant A darf weder Fragebögen, Versionen, Fragen, Antwortoptionen, Bedingungen, Beratungen noch Antworten von Tenant B lesen oder verändern.

Erstelle positive und negative Integrationstests für die kritischen Relationsgruppen.

10. API- UND SERVICE-SCHNITTSTELLEN

Implementiere eine klare Service-Schicht. Die konkrete API-Struktur darf an die bestehende Architektur angepasst werden.

Mindestens erforderlich sind technische Operationen für:

- gültigen Fragebogen für eine Beratung starten
- aktuellen Befragungszustand laden
- nächste Frage ermitteln
- Antwort speichern
- vorhandene Antwort ändern
- sichtbaren Fragenpfad neu berechnen
- Fortschritt abrufen
- Fragebogen abschließen
- QuestionnaireVersion technisch validieren

API-Antworten dürfen keine internen Stack-Traces, SQL-Fehler oder sensiblen Metadaten enthalten.

Verwende serverseitige Zod-Validierung oder die bereits etablierte Validierungslösung.

Vertraue niemals einer vom Client übergebenen tenantId.

Vermeide eine unnötige Route pro interner Hilfsfunktion. Entwirf eine kleine, nachvollziehbare API.

11. IDEMPOTENZ UND NEBENLÄUFIGKEIT

Verhindere doppelte Antworten oder widersprüchliche Zustände durch wiederholte Requests.

Definiere eine sinnvolle Eindeutigkeit für aktive Antworten pro:

- Tenant
- ConsultationSession
- QuestionnaireVersion
- QuestionVersion

Verwende Transaktionen für Vorgänge, die Antwortänderung, Pfadneuberechnung und Statusänderung gemeinsam betreffen.

Prüfe konkurrierende Änderungen mindestens über eine Versionsnummer, optimistic locking oder eine gleichwertige nachvollziehbare Lösung.

Ein verspäteter Request darf nicht unbemerkt eine neuere Antwort überschreiben.

12. DATENSCHUTZ UND ANALYTICS

Speichere nur die für die Befragung erforderlichen Daten.

Keine Namen, Telefonnummern oder E-Mail-Adressen in:

- AnalyticsEvent
- AuditLog-Metadaten
- technischen Fehlerlogs
- Fragebogen-Zustandsantworten

Analytics darf in Phase 3A ausschließlich technische Ereignisse erfassen, zum Beispiel:

- QUESTIONNAIRE_STARTED
- QUESTION_ANSWERED
- ANSWER_CHANGED
- PATH_RECALCULATED
- QUESTIONNAIRE_COMPLETED

Keine vollständigen Freitextantworten und keine direkten Kundenkontaktdaten in Analytics- oder Audit-Payloads.

Verwende die in Phase 2B eingeführte strukturierte JSON-Validierung.

MINIMALE TECHNISCHE PRÜFUNG

Es soll keine fertige Mitarbeiteroberfläche entstehen.

Bevorzugt werden Service-, API- und Integrationstests.

Falls eine visuelle Prüfung sonst nicht sinnvoll möglich ist, darf eine klar als intern und technisch gekennzeichnete Development/Test-Prüfansicht ergänzt werden.

Diese darf höchstens ermöglichen:

- synthetische Beratung auswählen
- aktuelle Frage anzeigen
- synthetische Antwort absenden
- nächste Frage anzeigen
- aktuellen sichtbaren Pfad und technischen Fortschritt prüfen
- Fragebogen zurücksetzen beziehungsweise einen neuen synthetischen Lauf starten

Für eine solche Prüfansicht gelten zwingend:

- nur Development/Test
- technisch in Produktion deaktiviert
- keine echten Kundendaten
- kein fertiges Mitarbeiterdesign
- keine Verkaufs- oder Produktempfehlungen
- keine Darstellung als pilotbereites MVP

SEED-DATEN

Erweitere die Seeds ausschließlich mit eindeutig synthetischen Daten.

Erstelle mindestens:

1. einen veröffentlichten einfachen Fragebogen,
2. mindestens zwei QuestionnaireVersionen, von denen nur die zum Startzeitpunkt gültige Version ausgewählt wird,
3. mindestens acht Fragen mit mehreren Fragetypen,
4. mindestens eine BOOLEAN-Verzweigung,
5. mindestens eine SINGLE_CHOICE-Verzweigung,
6. mindestens eine MULTIPLE_CHOICE-Frage,
7. mindestens eine numerische Bedingung,
8. mindestens eine optionale Frage,
9. mindestens eine Pflichtfrage,
10. mindestens eine Frage, die durch Antwortänderung nicht mehr sichtbar wird,
11. einen synthetischen begonnenen Fragebogen,
12. einen synthetischen abgeschlossenen Fragebogen,
13. entsprechende Daten für zwei Tenants zur Isolationsprüfung.

Nutze ausschließlich fiktive Bezeichnungen und keine echten Mitarbeiter-, Kunden-, Provider-, Tarif- oder Vertragsdaten.

AUTOMATISIERTE TESTS

Erstelle umfassende Unit- und Integrationstests.

Mindestens zu prüfen:

1. veröffentlichte und zum Zeitpunkt gültige QuestionnaireVersion wird korrekt ausgewählt,
2. neue Version verändert eine bereits begonnene Beratung nicht,
3. Entwurfs- und abgelaufene Versionen werden nicht ausgewählt,
4. erste sichtbare Frage wird korrekt ermittelt,
5. Reihenfolge ist deterministisch,
6. SINGLE_CHOICE akzeptiert nur gültige Optionen,
7. MULTIPLE_CHOICE erzwingt erlaubte Optionen und Auswahlgrenzen,
8. BOOLEAN akzeptiert nur gültige boolesche Werte,
9. INTEGER und DECIMAL prüfen Wertebereiche,
10. SHORT_TEXT prüft Längenbegrenzung,
11. DATE akzeptiert nur gültige erlaubte Datumswerte,
12. Pflichtfragen verhindern einen vorzeitigen Abschluss,
13. optionale Fragen blockieren den Abschluss nicht,
14. EQUALS- und NOT_EQUALS-Bedingungen funktionieren,
15. IN-, NOT_IN- und CONTAINS-Bedingungen funktionieren,
16. numerische Vergleichsoperatoren funktionieren,
17. AND- und OR-Verknüpfungen funktionieren,
18. nicht sichtbare Fragen werden nicht als offen gezählt,
19. Antworten auf nicht sichtbare Fragen werden abgelehnt,
20. Änderung einer früheren Antwort berechnet den Pfad neu,
21. nicht mehr sichtbare Antworten werden nicht weiter aktiv verwendet,
22. historische Nachvollziehbarkeit bleibt erhalten,
23. erneutes Laden setzt die Beratung korrekt fort,
24. abgeschlossener Fragebogen bleibt reproduzierbar,
25. Abschluss erzeugt keine Recommendation oder SalesOpportunity,
26. zyklische Bedingungen werden abgelehnt,
27. Condition auf fremde QuestionnaireVersion wird abgelehnt,
28. falscher Operator für einen Fragetyp wird abgelehnt,
29. Freitext wird nicht als VisibilityCondition verwendet,
30. Tenant A kann keine Fragebogendaten von Tenant B lesen,
31. Tenant A kann keine Antworten für Tenant B schreiben,
32. manipulierte tenantId aus einem Request wird ignoriert oder abgelehnt,
33. fremde AnswerOption-ID wird abgelehnt,
34. doppelte oder wiederholte Requests erzeugen keinen inkonsistenten Zustand,
35. veraltete parallele Antwortänderung wird erkannt,
36. Analytics- und Audit-Payloads enthalten keine direkten Kontaktdaten oder Freitextantworten,
37. aktivierte und verwendete Fragebogenversionen sind gegen unerlaubte Änderung geschützt,
38. Migration funktioniert auf leerer PostgreSQL-Datenbank,
39. Seed funktioniert nach vollständigem Neuaufbau,
40. bestehende Phase-2B-Tests bleiben grün.

Teste die Engine nicht nur mit Mock-Objekten. Kritische Tenant-, Fremdschlüssel-, Transaktions-, Versions- und Persistenzregeln müssen gegen die echte PostgreSQL-Testdatenbank geprüft werden.

QUALITÄTSANFORDERUNGEN

- keine unstrukturierten beliebigen JSON-Antwortwerte
- keine Geschäftslogik direkt in API-Routen oder UI-Komponenten
- keine Prüfung der Sichtbarkeit ausschließlich im Client
- keine Änderung historischer Beratungsergebnisse durch neue Konfigurationen
- keine Cascade Deletes bei historischen Antworten oder Befragungsläufen
- keine N+1-Abfragen im normalen Laden des Befragungszustands
- keine selbst erfundene Kryptografie
- keine Secrets im Repository
- UTC für gespeicherte Zeitpunkte
- Darstellung lokaler Zeiten weiterhin Europe/Berlin
- Geld- oder Margenberechnung ist in dieser Phase nicht erforderlich
- verständliche Fehlercodes für fachliche Validierungsfehler
- sichere Fehlerantworten ohne interne Details

CI UND VERIFIKATION

Die bestehende CI-Pipeline muss mindestens weiterhin erfolgreich ausführen:

- Installation mit verbindlichem Lockfile
- Prisma format beziehungsweise Schema-Prüfung
- Prisma validate
- Prisma generate
- Migrationen auf leerer PostgreSQL-Testdatenbank
- Seed beziehungsweise erforderliche Seed-Verifikation
- ESLint
- Prettier-Check
- TypeScript-Prüfung
- Unit-Tests
- Integrationstests gegen echte PostgreSQL-Datenbank
- Produktions-Build

Erweitere die CI nur, wenn dies für die neuen Integrationstests erforderlich ist. Entferne oder schwäche keine vorhandenen Prüfungen.

Docker Compose und die Browser-/E2E-Prüfung der /review-Seite beziehungsweise einer möglichen technischen Phase-3A-Prüfansicht bleiben separate Smoke-Tests. Sie müssen vor einem Pilotbetrieb nachgeholt und dokumentiert werden. Stelle sie im Abschlussbericht nicht als bestanden dar, wenn sie nicht tatsächlich ausgeführt wurden.

DOKUMENTATION

Aktualisiere mindestens:

- README.md
- docs/CURRENT_STATE.md
- docs/ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/DECISION_LOG.md
- docs/IMPLEMENTATION_STATUS.md
- docs/PRIVACY_AND_SECURITY.md
- docs/TEST_STRATEGY.md
- docs/LOCAL_DEVELOPMENT.md

Erstelle zusätzlich:

- docs/QUESTION_ENGINE.md

QUESTION_ENGINE.md muss mindestens enthalten:

- Verantwortungsbereich der Engine
- ausdrücklich ausgeschlossene Funktionen
- Frage- und Antworttypen
- Validierungsregeln
- Versionsauflösung
- Sichtbarkeitsmodell
- unterstützte Operatoren
- AND-/OR-Logik
- Pfadneuberechnung
- Umgang mit nicht mehr sichtbaren Antworten
- Fortschrittsberechnung
- Abschlussbedingungen
- Tenant-Isolation
- Nebenläufigkeitsstrategie
- API- beziehungsweise Service-Schnittstellen
- Fehlercodes
- Datenschutzgrenzen
- Beispiele mit ausschließlich synthetischen Daten

Ergänze im DECISION_LOG mindestens Entscheidungen zu:

- Fixierung der QuestionnaireVersion beim Beratungsstart
- Strategie für geänderte Antworten
- Behandlung nicht mehr sichtbarer Antworten
- erlaubte Bedingungsoperatoren
- Verbot von Freitext in Bedingungen
- Abschluss und mögliche Wiederöffnung
- Nebenläufigkeitskontrolle
- klare Trennung zwischen Fragen-Engine und späterer Empfehlungs-Engine

ARBEITSWEISE

1. Lies zuerst die bestehende Implementierung und Dokumentation.
2. Prüfe Widersprüche zwischen Prisma-Schema, Migrationen, Services und Dokumentation.
3. Erstelle einen kurzen Implementierungsplan.
4. Implementiere in kleinen, nachvollziehbaren Schritten.
5. Verwende bestehende Architektur- und Sicherheitsmuster.
6. Führe Migrationen und Tests tatsächlich aus.
7. Behebe auftretende Fehler vollständig.
8. Verwende keine echten Daten oder Zugangsdaten.
9. Lösche keine bestehende Funktion oder Dokumentation ohne Begründung.
10. Schwäche keine Phase-2B-Sicherheitsregel ab.
11. Beginne keine Empfehlungs-Engine oder Mitarbeiteroberfläche.
12. Wenn eine grundlegende fachliche Entscheidung die Umsetzung blockiert, dokumentiere die konkrete Frage und stoppe an dieser Stelle, anstatt willkürlich eine weitreichende Entscheidung zu treffen.

ABNAHMEKRITERIEN FÜR PHASE 3A

Phase 3A ist nur abgeschlossen, wenn:

- die Engine einen veröffentlichten Fragebogen starten kann,
- die verwendete QuestionnaireVersion fixiert wird,
- Antworten vollständig serverseitig typisiert validiert werden,
- Verzweigungen deterministisch funktionieren,
- zyklische oder ungültige Bedingungen abgelehnt werden,
- eine Beratung gespeichert und fortgesetzt werden kann,
- frühere Antworten kontrolliert geändert werden können,
- der Fragenpfad danach korrekt neu berechnet wird,
- nicht mehr sichtbare Antworten nicht aktiv weiterverwendet werden,
- Fortschritt und offene Pflichtfragen korrekt berechnet werden,
- ein Fragebogen kontrolliert abgeschlossen werden kann,
- keine Empfehlungen oder Produktentscheidungen erzeugt werden,
- Tenant-Isolation nachgewiesen ist,
- Nebenläufigkeit beziehungsweise veraltete Updates kontrolliert werden,
- Datenschutztests erfolgreich sind,
- Migration und Seed erfolgreich sind,
- alle bestehenden und neuen Tests grün sind,
- Typecheck, Lint, Formatcheck und Produktions-Build grün sind,
- die Dokumentation dem tatsächlichen Stand entspricht.

ABSCHLUSSBERICHT

Liefere nach Abschluss:

1. kurze Zusammenfassung des implementierten Umfangs,
2. verwendete technische Versionen,
3. umgesetzte Architektur der Fragen-Engine,
4. Schema- und Migrationsänderungen,
5. unterstützte Frage- und Antworttypen,
6. unterstützte Sichtbarkeitsoperatoren,
7. Strategie für Versionierung und Reproduzierbarkeit,
8. Strategie bei Antwortänderungen und Pfadneuberechnung,
9. Tenant- und Datenschutzmaßnahmen,
10. API- und Service-Schnittstellen,
11. Anzahl und Art der neuen Tests,
12. vollständige ausgeführte Befehle mit Ergebnissen und Exit-Codes,
13. Status des GitHub-Actions-Laufs und Commit-Hash,
14. Liste aller erstellten und geänderten Dateien,
15. bekannte Einschränkungen,
16. ausdrücklich noch nicht implementierte spätere Funktionen,
17. offene Smoke-Tests für Docker Compose und Browser-/E2E-Prüfung,
18. eindeutige Aussage GO oder NO-GO für den nächsten Phase-3-Schritt.

Stoppe anschließend.

Beginne ausdrücklich noch nicht mit:

- Empfehlungs-Engine,
- Tarif- oder Produktlogik,
- Cross-Selling-Regeln,
- Margenpriorisierung,
- Mitarbeiteroberfläche,
- Admin-Konfigurator,
- Geschäftsführer-Dashboard,
- Pilotbetrieb.

Der nächste Schritt darf erst nach Prüfung und ausdrücklicher Freigabe dieses Abschlussberichts begonnen werden.
