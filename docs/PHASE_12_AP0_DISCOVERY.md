# Phase 12 AP0: Discovery — Freitext-KI-Angebotsfeature (Teil A)

Status: AP0 abgeschlossen, ChatGPT-Entscheidungen final, GO für Implementation Plan (AP1) erteilt (2026-08-23). Kein Code in AP0 — reine Untersuchung + Architekturentscheidungen.

Scope-Grenze (bindend, ChatGPT): Phase 12 endet bei der bestätigten strukturierten Beratung. Freitext → KI-Fakten-Vorschläge → Mitarbeiterbestätigung → `CustomerAnswer` → bestehende Empfehlungs-Engine unverändert (`computeVisiblePath` → Eligibility → Prioritization → Recommendation → Cross-Selling). Automatischer Vertragsabschluss, Provider-API-Anbindung, Bestellung, Aktivierung sind NICHT Teil dieser Phase (Teil B, separat).

## 1. Erlaubte Extraktionsfelder

Die KI darf ausschließlich Werte für bereits im aktiven Fragebogen (`QuestionnaireVersion`) existierende, für die Session serverseitig sichtbare Fragen vorschlagen (basierend auf `computeVisiblePath`-Ergebnis) — kein neues Vokabular, keine erfundenen Fragen/Antwortoptionen.

**ChatGPT-Entscheidung: `SHORT_TEXT` als KI-Ziel zunächst NEIN.** Erlaubte Antworttypen in Phase 12: `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `BOOLEAN`, `INTEGER`, `DECIMAL`, `DATE`. Begründung: `SHORT_TEXT` erzeugt den größten Konflikt zwischen unstrukturiertem Freitext, PII und dauerhaft gespeicherten Kundendaten, bei geringem Mehrwert (KI-generierte Freitextübernahme ins Kundendatenmodell). Kann später eigene Erweiterung werden.

## 2. Freitext → Fragen-Mapping

Serverseitige Nachvalidierung ist Pflicht: jeder von der KI zurückgegebene `questionKey` wird gegen die tatsächlich sichtbare Fragenmenge der Session geprüft, unbekannte/nicht-sichtbare Keys werden verworfen.

**ChatGPT-Entscheidung (harte Sicherheitsgrenze): die KI darf niemals selbst bestimmen, welche Fragen sichtbar sind.** Der Server berechnet zuerst den aktuellen sichtbaren Fragenkatalog; nur dieser Katalog geht an die Extraktionskomponente (Session → serverseitig sichtbare Fragen → KI, niemals Session → KI → KI entscheidet, welche Fragen existieren). Wichtig für Tenant-Isolation, Fragebogen-Versionierung und IDOR-Schutz.

**ChatGPT-Entscheidung zu Mehrdeutigkeit: konsequent verwerfen.** Lieber kein Vorschlag als ein falscher. Pipeline: Freitext → Kandidat → serverseitige Validierung → nur valide + eindeutige Kandidaten → Mitarbeiter. Die KI darf keine neuen Question-Keys, Antwortoptionen oder Werte erfinden.

## 3. KI-Ausgabe strikt strukturieren

KI-Antwort als striktes Schema: Liste von `{ questionKey, answerType, proposedValue, confidence? }` — kein freier Fließtext als Rückgabe. Serverseitige Nachvalidierung analog `goal-validator.ts`/`commission-validator.ts`-Pattern (Validator prüft VOR jeder Anzeige, wirft strukturierte Fehler mit allen gefundenen Problemen): `proposedValue` muss zum `answerType`/`AnswerOption`/`minValue`/`maxValue` der Zielfrage passen, sonst wird der Vorschlag verworfen statt angezeigt. Unsichere/nicht erkannte Informationen: kein Vorschlag statt Rateversuch.

## 4. Bestätigungs-UX

**ChatGPT-Entscheidung: Einzelbestätigung als verbindlicher Standard, keine Sammel-Übernahme in Phase 12.** Jeder Vorschlag bekommt eigene Aktionen: übernehmen / ändern / verwerfen. Eine globale "Alle übernehmen"-Funktion ist in Phase 12 nicht erlaubt — der Mitarbeiter soll bewusst erkennen, welche Aussage die KI aus welchem Text abgeleitet hat. Eine `CustomerAnswer` entsteht — wie heute — ausschließlich über den normalen Frage-Speicherpfad, nicht direkt durch die KI. Bulk-Funktion ggf. später, wenn echte Nutzung sie rechtfertigt.

## 5. Umgang mit bereits beantworteten Fragen / Konflikten

**ChatGPT-Entscheidung: strenger als ursprünglich vorgeschlagen — kein "Alt→Neu"-Vorschlag in Phase 12.** Standardmäßig werden nur unbeantwortete sichtbare Fragen als KI-Kandidaten vorgeschlagen. Eine bereits vorhandene aktive `CustomerAnswer` wird von der KI weder verändert noch durch einen Vorschlag ersetzt. Begründung: vermeidet, dass eine bewusst erfasste Kundenangabe durch eine abweichende KI-Interpretation versehentlich verändert wird. Ein "KI schlägt abweichende Aktualisierung vor"-Feature ist explizit auf eine spätere, separate Phase verschoben.

## 6. Audit / Nachvollziehbarkeit

Audit-Ereignisse (analog `goal-admin.ts`/`rule-admin.ts`-Muster, PII-gescannt): ein Eintrag pro KI-Extraktionslauf (Session-ID, Anzahl Vorschläge, Modell-/Prompt-Version als Enum/String-Kennung) sowie ein Eintrag pro Bestätigung/Ablehnung je Feld (`questionKey`, `accepted`, `changed`). Weder der Freitext-Eingabetext noch die KI-Rohantwort dürfen in `AuditLog.metadata` landen — nur technische Metadaten (siehe Punkt 7, Lehre aus AP2-PII-Scanner-Fund Phase 11).

## 7. Datenschutz

**ChatGPT-Entscheidung (zentraler Architekturgrundsatz): Freitext grundsätzlich nicht dauerhaft speichern.** Freitext wird nur für die Extraktion verarbeitet, keine Speicherung des Rohtexts in `AuditLog`, `AnalyticsEvent` oder einem dauerhaften Customer-Datensatz; falls technisch erforderlich, nur transaktionsnah/in-memory bzw. kurzfristig. Die KI-Rohantwort wird ebenfalls nicht dauerhaft gespeichert. Nur die bestätigten Werte landen als normale `CustomerAnswer`. Der Freitext ist eine temporäre Eingabe zur Transformation in strukturierte Daten — kein neues dauerhaftes Kundendatenmodell. Vor einer externen Provider-Anbindung muss zusätzlich dokumentiert werden, welcher Provider welche Daten zu welchem Zweck unter welchen Datenschutzbedingungen erhält (Auftragsverarbeitung/Drittlandtransfer).

## 8. Tenant-Isolation

Bestehendes automatisches `tenantId`-Scoping (`scoped-client.ts`) gilt nur auf DB-Ebene. Bei einer externen KI-Anfrage muss sichergestellt werden, dass ein Prompt ausschließlich Daten aus genau einer Session/einem Tenant enthält, keine Vermischung über parallele Anfragen verschiedener Tenants (kein tenantübergreifender Cache/Kontext). Reine Prozess-/Architekturanforderung für den Implementation Plan.

## 9. Fehler-/Halluzinationsverhalten + Kosten/Geschwindigkeit/Modellstrategie

Grundsatz: lieber "nicht erkannt" als falsche strukturierte Antwort, KI darf fehlende Angaben nicht ergänzen. Modellwahl (OpenAI/Anthropic o. ä.), synchron/asynchron, Token-/Kostenbudget, Timeout-/Fallback-Verhalten bei Provider-Ausfall (normaler Fragen-Flow bleibt unberührt) sind bewusst NICHT Teil von AP0 — werden erst im Implementation Plan entschieden. Architekturanforderung: providerunabhängige Extraktions-Schnittstelle für einen späteren Modellwechsel ohne Datenmodellbruch.

## Verbindliche Scope-Abgrenzung Phase 12 (ChatGPT)

Erlaubt: Freitext → bestehende sichtbare Frage → strukturierter Kandidat → Mitarbeiter bestätigt → normale `CustomerAnswer`.

Nicht erlaubt: Freitext → neue Frage; Freitext → erfundene Antwortoption; Freitext → automatische `CustomerAnswer`; Freitext → Überschreiben bestehender Antworten; Freitext → `SHORT_TEXT`-`CustomerAnswer`; Freitext → dauerhafte Rohtextablage; KI → Recommendation Engine direkt.

Die bestehende Engine bleibt danach vollständig unangetastet: `CustomerAnswer` → `computeVisiblePath` → Eligibility → Prioritization → Recommendation → Cross-Selling.

## Vorgabe für den Implementation Plan (ChatGPT)

Klar getrennte Schichten:

1. Extraction Contract — providerunabhängiges Interface
2. Visible-Question Context — serverseitig erzeugter erlaubter Fragenkatalog
3. AI Extraction — ausschließlich strukturierte Kandidaten
4. Server Validation — QuestionKey, AnswerType, Wert, Option, Sichtbarkeit
5. Suggestion State — noch keine `CustomerAnswer`
6. Employee Confirmation — normaler `CustomerAnswer`-Speicherpfad
7. Audit — technische Ereignisse, keine Rohtexte
8. Privacy/Retention/Provider Boundary
9. Failure/Timeout/Cost Controls
10. Tests/Security/E2E

**GO für AP1 = Implementation Plan erteilt.** Noch kein AP1-Code. Etabliertes Muster gilt weiter: Plan → ChatGPT-Prüfung → explizites Implementierungs-GO (Nutzer) → AP1.
