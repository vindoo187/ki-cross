# Refactor-Plan und Zeilenrichtwerte vom 13.09.2026

## Status

Übergabe des im Gespräch angeforderten Plans. Die Reihenfolge wurde vom Nutzer
ausdrücklich aufgenommen. Konkrete Aufteilung und Zeilenrichtwerte sind Vorschläge
für die Umsetzung, keine bereits eingeführten Repository-Gates.

Die [Produktentscheidungen](PRODUKTENTSCHEIDUNGEN_2026-09-13.md) präzisieren den
fachlichen Umfang: KI-Cross erstellt Angebote; die eigentliche Vertragsbuchung
erfolgt außerhalb. Bestehenden Code und historische Daten nicht vorsorglich
löschen. Der PR mit diesem Plan enthält ausschließlich Dokumentation.

## Grundentscheidung

Die vorhandene Codebasis und der fachliche Kern bleiben erhalten. Kein kompletter
Neubau und kein pauschaler Stackwechsel. Fragen- und Empfehlungslogik,
Mandantentrennung, Versionierung und bestehende Tests sind weiterzuverwenden.

Sicherheitskorrekturen, Änderungen des Fachverhaltens und rein strukturelle
Refactors in getrennten, überschaubaren PRs bearbeiten. Vor Umsetzung jeweils den
aktuellen Branchstand und die Prüfungen erneut feststellen.

## Verbindliche Reihenfolge

### 1. Versionen und CI korrigieren

- Unterstützte Patchstände einsetzen und Node-Versionen zwischen lokaler
  Konfiguration, CI und Paketmanifest vereinheitlichen.
- Die vorhandenen Komponententests in die CI aufnehmen.
- Lint, Format, Typecheck, Unit, Integration gegen isoliertes PostgreSQL, Build
  und E2E als erforderliche Prüfungen erhalten. Übersprungene Datenbanktests
  nicht als bestandene Integrationsprüfung werten.
- Zeilenbaseline einführen und überholte Projektstatus-Texte berichtigen.

### 2. Produktive Anmeldung herstellen

- Produktive Benutzerverwaltung von synthetischen Dev-Zugängen trennen.
- Dev-Login im Produktionsmodus serverseitig sperren.
- Deaktivierung, Rollenentzug, Session-Widerruf, Rate-Begrenzung und einen
  definierten Einladungs-/Wiederherstellungsweg behandeln.
- Mandanten- und Rollenregeln erhalten; neue betreuungsbezogene Angebotsrechte
  erst auf Basis der offenen Zugriffsentscheidung ergänzen.

### 3. Abschluss- und Finanzregeln absichern

- Paketmarge und Kundenkompensation fachlich definieren und testen.
- Fehlende Kosten von bestätigten Nullkosten unterscheiden; gemischte Währungen
  ohne definiertes Umrechnungsmodell verhindern.
- Vertragswert, Provision und Deckungsbeitrag eindeutig benennen und neue
  Berechnungsregeln versionieren. Historische Snapshots unverändert erhalten.
- Parallelzugriffe bei Antworten, Abschluss und Abbruch absichern.
- Den bisherigen Begriff „Abschluss“ mit der neuen Grenze abgleichen:
  Angebotsannahme und Verkaufsrückmeldung gehören zur Betrachtung; die Buchung
  beim Anbieter ist kein Auftrag an KI-Cross.

### 4. Große Module schrittweise aufteilen

- Laden, Validieren, Entwurfsbearbeitung, Veröffentlichung und Historisierung
  nach Verantwortung trennen; Transaktionen und Mandantenkontext erhalten.
- UI-Darstellung, Formularzustand und Serverkommunikation sinnvoll aufteilen.
- Gemeinsame Abläufe nur bei tatsächlich übereinstimmender Semantik abstrahieren.
- Große Tests nach Anwendungsfällen gliedern; Assertions und relevante
  Fehlerfälle erhalten. Keine universelle Verwaltungsengine allein wegen der
  Zeilenlimits bauen.

### 5. Echte KI integrieren

- Bestehenden Provider-Vertrag und serverseitige Validierung nutzen.
- Mock als Testdouble erhalten; echte Extraktion konfigurierbar integrieren.
- Freitext-Erkenntnisse erst nach Verkäuferbestätigung übernehmen.
- Berechtigungen, Mandantenfreigabe, Zeitlimits, Kostenbegrenzung und den
  Beratungsablauf bei Provider-Ausfall berücksichtigen.
- Kostenpflichtige Provider-Tests getrennt von der normalen PR-CI betreiben.
- Den tatsächlichen Beratungsablauf prüfen; ein isolierter Provider-PoC ist
  kein Integrationsnachweis für das Produkt.

Die Produktentscheidungen zu Angebot, PDF, Versand und Rückmeldung erfordern
zusätzlich einen Implementierungsabgleich. Sie sind neue Funktionsanforderungen
und dürfen nicht als bereits durch diese fünf Refactor-Phasen erledigt gelten.

## Zeilenrichtwerte nach Baustein

| Baustein                        | Zielbereich | Prüfgrenze |
| ------------------------------- | ----------- | ---------- |
| API-Route                       | 40–100      | 150        |
| Page/Layout                     | 80–200      | 300        |
| Wiederverwendbare UI-Komponente | 80–200      | 300        |
| Komplexer Editor/Flow-Container | 150–300     | 400        |
| Hook / Client-Ablaufsteuerung   | 60–150      | 200        |
| Reine Fachlogik / Berechnung    | 80–200      | 300        |
| Service / Anwendungsfall        | 150–300     | 400        |
| Validierung / Schemas / DTOs    | 100–250     | 350        |
| Unit-/Komponententestdatei      | 150–350     | 500        |
| Integrations-/E2E-Testdatei     | 200–500     | 700        |
| CSS-Datei je Funktionsbereich   | 150–300     | 400        |

Gezählt werden physische Dateizeilen einschließlich Leerzeilen und Kommentaren.
Die Zielbereiche sind Orientierung, keine Mindestlängen. Eine Überschreitung
der Prüfgrenze braucht eine dokumentierte fachliche oder technische Begründung.
Die Verantwortung bestimmt den Schnitt, nicht die Zeilennummer.

Keine künstlichen Mini-Dateien, Codeverdichtung oder Verlagerung in Sammeldateien.
Notwendige Erklärungen erhalten; historische Chat-/Phasenprotokolle können in
passende Dokumentation überführt werden.

Generierten Code, Lockdateien und historische Migrationen ausnehmen. Das
Prisma-Schema und deklarative Datenkataloge nach fachlicher Struktur prüfen,
nicht mechanisch zerteilen. Für reine Dokumentation gelten diese Codegrenzen
nicht.

### Umgang mit dem Bestand

- Bestehende Überschreitungen als Baseline erfassen, nicht sofort die gesamte
  CI blockieren.
- Neue Dateien halten die Prüfgrenze ein oder erhalten eine begründete Ausnahme.
- Bestehende Überschreitungen wachsen nur mit begründeter Ausnahme.
- Nach erfolgreicher Aufteilung die entsprechende Baseline-Ausnahme entfernen.
- Ausnahmen enthalten Pfad, Grund, verantwortliche Rolle und ein Kriterium zur
  Neubewertung. Kleinere Dateien allein sind kein Erfolgsnachweis.

## Erste Kandidaten für Phase 4

Bestandsmessung bei `2f8131d`, einschließlich Kommentaren und Leerzeilen:

| Datei                                          | Zeilen | Prüfauftrag                                                            |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `src/server/admin/rule-admin.ts`               | 1.978  | Verwaltung nach Anwendungsfällen aufteilen.                            |
| `src/server/questionnaire/service.ts`          | 1.165  | Zustandsaufbau und Schreibabläufe trennen; Transaktionsgrenzen prüfen. |
| `src/server/admin/question-admin.ts`           | 1.036  | Entwurf, Validierung und Veröffentlichung abgrenzen.                   |
| `src/server/recommendation/service.ts`         | 976    | Datenbeschaffung, Auswertung und Persistierung abgrenzen.              |
| `src/server/admin/commission-admin.ts`         | 959    | Provisionsverwaltung nach Anwendungsfällen aufteilen.                  |
| `src/components/admin/RuleDraftEditor.tsx`     | 851    | Darstellung und Bearbeitungsabläufe entflechten.                       |
| `src/components/consultation/QuestionFlow.tsx` | 711    | Formularzustand, Kommunikation und Darstellung gliedern.               |

Danach weitere Editoren und große Testdateien prüfen. Bereits kurze API-Routen
nicht ohne konkreten Nutzen umbauen.

## Abnahme je Umsetzungsschritt

- Ein abgegrenztes Problem und eine nachvollziehbare Änderung pro PR.
- Bei reinem Refactor unveränderte fachliche Ergebnisse und öffentliche Verträge.
- Bei fachlicher Änderung konkrete Vorher-/Nachher-Beispiele und gezielte Tests.
- Relevante Prüfungen und erforderliche CI-Gates für den exakten Commit erfolgreich.
- Keine neuen zyklischen Abhängigkeiten; notwendige Transaktionen erhalten.
- Verbleibende Grenzen und Rückfallmöglichkeit dokumentieren.
- Keine Produktionsdaten ändern und keine automatische Deployment-Freigabe aus
  diesem Plan ableiten.

Erster Umsetzungsauftrag nach Übernahme des Plans: aktuellen Bestand abgleichen,
kleine PR-Liste erstellen und mit Phase 1 beginnen.
