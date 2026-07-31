# Entwicklungsplan

Kleine, prüfbare Phasen. Jede Phase hat ein überprüfbares Ergebnis und Abnahmekriterien – keine Phase gilt als "fertig", solange die Kriterien nicht erfüllt sind. Reihenfolge ist eine Empfehlung; Abhängigkeiten sind vermerkt.

## Phase 0 – Grundlagenklärung (vor jeglichem Code)

**Ergebnis:** Alle Punkte aus [OPEN_DECISIONS.md](OPEN_DECISIONS.md) sind entweder entschieden oder bewusst vertagt mit Owner und Termin.

**Abnahme:** Auftraggeber hat OPEN_DECISIONS.md gegengezeichnet oder Entscheidungen im Dokument aktualisiert.

**Warum zuerst:** Ohne Klärung von z. B. Kundendatenerfassung oder Hosting-Anbieter würden nachfolgende Phasen auf Annahmen aufbauen, die teure Nacharbeit erzeugen könnten.

## Phase 1 – Projektgerüst

**Ergebnis:** Lauffähiges, leeres Anwendungsgerüst (Next.js/TypeScript, PostgreSQL via Docker, Prisma-Setup, CI mit Lint+Test-Pipeline), Repository mit Branch-/Review-Konventionen.

**Abnahme:** `docker-compose up` startet lokal eine leere, aber lauffähige Anwendung; ein Platzhalter-Test läuft grün in CI.

## Phase 2 – Datenmodell umsetzen

**Ergebnis:** Prisma-Schema gemäß [DATA_MODEL.md](DATA_MODEL.md) (zunächst ohne Mandanten-Mehrfachnutzung, aber mit `tenant_id`-Spalten von Anfang an), Migrationen, Seed-Skript mit **synthetischen** Testdaten.

**Abnahme:** Migrationen laufen sauber durch; Seed erzeugt konsistente Testdaten; keine echten Kundendaten im Repository (Stichprobenprüfung).

**Abhängig von:** Phase 1.

## Phase 3 – Fragen-Engine (Kernlogik, ohne UI-Feinschliff)

**Ergebnis:** `QuestionnaireVersion`/`Question`/`VisibilityCondition`-Logik lauffähig, testbar über API/Unit-Tests, noch mit einfachster UI (kein Design-Feinschliff).

**Abnahme:** Automatisierte Tests decken die in [QUESTION_ENGINE.md](QUESTION_ENGINE.md) beschriebenen Beispiel-Themenblöcke ab (z. B. "Family-Fragen erscheinen nur bei household_size > 1").

**Abhängig von:** Phase 2.

## Phase 4 – Empfehlungs-Engine (regelbasiert)

**Ergebnis:** Eignungs- und Priorisierungsregeln aus [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md) implementiert und getestet, mit manuell gepflegten Beispiel-Tarifdaten (synthetisch, klar als Testdaten gekennzeichnet).

**Abnahme:** Unit-Tests beweisen: (a) Ausschlussregeln greifen hart, (b) eligibility_score und priority_score sind unabhängig nachvollziehbar, (c) keine Empfehlung ohne referenzierte `ProductVersion`.

**Abhängig von:** Phase 2, kann parallel zu Phase 3 laufen.

## Phase 5 – Mitarbeiter-UI (MVP-Qualität)

**Ergebnis:** Nutzbare Oberfläche für Gesprächsführung, Fortschritt, Empfehlung+Begründung, Zusammenfassung, Möglichkeit zur Ablehnung/Änderung. Desktop und Tablet getestet.

**Abnahme:** Die 5 MVP-Abnahmekriterien aus [MVP_SCOPE.md](MVP_SCOPE.md) sind erfüllt; mindestens ein echter Testlauf mit einem Mitarbeiter (nicht Entwickler) ohne Vorführung durch das Entwicklungsteam.

**Abhängig von:** Phase 3, 4.

## Phase 6 – Analytics-Grundlage

**Ergebnis:** Alle Kernereignisse aus [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md) werden korrekt geschrieben; noch kein Dashboard.

**Abnahme:** Für jeden definierten Event-Typ existiert mindestens ein automatisierter Test, der das korrekte Schreiben nachweist.

**Abhängig von:** Phase 5.

**→ Ende MVP.** Go/No-Go-Entscheidung des Auftraggebers vor Phase 7.

## Phase 7 – Rollen- und Berechtigungsmodell vollständig

**Ergebnis:** Rollen gemäß [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md), serverseitige Autorisierungsprüfung für alle Endpunkte.

**Abnahme:** Automatisierter Test je Berechtigungsmatrix-Zeile ("Mitarbeiter kann NICHT auf fremde Filiale zugreifen" usw.).

## Phase 8 – Admin-Oberfläche (Fragen/Regeln/Ziele/Kampagnen)

**Ergebnis:** Fachadmin kann ohne Code-Änderung Fragen/Regeln/Ziele/Kampagnen anlegen, ändern, versionieren, zurückrollen.

**Abnahme:** Ein Nicht-Entwickler (z. B. Product Owner) führt die MVP-Abnahmekriterien 3 und 5 aus [MVP_SCOPE.md](MVP_SCOPE.md) Pilot-Abschnitt selbstständig durch.

**Abhängig von:** Phase 3, 4, 7.

## Phase 9 – Geschäftsführer-Dashboard

**Ergebnis:** KPI-Dashboard gemäß [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md), inkl. Filial-/Mitarbeitervergleich und Zeitverlauf.

**Abnahme:** Jede angezeigte KPI lässt sich per Tooltip/Detailansicht auf Formel und Datenquelle zurückführen (Stichprobenprüfung durch Auftraggeber).

**Abhängig von:** Phase 6, 7.

## Phase 10 – Vollständige Produktabdeckung + Versionierung produktiv

**Ergebnis:** Alle Produktkategorien (DSL/Glasfaser, Family, Streaming, Zubehör) abgebildet; Tarif-/Provisionsversionierung im echten Pflegeprozess genutzt.

**Abnahme:** Testfall "Provisionsänderung nach Abschluss X ändert die KPI von X nicht rückwirkend" besteht.

**Abhängig von:** Phase 4, 8.

## Phase 11 – Pilotbetrieb alle 5 Filialen

**Ergebnis:** Produktivbetrieb über definierten Zeitraum (**Annahme:** 4–6 Wochen), begleitet durch Baseline-Vergleichsmessung (Methode aus Phase 0/OPEN_DECISIONS).

**Abnahme:** Pilot-Abnahmekriterien aus [MVP_SCOPE.md](MVP_SCOPE.md) erfüllt; Sicherheits-Review (siehe [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md)) vor Produktivstart mit echten Kundendaten durchgeführt und dokumentiert.

**Abhängig von:** Phase 9, 10.

## Phase 12 – Auswertung und Entscheidung Plattformversion

**Ergebnis:** Pilotauswertung, Entscheidung des Auftraggebers, ob/wann Plattformversion (Mandantenfähigkeit für Fremdverkauf) verfolgt wird.

**Abhängig von:** Phase 11. Kein technischer Auftrag in dieser Dokumentenreihe.

## Kritischer Pfad

Phase 0 → 1 → 2 → (3 ∥ 4) → 5 → 6 → **Go/No-Go** → 7 → 8 → 9 → 10 → 11 → 12.
