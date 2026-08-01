# STARTPROMPT – PHASE 3B: REGEL- UND EMPFEHLUNGS-ENGINE

_Quelle: ChatGPT (Projektleiter), 2026-08-01. Planungsfassung — erteilt ausdrücklich noch kein Implementierungs-GO._

## 1. Rolle und Arbeitsweise

Du arbeitest als verantwortlicher Senior-Backend-Entwickler und Softwarearchitekt am Projekt „Ki cross“.

Phase 3A – Fragen-Engine ist vollständig abgeschlossen und formal abgenommen. Der nächste freigegebene Entwicklungsschritt ist ausschließlich:

**Phase 3B – deterministische Regel- und Empfehlungs-Engine**

Arbeite strikt innerhalb des nachfolgend definierten Umfangs.

Beginne nicht mit einer Mitarbeiteroberfläche, einem Dashboard, einer Admin-Oberfläche, einer KI-Integration oder einer Anbieterportal-Anbindung.

Vor Änderungen musst du den tatsächlichen Repository-Stand vollständig prüfen. Bestehende Architektur-, Sicherheits-, Tenant-, Versions-, Audit- und Append-only-Vorgaben haben Vorrang vor Annahmen aus diesem Prompt.

Keine bestehende Funktion darf stillschweigend entfernt, umgangen oder abgeschwächt werden.

## 2. Ausgangslage

Bereits vorhanden und abgenommen sind insbesondere:

- Multi-Tenant-Grundarchitektur
- Company-, Store- und Employee-Struktur
- versionierte Produkt- und Provisionsmodelle
- Questionnaire, QuestionnaireVersion und Question
- typisierte Antworten
- bedingte Sichtbarkeit von Fragen
- Pfadneuberechnung bei Antwortänderungen
- ConsultationSession
- an eine Sitzung gebundene QuestionnaireVersion
- Tenant-Isolation
- Audit- und Analytics-Grundstrukturen
- Phase-3A-Tests und CI-Abnahme

Die Fragen-Engine erfasst den Kundenbedarf. Phase 3B muss aus diesen Antworten fachlich nachvollziehbare Produktempfehlungen und Verkaufschancen erzeugen.

## 3. Ziel der Phase

Nach Abschluss von Phase 3B muss das Backend eine auswertbare Beratungssitzung deterministisch analysieren können.

Das Ergebnis muss mindestens enthalten:

- passende Hauptproduktempfehlungen,
- ausgeschlossene Produkte mit strukturierten Gründen,
- nachvollziehbare Eignungs- und Prioritätswerte,
- strukturierte Empfehlungsbegründungen,
- getrennte Cross-Selling- beziehungsweise Bedarfspotenziale,
- die verwendeten Produkt-, Regel- und Fragebogenversionen,
- einen reproduzierbaren gespeicherten Ergebnisstand.

Die Engine arbeitet ausschließlich regelbasiert. Es wird in dieser Phase keine KI und kein LLM verwendet.

## 4. Fachliche Grundprinzipien

Die Engine muss vier Ebenen klar voneinander trennen:

### 4.1 Eignung

Zuerst wird geprüft, ob ein Produkt grundsätzlich zum erfassten Bedarf passt. Beispiele: gewünschtes Datenvolumen, Vertragsart, Neuvertrag oder Vertragsverlängerung, SIM-only oder mit Gerät, maximales Monatsbudget, gewünschter Anbieter (sofern angegeben), Alters-/Zielgruppenbedingungen, erforderliche Leistungen.

### 4.2 Harte Ausschlüsse

Ein harter Ausschluss darf nicht durch Provision, Marge, Kampagne oder Verkaufsziel überschrieben werden. Beispiele: Monatskosten über verbindlichem Kundenlimit, nicht erfüllte Altersvoraussetzung, nicht unterstützte Vertragsart, erforderliche Leistung fehlt, ProductVersion zum Sitzungszeitpunkt nicht gültig, falscher Tenant, ausdrücklicher Kundenwunsch wird verletzt.

### 4.3 Kundenpassung

Nur grundsätzlich geeignete Produkte erhalten einen Kundenpassungswert, berechnet aus transparenten, im Ergebnis nachvollziehbar gespeicherten Einzelkriterien.

### 4.4 Geschäftliche Priorisierung

Geschäftliche Faktoren (Provision/Deckungsbeitrag, aktive Kampagne, Verkaufsziele, strategische Produktpriorität) dürfen nur zwischen bereits geeigneten Produkten priorisieren. Sie dürfen niemals: einen harten Ausschluss aufheben, ein ungeeignetes Produkt empfehlen, eine fehlende Kundenanforderung ignorieren, die Kundenpassung im Ergebnis verschleiern.

Kundenpassung und geschäftliche Priorisierung müssen als getrennte Werte erkennbar bleiben.

## 5. Cross-Selling- und Bedarfspotenziale

Zusätzlich zur Hauptproduktempfehlung: strukturierte Chancen erkennen. Pilotumfang mindestens: Partnerkarte/Family-Angebot, DSL/Glasfaser, Streaming, Zubehör, Geräteschutz.

Ein Bedarfspotenzial ist keine automatisch angenommene Verkaufszusage. Jede Chance benötigt mindestens: Kategorie, Status, auslösende Antwort/Regel, Begründung, Priorität, ggf. passende ProductVersion, ggf. Grund für offene Rückfragen.

Cross-Selling-Ergebnisse müssen getrennt von der Rangliste der Hauptprodukte gespeichert und ausgegeben werden.

## 6. Versions- und Zeitbezug

Eine Auswertung muss historisch reproduzierbar sein. Eine Empfehlung muss eindeutig auf die tatsächlich verwendeten Versionen verweisen: ConsultationSession, QuestionnaireVersion, RuleSetVersion, ProductVersion, ggf. CommissionModelVersion, Auswertungszeitpunkt.

Spätere Änderungen an Produkten, Regeln, Provisionen oder Fragen dürfen ein bereits gespeichertes Empfehlungsergebnis nicht rückwirkend verändern.

Vorhandene versionierte Modelle sind zu verwenden. Keine parallele Schatten-Versionierung einführen. Falls für die Sitzung bereits eine RuleSetVersion vorgesehen ist, muss diese verwendet werden; falls die verbindliche Fixierung fehlt, konsistent zur Fixierung der QuestionnaireVersion implementieren.

## 7. Regelmodell

Prüfe zuerst, welche Regelmodelle bereits im Prisma-Schema und in der Dokumentation vorgesehen sind.

Mindestens folgende Regelarten müssen fachlich abbildbar sein: EligibilityRule, ExclusionRule, PrioritizationRule, Opportunity-/Cross-Selling-Regel.

Bevorzuge ein kleines, explizites und validierbares Regelmodell. Keine freie Codeausführung, kein eval, keine dynamischen JavaScript-Ausdrücke und keine unvalidierten Regelobjekte.

Unterstützte Operatoren müssen ausdrücklich definiert, validiert, dokumentiert und getestet werden: equals, notEquals, in, notIn, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, contains, isAnswered, isNotAnswered.

Operatoren dürfen nur mit kompatiblen Antworttypen verwendet werden. Ungültige Kombinationen müssen bereits bei der Regelvalidierung abgelehnt werden.

## 8. Auswertungsablauf

1. Tenant-Kontext prüfen.
2. ConsultationSession tenant-gescoped laden.
3. Sitzungsstatus und Auswertbarkeit prüfen.
4. fixierte QuestionnaireVersion und RuleSetVersion bestimmen.
5. ausschließlich gültige, aktive und für die Sitzung sichtbare Antworten laden.
6. relevante ProductVersions zum festgelegten Zeitpunkt laden.
7. Produkte auf harte Eignung und Ausschlüsse prüfen.
8. geeignete Produkte hinsichtlich Kundenpassung bewerten.
9. geschäftliche Priorisierung getrennt berechnen.
10. stabile Sortierung anwenden.
11. strukturierte Begründungen und Ausschlussgründe erzeugen.
12. Cross-Selling- und Bedarfspotenziale erzeugen.
13. vollständiges Ergebnis atomar speichern.
14. erforderliche Analytics- und Audit-Ereignisse schreiben.
15. Ergebnis tenant-gescoped zurückgeben.

Stabile Tie-Break-Regel definieren (keine Zufallswerte, keine implizite DB-Reihenfolge).

## 9. Umgang mit unvollständigen Sitzungen

Keine scheinbar vollständige Empfehlung, wenn erforderliche Antworten fehlen. Eindeutige Zustände definieren: Sitzung noch nicht auswertbar, erforderliche Antwort fehlt, Regelversion fehlt, keine gültige Produktversion vorhanden, kein geeignetes Produkt gefunden, Auswertung erfolgreich, vorhandene Auswertung wird reproduzierbar abgerufen oder bewusst neu erzeugt. Fehlende Daten nicht mit erfundenen Standardwerten ersetzen.

## 10. Speicherung und Idempotenz

Vorhandene Modelle Recommendation und RecommendationOutcome (und verwandte Strukturen) prüfen und nutzen, sofern sie den Zweck erfüllen. Schemaänderungen nur bei nachgewiesener und dokumentierter Lücke.

Gespeicherte Ergebnisse müssen mindestens zeigen: bewertetes Produkt, geeignet/ausgeschlossen, eligibilityScore, priorityScore, strukturierte Begründung, strukturierte Ausschlussgründe, verwendete Versionen, Berechnungszeitpunkt, Tenant und Sitzung.

Vor Implementierung festlegen: idempotente Rückgabe eines vorhandenen Ergebnisses oder bewusst versionierter neuer Auswertungslauf. Reproduzierbar, transaktional, getestet. Keine stillen Duplikate.

## 11. Tenant-Isolation und Sicherheit

- kein ungescopter Prisma-Client in produktiver Service-Logik
- keine Tenant-ID aus unvalidierten Request-Daten übernehmen
- keine Ergebnisse/Produkte/Regeln/Sitzungen eines fremden Tenants laden
- Tenant-ID bei Create-Aufrufen explizit und typsicher setzen
- keine any-Typen
- keine as unknown as-Ketten
- keine Abschwächung des Typechecks
- keine Abschaltung von DB-Triggern
- keine Umgehung von Append-only-Regeln

Tenant-A und Tenant-B müssen in Integrationstests vollständig voneinander isoliert sein.

## 12. Service- und API-Schnittstellen

Servicefunktionen mindestens für: Auswertung einer ConsultationSession, Abruf eines gespeicherten Empfehlungsergebnisses, Abruf der Hauptproduktempfehlungen, Abruf der Ausschlussgründe, Abruf der Cross-Selling-/Bedarfspotenziale.

Falls HTTP-Endpunkte Bestandteil der Architektur sind: vorhandene Patterns nutzen (Zod-Validierung, Authentifizierung, Autorisierung, Tenant-Kontext, AppError, sichere Fehlercodes, Logging). Keine Prisma-/SQL-/Stack-Trace-/internen Regelimplementierungsdetails an Clients.

Mindestens unterscheidbare Fehlerfälle: Session nicht gefunden, Session gehört zu anderem Tenant, Session nicht auswertbar, erforderliche Antworten fehlen, RuleSetVersion fehlt/ungültig, keine gültigen ProductVersions, kein geeignetes Produkt gefunden, Auswertung bereits vorhanden/Konflikt, interne Auswertung fehlgeschlagen.

## 13. Tests

**Unit-Tests:** jeder Operator, ungültige Operator-/Antworttyp-Kombinationen, Eligibility-Auswertung, harte Ausschlüsse, Scoring der Kundenpassung, getrennte geschäftliche Priorisierung, stabile Sortierung bei Punktgleichheit, strukturierte Begründungen, Cross-Selling-Regeln, fehlende Antworten, ungültige Regeln, deterministische Wiederholung.

**Integrationstests:** vollständige erfolgreiche Auswertung, ungeeignetes Produkt ausgeschlossen, geeignetes Produkt empfohlen, mehrere geeignete Produkte stabil sortiert, hohe Provision hebt keinen Ausschluss auf, historisch fixierte ProductVersion verwendet, historisch fixierte RuleSetVersion verwendet, spätere Produktänderung verändert altes Ergebnis nicht, spätere Regeländerung verändert altes Ergebnis nicht, Antwortänderung vor finaler Auswertung beeinflusst Ergebnis korrekt, unvollständige Sitzung abgelehnt, keine passende Empfehlung, Cross-Selling-Chancen getrennt erzeugt, Transaktions-Rollback bei Fehler, Tenant-A kann nichts von Tenant-B nutzen, wiederholte Auswertung entspricht Idempotenzstrategie, Append-only-/Audit-Vorgaben bleiben intakt.

Tests nur gegen dedizierte, wegwerfbare Testdatenbank. Bestehende Schutzregeln/Einschränkungen aus Phase 3A beachten.

## 14. Pilotdaten

Nur klar erkennbare Test-/Pilotdaten. Pilotszenarien: Neuvertrag, Vertragsverlängerung, SIM-only, Vertrag mit Gerät. Tarif-/Produkt-/Provisionsdaten bleiben manuell und versioniert gepflegt. Keine Live-Daten aus Anbieterportalen, keine Telekom-/Telefónica-/Freenet-Schnittstellen simulieren ohne bestehende freigegebene Architektur. Seeds deterministisch, tenant-sicher, wiederholbar.

## 15. Migrationen

Falls nötig: jede Änderung vor Umsetzung begründen, neue additive Prisma-Migration, keine Änderung bereits ausgeführter historischer Migrationen, bestehende Daten berücksichtigen, Foreign Keys/Löschverhalten prüfen, Append-only-Trigger beachten, Schema-/Datenmodelldokumentation aktualisieren, Migration in frischer DB testen, Upgrade-Pfad testen soweit möglich. Keine destructive migration ohne ausdrückliche Freigabe.

## 16. Dokumentation

Mindestens tatsächlich betroffene Dokumente aktualisieren + eigenständige Dokumentation der Empfehlungs-Engine: Architektur, Auswertungsablauf, Regelarten, Operatoren, Scoring, Ausschlusslogik, Priorisierung, Tie-Break-Regel, Cross-Selling-Erkennung, Versionsstrategie, Idempotenzstrategie, API-/Service-Schnittstellen, Fehlercodes, Tenant-Isolation, Teststrategie, bekannte Einschränkungen, ausdrücklich nicht implementierte Folgefunktionen.

Zusätzlich aktualisieren: IMPLEMENTATION_STATUS.md, OPEN_DECISIONS.md (falls offen), RISK_REGISTER.md (falls neue Risiken), bestehende Architektur-/Datenmodelldokumentation soweit betroffen.

## 17. Verbindliche Scope-Grenzen

Nicht implementieren: Mitarbeiteroberfläche, Geschäftsführer-Dashboard, Admin-Center, grafischer Regeleditor, automatische Tarifimporte, Anbieterportal-Integration, Browser-Erweiterung, Vertragsabschluss, Rufnummernmitnahmeprozess, Kündigungsgenerator, KI/LLM, Freitextinterpretation, Machine Learning, automatische Optimierung von Verkaufszielen, vollständige Margen-/Zeitersparnis-/ROI-Auswertung, nachträgliche Änderung des Umfangs von Phase 3A.

Technisch hilfreich erscheinende Funktionen außerhalb des Scopes: als Folgepunkt dokumentieren, nicht implementieren.

## 18. Vorgehensweise und Stop-Regeln

1. Repository und relevante Dokumentation vollständig analysieren.
2. Aktuellen Stand der vorhandenen Empfehlung-, Produkt-, Regel- und Sitzungsmodelle darstellen.
3. Lücken zwischen Ist-Zustand und diesem Auftrag benennen.
4. Konkreten Implementierungsplan und betroffene Dateien vorlegen.
5. Erst danach innerhalb des freigegebenen Umfangs implementieren.
6. Nach jedem abgeschlossenen Teilpaket Tests ausführen.
7. Keine fehlschlagenden Prüfungen überspringen.
8. Fehlerursachen beheben, nicht nur Symptome verdecken.
9. Keine TypeScript-/Prisma-Probleme durch unsichere Casts umgehen.
10. Änderungen in nachvollziehbaren, thematisch getrennten Commits.
11. Vollständige CI für finalen Code-/Migrations-/Skriptstand abwarten.
12. Eigenständigen Abschlussbericht erstellen.
13. Danach stoppen und formale GO/NO-GO-Abnahme abwarten.

Bei Widersprüchen zwischen Repository-Zustand/Schema und diesem Prompt: nicht eigenmächtig größere Neustrukturierung beginnen, sondern Widerspruch mit konkreten Dateien/Stellen melden und eng begrenzte Lösung vorschlagen.

## 19. Pflichtprüfungen

Mindestens: Installation/Lockfile-Prüfung, Lint, Prettier/Formatprüfung, TypeScript-Typecheck, Unit-Tests, Integrationstests, Prisma-Schema-Validierung, Migrationstest, Seed-/Verifikationsskripte, Build, vollständige CI.

Für jeden tatsächlich ausgeführten Befehl dokumentieren: exakter Befehl, Ergebnis, Exit-Code, Anzahl erfolgreicher/fehlgeschlagener Tests, relevante Warnungen, Grund für nicht ausführbare Prüfungen. Eine Prüfung darf nur als erfolgreich gelten, wenn sie tatsächlich ausgeführt wurde.

## 20. Abschlussbericht

`docs/ABSCHLUSSBERICHT_PHASE3B.md` — eigenständig verständlich, mindestens: Auftrag/Scope, finaler Repository-/Commit-Stand, technische Versionen, Ausgangszustand, implementierte Architektur, Regelmodell/Operatoren, Eignungs-/Ausschlusslogik, Kundenpassungs-/Priorisierungslogik, Cross-Selling-/Bedarfspotenziale, Versions-/Reproduzierbarkeitsstrategie, Idempotenz-/Transaktionsstrategie, Schema-/Migrationsänderungen, Service-/API-Schnittstellen, Tenant-/Sicherheits-/Datenschutzmaßnahmen, Tests nach Art/Anzahl, vollständige Prüfkommandos mit Ergebnissen/Exit-Codes, vollständige Datei-Liste, CI-Lauf/finaler Commit/Status/Laufzeit, bekannte Einschränkungen/Risiken, nicht implementierte Folgefunktionen, offene Entscheidungen, ehrliche GO-/NO-GO-Empfehlung. Keine bloßen Verweise anstelle der Pflichtinhalte.

## 21. Definition of Done

Phase 3B gilt nur als technisch fertig, wenn: Engine vollständig deterministisch arbeitet, alle harten Ausschlüsse Vorrang haben, Kundenpassung und geschäftliche Priorisierung getrennt sind, Empfehlungen/Ablehnungen strukturiert begründet werden, Cross-Selling-Chancen getrennt dargestellt werden, Ergebnisse versioniert und historisch reproduzierbar sind, Tenant-Isolation nachgewiesen ist, keine unsicheren TypeScript-Casts verwendet werden, Migrationen und Seeds funktionieren, alle Pflichtprüfungen erfolgreich sind, die vollständige CI für den finalen Stand grün ist, der Abschlussbericht vollständig vorliegt, keine ausgeschlossenen Folgefunktionen vorgezogen wurden.

Nach Erstellung des Abschlussberichts nicht mit der Mitarbeiteroberfläche oder einer anderen Phase beginnen.

## 22. Erste Antwort nach Erhalt dieses Prompts

Noch keine Codeänderungen. Erste Antwort ausschließlich mit:

- Zusammenfassung des verstandenen Auftrags,
- analysiertem Ist-Zustand im Repository,
- vorhandenen relevanten Modellen und Services,
- erkannten Lücken oder Widersprüchen,
- geplantem Implementierungsablauf,
- voraussichtlich betroffenen Dateien,
- erforderlichen Migrationen,
- Testplan,
- Risiken und offenen Entscheidungen,
- eindeutiger Aussage, ob der Auftrag ohne Scope-Erweiterung umsetzbar ist.

Danach auf das ausdrückliche Implementierungs-GO warten.

---

## Geplante Phasenreihenfolge danach (laut ChatGPT)

1. Phase 3B: Empfehlungs-Engine
2. Phase 3C/Phase 5: schlanke Mitarbeiteroberfläche für den Pilotshop
3. Analytics-Grundlage: Zeit, Empfehlungen, Abschlüsse und Cross-Selling messen
4. Geschäftsführer-Dashboard: Marge, Umsatz, Effektivität, Zeitersparnis und Zielerreichung
5. Admin-Center: Fragen, Regeln, Ziele, Produkte und Prioritäten selbst konfigurieren
