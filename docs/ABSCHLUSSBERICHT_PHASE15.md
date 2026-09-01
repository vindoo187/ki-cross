# Abschlussbericht Phase 15 – AP-Sidebar (ConsultationWorkspace)

**Status:** Phase 15 OFFIZIELL ABGESCHLOSSEN. Bewusst klein gehalten (nur
zwei inhaltliche AP plus dieser Abschlussbericht) – siehe ChatGPTs
ausdrückliche Vorgabe, aus einem ursprünglich überschaubaren
Navigations-/Kontext-Feature keine neue Aggregations-/KI-Architektur
entstehen zu lassen.

## 1. Commit-/CI-Übersicht

| AP  | Commit    | Beschreibung                                                        | CI-Run | Ergebnis                      |
| --- | --------- | ------------------------------------------------------------------- | ------ | ----------------------------- |
| AP0 | `1e4d2f9` | Discovery AP-Sidebar (kein Code)                                    | #156   | Success, 4m47s, erster Anlauf |
| AP1 | `faf755e` | ConsultationWorkspace `layout.tsx` + `getConsultationSidebarData()` | #157   | Success, 4m58s, erster Anlauf |

Beide Commits liefen beim ersten Anlauf grün – keine Fix-Runden nötig.

## 2. Ziel und Vorgeschichte

Das Sidebar-Feature (`ConsultationWorkspace` + `getConsultationSidebarData()`)
wurde bereits am 2026-08-03 (Phase 5) skizziert, dann aber mehrfach
zurückgestellt (Task #186), während Campaigns (Phase 13), Sales Playbook
(Phase 14) und weitere Domänen hinzukamen. Auf Nutzerwunsch wurde es in
Phase 15 wieder aufgegriffen. ChatGPT bestand auf einer frischen
Kurz-Discovery statt der 1:1-Umsetzung des alten Plans, da sich die
Systemlandschaft seit 2026-08-03 erheblich verändert hatte.

## 3. Scope

**Ebene 1 (umgesetzt):** gemeinsame Navigation zwischen den drei
Consultation-Unterseiten (Fragen/Empfehlung/Zusammenfassung), Anzeige des
Sitzungsstatus, optional die eigenen aktuell periodenaktiven Ziele des
Mitarbeiters (rein lesend).

**Ebene 2 (bewusst nicht umgesetzt, ausdrücklich Out-of-Scope):**
Playbook-Empfehlungen, KI-generierte Inhalte, Campaign-Insights,
Provisions-/Margendaten, Änderungen an `evaluate()`, neue Permission-Keys.
ChatGPT: „Ich würde die Sidebar nicht automatisch zu einem ‚Sales Command
Center‘ machen.“

## 4. Ist-Zustand vor Phase 15

Drei unabhängige Server-Component-Seiten unter `/consultation/[sessionId]`,
kein gemeinsames `layout.tsx`, dreifach identischer
`getOptionalServerSession()` → `redirect("/login")` →
`withServerSessionTenantContext()`-Boilerplate, nur eine gemeinsame
CSS-Klasse (`consultation-workspace`), keine durchgängige Navigation
zwischen den Unterseiten.

## 5. Zentrale Architekturentscheidung: Next.js-Layout-Freshness

Vor der eigentlichen Implementierung wurde eine Bestandsprüfung
durchgeführt, wie von ChatGPT gefordert. Dabei zeigte sich ein reales
technisches Risiko: Next.js 15 hat den Client-Router-Cache-`staleTime`
für **Page**-Segmente standardmäßig auf 0 gesetzt (immer frisch bei
Navigation), für geteilte **Layout**-Segmente gilt das laut offizieller
Next.js-Dokumentation ausdrücklich **nicht** – Layout-Segmente werden bei
Client-seitiger Navigation zwischen Geschwister-Seiten nicht zwingend neu
vom Server geholt.

Wäre der Session-/Auth-Check wie ursprünglich skizziert in `layout.tsx`
verschoben worden, hätte er nur beim ersten Betreten der Route
gegriffen – nicht mehr bei jeder Navigation zwischen den drei
Unterseiten. Das wäre eine echte Verhaltensänderung gegenüber heute
gewesen (potenzielle Security-Regression, z. B. bei Session-Ablauf
während einer laufenden Beratung).

Drei Optionen wurden ChatGPT vorgelegt und entschieden:

- **Option A (gewählt):** Auth-/Session-Check bleibt dupliziert in allen
  drei `page.tsx`, `layout.tsx` übernimmt ausschließlich den UI-Rahmen.
- Option B (Middleware als zusätzliche Auth-Schicht) – abgelehnt: „Kein
  Architekturumbau nur zur Beseitigung von Duplikation, wenn das
  bestehende Verhalten sicher und korrekt ist.“
- Option C (Cache-Konfiguration erzwingen) – abgelehnt: nicht zuverlässig
  steuerbar, kein Cache-Trick als Security-Mechanismus.

Dieselbe Überlegung galt für `getConsultationSidebarData()`: auch dieses
Read-Model darf nicht aus dem Layout heraus aufgerufen werden. Zwei Wege
wurden entschieden – **Weg 1 (gewählt):** jede der drei `page.tsx` ruft
`getConsultationSidebarData(sessionId)` selbst auf und rendert
`<ConsultationSidebar>` selbst (dieselbe Funktion, aber dreifacher
Call-Site, analog der Auth-Entscheidung). Weg 2 (Next.js Parallel Routes,
`@sidebar`-Slot) wurde verworfen – neues, im Projekt bislang unbenutztes
Routing-Pattern, unverhältnismäßiger Mehraufwand für ein bewusst schlankes
Feature.

ChatGPTs verbindliches Leitprinzip: „Freshness und Security haben Vorrang
vor DRY. Die dreifache Ausführung des Sidebar-Read-Models ist gewollt.
Zentralisiert wird nur die UI, nicht deren Datenbeschaffung.“

## 6. Implementierung

- **`src/app/consultation/[sessionId]/layout.tsx`** (neu – das erste
  verschachtelte Layout im gesamten Repository): rein präsentational,
  kein Auth-Check, kein Datenbankzugriff. Übernimmt `ConsultationNav`
  (Navigation, ausschließlich aus dem `sessionId`-Routenparameter
  abgeleitet) plus `children`.
- **`getConsultationSidebarData(consultationSessionId, now = new Date())`**
  (neu in `src/server/consultation-ui/view-models.ts`): bündelt
  `loadConsultationSessionStatus()` und `buildGoalProgressForEmployee(now)`
  per `Promise.all`. Reine Komposition bestehender, bereits freigegebener
  Lesefunktionen – keine neue Fachlogik. Der optionale `now`-Parameter
  spiegelt das bestehende Muster von `buildGoalProgressForEmployee()` und
  macht die Funktion deterministisch testbar.
- **`ConsultationSidebar`/`ConsultationNav`** (neu,
  `src/components/consultation/`): reine Anzeige-Komponenten ohne eigene
  Datenbeschaffung.
- **CSS-Ergänzung** in `globals.css`: Desktop ≥1024px zeigt Hauptinhalt
  und Sidebar nebeneinander, darunter bleibt es einspaltig – analog dem
  bereits etablierten `.question-flow__body`-Muster (AP11/Phase 5).
- Alle drei `page.tsx` (Fragen/Empfehlung/Zusammenfassung) wurden
  entsprechend angepasst: Auth-Block unverändert, `getConsultationSidebarData()`
  zusätzlich innerhalb des bestehenden `withServerSessionTenantContext()`-
  Aufrufs geladen, `<ConsultationSidebar>` gerendert.

## 7. Angezeigte vs. explizit nicht angezeigte Daten

**Angezeigt:** Sitzungsstatus (Laufend/Abgeschlossen/Abgebrochen), eigene
aktuell periodenaktive Ziele (Metrik-Label, Ist-/Zielwert, Erfüllungsgrad)
über die bereits bestehende, `employeeId`-gescopte
`buildGoalProgressForEmployee()`.

**Nicht angezeigt (bewusst, strukturell garantiert):** Provisions-/
Margendaten und `businessPriorityScore`. Dies ist keine neue Regel dieser
Phase, sondern die bereits seit Phase 6 in `view-models.ts` dokumentierte,
projektweite Trennung zwischen Mitarbeiter- und Management-Sicht – die
Sidebar ruft strukturell keine der betroffenen Datenquellen ab, das
Risiko einer versehentlichen Anzeige besteht also nicht erst auf
UI-Ebene. Zusätzlich per Negativtest in der neuen E2E-Suite abgesichert
(`consultation-sidebar.spec.ts`).

## 8. RBAC / Tenant-Isolation

Keine neuen Permission-Keys nötig. Alle Datenquellen laufen bereits über
bestehende, freigegebene Lesepfade (`employeeId`-Scope für Goals,
tenant-gescopter `db`-Client für den Sitzungsstatus). Die bestehende,
unveränderte `tenant-isolation.spec.ts` deckt den Fremd-Tenant-/
Session-ID-Fall für die Hauptseite weiterhin ab; da Auth/Tenant-Kontext
durch AP1 unverändert blieb, entstand hier keine neue Angriffsfläche.

## 9. Tests

- **Neue Integrationstests** (`tests/integration/consultation-sidebar-data.test.ts`,
  4 Testfälle, echte Postgres-DB): leeres `activeGoals`-Array ohne
  eigenes Ziel; korrekt aufbereitetes einzelnes Ziel (Metrik/Ziel-/
  Ist-Wert/Erfüllungsgrad); mehrere gleichzeitig aktive Ziele mit
  unterschiedlichen Metriken (analog Phase-11-AP9-1); unbekannte
  Session-ID liefert `sessionStatus=null` ohne zu werfen. Jeder Testfall
  nutzt einen eigenen Employee, um Goal-Überschneidungen zwischen
  Testfällen auszuschließen; `now` wird explizit übergeben, um
  Kalendermonats-Abhängigkeit vom tatsächlichen CI-Laufzeitpunkt zu
  vermeiden.
- **Neue E2E-Suite** (`tests/e2e/consultation-sidebar.spec.ts`,
  Desktop Chromium + Tablet iPad Landscape, 4 Testfälle): Navigation
  zwischen allen drei Unterseiten; Sitzungsstatus „Laufend“ wird
  angezeigt; eigenes aktives Ziel wird angezeigt (inkl. Negativtest:
  keine Provisions-/Margendaten im Sidebar-DOM); dezenter Leerstand ohne
  aktives Ziel (Tenant B, kein Goal-Fixture).
- **Neues Seed-Fixture:** ein EMPLOYEE-Goal (Metrik `DEALS_CLOSED`,
  Periode `YEAR`, `periodStart = VALID_FROM`) für den Tenant-A-Mitarbeiter
  in `prisma/seed-e2e.ts` – Periode bewusst großzügig gewählt, damit das
  Ziel unabhängig vom genauen E2E-Laufzeitpunkt aktiv bleibt.
- **Korrektur gegenüber dem alten Task-Text (2026-08-03):** dieser nannte
  „Chromium+WebKit“ als Testumfang. Das seit AP12 (Phase 5/6) tatsächlich
  etablierte und in allen späteren Phasen (Rules, Commissions, Goals,
  Campaigns, Playbooks) verwendete Playwright-Setup ist Desktop Chromium
  - Tablet (iPad Landscape) – kein WebKit-Projekt vorhanden. Die neue
    Suite folgt dem etablierten, nicht dem veralteten Muster.
- **Keine Regression:** `tenant-isolation.spec.ts`, `happy-path.spec.ts`
  und `abandonment.spec.ts` blieben unverändert und laufen weiterhin
  gegen die (jetzt um Layout/Sidebar erweiterten) Consultation-Seiten.

## 10. Datei-Diff (gesamte Phase 15, `67d2f02..faf755e`)

```
 docs/PHASE_15_DISCOVERY.md                                       | 225 +++++++++
 prisma/seed-e2e.ts                                                |  29 ++
 src/app/consultation/[sessionId]/layout.tsx                       |  45 ++
 src/app/consultation/[sessionId]/page.tsx                         |  44 +-
 src/app/consultation/[sessionId]/recommendation/page.tsx          |  54 +-
 src/app/consultation/[sessionId]/summary/page.tsx                 |  39 +-
 src/app/globals.css                                                | 108 ++++
 src/components/consultation/ConsultationNav.tsx                    |  26 ++
 src/components/consultation/ConsultationSidebar.tsx                |  72 +++
 src/server/consultation-ui/view-models.ts                          |  78 +++-
 tests/e2e/consultation-sidebar.spec.ts                             |  86 ++++
 tests/integration/consultation-sidebar-data.test.ts                | 225 +++++++++
 12 files changed, 977 insertions(+), 54 deletions(-)
```

Keine Schema-/Migrationsänderungen, keine neuen Abhängigkeiten.

## 11. Bewusste Grenzen / explizit nicht umgesetzt

- Kein Playbook-Bezug in der Sidebar (Phase 14 bleibt architektonisch
  entkoppelt, wie in Phase 14 festgelegt).
- Keine KI-/Prompt-Funktionalität, keine Abhängigkeit von AP5c (Provider-
  PoC, weiterhin pausiert).
- Keine Campaign-Insights.
- Keine Provisions-/Margendaten in jeglicher Form.
- Keine neuen Permission-Keys, keine Änderungen an `evaluate()`/der
  Recommendation Engine.
- Keine Middleware-Einführung, keine Cache-Konfigurationsänderungen.

## 12. Fazit

Phase 15 hat das seit Phase 5 zurückgestellte Sidebar-Feature in
kleinstmöglichem, sicherem Zuschnitt umgesetzt: eine gemeinsame
Navigation und ein dediziertes, bewusst dreifach ausgeführtes
Sidebar-Read-Model, ohne das bestehende Auth-/Caching-Verhalten der
Consultation-Seiten zu verändern. Die im Verlauf entdeckte
Next.js-Layout-Freshness-Problematik wurde vor jeglicher Implementierung
mit ChatGPT geklärt und ist dokumentiert, damit sie bei künftigen
Layout-Entscheidungen im Projekt nicht erneut von Grund auf untersucht
werden muss. Beide Commits liefen in CI beim ersten Anlauf grün.
