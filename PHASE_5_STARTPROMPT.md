# STARTPROMPT – PHASE 5: MITARBEITER-UI (MVP-QUALITÄT)

_Quelle: ChatGPT (Projektleiter), 2026-08-01. Planungsfassung — erteilt ausdrücklich noch kein Implementierungs-GO für Code, nur GO für die Planungsstufe (Ist-Analyse + Implementierungsplan)._

## 0. Ausgangslage

- Branch: `main`
- HEAD: `69e754e`
- Phase 3A / Plan-Phase 3 (Fragen-Engine): abgeschlossen
- Phase 3B / Plan-Phase 4 (Empfehlungs-Engine): FINAL GO (CI-Lauf #20 erfolgreich)
- Die Abhängigkeiten von Phase 5 gemäß `IMPLEMENTATION_PLAN.md` (kritischer Pfad Phase 0 → 1 → 2 → (3 ∥ 4) → 5 → 6 → Go/No-Go → 7 → 8 → 9 → 10 → 11 → 12) sind damit erfüllt.

Phase 5 soll erstmals eine durchgängig nutzbare Mitarbeiteroberfläche für ein echtes Beratungsgespräch liefern.

## 1. Verbindliches Ergebnis der Phase

Ein Mitarbeiter muss ohne Entwicklerunterstützung:

1. eine Beratungssitzung öffnen bzw. beginnen können,
2. den dynamischen Fragenpfad vollständig bearbeiten können,
3. seinen Fortschritt und noch fehlende Pflichtangaben erkennen können,
4. Antworten ändern und sicher speichern können,
5. die Empfehlungs-Engine auslösen können,
6. eine verständliche Ergebnisübersicht erhalten,
7. jede Empfehlung per Klick auf ihre regelbasierte Begründung zurückführen können,
8. Cross-Selling-Hinweise erkennen und bearbeiten können,
9. eine Empfehlung ablehnen oder die Beratung ändern können,
10. eine abschließende Beratungszusammenfassung sehen können.

Die Oberfläche muss auf Desktop und Tablet praxistauglich sein.

## 2. Verbindliche MVP-Abnahmekriterien (aus MVP_SCOPE.md)

Phase 5 ist nur abgeschlossen, wenn alle folgenden Kriterien nachweisbar erfüllt sind:

1. Ein Mitarbeiter kann ein vollständiges Beratungsgespräch ohne Entwicklerunterstützung durchführen.
2. Mindestens drei unterschiedliche Kundensituationen führen zu spürbar unterschiedlichen Fragenpfaden.
3. Jede Empfehlung lässt sich per Klick auf ihre Regel-Begründung zurückführen.
4. Keine Empfehlung enthält Preise oder Eigenschaften außerhalb der gepflegten Stammdaten.
5. Alle in ANALYTICS_AND_KPIS.md definierten Kernereignisse werden korrekt geschrieben.

Zusätzlich: mindestens ein echter Testlauf mit einem Mitarbeiter, bei dem kein Entwickler die Bedienung vorführt oder eingreift. Dieser reale Test darf nicht durch Unit-, Integrations- oder E2E-Tests ersetzt werden.

## 3. Vorgehensweise – zwingend

**Implementiere noch keinen Code.** Führe zunächst eine vollständige Ist-Analyse durch und erstelle einen detaillierten Implementierungsplan für Phase 5 (analog `PHASE_3B_IMPLEMENTATION_PLAN.md`).

Lies mindestens:

- `IMPLEMENTATION_PLAN.md`
- `MVP_SCOPE.md`
- `ANALYTICS_AND_KPIS.md`
- `docs/ABSCHLUSSBERICHT_PHASE3A.md`
- `docs/ABSCHLUSSBERICHT_PHASE3B.md`
- `docs/RECOMMENDATION_ENGINE.md`
- `docs/DATA_MODEL.md`
- `docs/DECISION_LOG.md`
- `docs/OPEN_DECISIONS.md`
- `docs/RISK_REGISTER.md`
- `docs/IMPLEMENTATION_STATUS.md`
- die bestehende Frontend-Struktur
- die öffentlichen Schnittstellen der Fragen-Engine
- `src/server/recommendation/service.ts`
- die vorhandenen Authentifizierungs-, Rollen-, Tenant- und API-Muster
- die vorhandenen Test-, CI- und Styling-Konfigurationen

Prüfe außerdem den tatsächlichen Git-Stand und bestätige, ob `69e754e` der Ausgangsstand ist. Bestehende, nicht zu Phase 5 gehörende Änderungen dürfen nicht überschrieben werden.

## 4. Architekturleitplanken

### 4.1 Fachliche Wahrheit

Die bereits implementierten Server-Engines bleiben die einzige fachliche Wahrheit. Das Frontend darf folgende Logik nicht eigenständig duplizieren: Sichtbarkeit von Fragen, Pflichtfeldstatus, Fortschrittsberechnung, Antwortvalidierung, Produktausschlüsse, Eignungsprüfung, Fit-Score, Priorisierung, Tie-Breaking, Cross-Selling-Regeln, Empfehlungsbegründungen, Preise und Produkteigenschaften.

Falls für die UI geeignete Read-Models oder API-Endpunkte fehlen: dünne serverseitige Adapter-/View-Model-Schicht vorschlagen, die die bestehenden Services verwendet und keine zweite Fachlogik aufbaut.

### 4.2 State-Management

Zuerst vorhandenen Stack und installierte Abhängigkeiten analysieren. Bevorzugte Zielarchitektur:

- persistierter Sitzungs-, Fragen- und Empfehlungszustand kommt vom Server,
- temporärer Eingabe- und Darstellungszustand bleibt lokal in der jeweiligen UI,
- komplexer Seitenzustand kann über einen klar typisierten Reducer oder eine kleine Zustandsmaschine modelliert werden,
- kein neuer globaler State-Manager, sofern der vorhandene Stack den Ablauf ohne ihn sauber abbilden kann,
- keine parallele Schattenkopie der vollständigen Beratungssitzung im Browser.

Explizite UI-Zustände definieren, mindestens: Laden, bereit zur Eingabe, lokale Änderung vorhanden, Speichern, erfolgreich gespeichert, Validierungsfehler, Versionskonflikt, offline/Netzwerkfehler, Fragen vollständig, Empfehlung wird berechnet, Empfehlung vorhanden, keine auswertbare Empfehlung, abgeschlossene Sitzung.

Im Plan klären: Speichern pro Antwort oder gesammelt, Autosave-Verhalten, Debouncing, Wiederholung nach Netzwerkfehlern, Schutz vor doppelten Requests, Verhalten beim Verlassen mit ungespeicherten Eingaben, Behandlung des vorhandenen Optimistic Lockings, Verhalten bei Pfadänderung durch eine Antwort.

Versteckte Antworten dürfen nicht durch rein clientseitige Annahmen gelöscht oder weiterverwendet werden — maßgeblich ist das Verhalten der vorhandenen Fragen-Engine.

### 4.3 Dynamischer Fragenfluss

Soll sich wie ein geführtes Verkaufsgespräch anfühlen, nicht wie ein technisches Datenbankformular. Erwartet mindestens: klar erkennbare aktuelle Frage bzw. sinnvolle kleine Fragengruppe, Fortschrittsanzeige, verständliche Auswahlmöglichkeiten, sichtbare Kennzeichnung verpflichtender Angaben, Zurück-Navigation zu bereits beantworteten Fragen, Möglichkeit kontrollierter Antwortänderung, stabile Fokusführung nach dem Speichern, verständliche Fehlermeldungen, keine Anzeige technisch interner IDs oder Operatoren.

Alle sieben vorhandenen Antworttypen (Single, Multi, Boolean, Integer, Decimal, ShortText, Date) müssen korrekt unterstützt werden — je Typ: Eingabe, Validierung, Tastaturbedienung, Tablet-Nutzung prüfen.

### 4.4 Empfehlungen und Begründungen

Eigenes, typisiertes UI-Read-Model für Empfehlungsergebnisse. Hauptansicht mindestens: Rang/empfohlene Reihenfolge, Produkt-/Tarifbezeichnung, ausschließlich gespeicherte Preise/Eigenschaften, verständliche Eignungszusammenfassung, `customerFitScore` falls fachlich sinnvoll, relevante Cross-Selling-Hinweise, klarer nächster Handlungsschritt.

Für jede Empfehlung: anklickbare Begründungsansicht, ausschließlich basierend auf gespeicherten `RecommendationRationale`- und zugehörigen Stammdaten. Deterministische Präsentationsschicht, die bekannte `factorKey`/`factorValue`-Kombinationen in verständliche deutsche Texte übersetzt.

Dabei: kein KI-generierter Text, kein Rückschluss auf nicht vorhandene Daten, keine erfundenen Preise/Eigenschaften, unbekannte `factorKeys` nicht stillschweigend interpretieren (sichere generische Anzeige oder kontrollierter Fehler mit Telemetrie), interne Provisionen/Margen/Business-Prioritäten nicht ungeprüft kundensichtbar machen, Ausschlussgründe und Cross-Selling-Gründe klar von positiven Empfehlungsgründen trennen.

Prüfen, ob Begründung besser als aufklappbarer Bereich, Drawer oder Dialog umgesetzt wird — Auswahl insbesondere für Tablets und Barrierefreiheit begründen.

### 4.5 Ablehnungs- und Änderungsflow

Empfehlungen sind append-only und dürfen durch die UI niemals überschrieben oder bearbeitet werden. Fachlich und technisch trennen:

**Empfehlung ablehnen:** bestehende Recommendation bleibt unverändert; Ablehnung wird über den vorgesehenen Outcome-/Workflow-Pfad dokumentiert; Grundauswahl möglichst strukturiert; keine unnötigen personenbezogenen Freitexte; wiederholte Klicks dürfen keine unkontrollierten Duplikate erzeugen; passendes Analytics-Ereignis muss geschrieben werden.

**Beratung ändern:** Mitarbeiter gelangt gezielt zurück zu den Antworten; geänderte Antworten werden über die Fragen-Engine gespeichert; sichtbarer Pfad und Vollständigkeit werden neu berechnet; anschließend wird `evaluate(consultationSessionId)` erneut verwendet; Fingerprint-Idempotenz der Empfehlungs-Engine bleibt erhalten; bei geänderten Eingaben entsteht ggf. eine neue Recommendation; alte Recommendations bleiben nachvollziehbar.

Vor Umsetzung prüfen, welche Service-/API-Schnittstellen für Outcomes, Sessionabschluss und Cross-Selling-Workflow bereits existieren. Fehlende Schnittstellen dürfen ergänzt werden, ohne die fachlichen Invarianten aus Phase 3A/3B zu umgehen.

### 4.6 Cross-Selling

`RecommendationCrossSellingSignal` ist ein unveränderlicher Snapshot. `SalesOpportunity` bildet den veränderlichen Vertriebsworkflow ab. Die UI muss diese Trennung respektieren: Signal/erkannten Bedarf verständlich anzeigen, Bearbeitungsstatus über `SalesOpportunity` führen, kein Update an Cross-Selling-Signalen, keine zweite Opportunity bei wiederholtem Laden oder identischer Auswertung, Statusänderungen tenant- und rollenabhängig absichern.

### 4.7 Desktop- und Tablet-Tauglichkeit

Zielgeräte mindestens: üblicher Desktop/Laptop, Tablet Querformat, Tablet Hochformat. Verbindlich: keine horizontalen Scrollzwänge im Kernprozess, ausreichend große Touch-Ziele, keine ausschließlich hover-abhängige Bedienung, wichtige Aktionen ohne Verlust des Gesprächskontexts erreichbar, Begründungen/Dialoge funktionieren auch mit Bildschirmtastatur, stabile Darstellung bei langen deutschen Bezeichnungen, sichtbarer Lade-/Speicher-/Fehlerstatus, Tastaturbedienbarkeit und sinnvoller Fokus, semantische Labels und verständliche Fehlermeldungen.

Mobile Smartphone-Optimierung darf berücksichtigt werden, ist aber kein eigenes MVP-Abnahmekriterium, sofern MVP_SCOPE.md nichts Abweichendes verlangt.

### 4.8 Analytics

Vor der Implementierung vollständige Mapping-Tabelle erstellen: Nutzeraktion → gefordertes Analytics-Ereignis → Auslöser → Payload → Idempotenz/Duplikatschutz → Test.

Ausschließlich Definitionen aus `ANALYTICS_AND_KPIS.md` nutzen — keine Eventnamen/Payloads frei erfinden, wenn bereits ein verbindliches Modell vorhanden ist. Analytics-Schreibfehler dürfen nicht unbemerkt bleiben; im Plan klären, ob sie den Fachvorgang blockieren müssen oder kontrolliert nachgelagert behandelt werden können.

### 4.9 Sicherheit und Mandantentrennung

Alle neuen serverseitigen Zugriffe müssen: tenant-gescoped sein, vorhandene Rollen-/Berechtigungsprüfungen verwenden, keine fremden Sessions über erratene IDs offenlegen, keine internen Fehler/Stack Traces/DB-Details an die UI geben, keine neuen personenbezogenen Daten ohne dokumentierte Notwendigkeit einführen. Keine direkte Datenbanknutzung aus UI-Komponenten.

## 5. UX-Zielbild

Ruhig, schnell, selbsterklärend. Der Mitarbeiter soll jederzeit erkennen: Wo bin ich? Was muss ich als Nächstes fragen? Wie weit ist die Beratung? Wurde meine Eingabe gespeichert? Warum wird dieses Produkt empfohlen? Welche Zusatzchance wurde erkannt? Wie lehne ich die Empfehlung ab? Wie ändere ich eine Angabe? Ist die Beratung vollständig abgeschlossen?

Kein überladenes Dashboard — Phase 5 ist ein geführter Beratungsarbeitsplatz, keine Managementoberfläche.

## 6. Nicht Teil von Phase 5

Sofern die Projektdokumentation nicht ausdrücklich etwas anderes bestimmt: keine Geschäftsführer-/Management-Dashboards, keine Administration von Fragen/Regeln/Produkten/Zielen, keine Tarifimport-Automatisierung, keine direkte Einbindung von O2-/Telekom-Portalen, keine Browser-Erweiterung, keine KI-generierten Empfehlungstexte, keine Änderung der Kernlogik aus Phase 3A oder 3B, kein physisches Entfernen von `legacyExpression`, keine fachfremden Datenbankbereinigungen, kein allgemeines Design-System-Rewrite, keine Erweiterung über den Mitarbeiter-MVP hinaus.

Wenn eine notwendige UI-Anforderung eine Änderung an Phase 3A/3B verlangt: stoppen und den Konflikt dokumentieren, bevor diese Kernlogik geändert wird.

## 7. Testanforderungen

Der Implementierungsplan muss mindestens vorsehen:

**Unit-/Komponententests:** Darstellung aller Antworttypen, Fortschritts- und Fehlerdarstellung, Mapping strukturierter Rationales auf UI-Texte, unbekannte Begründungsfaktoren, Button- und Statuslogik, responsive/zustandsabhängige Komponenten.

**Integrations-/API-Tests:** vollständiger Fragenfluss, dynamische Pfadänderung, Optimistic-Lock-Konflikt, vollständige Auswertung, Laden der neuesten Recommendation, Ablehnung, Änderung und erneute Auswertung, Cross-Selling-/SalesOpportunity-Workflow, Tenant-Isolation, Berechtigungen, Analytics-Ereignisse.

**E2E-Tests:** mindestens drei fachlich unterschiedliche Kundensituationen mit verschiedenen sichtbaren Fragenpfaden und nachvollziehbar unterschiedlichen Ergebnissen. Mindestens ein E2E-Test deckt den kompletten Weg ab: Sitzung starten → Fragen beantworten → Empfehlung erzeugen → Begründung öffnen → Cross-Selling-Hinweis bearbeiten → Empfehlung ablehnen oder Angaben ändern → Zusammenfassung.

Prüfen, ob bereits ein E2E-Framework vorhanden ist. Falls nicht: kleinste zum Projekt passende Ergänzung vorschlagen und begründen. Vor Freigabe des Plans keine neue Abhängigkeit installieren.

**Manueller Mitarbeitertest:** kurzes, neutrales Testskript. Der Mitarbeiter erhält nur eine Ausgangssituation, keine Entwickler-Vorführung. Zu protokollieren: benötigte Zeit, Stellen mit Rückfragen, Fehlbedienungen, nicht verstandene Begriffe, abgebrochene Schritte, erkannte Empfehlung, Verständnis der Begründung, Verständnis von Ablehnung und Änderung, Tablet-/Desktopgerät, Ergebnis bestanden/nicht bestanden. Ein durch Entwickler geführter Test erfüllt das Abnahmekriterium nicht.

## 8. Erwartetes Ergebnis der ersten Antwort

**Noch keinen Anwendungscode liefern.** Stattdessen einen belastbaren Plan mit:

- bestätigtem Git- und CI-Ausgangsstand,
- Analyse der vorhandenen Frontend-, API-, Auth-, Tenant- und Testarchitektur,
- Liste vorhandener und fehlender Schnittstellen,
- empfohlenem Seiten- und Komponentenaufbau,
- State-Management-Entscheidung mit Begründung,
- Datenfluss vom Laden einer Sitzung bis zum Abschluss,
- Verhalten bei Speichern, Konflikten und Pfadänderungen,
- Konzept für Recommendation- und Rationale-Darstellung,
- konkretem Ablehnungs-/Änderungsflow,
- Cross-Selling-/SalesOpportunity-Flow,
- vollständigem Analytics-Mapping,
- Desktop-/Tablet-Konzept,
- Testmatrix gegen alle fünf MVP-Abnahmekriterien,
- Plan für den echten Mitarbeitertest,
- Liste aller voraussichtlich zu erstellenden und zu ändernden Dateien,
- Risiken, offenen Entscheidungen und klaren Stop-Punkten,
- Umsetzungsschritten in sinnvoll getrennten Arbeitspaketen,
- exakten Prüfkommandos für lokal und CI,
- Definition of Done,
- abschließender GO-/NO-GO-Empfehlung für den Beginn der Implementierung.

Jede Annahme ausdrücklich als Annahme markieren. Keine vorhandenen Dateien, Routen, APIs oder Abhängigkeiten erfinden.

Falls Dokumentation und tatsächlicher Code voneinander abweichen: nicht stillschweigend eine Seite als richtig annehmen, sondern die Abweichung und ihre Auswirkung dokumentieren.

**Nach Vorlage dieses Plans auf die Freigabe des Projektleiters warten. Erst danach mit der Implementierung beginnen.**

---

_Projektleiter-Hinweis (ChatGPT, 2026-08-01): GO für die Planungsstufe von Phase 5, aber noch kein sofortiges GO für unkontrollierte UI-Implementierung. Zuerst prüft Claude Code den tatsächlichen Frontend- und API-Bestand gegen diesen Prompt. Danach wird der Plan wie bei Phase 3A/3B auf Lücken geprüft, erst dann wird der Code freigegeben._
