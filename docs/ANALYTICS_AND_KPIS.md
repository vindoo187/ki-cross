# Analytics-Events und KPIs

## Grundprinzip

Alle KPIs werden aus einem append-only `AnalyticsEvent`-Log und den Kernentitäten (`ConsultationSession`, `Recommendation`, `Deal`) berechnet – nie aus manuell gepflegten "Erfolgszahlen". Es werden **keine künstlichen Erfolgsaussagen** erzeugt: jede KPI hat eine explizite Formel und Datenquelle.

## Kernereignisse (Analytics-Events)

| Event                        | Ausgelöst wann                                                   | Wichtige Felder                                                   |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `session_started`            | Beratung beginnt                                                 | session_id, store_id, employee_id, session_type, started_at       |
| `question_answered`          | jede beantwortete Frage                                          | session_id, question_id, questionnaire_version_id, answered_at    |
| `session_topic_completed`    | Themenblock abgeschlossen                                        | session_id, topic_id                                              |
| `recommendation_generated`   | Engine erzeugt Empfehlung                                        | session_id, product_version_id, eligibility_score, priority_score |
| `recommendation_outcome_set` | Mitarbeiter nimmt an/ändert/lehnt ab                             | session_id, recommendation_id, outcome, rejection_reason          |
| `deal_closed`                | Abschluss erfasst                                                | session_id, deal_id, product_version_ids, total_monthly_value     |
| `session_abandoned`          | Beratung abgebrochen (kein Abschluss, Session beendet ohne Deal) | session_id, last_topic_reached, ended_at                          |
| `session_ended`              | Beratung regulär beendet                                         | session_id, ended_at, status                                      |

Alle Events sind **frei von direkten Personenidentifikatoren des Kunden** (siehe [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md)); Bezug ist ausschließlich über `session_id`.

## KPI-Katalog

Jede KPI wird pro Filiale, Mitarbeiter und Zeitraum (Tag/Woche/Monat) aggregiert, sofern nicht anders angegeben.

| KPI                                 | Formel                                                                                                                                                                                                            | Datenquelle                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Umsatz                              | Σ `total_monthly_value` aller `deal_closed` im Zeitraum (Momentaufnahme des Monatswerts; **Annahme:** Umsatz = monatlich wiederkehrender Wert zum Abschlusszeitpunkt, nicht Vertragslaufzeitwert – zu bestätigen) | `Deal`                                                                   |
| Deckungsbeitrag/Marge               | Σ (`margin_estimate` je `Deal`, berechnet aus referenzierter `CommissionModelVersion` zum Abschlusszeitpunkt)                                                                                                     | `Deal` + `CommissionModelVersion`                                        |
| Provision                           | Σ Provisionsbetrag aus `CommissionModelVersion` der abgeschlossenen `ProductVersion`s                                                                                                                             | `Deal` + `CommissionModelVersion`                                        |
| Abschlüsse                          | COUNT(`deal_closed`) im Zeitraum                                                                                                                                                                                  | `Deal`                                                                   |
| Abschlussquote                      | COUNT(`deal_closed`) / COUNT(`session_started`) im Zeitraum                                                                                                                                                       | `Deal` / `ConsultationSession`                                           |
| Cross-Selling-Quote                 | COUNT(Deals mit ≥ 2 Produktkategorien) / COUNT(`deal_closed`)                                                                                                                                                     | `Deal` (Produktkategorien der enthaltenen `ProductVersion`s)             |
| Ø Produkte pro Verkauf              | Σ Anzahl `product_version_ids` je Deal / COUNT(`deal_closed`)                                                                                                                                                     | `Deal`                                                                   |
| Ø Beratungsdauer                    | Ø(`ended_at` − `started_at`) über `session_ended`/`session_abandoned`                                                                                                                                             | `ConsultationSession`                                                    |
| Geschätzte Zeitersparnis            | Ø Beratungsdauer **Referenzzeitraum vor Einführung** − Ø Beratungsdauer aktueller Zeitraum, gleiche Filiale/Vergleichsgruppe                                                                                      | manuell erfasste Baseline (vor Systemeinführung) + `ConsultationSession` |
| Tatsächlich gemessene Zeitersparnis | wie oben, aber ausschließlich mit Systemdaten beider Zeiträume (erfordert Systemnutzung bereits in Referenzzeitraum – siehe unten)                                                                                | `ConsultationSession` beider Zeiträume                                   |
| Abbruchquote im Beratungsprozess    | COUNT(`session_abandoned`) / COUNT(`session_started`)                                                                                                                                                             | `ConsultationSession`                                                    |
| Häufige Kundenbedürfnisse           | Häufigkeitsverteilung bestimmter `CustomerAnswer`-Werte über alle Sessions im Zeitraum                                                                                                                            | `CustomerAnswer`                                                         |
| Häufig angebotene Produkte          | Häufigkeitsverteilung `product_version_id` in `recommendation_generated`                                                                                                                                          | `AnalyticsEvent`                                                         |
| Angenommene/abgelehnte Empfehlungen | COUNT je `outcome`-Wert                                                                                                                                                                                           | `RecommendationOutcome`                                                  |
| Gründe für Ablehnung                | Häufigkeitsverteilung `rejection_reason`                                                                                                                                                                          | `RecommendationOutcome`                                                  |
| Ergebnisse pro Filiale/Mitarbeiter  | alle obigen KPIs gruppiert nach `store_id`/`employee_id`                                                                                                                                                          | wie oben                                                                 |
| Entwicklung nach Tag/Woche/Monat    | alle obigen KPIs, Zeitfenster-Aggregation                                                                                                                                                                         | `KpiSnapshot`                                                            |
| Vergleich vor/nach Einführung       | Differenz KPI-Werte zwischen definiertem Referenzzeitraum (vor Rollout) und aktuellem Zeitraum, gleiche Filialen                                                                                                  | Baseline-Daten (siehe unten) vs. Systemdaten                             |
| Datenqualität/Vollständigkeit       | COUNT(beantwortete Pflichtfragen) / COUNT(Pflichtfragen der genutzten `QuestionnaireVersion`), gemittelt über Sessions                                                                                            | `CustomerAnswer` + `QuestionnaireVersion`                                |

## Das Baseline-Problem (wichtig, ehrlich benennen)

"Geschätzte Zeitersparnis" und "Mehrumsatz" **vor** Systemeinführung lassen sich nur schätzen, weil vor Rollout keine Systemdaten existieren. Zwei szenariogetriebene Optionen:

1. **Manuelle Baseline-Erhebung** vor Rollout (z. B. 2–4 Wochen Zeitstempel-Erfassung der bestehenden Beratungen ohne System, als einmalige Vergleichsmessung) – ehrlich als **Schätzung mit Erhebungsdatum** gekennzeichnet.
2. **Stufenweiser Rollout** (z. B. 2 von 5 Filialen zuerst) → echter A/B-Vergleich zwischen Filialen mit/ohne System im selben Zeitraum, methodisch sauberer als Vorher/Nachher.

**Offene Entscheidung** (siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md)): welche Baseline-Methode das Unternehmen wählt. Ohne diese Entscheidung ist "gemessene Zeitersparnis" nicht seriös berechenbar – das Dashboard muss diesen Vorbehalt explizit anzeigen (kein "erfundener" Vorher-Wert).

## Darstellungsprinzip im Dashboard

Jede KPI zeigt: Wert, Zeitraum, Vergleichswert (Vorperiode), Datenquelle/Berechnungshinweis auf Anfrage (Tooltip) – keine Kennzahl ohne erkennbare Grundlage.

## Implementierungsstatus (Phase 6)

Die obige Tabelle ist die ursprüngliche, aspirationale KPI-Vision aus Phase 2.
Phase 6 implementiert davon einen von ChatGPT priorisierten Kern-Ausschnitt
("Kern-KPIs") — Details zur konkreten Umsetzung, den tatsächlichen
Datenquellen und Implementierungsannahmen siehe
[DEAL_CAPTURE.md](DEAL_CAPTURE.md) Abschnitt 5.

**Tatsächlich implementiert (live aggregiert, `src/server/analytics/kpis.ts`):**
Beratungen (Anzahl), Completion-/Abbruchquote, Empfehlungen generiert,
Annahme-/Ablehnungsquote, Abschlüsse (Anzahl), Umsatz (einmalig +
monatlich wiederkehrend), Provision/Marge (intern berechnet, im
Mitarbeiter-Dashboard `/analytics` weiterhin bewusst NICHT angezeigt —
ursprüngliche ChatGPT-Entscheidung AP12/Phase 6, siehe DEAL_CAPTURE.md
Abschnitt 5).

**Update Phase 7:** Provision (`commissionAmountMinor`) und
Deckungsbeitrag (`contributionMarginMinor`) sind seit Phase 7 sichtbar —
aber ausschließlich in der neuen, RBAC-geschützten Management-Sicht
(`/analytics/management`, `GET /api/analytics/management`), nicht im
weiterhin unveränderten Mitarbeiter-Dashboard. Siehe
[MANAGEMENT_ANALYTICS.md](MANAGEMENT_ANALYTICS.md) für das vollständige
Autorisierungsmodell (RoleAssignment-Scope, Authorization-vor-Aggregation,
IDOR-Schutz) und die Testabdeckung.

**Bewusst zurückgestellt** (nicht Kern-KPI laut ChatGPT-Priorisierung, kein
Phase-6-Blocker): Cross-Selling-Quote, Ø Produkte pro Verkauf, Häufige
Kundenbedürfnisse, Häufig angebotene Produkte, Gründe für Ablehnung,
Zeitersparnis-Vergleich (Baseline-Problem weiterhin ungelöst, siehe
Abschnitt oben), Datenqualität/Vollständigkeit, Ergebnisse pro
Filiale/Mitarbeiter (nur Filiale ist im Dashboard-UI filterbar, nicht
Mitarbeiter), `KpiSnapshot`-basierte Zeitreihen (Phase 6 aggregiert
ausschließlich live, kein Snapshot-Mechanismus, ChatGPT-Vorgabe).

**Event-Tabelle oben vs. tatsächliche `AnalyticsEventType`-Werte:** die
Event-Namen in der Tabelle (`session_started`, `deal_closed`, …) sind die
ursprüngliche Namenskonvention aus Phase 2; die tatsächlich implementierten
Event-Typen (`CONSULTATION_STARTED`, `DEAL_CLOSED`, `CONSULTATION_COMPLETED`,
`CONSULTATION_ABANDONED`, `OPPORTUNITY_OFFERED`/`OPPORTUNITY_DECLINED`, …)
folgen der `AnalyticsEventType`-Enum-Konvention aus dem Prisma-Schema
(`SCREAMING_SNAKE_CASE`). Nicht jeder in Phase 2 vorgesehene Event-Typ wurde
umgesetzt — verbindliche Regel seit Phase 6 AP1/AP2: kein Analytics-Event
ohne echten fachlichen Auslöser im Produkt (siehe
PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.2/8.1 für die vollständige
Analyse, welche der ursprünglich vorgesehenen Events einen echten Trigger
haben und welche nicht).
