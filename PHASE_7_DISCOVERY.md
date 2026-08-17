# Phase 7 – AP0: Discovery & Scope (Management Analytics & Vertriebssteuerung)

Stand: 2026-08-17. Reine Ist-Analyse gemäß ChatGPTs Vorgabe ("noch keine
Implementierung, erst AP0 mit 10 Untersuchungspunkten, danach
PHASE_7_IMPLEMENTATION_PLAN.md und GO-Entscheidung"). Alle Aussagen sind
code-verifiziert (Grep/Read gegen den aktuellen `main`-Stand, Commit
`282a766`), keine Annahmen.

## 1. Aktuelle Analytics-Architektur

`src/server/analytics/kpis.ts` liefert drei live aggregierende
Read-Funktionen (Prisma `groupBy()`/`count()`/`aggregate()`, keine Roh-SQL,
keine Anwendungslogik-Schleifen):

- `getConsultationVolumeKpi()` – Beratungsvolumen, Completion-/Abbruchquote
  (Filter: `ConsultationSession.startedAt`).
- `getRecommendationOutcomeKpi()` – generierte/entschiedene Empfehlungen,
  Annahme-/Ablehnungsquote (Filter: `Recommendation.generatedAt` bzw.
  `RecommendationOutcome.decidedAt`, zwei getrennte Kohorten).
- `getDealKpi()` – pro Währung: Abschlüsse, wiederkehrender/einmaliger
  Umsatz, **`commissionAmountMinor`**, **`contributionMarginMinor`**
  (Filter: `Deal.closedAt`).

`src/server/analytics/dashboard-view.ts` komponiert diese drei Funktionen
zu `AnalyticsDashboardView`, aufgelöst nach Woche/Kalendermonat und
optionalem Filialfilter. **Wichtiger Befund:** `commissionAmountMinor` und
`contributionMarginMinor` werden von `getDealKpi()` bereits berechnet,
aber im `dashboard-view.ts`-Mapping bewusst herausgefiltert und erreichen
`/analytics` nie – dokumentiert in `docs/DEAL_CAPTURE.md` Abschnitt 5 als
"reserviert für einen späteren, RBAC-geschützten Management-Analytics-
Bereich". **Das ist exakt die Lücke, die Phase 7 schließt.**

`kpis.ts` unterstützt bereits einen `employeeId`-Filterparameter, der aber
in `dashboard-view.ts`/UI nicht angebunden ist (nur `storeId`-Filter
existiert im Dashboard).

## 2. Rollen/RBAC

**Schema-Modelle existieren und sind teilweise verdrahtet, aber es gibt
keine echte Autorisierung.**

- `Permission`, `Role`, `RolePermission`, `RoleAssignment`
  (`prisma/schema.prisma`) – `RoleAssignment` mit `scopeType: TENANT|COMPANY|STORE`,
  `companyId`/`storeId` optional je nach Scope, Integrität nur per Raw-SQL-
  Trigger in der Init-Migration abgesichert (nicht Prisma-nativ).
- `src/server/auth/dev-users.ts` liest tatsächlich `RoleAssignment`/`Role`
  und befüllt ein `roles: string[]`-Array; das landet im Session-Token
  (`SessionPayload.roles`) und im `TenantContext.roles`
  (Kommentar dort: _"fuer zukuenftige Autorisierungspruefungen"_).
- **Aber:** Ein projektweiter Grep nach tatsächlicher Nutzung
  (`.roles.includes(...)`, `.roles.some(...)` etc.) findet **keine einzige
  Stelle**, an der `roles` eine Zugriffsentscheidung beeinflusst. `roles`
  wird nur in der Login-Auswahl-UI angezeigt (`src/app/login/page.tsx`),
  nicht ausgewertet.
- `Permission`/`RolePermission` werden im Anwendungscode **nirgends**
  gelesen – nur geseedet (`prisma/seed.ts`).
- Die einzige tatsächliche Zugriffssperre im Code ist
  `src/server/review/review-access.ts` (`isReviewPageEnabled()`) – rein
  umgebungsbasiert (`NODE_ENV`/`ENABLE_REVIEW_PAGE`), nicht rollenbasiert.
- `docs/ROLES_AND_PERMISSIONS.md` (Phase-1-Konzeptdokument) beschreibt ein
  aspirationales Rollenkatalog (Verkaufsmitarbeiter, Filialleitung,
  Regionalleitung, Geschäftsführung, Fachadministrator,
  Systemadministrator, optional Mandanten-Owner) mit Berechtigungsmatrix –
  bislang reines Konzept, nicht umgesetzt.

**Fazit:** Die Datenbank-Grundlage für RBAC existiert bereits (Rollen sind
seedbar, Zuordnung zu Usern über `RoleAssignment` inkl. Scope-Ebene
Tenant/Company/Store), aber es fehlt die komplette Durchsetzungsschicht
(Autorisierungsprüfung in Services/Routen/UI). Phase 7 baut nicht bei Null,
sondern aktiviert vorhandene, bisher ungenutzte Infrastruktur.

## 3. KPI-Katalog: Vision vs. Implementiert

`docs/ANALYTICS_AND_KPIS.md` (Phase-2-Vision) listet 19 KPIs. Tatsächlich
in Phase 6 umgesetzt: Beratungsvolumen, Completion-/Abbruchquote,
Empfehlungen generiert, Annahme-/Ablehnungsquote, Abschlüsse, Umsatz
(einmalig + wiederkehrend), Provision/Marge (berechnet, nicht angezeigt).

**Bewusst zurückgestellt** (kein Phase-6-Blocker, aber im Katalog
vorhanden): Cross-Selling-Quote, Ø Produkte pro Verkauf, Ø
Beratungsdauer, häufige Kundenbedürfnisse/Produkte, Ablehnungsgründe,
Zeitersparnis-Vergleich (Baseline-Problem ungelöst, siehe
`OPEN_DECISIONS.md`), Datenqualität/Vollständigkeit,
Mitarbeiter-Aufschlüsselung im UI (Datenschicht vorhanden, UI fehlt).

Für Phase 7 vorgeschlagene Grobeinteilung (aufgreifend ChatGPTs
Kategorisierung operativ/Vertrieb/Finanzen/Management/Qualität) – NUR
Vorschlag, keine Festlegung:

| Kategorie  | Beispiel-KPIs                                               | Aktueller Stand                                                          |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Operativ   | Beratungsvolumen, Completion-/Abbruchquote                  | ✅ implementiert                                                         |
| Vertrieb   | Annahme-/Ablehnungsquote, Abschlussquote, Conversion-Funnel | teilw. implementiert (Abschlussquote/Funnel fehlen als explizite KPI)    |
| Finanzen   | Umsatz, Provision, Deckungsbeitrag, Margenquote             | Umsatz ✅, Provision/Marge berechnet aber nicht angezeigt                |
| Management | Mitarbeiter-/Filialvergleich, Zeiträume vergleichen         | fehlt komplett (kein Mitarbeiterfilter im UI, kein Vorperiodenvergleich) |
| Qualität   | Datenvollständigkeit, häufige Ablehnungsgründe              | fehlt komplett                                                           |

## 4. Deal-/Financial-Daten

Vollständig vorhanden (Phase 2/6), append-only wo nötig:

- `Deal` (`@@unique([tenantId, consultationSessionId])` seit AP12-Härtung
  – ein Deal pro Session), `DealItem`, `DealFinancialSnapshot` (append-only
  DB-Trigger, versionierte Formel `contributionMarginFormulaVersion`).
- `CommissionModel`/`CommissionModelVersion` (versioniert, FLAT/PERCENTAGE/
  TIERED, Exclusion-Constraint gegen überlappende aktive Versionen),
  `ProductCostVersion` (Hardware-/Subventions-/sonstige Kosten,
  versioniert).
- Provisions-/Kostenauflösung erfolgt einmalig zum `closedAt`-Zeitpunkt
  (`src/server/pricing/commission.ts`) und wird fest in den Snapshot
  geschrieben – spätere Stammdatenänderungen wirken sich nie rückwirkend
  auf bereits abgeschlossene Deals aus. Das ist die Grundvoraussetzung für
  eine revisionssichere Managementansicht.

## 5. Filial-/Mitarbeiter-Zuordnung

Hierarchie `Tenant → Company → Store → Employee` (bewusst **keine**
Region-Ebene, siehe `docs/DATA_MODEL.md`). Ein Employee gehört zu genau
einem Store, ein Store zu genau einer Company. Mehrfilialen-Betrieb ist
bereits aktiv genutzt: `prisma/seed.ts` erzeugt pro Demo-Tenant 2 Filialen
mit je einem Mitarbeiter (nicht 5, wie eine veraltete Stelle in
`DATA_MODEL.md` noch behauptet – dort besteht eine kleine
Dokumentationsschuld, die bei Gelegenheit korrigiert werden sollte).
`kpis.ts` unterstützt Filial- UND Mitarbeiterfilter, `dashboard-view.ts`
bindet aktuell nur den Filialfilter an.

## 6. Historische Auswertbarkeit / Indizes

Zeitraum-relevante Indizes bereits vorhanden: `ConsultationSession
[storeId, startedAt]`/`[employeeId, startedAt]`, `Deal[storeId, closedAt]`,
`AnalyticsEvent[tenantId, eventType, occurredAt]`/`[tenantId, storeId,
occurredAt]`. **Fehlend:** kein direkter Index auf
`Recommendation.generatedAt`/`RecommendationOutcome.decidedAt` – bei
größeren Datenmengen und häufigen Management-Abfragen über diese Felder
ggf. nachzuziehen (kein Blocker für AP0, aber ein AP-Kandidat für die
Implementierung).

## 7. Snapshot-Frage (`KpiSnapshot`)

Bestätigt: **Kein `KpiSnapshot`- oder `Goal`-Modell im Schema.** Beides
bewusst seit Phase 2B/6 zurückgestellt ("späterer Ausbau", siehe
`docs/DATA_MODEL.md`). Live-Aggregation war für Phase 6 (Einzel-Dashboard,
kurze Zeiträume Woche/Monat) ausreichend performant.

**Für Phase 7 zu klären:** Managementberichte (Monatsabschlüsse,
Filialvergleiche über längere Zeiträume, historische Mitarbeiterstände bei
Personalwechsel) könnten Live-Aggregation an ihre Grenzen bringen bzw.
erfordern "revisionssichere", nicht rückwirkend veränderliche Berichte
(z. B. ein Monatsabschluss darf sich nicht ändern, wenn nachträglich ein
Deal storniert würde – aktuell gibt es ohnehin keine Stornofunktion, aber
die Frage bleibt relevant für spätere Korrekturen). Das ist eine
Architekturentscheidung, keine AP0-Schlussfolgerung – wird explizit an
ChatGPT zur Entscheidung vorgelegt (siehe Abschnitt 9).

## 8. Management-Dashboard-Konzept (Ist-Stand: nicht vorhanden)

Aktuell existiert nur `/analytics` (Mitarbeiter-Dashboard, RBAC-los, keine
Provisions-/Margendaten). Keine dedizierte Management-Route. Bestehende
UI-Routen insgesamt: `/`, `/login`, `/consultation`,
`/consultation/[sessionId]`, `/consultation/[sessionId]/recommendation`,
`/consultation/[sessionId]/summary`, `/analytics`, `/review` (Dev/Test-only).
Kein bestehendes Muster für rollenabhängige UI-Sichtbarkeit im Frontend.

## 9. Datenschutz-/Tenant-Grenzen

Unverändert robust seit Phase 2B: `runWithTenantContext()` +
`withTenantScope()`-Prisma-Extension injiziert `tenantId` automatisch in
alle Standard-Query-Methoden (inkl. `groupBy`/`aggregate`/`count`, die
`kpis.ts` nutzt) für alle Modelle außer der expliziten
`GLOBAL_MODELS`-Ausnahmeliste (`Tenant`, `Permission`, `Provider`). Ein
Rollen-/Scope-Modell (Company/Store-Ebene) existiert in `RoleAssignment`
bereits – Phase 7 müsste diese Scope-Ebene zusätzlich zur bestehenden
Tenant-Isolation auswerten (z. B. "Filialleitung sieht nur ihre eigene
Filiale" ist eine WEITERE Einschränkung innerhalb des Tenants, kein neuer
Isolationsmechanismus).

## 10. Anforderungen an spätere Margenkontrolle

Technisch bereits erfüllt: Provisions-/Margenzahlen werden korrekt und
versioniert berechnet (`getDealKpi()`), sind aber UI-seitig unterdrückt.
Die einzige fehlende Voraussetzung für eine sichere Anzeige ist eine echte
Autorisierungsschicht (siehe Abschnitt 2) – die Datengrundlage selbst
braucht keine Änderung.

---

## Zusammenfassung für ChatGPT-Review

Kernbefund dieser Discovery: **Die Datengrundlage für Phase 7 ist zu
großen Teilen bereits vorhanden** (RBAC-Schema, Provisions-/Margen-
Berechnung, Filial-/Mitarbeiterstruktur, Zeitraum-Indizes) – die
eigentliche Phase-7-Arbeit ist überwiegend Durchsetzungs-/UI-Arbeit
(Autorisierung tatsächlich prüfen, Management-Dashboard bauen), nicht
Neubau der Datenschicht. Offene Architekturfragen, die vor einem
Implementierungsplan zu klären sind:

1. Welche der drei von ChatGPT vorgeschlagenen Sichten (Mitarbeiter/
   Prokurist-Management/Geschäftsführung) werden für Phase 7 tatsächlich
   gebaut – alle drei, oder zunächst nur eine (z. B. nur
   Geschäftsführungssicht mit voller Marge/Provision, Mitarbeitersicht
   bleibt `/analytics` wie bisher)?
2. Soll die Autorisierung auf Basis der bereits vorhandenen
   `RoleAssignment`-Scope-Ebenen (TENANT/COMPANY/STORE) erfolgen, oder
   reicht für Phase 7 zunächst ein einfacheres Modell (z. B. ein
   einzelnes `isManagement`-Flag pro Employee)?
3. Wird `KpiSnapshot` in Phase 7 tatsächlich gebraucht, oder reicht
   Live-Aggregation weiterhin (ggf. mit den in Abschnitt 6 genannten
   zusätzlichen Indizes)?
4. Documentation debt (nicht blockierend, zur Kenntnis): `docs/DATA_MODEL.md`
   nennt noch "5 Filialen" in den Testdaten – tatsächlich sind es 2 pro
   Tenant. Kleine Korrektur, kann im Rahmen von Phase 7 mit erledigt
   werden.
