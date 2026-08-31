# Phase 15 AP0 – Discovery: AP-Sidebar (Beratungsarbeitsplatz)

**Status:** Reines Discovery-/Entscheidungsdokument. Kein Code, keine
Migration, keine neuen Datenquellen. Grundlage: Nutzerwunsch, das seit
Phase 5 (2026-08-03) mehrfach zurückgestellte Sidebar-Feature für
`/consultation/[sessionId]` jetzt aufzugreifen (Task #186), sowie ChatGPTs
GO für eine frische Kurz-Discovery vor jeglicher Planung (2026-08-31) --
der ursprüngliche technische Kern (ConsultationWorkspace-Wrapper +
`getConsultationSidebarData()`) gilt weiterhin als richtig, aber die
Systemlandschaft hat sich seit 2026-08-03 durch Phase 6-14 erheblich
verändert (RBAC-Config-Domänen, Campaigns, Goals, Commissions, Sales
Playbook, KI-Extraction-Grundgerüst).

## 1. Ist-Zustand `/consultation/[sessionId]`

Drei unabhängige Server-Component-Seiten, **kein gemeinsames
`layout.tsx`**, kein `ConsultationWorkspace`-Wrapper existiert bisher:

| Route                                      | Datei                     | Zeilen | Lädt                                                                                                     |
| ------------------------------------------ | ------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `/consultation/[sessionId]`                | `page.tsx`                | 70     | `loadQuestionnaireState()`, `isAiExtractionAvailableForCurrentTenant()`                                  |
| `/consultation/[sessionId]/recommendation` | `recommendation/page.tsx` | 103    | `getLatestRecommendation()` + `buildConsultationRecommendationView()`, `loadConsultationSessionStatus()` |
| `/consultation/[sessionId]/summary`        | `summary/page.tsx`        | 70     | `buildConsultationSessionSummaryView()`                                                                  |

Jede der drei Seiten dupliziert identischen Boilerplate: `getOptionalServerSession()`
→ `redirect("/login")` bei fehlender Session → `withServerSessionTenantContext()`
für den eigentlichen Datenzugriff. Alle drei rendern `<main className="consultation-workspace">`
(gemeinsame CSS-Klasse existiert bereits, `globals.css` Zeile 104, aber kein
gemeinsamer Layout-Baustein). Navigation zwischen den drei Unterseiten
erfolgt aktuell nur über einzelne `<Link>`-Elemente innerhalb der jeweiligen
Seite (z. B. "Angaben ändern" auf der Empfehlungsseite), keine durchgängige
Sitzungsnavigation.

Genau diese Redundanz (dreifacher Session-/Tenant-Context-Boilerplate,
keine gemeinsame Navigation) war schon 2026-08-03 der Ausgangspunkt für den
`ConsultationWorkspace`-Vorschlag -- dieser Befund hat sich **nicht**
verändert und bleibt gültig.

## 2. Bereits vorhandene, wiederverwendbare Read-Model-Funktionen

Für eine Sidebar müsste **keine** neue Fachlogik gebaut werden -- alle
potenziell relevanten Datenquellen haben bereits dedizierte, reine
Lesefunktionen:

| Domäne              | Funktion                                                              | Datei                                                             | Scope                                                               |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Empfehlung          | `getLatestRecommendation()` + `buildConsultationRecommendationView()` | `recommendation/service.ts`, `consultation-ui/view-models.ts`     | pro Session                                                         |
| Sitzungsstatus      | `loadConsultationSessionStatus()`                                     | `consultation-ui/view-models.ts`                                  | pro Session                                                         |
| Ziele (Mitarbeiter) | `listVisibleGoalsForEmployee()`, `buildGoalProgressForEmployee()`     | `analytics/goal-visibility.ts`                                    | eigenes `EMPLOYEE`-Goal, bereits `TenantContext.employeeId`-gescopt |
| Playbook-Retrieval  | `selectPlaybookSections()` + `loadActivePlaybookSectionCandidates()`  | `playbook/playbook-retrieval.ts`, `playbook-retrieval-context.ts` | liefert nur Section-IDs/Metadaten, **kein** Content-Zugriff         |
| Kampagnen           | `loadActiveCampaignContext()`                                         | `recommendation/service.ts`                                       | intern, bisher nur innerhalb `evaluate()` genutzt                   |

Keine dieser Funktionen ist heute in einer der drei Consultation-Seiten
eingebunden -- eine Sidebar wäre der erste Ort, an dem mehrere davon
gemeinsam für den Mitarbeiter sichtbar würden.

## 3. Bestehende, verbindliche RBAC-/Sichtbarkeitsgrenze (wichtigster Befund)

`view-models.ts` enthält bereits eine **explizit dokumentierte, seit Phase 6
etablierte Regel**, die für die Sidebar unverändert gilt:

> "`businessPriorityScore` und Provisions-/Margendaten werden NICHT in der
> Mitarbeiter-UI angezeigt" (Modulkommentar zu
> `buildConsultationRecommendationView()`, wiederholt bei `DealSummary`).

Konkret: `prioritization:*`- und `commission_model_unresolved`-Rationale-
Einträge werden vollständig herausgefiltert (nicht nur unübersetzt
gelassen), `DealSummary` enthält bewusst kein `commissionAmountMinor`/
`contributionMarginMinor`. Diese Grenze ist **kein Sidebar-spezifisches
Thema**, sondern eine bereits bestehende, projektweite Trennung zwischen
Mitarbeiter-Sicht (`/consultation/*`) und Management-Sicht
(`/analytics/management`, `config.commissions.*`-Admin). Eine Sidebar darf
diese Grenze an keiner Stelle unterlaufen -- weder direkt (Provisionsdaten
anzeigen) noch indirekt (z. B. `businessPriorityScore`-Reihenfolge implizit
über die Darstellung erkennbar machen).

## 4. Vorgeschlagener MVP-Scope (zwei Ebenen, ChatGPTs Empfehlung)

**Ebene 1 -- AP-Sidebar jetzt (dieser mögliche AP1):**

- Kontext + Navigation zwischen den drei bestehenden Unterseiten
  (Fragenfluss / Empfehlung / Zusammenfassung) plus Rücksprung zur
  Einstiegsseite `/consultation`.
- Sichtbarer Sitzungsstatus (`IN_PROGRESS`/`COMPLETED`/`ABANDONED`,
  bereits über `loadConsultationSessionStatus()` verfügbar).
- Optional: eigenes aktives `EMPLOYEE`-Goal des Mitarbeiters, rein lesend
  über die bereits bestehende `buildGoalProgressForEmployee()`
  (Sichtbarkeitslogik bereits vollständig in `goal-visibility.ts` gelöst,
  keine neue RBAC-Prüfung nötig).
- Ausschließlich bereits vorhandene, bereits für die Mitarbeiter-Sicht
  freigegebene Daten -- keine neue Aggregation, keine zweite `evaluate()`-
  Auswertung, keine neue Recommendation-/Priorisierungslogik nur für die
  UI.

**Ebene 2 -- spätere Erweiterungen (ausdrücklich NICHT Teil dieses AP):**

- Playbook-Empfehlungen/-Argumentationshilfen in der Sidebar.
- KI-generierte Inhalte (abhängig von AP5c, aktuell pausiert).
- Campaign-Insights ("diese Kampagne ist gerade aktiv").
- Beliebige weitere Aggregationen.

Diese Trennung verhindert, dass aus einem ursprünglich überschaubaren
Navigations-/Kontext-Feature unbeabsichtigt eine neue Aggregations-/KI-
Architektur entsteht (ChatGPTs ausdrückliche Warnung).

## 5. Datenquellen der Sidebar (MVP, Ebene 1)

| Datenpunkt                                                     | Quelle                                                                                         | Neu?                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Sitzungsstatus                                                 | `loadConsultationSessionStatus()`                                                              | Nein, bereits vorhanden                    |
| Fragebogen-Label                                               | `ConsultationSession.questionnaireVersion.label` (bereits Teil von `loadQuestionnaireState()`) | Nein                                       |
| Navigationslinks                                               | statisch, aus `sessionId` abgeleitet                                                           | Nein (reine UI)                            |
| Eigenes aktives Goal (optional)                                | `buildGoalProgressForEmployee()`                                                               | Nein, aber neu VERWENDET in diesem Kontext |
| Empfehlungs-Kurzstatus (z. B. "Empfehlung vorhanden: ja/nein") | Ableitung aus `getLatestRecommendation() !== null`                                             | Nein                                       |

Keine dieser Datenquellen erfordert eine neue Migration, einen neuen
Permission-Key oder eine neue Aggregationsfunktion in der Kernlogik.

## 6. RBAC-/Tenant-Grenzen

- Tenant-Isolation weiterhin ausschließlich über den bereits etablierten,
  tenant-gescopten Prisma-Client (`db`) innerhalb `withServerSessionTenantContext()`
  -- keine neue Isolationsschicht nötig.
  Session-Zugriff bleibt wie bisher: `ConsultationSessionNotFoundError` bei
  fremder Session-ID (Next.js-Standardfehlerseite, unverändert).
- Goal-Sichtbarkeit: `listVisibleGoalsForEmployee()`/`buildGoalProgressForEmployee()`
  sind bereits ausschließlich auf `TenantContext.employeeId` beschränkt --
  keine Erweiterung/Änderung an `goal-visibility.ts` nötig oder vorgesehen.
- **Keine neuen Permission-Keys** nötig für den MVP-Scope -- alle
  angezeigten Daten sind bereits über bestehende, für die Mitarbeiter-Rolle
  freigegebene Lesepfade abgedeckt (`consultationPermissions`/`employeeId`-
  Scope, kein `config.*`-Bezug).
- Explizit zu vermeiden: keine Provisions-/Margendaten (Abschnitt 3), keine
  Management-Scope-Daten (`managementScope` ist für Analytics-Dashboards
  reserviert, nicht für die Mitarbeiter-Sidebar).

## 7. Performance-/Architekturüberlegung

Empfehlung: **ein dedizierter Read-Use-Case** `getConsultationSidebarData(sessionId)`
in `consultation-ui/view-models.ts` (analog den bestehenden Funktionen dort),
der die oben genannten, bereits vorhandenen Funktionen bündelt (`Promise.all`,
analog dem bestehenden Muster in `recommendation/page.tsx`), statt mehrerer
unabhängiger Requests aus der UI. Da `ConsultationWorkspace` als
`layout.tsx` für `/consultation/[sessionId]` gedacht ist (Server Component,
läuft bei jeder Unterseite erneut), sollte `getConsultationSidebarData()`
bewusst schlank bleiben (keine vollständigen Objekte laden, nur die für die
Sidebar nötigen Felder) -- analog der bereits etablierten
View-Model-Konvention in diesem Modul.

## 8. Reproduzierbarkeit/Seiteneffekte

Die Sidebar soll den **aktuellen** Zustand der laufenden Beratung
darstellen, ohne selbst Seiteneffekte auszulösen: kein Schreibzugriff, keine
erneute `evaluate()`-Auswertung, keine Veränderung von Recommendation-/
Campaign-/Goal-Daten durch den bloßen Aufruf der Sidebar. Dies ist konsistent
mit der bereits etablierten "JETZT-Semantik" (Campaigns/Goals/Playbook,
siehe `DECISION_LOG.md`) -- die Sidebar zeigt den aktuellen freigegebenen
Zustand, kein historisches Snapshot-Retrieval.

## 9. Teststrategie -- Korrektur gegenüber dem ursprünglichen Task #186

Der ursprüngliche Task-Text (2026-08-03) nannte "Playwright Chromium+WebKit
Regression, 12-Punkte-Testliste". **Wichtiger Befund:** Das seit AP12
(Phase 5/6) tatsächlich etablierte und in allen seitherigen Phasen (Rules,
Commissions, Goals, Campaigns, Playbooks) konsequent verwendete
Playwright-Setup (`playwright.config.ts`) verwendet **Desktop Chromium +
Tablet (iPad Landscape)**, **nicht** Chromium+WebKit -- WebKit ist in der
aktuellen Projektkonfiguration kein Test-Projekt. Der alte Task-Text ist an
dieser Stelle überholt; eine neue Sidebar-E2E-Suite sollte dem inzwischen
etablierten Muster folgen (Desktop+Tablet, nicht Chromium+WebKit).

Bestehende Regressionsbasis, die durch die Sidebar-Einführung NICHT brechen
darf: `tests/e2e/happy-path.spec.ts`, `tests/e2e/abandonment.spec.ts`
(decken den kompletten Frage→Empfehlung→Zusammenfassung-Fluss inkl.
Abbruch ab). Eine neue `tests/e2e/consultation-sidebar.spec.ts` (falls AP1
beschlossen wird) sollte mindestens abdecken:

1. Sidebar zeigt korrekte Navigation zwischen allen drei Unterseiten.
2. Sitzungsstatus wird korrekt dargestellt (`IN_PROGRESS`/abgeschlossen).
3. Eigenes aktives Goal wird angezeigt, falls vorhanden -- korrekt
   `employeeId`-gescoped (kein fremdes Mitarbeiterziel sichtbar).
4. Kein aktives Goal → kein Fehler, dezenter Leerstand.
5. Fremde Tenant-/Session-ID → weiterhin Next.js-Standardfehlerseite (keine
   Regression durch das neue `layout.tsx`).
6. Keine Provisions-/Margendaten in der Sidebar sichtbar (Negativtest,
   analog der bestehenden Prüfung in `buildConsultationRecommendationView()`).
7. Bestehender Happy-Path/Abandonment-Flow bleibt vollständig funktionsfähig
   (Regression).

## 10. Explizit außerhalb des Scopes (dieser mögliche AP1)

- Playbook-Integration in die Sidebar (Abschnitt 4, Ebene 2).
- Jegliche KI-/Prompt-Funktionalität (unabhängig, ob AP5c inzwischen
  gestartet wurde).
- Campaign-Insights in der Sidebar.
- Provisions-/Margendaten in jeglicher Form (bestehende, unverändert
  gültige Grenze, Abschnitt 3).
- Neue Permission-Keys oder RBAC-Architektur -- die Sidebar nutzt
  ausschließlich bereits bestehende, freigegebene Lesepfade.
- Änderungen an `evaluate()`/der Recommendation Engine selbst.

## 11. Empfehlung zu `ConsultationWorkspace` + `getConsultationSidebarData()`

**Unverändert übernehmen, mit einer technischen Präzisierung:**
`ConsultationWorkspace` sollte als Next.js `layout.tsx` für
`/consultation/[sessionId]` implementiert werden (nicht als reiner
Client-Wrapper) -- das würde den in Abschnitt 1 beschriebenen, dreifach
duplizierten Session-/Tenant-Context-Boilerplate tatsächlich reduzieren
(Next.js führt Layouts serverseitig einmal pro Navigation aus, aber
`getOptionalServerSession()`/Redirect könnten dort zentral geprüft werden,
sofern das mit dem bestehenden Muster der drei Unterseiten vereinbar ist --
diese Detailfrage wäre Teil der eigentlichen AP1-Umsetzung, nicht dieser
Discovery). `getConsultationSidebarData()` bleibt wie ursprünglich benannt
und geplant, jedoch mit dem in Abschnitt 5 präzisierten, bewusst schlanken
MVP-Datenumfang.

## 12. Offene Frage für ChatGPT vor AP1

Soll `ConsultationWorkspace` als `layout.tsx` den bereits in allen drei
Seiten identisch vorhandenen `getOptionalServerSession()`/`redirect("/login")`-
Block zentral übernehmen (echte Duplikat-Reduktion), oder soll dieser Block
aus Konsistenzgründen bewusst in jeder Seite bestehen bleiben (falls eine
Seite je unabhängig von der Sidebar aufrufbar sein müsste)? Diese
Entscheidung hat Auswirkung auf den Umfang von AP1 und wird hier bewusst
nicht vorweggenommen.
