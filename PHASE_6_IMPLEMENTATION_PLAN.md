# IMPLEMENTIERUNGSPLAN – PHASE 6: ANALYTICS-GRUNDLAGE & DEAL-ERFASSUNG

## 0. Bestätigter Ausgangsstand

Phase 5 (Mitarbeiteroberfläche/Beratungs-UI) ist abgeschlossen: Abschlussbericht
`docs/ABSCHLUSSBERICHT_PHASE5.md`, Berichts-Commit `a1a43c9`, CI #29 grün.
ChatGPT hat GO für den Berichtsinhalt und für AP15/Phase 5 insgesamt gegeben.
Der Nutzer hat GO für den Start von Phase 6 gegeben.

ChatGPT hat für Phase 6 folgenden verbindlichen Scope-Rahmen vorgegeben
(Chat "Phase 6 Scope und Dashboard", ChatGPT-Projekt "Ki cross"):

- **(A) Deal-Erfassung gehört in Phase 6** – als minimaler, fachlich sauberer
  End-to-End-Flow (kein vollständiges CRM).
- **(B) Das Analytics-Dashboard soll ein erster produktiver Analytics-MVP
  sein** – nicht nur Rohdaten-Konsistenz, aber auch nicht sofort alle KPIs
  aus dem Katalog.
- **KpiSnapshot wird NICHT eingeführt**, solange Live-Aggregation aus den
  bestehenden append-only Daten ausreicht.
- **Keine unnötigen Schema-/Migrationsänderungen.**

Explizit Out of Scope (ChatGPT-Vorgabe): vollständiges CRM, Forecasting,
KI-basierte Umsatzprognosen, frei konfigurierbare BI-/Reporting-Plattform,
komplexes Controlling-System, neue Fragebogen-/Recommendation-Funktionen
außerhalb der für Analytics notwendigen Integrationen.

## 1. Ist-Analyse (verifiziert gegen Code, nicht nur Dokumentation)

### 1.1 AnalyticsEventType – Enum vs. tatsächliche Schreibvorgänge

`prisma/schema.prisma` definiert 16 Werte. Tatsächlich geschrieben werden
aktuell 8, per `grep -rn "eventType:" src/server/` (ohne Tests) verifiziert:

| Geschrieben (8)                                       | Ort                              |
| ----------------------------------------------------- | -------------------------------- |
| `QUESTIONNAIRE_STARTED`                               | `questionnaire/service.ts`       |
| `QUESTION_ANSWERED`                                   | `questionnaire/service.ts`       |
| `PATH_RECALCULATED` (2×)                              | `questionnaire/service.ts`       |
| `ANSWER_CHANGED`                                      | `questionnaire/service.ts`       |
| `QUESTIONNAIRE_COMPLETED`                             | `questionnaire/service.ts`       |
| `RECOMMENDATION_GENERATED`                            | `recommendation/service.ts`      |
| `RECOMMENDATION_ACCEPTED` / `RECOMMENDATION_REJECTED` | `recommendation/outcome.ts`      |
| `CONSULTATION_COMPLETED`                              | `consultation-ui/completion.ts`  |
| `CONSULTATION_ABANDONED`                              | `consultation-ui/abandonment.ts` |

Nicht geschrieben (7): `CONSULTATION_STARTED`, `CONSULTATION_TOPIC_OPENED`,
`NEED_DETECTED`, `OPPORTUNITY_OFFERED`, `OPPORTUNITY_DECLINED`,
`DEAL_CLOSED`, `FOLLOW_UP_CREATED`.

Von diesen 7 hat nur `DEAL_CLOSED` einen direkten, in Phase 6 klar
umzusetzenden Auslöser (Deal-Erfassung, siehe 1.3). Die übrigen 6 markieren
Ereignisse, deren fachlicher Auslöser bereits im Produkt existiert
(`SalesOpportunity`-Anlage/-Status, `DetectedNeed`-Erzeugung,
Sitzungsstart/Themenwechsel, `FollowUp`-Anlage), aber bislang kein Event
schreibt. Gemäß ChatGPTs Vorgabe ("fehlende Events nur dort ergänzen, wo ihr
Auslöser bereits im Produkt vorhanden ist, keine künstlichen Events nur zur
KPI-Erfüllung") werden alle 6 im Rahmen von Phase 6 nachgezogen, weil ihr
jeweiliger Auslöser bereits als Fachdatensatz existiert:

- `CONSULTATION_STARTED` → beim Anlegen einer `ConsultationSession`
  (bestehender Codepfad, aktuell kein Event).
- `CONSULTATION_TOPIC_OPENED` → beim Öffnen/Wechsel eines
  `ConsultationTopic` (zu verifizieren, ob ein solcher Übergangspunkt
  bereits als einzelne Funktion existiert oder erst geschaffen werden muss –
  **offene Detailfrage, siehe Abschnitt 8**).
- `NEED_DETECTED` → bei Anlage eines `DetectedNeed`-Datensatzes.
- `OPPORTUNITY_OFFERED` / `OPPORTUNITY_DECLINED` → beim entsprechenden
  `SalesOpportunity`-Statusübergang (`opportunity-status.ts` existiert
  bereits und setzt den Status, schreibt aber noch kein Analytics-Event für
  diese beiden Übergänge – zu verifizieren).
- `FOLLOW_UP_CREATED` → bei Anlage eines `FollowUp`-Datensatzes (zu
  verifizieren, ob eine `FollowUp`-Erfassung als Service bereits existiert;
  falls nicht, ist das ein zusätzlicher, bisher nicht dokumentierter Gap,
  der VOR der Umsetzung mit dem Nutzer/ChatGPT geklärt werden muss, da er
  über reine Analytics-Nachrüstung hinausgehen könnte).

### 1.2 Deal / DealItem / DealFinancialSnapshot – Schema bereits vollständig

Das Schema (seit Phase 2, `prisma/schema.prisma` Zeilen 919–990) ist
bereits fachlich vollständig für einen einfachen Abschluss:

- `Deal`: `consultationSessionId`, `storeId`, `employeeId`,
  `customerReferenceId?`, `currency`, `closedAt`.
- `DealItem`: `dealId`, `productVersionId`, `quantity`.
- `DealFinancialSnapshot` (1:1, append-only, DB-Trigger-geschützt):
  `monthlyRecurringRevenueMinor`, `totalContractValueMinor`,
  `oneTimeRevenueMinor`, `commissionAmountMinor`,
  `expectedRecurringCommissionMinor`, Kostenfelder
  (`hardwarePurchaseCostMinor`, `subsidyCostMinor`, `discountCostMinor`,
  `otherDirectCostMinor`), `contributionMarginMinor` +
  `contributionMarginFormulaVersion`, `capturedAt`.

**Kein Migrationsbedarf für die Deal-Erfassung selbst** – die Lücke ist
ausschließlich Service-/API-/UI-seitig, deckungsgleich mit ChatGPTs Vorgabe
"keine unnötigen Schema-/Migrationsänderungen".

Preisdaten sind bereits vorhanden: `ProductVersion.monthlyPriceMinor`,
`oneTimePriceMinor`, `contractMonths`. Provisionsdaten über
`CommissionModelVersion` (`commissionAmountMinor`,
`commissionPercentageBasisPoints`, `recurringCommissionAmountMinor`),
verknüpft über `CommissionModel`, nicht direkt über `ProductVersion` – die
genaue Verknüpfungskette `ProductVersion → CommissionModel` muss beim
Implementieren von `computeDealFinancialSnapshot()` nachvollzogen werden
(vermutlich analog zur bereits bestehenden Verknüpfung in
`RecommendationRationale.commissionModelVersionId`, die dieselbe
Berechnung offenbar schon einmal zur Empfehlungszeit durchführt – **prüfen,
ob diese bestehende Berechnungslogik wiederverwendet werden kann**, statt
sie für den Deal-Abschluss ein zweites Mal zu implementieren).

### 1.3 Fehlender Endpunkt: Deal tatsächlich erfassen

`grep -rln "db.deal.create" src/` und `find src/app/api -iname "*deal*"`
liefern beide keine Treffer – es gibt aktuell keinen Codepfad, der einen
`Deal` anlegt. Das ist die zentrale Lücke, die Phase 6 gemäß ChatGPTs
Scope-Entscheidung (A) schließt.

### 1.4 KpiSnapshot – existiert nicht

Bestätigt per Grep: kein `model KpiSnapshot` im Schema. Bleibt gemäß
ChatGPT-Vorgabe in Phase 6 außen vor, solange Live-Aggregation ausreicht.

### 1.5 Bestehende Architekturmuster (für Phase 6 zu übernehmen)

- Analytics-Schreibvorgänge laufen **innerhalb derselben Transaktion** wie
  der Fachdatensatz (`db.$transaction`), siehe `outcome.ts`,
  `completion.ts`.
- Event-Idempotenz läuft, wo nötig, über eine Payload-Abfrage auf bereits
  existierende Events derselben `consultationSessionId` (kein
  DB-Unique-Index auf `Json?`-Feldern) – für `DEAL_CLOSED` nicht nötig, da
  ein `Deal` selbst bereits über `@@unique([tenantId, id])` eindeutig ist
  und pro Deal genau einmal geschlossen wird.
- Tenant-Scoping durchgehend über `getTenantId()` aus `tenant/context.ts`,
  nie über clientseitig übergebene IDs.
- Fehlerklassen pro Domäne (`ConsultationSessionNotFoundError`,
  `RecommendationOutcomeAlreadyExistsError` usw.), gemappt in
  `http-errors.ts`.
- API-Routen unter `src/app/api/consultation/...` sind dünne Wrapper um die
  Service-Schicht (`src/server/...`), keine Fachlogik in der Route selbst.

## 2. Vorhandene und fehlende Schnittstellen

| Schnittstelle                                                                                                                                                    | Status |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `POST /api/consultation/sessions/[id]/deals` (Deal anlegen)                                                                                                      | fehlt  |
| `db.server/deals/service.ts` (`closeDeal()`)                                                                                                                     | fehlt  |
| `db.server/deals/financial-snapshot.ts` (`computeDealFinancialSnapshot()`)                                                                                       | fehlt  |
| Fehlende Event-Writer (6 Stück, siehe 1.1)                                                                                                                       | fehlen |
| `GET /api/analytics/kpis` (o. ä., Dashboard-Datenquelle)                                                                                                         | fehlt  |
| Analytics-Aggregationsfunktionen (Umsatz, Abschlussquote, Cross-Selling-Quote, Ø Beratungsdauer, Abbruchquote, Häufige Bedürfnisse/Produkte, Outcome-Verteilung) | fehlen |
| Dashboard-UI (`/analytics` o. ä.)                                                                                                                                | fehlt  |

## 3. Empfohlener Aufbau

### 3.1 Deal-Erfassung (Service + API + UI)

- `src/server/deals/service.ts`: `closeDeal(consultationSessionId, items[], customerReferenceId?)`
  - Validiert: Session existiert (Tenant-Scope), Session-Status ist
    plausibel (analog `assertSessionEvaluable()`-Whitelist aus Phase 5,
    IN_PROGRESS oder COMPLETED – kein Deal auf einer bereits
    abgebrochenen Session), mindestens 1 `DealItem`.
  - Legt `Deal` + `DealItem[]` an, berechnet `DealFinancialSnapshot` über
    `computeDealFinancialSnapshot()`, schreibt `DEAL_CLOSED`-Event – alles
    in einer Transaktion.
- `src/app/api/consultation/sessions/[id]/deals/route.ts`: `POST`, dünner
  Wrapper.
- UI: Deal-Erfassung als Erweiterung der bestehenden Zusammenfassungsseite
  (`summary/page.tsx`) – ein Mitarbeiter markiert dort, welche
  Empfehlungen tatsächlich zum Abschluss geführt haben (Vorauswahl aus
  `RecommendationOutcome`-Einträgen mit `ACCEPTED`), bestätigt Menge/Produkt
  und schließt den Deal ab. Kein neuer, eigenständiger CRM-Bildschirm.

### 3.2 Fehlende Analytics-Events (6 Stück)

Jeweils ein kleiner, in die bestehende Erzeugung des jeweiligen
Fachdatensatzes integrierter Schreibvorgang, nach demselben Muster wie
`completion.ts`/`abandonment.ts`. Kein neuer Architekturbaustein nötig.

**Verbindliche Regel (ChatGPT-Vorgabe, Plan-Review):** Kein Analytics-Event
ohne echten fachlichen Auslöser. Insbesondere `NEED_DETECTED` darf nicht
einfach beim Anzeigen einer Empfehlung geschrieben werden, wenn "Need
Detection" fachlich etwas anderes bedeutet; `FOLLOW_UP_CREATED` nicht nur,
weil der Enum-Wert existiert. Für jedes der 6 Events wird vor der
Implementierung der reale fachliche Auslöser identifiziert (Teil von AP1);
existiert kein echter Auslöser im Produkt, wird das Event in Phase 6 NICHT
künstlich erzeugt.

### 3.3 Analytics-Aggregation (Live, kein Snapshot)

`src/server/analytics/kpis.ts`: reine Read-Funktionen pro KPI, parametrisiert
nach Zeitraum + optional `storeId`/`employeeId`, direkt gegen
`AnalyticsEvent`/`ConsultationSession`/`Deal`/`RecommendationOutcome`
aggregierend (SQL-Aggregation über Prisma `groupBy`/`aggregate`, keine
Anwendungslogik-Schleifen über große Datenmengen).

Priorisierte KPIs für Phase 6 (aus `ANALYTICS_AND_KPIS.md`, ChatGPT-Vorgabe
"Kern-KPIs"):

1. Beratungen (Anzahl `session_started`/Sessions im Zeitraum)
2. Completion-/Abbruchquote
3. Empfehlungen generiert
4. Annahme-/Ablehnungsquote der Empfehlungen
5. Abschlüsse (Anzahl Deals)
6. Abschlussquote (Deals / Sessions)
7. Umsatz (Σ `monthlyRecurringRevenueMinor`)
8. Provision/Marge – **nur soweit die Berechnungskette
   `ProductVersion → CommissionModelVersion` bereits zuverlässig zur
   Deal-Abschlusszeit auflösbar ist** (siehe offene Frage 8.2)

Bewusst zurückgestellt (nicht Kern-KPI laut ChatGPT-Priorisierung, aber im
Katalog vorhanden): Cross-Selling-Quote, Ø Produkte pro Verkauf, Häufige
Kundenbedürfnisse, Häufig angebotene Produkte, Gründe für Ablehnung,
Zeitersparnis-Vergleich (Baseline-Problem weiterhin ungelöst, siehe
`OPEN_DECISIONS.md`), Datenqualität/Vollständigkeit. Diese können, sofern
die Kern-KPIs zügig fertig werden, als Erweiterung innerhalb derselben Phase
ergänzt werden – werden aber nicht als Bedingung für die
Definition-of-Done gewertet, um Phase 6 nicht ausufern zu lassen
(ChatGPT-Vorgabe).

### 3.4 Dashboard-UI

Neue Route `src/app/(analytics)/analytics/page.tsx` (oder vergleichbar,
Routing-Gruppe an bestehende Konventionen in `src/app` anzupassen). Erste
Version: Kachel-/Kartenlayout mit den priorisierten KPIs, Zeitraum-Filter
(Woche/Monat), optionalem Filialfilter für Mehrfilialen-Tenants. Kein
Chart-Overengineering in Phase 6 – einfache Zahlen-/Tabellen-Darstellung
zuerst, analog zur bewusst schlichten `/review`-Prüfansicht aus Phase 2.

## 4. Tenant-/Security-Aspekte

Keine Abweichung vom bestehenden Modell: `getTenantId()`/
`runWithTenantContext()` durchgehend, `withTenantScope()`-Extension für
alle neuen Queries. Analytics-Aggregationen dürfen niemals
Tenant-übergreifend aggregieren – jede KPI-Funktion nimmt `tenantId`
implizit über den Kontext, nicht als Parameter.

## 5. Tests

- Unit: `closeDeal()` (Erfolg, fehlende Items, ungültiger Session-Status,
  Tenant-Fremdzugriff), `computeDealFinancialSnapshot()`
  (Berechnungslogik, Rundung analog bestehender `decimal.ts`-Konventionen),
  jede der 6 neuen Event-Writer-Funktionen.
- Integration: `POST .../deals` End-to-End inkl. Analytics-Event- und
  Financial-Snapshot-Schreibvorgang, KPI-Aggregationsfunktionen gegen
  Seed-Daten mit bekannten Erwartungswerten.
- Component/E2E: Deal-Erfassung auf der Zusammenfassungsseite, Dashboard
  rendert erwartete KPI-Werte (mind. 1 Happy-Path-E2E-Test, analog Phase-5-
  Konvention).
- Append-only-Test für `DealFinancialSnapshot` ergänzen (analog den 5
  bestehenden append-only-Tests aus Phase 3B) – da dieses Modell bisher nur
  im Schema, aber nie tatsächlich beschrieben wurde, ist noch nicht
  verifiziert, dass der DB-Trigger für diese Tabelle bereits aktiv greift.

## 6. Voraussichtlich zu erstellende/ändernde Dateien

- `src/server/deals/service.ts`, `financial-snapshot.ts`, `errors.ts` (neu)
- `src/app/api/consultation/sessions/[id]/deals/route.ts` (neu)
- `src/server/analytics/kpis.ts` (neu)
- `src/app/(analytics)/analytics/page.tsx` + zugehörige Komponenten (neu)
- Erweiterungen in `src/server/consultation-ui/` (Sitzungsstart),
  `src/server/recommendation/opportunity-status.ts` (Offered/Declined-Events),
  `src/server/questionnaire/service.ts` oder neuer Ort für `NEED_DETECTED`/
  `CONSULTATION_TOPIC_OPENED`, `FollowUp`-Erzeugung (Ort abhängig von 8.1)
- `SessionSummaryView.tsx` / `summary/page.tsx`: Erweiterung um Deal-Erfassung
- `docs/ANALYTICS_AND_KPIS.md`: Abgleich mit tatsächlich implementierten KPIs
- neue Doku: `docs/DEAL_CAPTURE.md` oder Ergänzung in bestehender Doku

## 7. Risiken

- **Provisions-/Margenberechnung** ist die komplexeste Einzelkomponente
  (mehrere verkettete Versions-Entitäten) – Risiko von stillen
  Rechenfehlern, falls die bestehende Verknüpfungskette nicht 1:1
  wiederverwendet werden kann. Mitigation: bestehende
  `RecommendationRationale`-Berechnung als Referenzimplementierung nutzen,
  nicht neu erfinden.
- **`FollowUp`-Erfassung könnte über reinen Analytics-Nachtrag
  hinausgehen**, falls dafür noch kein Service existiert (siehe 8.1) – ggf.
  als separater Arbeitspunkt innerhalb von Phase 6, nicht als Phase-6-
  Blocker zu werten.
- **Append-only-Trigger für `DealFinancialSnapshot`** bisher unverifiziert
  in der Praxis (nie beschrieben) – erster Schreibversuch in Tests deckt
  das auf.

## 8. Offene Entscheidungen (vor Umsetzungsbeginn zu klären)

1. Existiert bereits ein Service/Codepfad für `ConsultationTopic`-Wechsel
   und `FollowUp`-Anlage, oder müssen diese Fachfunktionen im Rahmen von
   Phase 6 überhaupt erst schaffen werden (dann wäre das kein reiner
   Analytics-Nachtrag mehr, sondern zusätzlicher Funktionsumfang)?
2. Ist die Provisions-/Margen-Berechnungskette
   (`ProductVersion → CommissionModel → CommissionModelVersion`) bereits an
   einer Stelle im Code vollständig nachvollzogen (vermutlich
   `recommendation/service.ts` bei der Rationale-Erzeugung), sodass sie für
   den Deal-Abschluss wiederverwendet werden kann?
3. Soll die Deal-Erfassung ausschließlich auf der Zusammenfassungsseite
   angeboten werden, oder zusätzlich als eigener Einstiegspunkt (z. B. für
   nachträgliche Erfassung eines Abschlusses ohne laufende Session)? Plan
   geht von "nur über die Zusammenfassungsseite einer bestehenden Session"
   aus, analog ChatGPTs "kein CRM"-Leitplanke.

Diese drei Punkte werden vor Beginn der Umsetzung per kurzer Ist-Analyse im
Code beantwortet (Punkt 1 + 2) bzw. sind Teil dieses Plans zur Bestätigung
durch ChatGPT/Nutzer (Punkt 3).

### 8.1 AP1-Ergebnis (Code-Verifikation, abgeschlossen)

**Korrektur der Ist-Analyse aus Abschnitt 1.1:** Ein erneuter, gezielter
Grep (`grep -rn "analyticsEvent.create" src/server`, alle 11 Fundstellen
einzeln geprüft statt nur nach String-Literalen `eventType: "..."` zu
suchen) zeigt, dass `opportunity-status.ts` `OPPORTUNITY_OFFERED` und
`OPPORTUNITY_DECLINED` bereits schreibt – nur über eine Variable
(`OPPORTUNITY_ANALYTICS_EVENT_TYPE[input.status]`), nicht über ein
String-Literal, weshalb der ursprüngliche Grep-Lauf sie nicht erfasst
hatte. **Tatsächlich fehlen damit nur noch 4 Events** (nicht 6):
`CONSULTATION_STARTED`, `CONSULTATION_TOPIC_OPENED`, `NEED_DETECTED`,
`FOLLOW_UP_CREATED` (`DEAL_CLOSED` kommt ohnehin neu über AP3 hinzu).

1. **ConsultationTopic-Wechsel / FollowUp-Anlage:** Beide Modelle haben
   **keinen** produktiven Schreibpfad. `ConsultationTopic` wird nur in
   `prisma/seed.ts` direkt angelegt (synthetische Testdaten), nie durch
   Anwendungscode. `FollowUp` wird nirgends angelegt, nur in
   `src/app/review/page.tsx` gezählt (technische Prüfansicht). Es gibt
   also aktuell **keine echte Mitarbeiteraktion**, die `FollowUp` oder
   einen expliziten Themenwechsel erzeugt.
   → **Entscheidung gemäß ChatGPTs Regel ("kein Event ohne echten
   Auslöser"): `CONSULTATION_TOPIC_OPENED` und `FOLLOW_UP_CREATED`
   werden in Phase 6 NICHT nachgezogen**, weil ihr fachlicher Auslöser im
   Produkt noch gar nicht existiert – das wäre sonst genau das von
   ChatGPT ausgeschlossene "künstliche Event nur zur KPI-Erfüllung" bzw.
   ein verstecktes Ausweiten des Scopes auf einen neuen Fachprozess
   (Wiedervorlagen-Anlage), was explizit Out of Scope ist.
2. **Provisions-/Margen-Berechnungskette:** Vollständig vorhanden und
   wiederverwendbar. `recommendation/service.ts` enthält bereits
   `loadActiveCommissionModelVersions()` + `buildResolveCommission()`,
   die `ProductVersion → CommissionModel → CommissionModelVersion`
   auflösen und `commissionValueMinor` berechnen (inkl.
   PERCENTAGE-vs-Fixbetrag-Unterscheidung). Wichtige Ergänzung: **eine
   FK von `DealItem` zu `RecommendationItem`/`RecommendationRationale`
   ist nicht nötig, um historische Stabilität zu erreichen** –
   `DealFinancialSnapshot` speichert bereits fertig berechnete
   Minor-Beträge (keine Referenz auf `CommissionModelVersion`), und ist
   selbst append-only. Es reicht, die Commission-Auflösung zum
   `closedAt`-Zeitpunkt einmalig durchzuführen und das Ergebnis in den
   Snapshot zu schreiben – spätere Änderungen an `CommissionModel`
   können den bereits geschriebenen Snapshot dann nicht mehr beeinflussen.
   **Umsetzungskonsequenz:** `loadActiveCommissionModelVersions()` +
   `buildResolveCommission()` werden aus `recommendation/service.ts` in
   ein gemeinsames Modul extrahiert (z. B. `src/server/pricing/commission.ts`),
   damit `deals/financial-snapshot.ts` sie ohne Duplikation nutzen kann.
3. **Deal-Erfassung nur über Zusammenfassungsseite:** Bestätigt, keine
   gegenteiligen Hinweise im Code gefunden; deckt sich mit ChatGPTs
   Freigabe ("kein separater UI-Einstiegspunkt, API-Endpunkt kann
   trotzdem separat existieren").

**Weitere Vertiefung zu `NEED_DETECTED`:** Wie bei `FollowUp` gilt auch hier
"kein echter Auslöser" – und zwar strukturell, nicht nur mangels Code.
`sales-opportunity.ts` dokumentiert explizit, dass der tatsächlich genutzte
Pfad (Cross-Selling-Signal-gesteuerte `SalesOpportunity`, Phase 3B) **bewusst
keine** `DetectedNeed`-Zeile anlegt, sondern `triggerSignalId` direkt auf
`SalesOpportunity` setzt. `DetectedNeed` ist im Code ausdrücklich als
"legacy-/manueller Pfad" markiert, der aktuell nirgends bedient wird. Ein
`NEED_DETECTED`-Event hätte damit keinen echten Auslöser im heutigen
Produkt – es künstlich an die `SalesOpportunity`-Erzeugung zu hängen würde
faktisch ein neues `DetectedNeed`-Schreibverhalten einführen, was laut
ChatGPTs Out-of-Scope-Liste ("neue Fragebogen-/Recommendation-Funktionen
außerhalb der für Analytics notwendigen Integrationen") nicht in Phase 6
gehört.

**AP1 damit abgeschlossen. Finales Ergebnis: von den ursprünglich
angenommenen 6 fehlenden Events wird in Phase 6 nur 1 tatsächlich
nachgezogen: `CONSULTATION_STARTED`** (echter, eindeutiger Auslöser: Anlage
einer `ConsultationSession` in `questionnaire/service.ts`, Zeile ~569).
`CONSULTATION_TOPIC_OPENED`, `NEED_DETECTED` und `FOLLOW_UP_CREATED` bleiben
in Phase 6 bewusst ungeschrieben, mangels echtem fachlichen Auslöser im
heutigen Produkt – das ist keine Lücke, die Phase 6 schließen sollte,
sondern würde jeweils einen neuen, mit ChatGPT gesondert abzustimmenden
Fachprozess voraussetzen (Themenwechsel-Tracking, Wiedervorlagen-Erfassung,
echte Bedarfserkennung als eigenständiger Schritt). Scope-Auswirkung: AP2
wird auf einen einzigen, kleinen Event-Writer reduziert. AP3 bekommt einen
zusätzlichen kleinen Refactoring-Schritt (Commission-Logik-Extraktion aus
`recommendation/service.ts` in ein gemeinsames Modul).

## 9. Umsetzungsschritte (Arbeitspakete)

- **AP1** – Klärung der 3 offenen Punkte aus Abschnitt 8 (Code-Verifikation)
- **AP2** – 6 fehlende Analytics-Events nachziehen (je Event ein kleiner PR-Schnitt)
- **AP3** – `closeDeal()` + `computeDealFinancialSnapshot()` Service-Schicht
- **AP4** – API-Route `POST .../deals`
- **AP5** – Deal-Erfassung UI auf Zusammenfassungsseite
- **AP6** – `DEAL_CLOSED`-Event-Integration in `closeDeal()` (Teil von AP3, hier als Verifikationsschritt gelistet)
- **AP7** – Analytics-KPI-Aggregationsfunktionen (Kern-KPIs, Abschnitt 3.3)
- **AP8** – Analytics-Dashboard-UI
- **AP9** – Testsuite (Unit/Integration/Component/E2E, Abschnitt 5)
- **AP10** – Dokumentation (`docs/DEAL_CAPTURE.md`, `ANALYTICS_AND_KPIS.md`-Abgleich)
- **AP11** – Lokale Verifikation, Commit, CI-Prüfung
- **AP12** – Abschlussbericht Phase 6

## 10. Exakte Prüfkommandos

Wie in allen Vorphasen: `npm run lint`, `npm run format:check`,
`npm run typecheck`, `npm run test`, `npm run build`, Playwright-E2E gegen
CI (sandbox-bedingt lokal nicht ausführbar – siehe wiederkehrender Hinweis
in allen bisherigen Abschlussberichten).

## 11. Definition of Done

Deckungsgleich mit ChatGPTs Vorgabe (Abschnitt 0): Eine abgeschlossene
Beratung kann reproduzierbar zu einem tatsächlich erfassten Deal führen,
der Deal erzeugt die erforderlichen Analytics-Daten, die priorisierten
Kern-KPIs sind aus produktiven Daten berechenbar und im ersten
Analytics-Dashboard sichtbar. Tenant-Isolation, Append-only-Regeln,
Auditierbarkeit und bestehende Architekturprinzipien bleiben erhalten. CI
vollständig grün.

## 12. GO-/NO-GO-Empfehlung

Aus meiner Sicht **GO für die Planungsstufe abgeschlossen** – der Plan ist
bereit zur Prüfung durch ChatGPT. Vor Beginn der eigentlichen Umsetzung
(AP1 ff.) sind wie in allen Vorphasen zwei getrennte Freigaben nötig:
ChatGPTs Plan-GO und das explizite Implementierungs-GO des Nutzers.

### 12.1 ChatGPT-Plan-Review (erteilt)

**🟢 GO – Phase 6 darf umgesetzt werden**, mit folgenden verbindlichen
Leitplanken (ChatGPT, Plan-Review):

- Keine Migration, solange die Code-Verifikation (AP1) die vorhandene
  Deal-Struktur bestätigt.
- `closeDeal()` als zentrale transaktionale Business-Operation: Deal +
  DealItems + FinancialSnapshot + `DEAL_CLOSED` atomar.
- Bestehende Commission-/Margin-Logik wiederverwenden, nicht duplizieren
  (siehe offene Frage 8.2) – **wichtig: ein bereits abgeschlossener Deal
  darf später nicht rückwirkend eine andere Provision/Marge zeigen, nur
  weil sich ein aktuelles `CommissionModel` geändert hat** – deshalb ist
  die referenzierte `CommissionModelVersion` zum Abschlusszeitpunkt
  festzuschreiben (konsistent mit der bestehenden
  `RecommendationRationale.commissionModelVersionId`-Architektur).
- Deal-UI ausschließlich in der bestehenden Zusammenfassungsseite (ein
  separater API-Endpunkt ist unabhängig davon zulässig, nur kein
  separater UI-Einstiegspunkt).
- Fehlende Events nur an echte fachliche Trigger hängen (siehe 3.2).
- Live-KPI-Aggregation zunächst ohne `KpiSnapshot`.
- Dashboard zunächst bewusst als Analytics-MVP, keine CRM-Ausweitung.
- Bestehende Tenant-Isolation, Append-only- und Audit-Regeln bleiben
  unangetastet.
- Die drei offenen Punkte aus Abschnitt 8 sind kein Grund für einen
  Plan-Stopp, sondern werden als AP1 (Code-Verifikation) vor der
  eigentlichen Umsetzung abgearbeitet.

### 12.2 Nutzer-Implementierungs-GO

Erteilt (2026-08-17). AP1-AP3 sind in Bearbeitung/abgeschlossen (siehe unten).

### 12.3 Verbindliche Deckungsbeitrags-Formel v1 (ChatGPT-Konsultation, AP3)

Bei der Umsetzung von `computeDealFinancialSnapshot()` stellte sich heraus,
dass `contributionMarginFormulaVersion` eine versionierte Formel verlangt,
die nirgends im Projekt definiert war. ChatGPT hat folgende verbindliche
Formel v1 vorgegeben:

```
Formula Version: "v1"

contributionMarginMinor =
    oneTimeRevenueMinor
  - hardwarePurchaseCostMinor
  - subsidyCostMinor
  - discountCostMinor   // in v1 immer 0
  - otherDirectCostMinor
```

Wichtige Leitplanken dazu:

- **Nur der einmalige Umsatz/Kosten fließen in v1 in den Deckungsbeitrag
  ein.** Der wiederkehrende Umsatz (`monthlyRecurringRevenueMinor`) wird
  separat ausgewiesen, NICHT über eine angenommene Vertragslaufzeit in den
  v1-Deckungsbeitrag eingerechnet (das wäre ein "Expected Contract
  Contribution" – explizit einer späteren Formel-Version vorbehalten, nicht
  Teil von v1).
- **`discountCostMinor` ist in v1 immer `0`.** Keine manuelle
  Rabatt-Eingabe durch den Mitarbeiter beim Deal-Abschluss, weil ein frei
  eingebbares Kostenfeld ohne definierte Quelle die KPI-Grundlage
  manipulierbar machen würde ("Mitarbeiter trägt 0 € ein, tatsächlich
  wurden 100 € Rabatt gegeben"). Eine echte Rabattfunktion mit definiertem
  Ursprung ist explizit einer Formel-Version v2 vorbehalten.
- `expectedRecurringCommissionMinor` und `commissionAmountMinor` werden
  unabhängig von der Margen-Formel über die wiederverwendete
  Commission-Resolution (`src/server/pricing/commission.ts`) berechnet.

### 12.4 AP3-Ergebnis (Implementierung abgeschlossen, Code-Review)

`src/server/pricing/commission.ts` (Extraktion `loadActiveCommissionModelVersions()`/
`buildResolveCommission()` aus `recommendation/service.ts` + neue
`computeCommissionAmountMinor()`), `src/server/deals/errors.ts`,
`src/server/deals/financial-snapshot.ts` (`computeDealFinancialSnapshot()`,
Formel v1) und `src/server/deals/service.ts` (`closeDeal()`, atomare
Transaktion: Deal + DealItem[] + DealFinancialSnapshot + `DEAL_CLOSED`-Event)
sind geschrieben.

Zwei Punkte während der Selbstprüfung geklärt:

- **`DEAL_CLOSED`-Payload gegen `safeJsonPayloadSchema` geprüft**
  (`src/server/validation/event-payload-schemas.ts`): Payload
  `{ consultationSessionId, dealId, productVersionIds, totalMonthlyValueMinor }`
  besteht ausschließlich aus IDs/Zahlen/einem kurzen ID-Array (Tiefe 1 von
  max. 3, Array-Länge weit unter 50) – konform, keine Kontaktdaten-/
  Freitext-Muster.
- **Bugfix Doppelverrechnung von `quantity` bei Provisionen**: In
  `computeDealFinancialSnapshot()` wurde `computeCommissionAmountMinor()`
  ursprünglich mit bereits mengen-skalierten Basisbeträgen
  (`itemOneTimeRevenue`/`itemMonthlyRevenue`) aufgerufen und das Ergebnis
  danach nochmals mit `item.quantity` multipliziert – bei
  PERCENTAGE-Provisionsmodellen führte das zu einer doppelten
  Mengenverrechnung. Korrigiert: Provisionsberechnung erfolgt jetzt auf
  Stückpreis-Basis (`item.oneTimePriceMinor`/`item.monthlyPriceMinor`),
  Mengenskalierung passiert einmalig danach – sowohl für FIXED als auch
  PERCENTAGE korrekt.

Sandbox-bedingt (kein `tsc`/`vitest` verfügbar) wurde ausschließlich per
manueller Code-Prüfung verifiziert, keine echte Testausführung. Reguläre
Tests folgen in AP9, CI-Verifikation in AP11.

### 12.5 AP4/AP5-Ergebnis (API-Route + UI, Code-Review)

**AP4:** `closeDealBodySchema` (`consultation-ui/schemas.ts`), Fehler-Mapping
für alle 5 `DealEngineError`-Subklassen (`consultation-ui/http-errors.ts`,
404/409/422 je nach Fehlerklasse) und
`src/app/api/consultation/sessions/[id]/deals/route.ts` (dünner `POST`-
Wrapper, analog `sales-opportunities/[id]/route.ts`). `closeDeal()` erhielt
zusätzlich einen optionalen `customerReferenceId`-Parameter (Plan Abschnitt
3.1 sah dieses Argument explizit vor, die erste AP3-Fassung hatte es
übersehen) – Fallback auf `session.customerReferenceId`, keine
Existenzprüfung im Service (identisches Muster wie bei
`startQuestionnaire()`, DB-Fremdschlüssel erzwingt Integrität).

**AP5:** `view-models.ts` um `DealSummary`/`DealClosureCandidateItem` +
`loadDealForSession()` erweitert, `ConsultationSessionSummaryView` um
`deal`/`dealClosureCandidates` ergänzt (Vorauswahl aus `RecommendationOutcome
= ACCEPTED`, bewusst leer sobald bereits ein Deal existiert). Neue
Komponente `DealClosureForm.tsx` (Checkbox+Menge je Kandidat, `POST .../deals`,
`router.refresh()` nach Erfolg/409 analog `OutcomeDialog`) und
`DealSummaryCard` (read-only, in `SessionSummaryView.tsx` integriert) – zeigen
beide bewusst NUR kundenbezogene Umsatzzahlen, keine Provisions-/
Margendaten (gleiche Regel wie bei `businessPriorityScore`). Formular wird
für `status === "ABANDONED"` gar nicht erst gerendert (Sichtbarkeits-Gate
analog `AbandonConsultationButton`), da `closeDeal()` das ohnehin mit 409
ablehnen würde. `globals.css` um `.deal-closure`/`.deal-summary`-Regeln
ergänzt.

### 12.6 AP7-Ergebnis (KPI-Aggregation, Code-Review)

`src/server/analytics/kpis.ts`: reine, live aggregierende Read-Funktionen
(`getConsultationVolumeKpi()`, `getRecommendationOutcomeKpi()`,
`getDealKpi()`) für die 8 priorisierten Kern-KPIs aus Abschnitt 3.3, über
Prisma `groupBy()`/`count()` (kein `KpiSnapshot`, wie von ChatGPT
vorgegeben).

Zwei Implementierungsentscheidungen dabei getroffen und dokumentiert (siehe
Modulkommentar in `kpis.ts`), da sie im Plan nicht bis ins Detail
spezifiziert waren:

- **Zeitraum-Filterung pro Datensatztyp statt gemeinsamer Session-Kohorte**
  (Sessions nach `startedAt`, Empfehlungen nach `generatedAt`, Outcomes nach
  `decidedAt`, Deals nach `closedAt`) – "Abschlussquote" ist damit ein
  Perioden-Verhältnis, kein exaktes Pro-Session-Konversionsmaß (übliche
  Vertriebs-Reporting-Konvention).
- **`getDealKpi()` gruppiert nach Währung** statt blind zu summieren (Schema
  erlaubt grundsätzlich unterschiedliche `ProductVersion.currency` je
  Mandant, auch wenn aktuell nur EUR im Einsatz ist).

**Offener Punkt für AP8 (noch nicht entschieden, hier bewusst nicht
unilateral getroffen):** `getDealKpi()` liefert `commissionAmountMinor`/
`contributionMarginMinor` (KPI 8) mit zurück. Ob diese Provisions-/
Margendaten im Dashboard (AP8) tatsächlich angezeigt werden, ist trotz der
grundsätzlichen Aufnahme von KPI 8 in Abschnitt 3.3 eine offene Frage: die
bestehende Regel "Provisions-/Margendaten nicht in der Mitarbeiter-UI"
(siehe `view-models.ts`) wurde bisher ausdrücklich für die Pro-Sitzung-
Empfehlungsansicht begründet; ob sie unverändert auch für ein aggregiertes
Management-Dashboard gilt (das mangels RBAC aktuell von jedem
authentifizierten Mitarbeiter aufrufbar wäre), ist damit nicht automatisch
mitentschieden. **Vorläufige, konservative Entscheidung für AP8:** Umsatz-
KPIs (1–7) werden angezeigt, Provision/Marge (KPI 8) zunächst NICHT im
Dashboard dargestellt (Daten bleiben in `kpis.ts` verfügbar) – vor einer
Anzeige wird dies mit ChatGPT geklärt.

### 12.6a AP9-Ergebnis (Testsuite, Code-Review)

Geschrieben (sandbox-bedingt nicht ausführbar, siehe Modulkommentare):

- `tests/unit/pricing/commission.test.ts` – `computeCommissionAmountMinor()`
  (FLAT/TIERED/PERCENTAGE, Rundung, Basis-Points-Randfälle).
- `tests/unit/deals/financial-snapshot.test.ts` – `computeDealFinancialSnapshot()`
  (Formel v1, `discountCostMinor` immer 0, fehlende Kosten-/Provisionsdaten,
  explizite Regressionstests für den AP3-Doppelverrechnungs-Bugfix bei FLAT-
  UND PERCENTAGE-Provisionen).
- `tests/integration/deals-service.test.ts` – `closeDeal()` End-to-End (Erfolg,
  IN_PROGRESS/COMPLETED, `DealSessionNotClosableError` bei ABANDONED,
  `DealRequiresItemsError`, `DealConsultationSessionNotFoundError`,
  `DealProductVersionNotFoundError`, `DealAlreadyExistsForSessionError`,
  Mandantentrennung für Session UND ProductVersion, optionale
  `customerReferenceId`, append-only-Test für `deal_financial_snapshots`).
- `tests/integration/analytics-kpis.test.ts` – alle drei `kpis.ts`-Funktionen
  gegen Fixtures mit bekannten Erwartungswerten (Zeitraum-Grenzen,
  Store-Filter, Mandantentrennung, Währungsgruppierung bei `getDealKpi()`).
- `scripts/verify_migration_pglite.mjs` – neuer Smoke-Test-Block: Deal +
  DealItem + DealFinancialSnapshot end-to-end anlegen, append-only-Trigger
  auf `deal_financial_snapshots` (UPDATE/DELETE) verifizieren, `deal_items`
  bleibt bewusst mutabel bestätigt (kein Trigger, wie im Schema vorgesehen).

**Bewusst NICHT umgesetzt (Scope-Reduktion, hier transparent dokumentiert):**
Component-/E2E-Tests für `DealClosureForm`/Dashboard (Plan Abschnitt 5,
"mind. 1 Happy-Path-E2E-Test") wurden in AP9 zurückgestellt – das bestehende
Playwright-Setup (`tests/e2e/global-setup.ts`/`seed-output.ts`) müsste um
Phase-6-Fixtures erweitert werden, was den Umfang dieses APs gesprengt hätte.
Wird vor dem finalen Phase-6-Abschluss (AP11/AP12) mit ChatGPT als offener
Punkt besprochen, nicht unilateral als "erledigt" markiert.

### 12.6c AP11-Ergebnis (Lokale Verifikation, Commit)

Überraschender Fund: `node_modules` ist in dieser Sandbox tatsächlich
vorhanden (entgegen der bisherigen Annahme "kein tsc/vitest möglich") –
`npx tsc --noEmit`, `npx eslint .` und `npx prettier --check .` liefen
tatsächlich aus:

- `tsc --noEmit`: 2 echte Fehler gefunden und behoben (`tests/component/fixtures.ts`
  fehlten die neuen Pflichtfelder `deal`/`dealClosureCandidates`;
  `tests/integration/questionnaire-engine.test.ts` fehlender
  Non-Null-Assertion bei Array-Zugriff) – danach sauber.
- `eslint`: 2 echte Fehler behoben (ungenutzter `CommissionResolution`-Import
  in `recommendation/service.ts` nach der AP3-Extraktion, ungenutzte
  Testvariable in `deals-service.test.ts`) – danach 0 Fehler (der einzige
  verbleibende Treffer betraf `next-env.d.ts`, eine generierte, `.gitignore`d
  Datei, kein echtes Problem).
- `prettier --write .`: 10 Dateien automatisch formatiert.
- `vitest run`: **nicht ausführbar** in dieser Sandbox – Rollup-Native-Binary-
  Mismatch (`@rollup/rollup-linux-arm64-gnu` fehlt, bekannter npm-
  Optional-Dependencies-Bug). Kein Code-Problem, sondern ein
  Umgebungsproblem dieser Sandbox-Installation; `npm install` wurde
  bewusst NICHT versucht (dokumentierte Standardregel dieses Projekts).
  Vitest-Verifikation bleibt daher CI-abhängig.

**Commit:** `3e45b5b` ("feat(deals,analytics): Phase 6 AP1-AP10 – Deal-
Erfassung + Analytics-KPI-Dashboard"), 29 Dateien, +4013/-66 Zeilen, direkt
auf `main` aufsetzend auf `a1a43c9` (Phase-5-Abschlussbericht). Push und
CI-Beobachtung stehen noch aus (Nutzer pusht über GitHub Desktop, wie in
allen vorherigen Phasen).

### 12.6b AP10-Ergebnis (Dokumentation)

- `docs/DEAL_CAPTURE.md` (neu): Deal-Erfassung, Provisions-/Kosten-Auflösung,
  Formel v1, API/UI-Übersicht, KPI-Aggregation, bekannte Einschränkungen.
- `docs/CONSULTATION_UI.md`: Abschnitt 6 um Deal-Erfassungs-UI ergänzt,
  Dateiliste (Abschnitt 12) und bekannte Einschränkungen (Abschnitt 11) um
  Phase-6-Stand aktualisiert.
- `docs/ANALYTICS_AND_KPIS.md`: neuer Abschnitt "Implementierungsstatus
  (Phase 6)" – stellt die aspirationale Phase-2-KPI-Tabelle den tatsächlich
  implementierten Kern-KPIs gegenüber, inkl. Hinweis auf die reale
  `AnalyticsEventType`-Namenskonvention vs. die Phase-2-Beispielnamen.
- `docs/DATA_MODEL.md`: Hinweis zu `Goal`/`KpiSnapshot` präzisiert (KPIs
  werden seit Phase 6 tatsächlich live berechnet, nicht mehr nur
  konzeptionell).
- `README.md` bewusst NICHT aktualisiert – der Status-Banner ist bereits seit
  Phase 3B veraltet (zeigt "Phase 3A"), das ist ein vorbestehender Zustand
  unabhängig von Phase 6 und außerhalb des AP10-Umfangs.

### 12.7 AP8-Ergebnis (Dashboard-UI, Code-Review)

`src/server/analytics/dashboard-view.ts` (Zeitraum-Auflösung Woche/
Kalendermonat, Komposition der drei `kpis.ts`-Funktionen, Filialliste nur
bei Mehrfilialen-Mandanten) und `src/app/analytics/page.tsx` (Server
Component, GET-Formular für Zeitraum/Filiale, Kachel-Layout laut Plan
Abschnitt 3.4 – bewusst ohne Charts). Wie in 12.6 festgelegt: **keine**
Provisions-/Margendaten im Dashboard, nur Anzahl/Umsatz. Zugriff wie
`/consultation` nur "eingeloggt" (kein RBAC – bestehender, bereits in Phase
5 dokumentierter Stop-Punkt, hier nicht neu entschieden). Einstiegslink von
`/consultation` aus ergänzt, `globals.css` um `.analytics-dashboard__*`-
Regeln erweitert.
