# Produktentscheidungen aus der kritischen Fragerunde vom 13.09.2026

## Status und Zweck

Übergabe der mit dem Co-Nutzer besprochenen Anforderungen an den Repository-Owner
`vindoo187`. Ausgangspunkt ist `dev` bei Commit
`2f8131ded74fec014de8def2a6b14fab6aeec2d0`.

Dieses Dokument beschreibt Anforderungen, keine implementierten Funktionen und
keine Produktionsfreigabe. Es unterscheidet Aussagen des Nutzers, daraus
abgeleitete Umsetzungsvorschläge und noch offene Entscheidungen. Bestehende
Dokumentation wird hierdurch nicht stillschweigend umgeschrieben; der Owner soll
die Änderungen prüfen und in die maßgeblichen Spezifikationen übernehmen.

## 1. Im Gespräch festgelegte Anforderungen

### A01 – Individuelle Haushaltspakete

KI-Cross soll eine umsatzstarke Beratung unterstützen und aus dem ermittelten
Kundenbedarf passende Produktpakete zusammenstellen. Betrachtet werden unter
anderem Mobilfunk, Partnerkarten, Internet zuhause und Streaming.

Ein zentraler Verkaufsnutzen ist die Bündelung: weniger Verwaltungsaufwand,
möglichst ein Anbieter und eine gemeinsame Abrechnung. Ob eine konkrete
Kombination diese Eigenschaften erfüllt, muss durch die gepflegten Produktdaten
belegt sein. Die Aussage, dies gefalle jedem Kunden, ist kein nachgewiesenes
Marktergebnis und kein automatisch anzunehmendes Kundenmerkmal.

### A02 – Wunschpreis und Mehrwert

Der Kunde kann einen Wunschpreis nennen. Der Verkäufer darf ein höherpreisiges
Paket mit zusätzlichem Nutzen anbieten und den Kunden dafür gewinnen. Daraus
folgt keine automatische Zustimmung des Kunden zu Mehrkosten. Wie Wunschpreis
und eine ausdrücklich feste Budgetgrenze unterschieden werden, ist noch offen.

### A03 – Anbieter und Alternativen

Die erste nutzbare Version soll O₂, Telekom, Freenet, Ay Yıldız, congstar und Blau
berücksichtigen. KI-Cross soll mehrere geeignete Angebote empfehlen können; der
Kunde entscheidet. Auch anbieterübergreifende Kombinationen wurden im Gespräch
bejaht. Konkrete Kombinationsregeln müssen tatsächlich buchbare Produkte abbilden.

Die Betreiber bestimmen Auswahl und Priorisierung. Weder die konkreten Regeln
noch die maximale Zahl gleichzeitig gezeigter Angebote wurden festgelegt.

### A04 – Pflege und Gültigkeit der Daten

Der Admin pflegt die Tarif- und Kombinationsdaten monatlich. Gültigkeitszeiträume
und akzeptable Margen werden durch die Betreiber definiert. Konkrete Datenquellen,
Formate und ein Verfahren für Änderungen zwischen den Pflegeterminen wurden
nicht festgelegt.

### A05 – Späterer DSL-Abschluss oder Kompensation

DSL kann später gebucht werden, wenn bestehende Bindungen einen sofortigen
Wechsel unattraktiv machen. Alternativ kommt eine Kompensation infrage, wenn
die Paketmarge dies wirtschaftlich zulässt.

Der Verkaufsleiter verantwortet Kompensationsentscheidungen; eigenständige
Entscheidungen im Verkauf sollen ebenfalls möglich sein. Maßgeblich ist die von
den Betreibern definierte akzeptable verbleibende Marge. Formel, Grenzwerte und
der genaue Freigabeprozess sind noch nicht festgelegt.

### A06 – Abbruch der Gesamtberatung

Will der Kunde ausschließlich sein Einzelanliegen bearbeiten lassen, verlangt
der Nutzer einen „harten Cut“. Die Gesamtberatung und weitere Cross-Selling-
Nachfragen sollen in diesem Fall enden; das Einzelanliegen bleibt bearbeitbar.

### A07 – Zeitbudget und Datenbeschaffung

Für die vollständige Paketberatung wurden 15 Minuten genannt. Daten werden
überwiegend erfragt; notwendige Preise und Vertragsinformationen soll der
Verkäufer vor dem belastbaren Paketvergleich herausfinden.

Auf die Frage nach dem Start des Zeitbudgets antwortete der Nutzer „ab sofort“.
Die Arbeitsinterpretation lautet: ab Beginn der Paketberatung einschließlich
Datenerfassung. Der genaue messbare Start- und Endpunkt ist vor einer Zeitabnahme
noch zu präzisieren; zusätzliche Recherchezeit wurde nicht ausdrücklich erlaubt.

### A08 – Eingabe und KI-Bestätigung

Die Erfassung erfolgt über Klickfelder und ergänzenden Freitext. Aus Freitext
abgeleitete Informationen dürfen erst nach Bestätigung durch den Verkäufer in
die Paketberechnung eingehen. Die KI liefert damit zunächst überprüfbare
Vorschläge und keine stillschweigend verbindlichen Kundenangaben.

### A09 – Kundenangebot per E-Mail und zum Drucken

Der Kunde soll das Angebot per E-Mail erhalten und ausdrucken können. Die
Angebotsgültigkeit bestimmt der Verkäufer. Bei nicht mehr verfügbaren Angeboten
stehen nach Aussage des Nutzers Alternativangebote zur Verfügung.

Damit noch nicht entschieden ist, wie eine Angebotsfrist behandelt wird, die
über die Preisgültigkeit eines enthaltenen Produkts hinausgeht. Ebenso offen
sind zulässige Änderungen einer Alternative und der Umgang mit ursprünglichen
Preiszusagen.

### A10 – Grenze zum eigentlichen Verkauf

Nach der Angebotsannahme findet der eigentliche Verkauf außerhalb von KI-Cross
statt. KI-Cross soll den Vertrag nicht selbst beim Anbieter buchen.

Änderungen am Angebot sollen anschließend aktiv für die Auswertung zurückgemeldet
werden. Ergebnisse und Änderungen müssen auch nachgetragen werden können. Die
Rückmeldung übernimmt der Mitarbeiter, der den Kunden gerade betreut.

Eine Pflicht zur vollständigen Rückmeldung jedes unverändert abgeschlossenen
oder gescheiterten Verkaufs wurde noch nicht ausdrücklich festgelegt.

### A11 – Übergabe und Zugriff

Mitarbeiter, die aktuell mit dem Kunden befasst sind, sollen dessen Angebot
einsehen, übernehmen und Ergebnisse ergänzen können. Die Angebotsnummer wurde
als ein möglicher Zugangsweg akzeptiert, nicht als abschließendes Verfahren.

Welche Kundendaten gespeichert werden und wie Wiederfinden, Zuordnung und
Berechtigung konkret funktionieren, wird später festgelegt. Daraus folgt keine
allgemeine Freigabe für beliebige Kunden- oder mandantenübergreifende Zugriffe.

### A12 – Fachliche Abnahme und spätere Erfolgsmessung

Erste Kernabnahme: Ein kundenzugeschnittenes Paket erstellen und anbieten können.
Der Verkaufsleiter verantwortet fachliche Referenzfälle und deren Freigabe,
unterstützt durch erfahrene Verkäufer. Der Entwickler weist technische Funktion
nach. Die Erfolgsmessung soll erst nach technischer Freigabe für einen Pilot
beginnen. Eine technische Freigabe ist noch kein Nachweis einer Umsatzsteigerung.

Konkrete Referenzfälle, Zielwerte, Vergleichsbasis und Pilotumfang wurden noch
nicht geliefert beziehungsweise beschlossen. Vier Wochen Pilotdauer waren ein
Gesprächsvorschlag, keine bestätigte Laufzeit.

## 2. Abgeleitete Umsetzungsvorschläge – noch keine Einzelabnahme

- Druckfähiges PDF als gemeinsames Dokument für Ausdruck und E-Mail-Versand;
  Verkäufer prüft Empfänger und Angebot vor dem Versand.
- Angebotsversionen unveränderlich speichern; Änderungen als neue Version mit
  nachvollziehbarem Bezug zur vorherigen Version führen.
- Für Alternativangebote Unterschiede bei Leistung, Preis und Laufzeit zeigen
  und eine erneute Kundenbestätigung vorsehen.
- Preise in zeitlichen Phasen darstellen, wenn DSL, Rabatte oder andere
  Bestandteile später beginnen. Zukünftige Rabatte nicht vorzeitig einrechnen.
- Kompensation aus Paketmarge, Kosten und verbleibender Mindestmarge berechnen;
  Überschreitungen der Verkäuferbefugnis an den Verkaufsleiter geben. Befugnisse
  und die Möglichkeit einer Ausnahme sind separat festzulegen.
- Ohne Rückmeldung den Status „Verkaufsergebnis offen“ führen. Offene Fälle in
  Auswertungen gesondert ausweisen; Angebotsannahme nicht als erzielten Umsatz
  zählen.
- Bearbeitung und Nachträge mit handelndem Benutzer und Zeitpunkt protokollieren.
- Datenpflege und Priorisierungsregeln versionieren und kontrolliert freigeben.

## 3. Offene Entscheidungen für die Fortsetzung

| ID  | Offener Punkt                       | Benötigte Entscheidung                                                                                                 |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| O01 | Kein geeignetes neues Angebot       | Welches Ergebnis liefert KI-Cross, wenn keines der Pakete einen erkennbaren Mehrwert bietet?                           |
| O02 | Kundenbezug und Übergabe            | Datenfelder, Suchwege, Übernahmeberechtigung und Filialgrenzen festlegen.                                              |
| O03 | Datenversorgung                     | Quellen, Formate, Buchbarkeitsnachweis und Umgang mit Änderungen zwischen den monatlichen Pflegeterminen bestimmen.    |
| O04 | Margen und Kompensation             | Berechnungsbasis, Mindestmarge, Eigenentscheidungsgrenzen und Freigabeverfahren definieren.                            |
| O05 | Angebotsgültigkeit und Alternativen | Konflikte zwischen Angebotsfrist und Produktgültigkeit sowie Änderungen von Preis und Leistung regeln.                 |
| O06 | Priorisierung                       | Konkrete Auswahlregeln, Sortierung, Zahl der Varianten und Umgang mit harten Budgetgrenzen bestimmen.                  |
| O07 | Verkaufsrückmeldung                 | Welche Ausgänge müssen erfasst werden, wie vollständig und mit welchem Nachtrags-/Erinnerungsverfahren?                |
| O08 | Abnahme und Messung                 | Referenzfälle, Zeitmesspunkte, Pilotumfang, Ausgangswerte und Erfolgskriterien festlegen.                              |
| O09 | Versand und Annahme                 | Versanddienst, Empfängererfassung, Nachweis von Versand und Angebotsannahme sowie Umgang mit Versandfehlern bestimmen. |

**Die Fragerunde wurde auf Wunsch des Nutzers pausiert.** Nächster Gesprächspunkt
ist O01: Was soll KI-Cross empfehlen, wenn kein neues Paket einen erkennbaren
Mehrwert für den Kunden bietet?

## 4. Auswirkungen auf vorhandene Spezifikationen

- [MVP_SCOPE.md](MVP_SCOPE.md): früherer enger MVP und nun gewünschte sechs
  Anbieter, Paketvergleich und Angebotsausgabe müssen gemeinsam abgegrenzt werden.
- [DEAL_CAPTURE.md](DEAL_CAPTURE.md): vorhandene Deal-Erfassung ist nicht
  automatisch Teil des neuen Angebots-MVP. Rückmeldungen bleiben erforderlich;
  ein Löschen der Implementierung wurde nicht beschlossen.
- [DATA_MODEL.md](DATA_MODEL.md) und [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md):
  Kundenbezug, E-Mail-Versand und betreuungsbezogener Zugriff brauchen eine
  abgestimmte Ergänzung.
- [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md): Paketkombinationen,
  zeitliche Preisphasen und konfigurierbare Vorauswahl gegen den Bestand prüfen.
- [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md): Angebotsannahme, gemeldeten
  Verkauf und unbekannten Ausgang fachlich auseinanderhalten.

Die priorisierte technische Weiterentwicklung und vorgeschlagenen
Zeilenrichtwerte stehen im [Refactor-Plan](REFACTOR_PLAN_2026-09-13.md).
