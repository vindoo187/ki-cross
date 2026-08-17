# Deal-Erfassung und Analytics-Grundlage (Phase 6)

Ergänzt [CONSULTATION_UI.md](CONSULTATION_UI.md) (Deal-Erfassungs-UI) und
[ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md) (KPI-Formeln/-Datenquellen) um
die konkrete, in Phase 6 tatsächlich implementierte Fachlogik. Details zu
Herleitung, offenen Punkten und ChatGPT-Konsultationen siehe
[PHASE_6_IMPLEMENTATION_PLAN.md](../PHASE_6_IMPLEMENTATION_PLAN.md).

## 1. Grundprinzip

Ein Deal wird ausschließlich über `closeDeal()`
(`src/server/deals/service.ts`) erfasst — der einzige Schreibpfad, über den
`Deal` + `DealItem[]` + `DealFinancialSnapshot` + `DEAL_CLOSED`-Analytics-Event
entstehen, alle vier ATOMAR in einer Transaktion. Bewusst **ein Deal pro
`ConsultationSession`**: kein Nachtragen weiterer Positionen zu einem bereits
geschlossenen Deal (kein CRM-Auftragsprozess, ChatGPT-Vorgabe "Out of
Scope" für Phase 6) — ein zweiter Versuch wirft
`DealAlreadyExistsForSessionError`.

Voraussetzung: die `ConsultationSession` muss `IN_PROGRESS` oder `COMPLETED`
sein (`DealSessionNotClosableError` sonst, positive Whitelist analog
`assertSessionEvaluable()` aus der Empfehlungs-Engine — `ABANDONED` bleibt
immer gesperrt).

## 2. Provisions-/Kosten-Auflösung

Provisions- und Kostendaten werden zum `closedAt`-Zeitpunkt **einmalig**
aufgelöst und direkt (nicht als Referenz) in den `DealFinancialSnapshot`
geschrieben:

- `ProductCostVersion` (`hardwarePurchaseCostMinor`/`subsidyCostMinor`/
  `otherDirectCostMinor`) — aktive Version je Produkt zum Abschlusszeitpunkt.
  Fehlt eine Version für ein Produkt, gilt das als "keine Kosten" (0), kein
  Fehler.
- `CommissionModelVersion` — dieselbe Auflösungsquelle wie die
  Empfehlungs-Engine (`loadActiveCommissionModelVersions()`/
  `buildResolveCommission()`, nach `src/server/pricing/commission.ts`
  verschoben, Verhalten unverändert). Neu für Phase 6:
  `computeCommissionAmountMinor(row, baseAmountMinor, fixedAmountMinor)`
  berechnet aus einer aufgelösten `CommissionModelVersion`-Zeile den
  konkreten Minor-Betrag — bei `PERCENTAGE` anhand von
  `commissionPercentageBasisPoints` (10000 = 100 %, kaufmännisch gerundet),
  bei `FLAT`/`TIERED` als der übergebene feste Betrag.

**Historische Stabilität** (ChatGPT-Vorgabe): `DealFinancialSnapshot` ist
append-only (DB-Trigger `deal_financial_snapshots_append_only`). Da
Provision/Kosten beim Abschluss vollständig aufgelöst und nicht als
Fremdschlüssel referenziert werden, ändert eine spätere Anpassung von
`CommissionModel`/`ProductCostVersion` einen bereits geschlossenen Deal nie
rückwirkend.

## 3. Deckungsbeitrags-Formel Version "v1"

```
contributionMarginMinor =
    oneTimeRevenueMinor
  - hardwarePurchaseCostMinor
  - subsidyCostMinor
  - discountCostMinor        // in v1 immer 0
  - otherDirectCostMinor
```

- **Nur der einmalige Umsatz/die einmaligen Kosten** fließen in v1 in den
  Deckungsbeitrag ein. `monthlyRecurringRevenueMinor` wird separat
  ausgewiesen, nicht über eine angenommene Vertragslaufzeit eingerechnet
  (das wäre ein "Expected Contract Contribution" — einer späteren
  Formel-Version vorbehalten).
- `discountCostMinor` ist in v1 **immer 0** — keine manuelle Rabatt-Eingabe
  durch den Mitarbeiter beim Deal-Abschluss (ein frei eingebbares
  Kostenfeld ohne definierte Quelle würde die KPI-Grundlage
  manipulierbar machen). Eine echte Rabattfunktion ist Formel-Version v2
  vorbehalten.
- `totalContractValueMinor` = `oneTimeRevenueMinor` + `monthlyRecurringRevenueMinor`
  (ein Monat wiederkehrender Umsatz, **keine** Laufzeit-Projektion).
- `commissionAmountMinor`/`expectedRecurringCommissionMinor` werden
  unabhängig von der Margen-Formel berechnet und nur aufsummiert.

Reine, DB-freie Berechnungsfunktion: `computeDealFinancialSnapshot()`
(`src/server/deals/financial-snapshot.ts`), pro Produktzeile auf
Stückpreisbasis berechnet und **einmalig** mit `quantity` skaliert (bewusst
so umgesetzt, um eine doppelte Mengenverrechnung bei prozentualen
Provisionen zu vermeiden — Regressionstest in
`tests/unit/deals/financial-snapshot.test.ts`).

`contributionMarginFormulaVersion` wird als String (aktuell `"v1"`) mit
jedem Snapshot mitgeschrieben, damit spätere Formel-Versionen bestehende
Snapshots nicht rückwirkend uminterpretieren.

## 4. API und UI

- `POST /api/consultation/sessions/[id]/deals` — Body:
  `{ items: [{ productVersionId, quantity }], customerReferenceId? }`.
  Dünner Wrapper (`src/app/api/consultation/sessions/[id]/deals/route.ts`),
  Zod-Validierung in `consultation-ui/schemas.ts`
  (`closeDealBodySchema`), Fehler-Mapping in `consultation-ui/http-errors.ts`.
- UI: `DealClosureForm`/`DealSummaryCard` als Erweiterung der
  Zusammenfassungsseite (`/consultation/[sessionId]/summary`) — siehe
  [CONSULTATION_UI.md](CONSULTATION_UI.md) Abschnitt 6. Kein eigenständiger
  CRM-Bildschirm.

## 5. Analytics-KPI-Aggregation

`src/server/analytics/kpis.ts` — reine, live aggregierende Read-Funktionen
(kein `KpiSnapshot`, ChatGPT-Vorgabe im Plan-Review):

| Funktion                        | Deckt KPI(s)                                     | Zeitraum-Filter                                                                            |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `getConsultationVolumeKpi()`    | Beratungen, Completion-/Abbruchquote             | `ConsultationSession.startedAt`                                                            |
| `getRecommendationOutcomeKpi()` | Empfehlungen generiert, Annahme-/Ablehnungsquote | `Recommendation.generatedAt` (generiert) / `RecommendationOutcome.decidedAt` (entschieden) |
| `getDealKpi()`                  | Abschlüsse, Umsatz, Provision/Marge              | `Deal.closedAt`, gruppiert nach `currency`                                                 |

Implementierungsannahmen (dokumentiert, keine Fachvorgabe — siehe
Modulkommentar in `kpis.ts`): "Abschlussquote" ist ein Perioden-Verhältnis
(Deals der Periode / Sessions der Periode), keine exakte Pro-Session-Kohorte;
`getDealKpi()` summiert bewusst NICHT über Währungen hinweg.

`src/server/analytics/dashboard-view.ts` löst den Zeitraum-Filter
(Woche/Kalendermonat) auf und komponiert die drei KPI-Funktionen zum
Dashboard-View-Model — zeigt **nur** die Umsatz-KPIs (1–7) an. **Endgültig
entschieden (ChatGPT, AP12/AP13):** Provision/Marge (KPI 8) werden im
`/analytics`-Dashboard bewusst NICHT angezeigt, weil das Dashboard aktuell
RBAC-los ist (jeder authentifizierte Mitarbeiter des Mandanten erreicht es).
`commissionAmountMinor`/`contributionMarginMinor` werden intern weiter in
`kpis.ts` berechnet und stehen für einen späteren, RBAC-geschützten
Management-Analytics-Bereich zur Verfügung, sind aber nirgends im
Mitarbeiter-UI gerendert (verifiziert durch
`tests/component/AnalyticsDashboardContent.test.tsx`).

Dashboard-Route: `/analytics` (`src/app/analytics/page.tsx`), Server
Component mit GET-Formular für Zeitraum/Filiale, Kachel-Layout ohne Charts
(analog der bewusst schlichten `/review`-Prüfansicht).

## 6. Absicherung gegen Doppelabschluss (AP12-Härtung)

`Deal` trägt zusätzlich zu `@@unique([tenantId, id])` den Constraint
`@@unique([tenantId, consultationSessionId])`
(Migration `20260817170000_deal_unique_consultation_session`). Der
App-Level-Precheck in `closeDeal()` allein war race-anfällig (zwei nahezu
gleichzeitige Aufrufe könnten beide den Precheck vor Transaktionsende
passieren); der DB-Constraint verhindert das strukturell. `closeDeal()`
fängt die resultierende `PrismaClientKnownRequestError` (Code `P2002`) ab
und übersetzt sie in dieselbe `DealAlreadyExistsForSessionError` wie der
Precheck (Defense-in-Depth, analog `recommendation/outcome.ts`). Regressionstest:
`tests/integration/deals-service.test.ts` (`Promise.allSettled()` mit zwei
gleichzeitigen `closeDeal()`-Aufrufen für dieselbe Session, genau ein Erfolg).

## 7. Bekannte Einschränkungen

- Kein RBAC: `/analytics` ist wie `/consultation` für jeden authentifizierten
  Mitarbeiter des Mandanten erreichbar (bestehender, in Phase 5 dokumentierter
  Stop-Punkt, hier nicht neu entschieden).
- Kein Mitarbeiterfilter im Dashboard-UI (nur Zeitraum + Filiale, wie in
  PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.4 vorgegeben) — `kpis.ts`
  unterstützt `employeeId` bereits, ist aber noch nicht ans UI angebunden.
