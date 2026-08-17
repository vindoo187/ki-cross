# Beratungs-UI (Mitarbeiteroberfläche)

Dieses Dokument beschreibt den in Phase 5 (AP2–AP12) implementierten
Mitarbeiter-Arbeitsplatz für die Tarifberatung: Routen, Komponenten,
Zustandsmodell, Fehlerbehandlung, Responsive-/Tablet-Verhalten und
Testabdeckung. Es ist ein **As-built-Dokument** (beschreibt den tatsächlich
implementierten Stand), kein Planungsdokument — für die ursprüngliche
Entscheidungsgrundlage siehe `PHASE_5_IMPLEMENTATION_PLAN.md`.

Fachliche Grundlagen (Fragen-Engine, Empfehlungslogik) sind bereits in
[QUESTION_ENGINE.md](QUESTION_ENGINE.md) und
[RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md) beschrieben — dieses
Dokument behandelt ausschließlich die UI-Schicht darüber (`src/app/`,
`src/components/consultation/`, `src/components/auth/`) sowie die dünne
Adapter-Schicht `src/server/consultation-ui/` (View-Models, Vervollständigungs-
und Abbruch-Service), die diese UI mit den Engines verbindet.

## 1. Anmeldung (Dev-/Pilot-Login)

Route `/login` (`src/app/login/page.tsx` + `src/components/auth/DevLoginButton.tsx`).
Passwortlose Auswahl aus vorab geseedeten, synthetischen Mitarbeiter-
Datensätzen (`listDevLoginCandidates()`), ein Klick sendet die gewählte
`employeeId` an `POST /api/auth/dev-login`.

**Ausdrücklich nicht produktionsreif** — dies ist bewusst so dokumentiert
(Kommentar in `route.ts`, `.env.example`, `PHASE_5_IMPLEMENTATION_PLAN.md`
Abschnitt 15 Stop-Punkt 1, von ChatGPT am 2026-08-02 bestätigt) und gilt
ausschließlich für den internen Pilotbetrieb mit synthetischen Testdaten.
Es gibt keinen Passwortmechanismus, keine Kontosperrung und keine
Produktions-Session-Härtung.

## 2. Routenübersicht

| Route                                      | Zweck                                                                                                   | Server/Client                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/login`                                   | Dev-Login                                                                                               | Server Component + Client-Button                            |
| `/consultation`                            | Einstieg: neue Beratung starten oder laufende fortsetzen                                                | Server Component                                            |
| `/consultation/[sessionId]`                | Fragebogen-Arbeitsplatz                                                                                 | Server Component lädt, `QuestionFlow` (Client) orchestriert |
| `/consultation/[sessionId]/recommendation` | Empfehlung, Begründung, Annehmen/Ablehnen, Cross-Selling                                                | Server Component                                            |
| `/consultation/[sessionId]/summary`        | Zusammenfassung, Beratung abschließen                                                                   | Server Component                                            |
| `/review`                                  | Technische Prüfansicht der Seed-Daten (kein Endnutzer-Feature, Dev/Test-only, siehe `review-access.ts`) | Server Component                                            |

Alle vier Beratungsrouten sind Next.js Server Components mit
`export const dynamic = "force-dynamic"` (kein statisches Prerendering,
da jede Seite den authentifizierten Mandanten-/Sitzungskontext benötigt).
Jede prüft zunächst `getOptionalServerSession()` und leitet ohne gültige
Session zu `/login` um. Ein `ConsultationSessionNotFoundError` (fremder
Mandant oder falsche `sessionId`) wird bewusst **nicht** von einer eigenen
Fehlerseite abgefangen — Next.js' eingebaute Fehlerbehandlung genügt für
diesen internen Pilotbetrieb (Plan Abschnitt 15). Der negative
Tenant-Isolationstest (`tests/e2e/tenant-isolation.spec.ts`) prüft dies
generisch über eine fehlgeschlagene HTTP-Antwort, ohne einen konkreten
Statuscode anzunehmen.

## 3. Fragebogen-Arbeitsplatz (`/consultation/[sessionId]`, AP4)

Kernkomponente `QuestionFlow.tsx` (Client Component), orchestriert genau
eine aktive Frage zur Zeit plus eine `QuestionNavigator`-Seitenleiste zum
Springen zwischen sichtbaren Fragen (auch bereits beantworteten — Ändern
läuft dann über denselben Commit-Pfad).

### Zustandsmaschine

`QuestionFlow` führt einen `useReducer` mit folgenden Phasen:
`ready`, `dirty`, `saving`, `saved`, `validationError`, `versionConflict`,
`networkError`, sowie zwei Ergänzungen für den Abschluss-Schritt:
`completing`, `sessionCompleted`. `pathComplete` ist bewusst **kein**
eigener Phasen-Wert, sondern wird laufend aus
`questionnaire.progress.canComplete` abgeleitet (kann parallel zu jeder
anderen Phase gelten).

Kernprinzip: nach jedem erfolgreichen Speichern übernimmt der Client den
vom Server zurückgegebenen, autoritativen `QuestionnaireState` (inklusive
neu berechneter `hiddenQuestionIds`-Wirkung) — es wird nie clientseitig
angenommen, welche Fragen als Nächstes sichtbar sind.

Fehlerfälle werden unterschiedlich behandelt:

- **422 (Validierungsfehler)** → `validationError`, Liste der Probleme wird
  direkt unter der Frage angezeigt (`role="alert"`).
- **409 (`StaleAnswerVersionError`, Parallelbearbeitung z. B. Zweitgerät)**
  → `versionConflict`, `ConflictBanner` mit explizitem "Aktuellen Stand neu
  laden"-Button. Kein automatisches Zusammenführen.
- **Netzwerkfehler** → `networkError`, `OfflineBanner` mit manuellem Retry
  (kein automatischer Retry-Loop).

### Eingabekomponenten

`QuestionRenderer.tsx` dispatcht anhand `answerType` (erschöpfende
`switch`-Prüfung, neuer `AnswerType` fällt zur Compile-Zeit auf) auf sieben
Unterkomponenten in `QuestionInputs.tsx`: `SingleChoiceInput`,
`MultipleChoiceInput`, `BooleanInput`, `IntegerInput`, `DecimalInput`,
`ShortTextInput`, `DateInput`. Diskrete Eingaben (Single/Multiple/Boolean/
Date) speichern sofort bei jeder Änderung; Freitext-/Zahlenfelder debouncen
lokal (~1.000 ms, Fix 8/AP15-Vorbereitung, ursprünglich 500 ms) und lösen
`onLocalEdit` (für den `dirty`-Zustand) bereits vor dem Debounce aus. Die
Komponenten validieren bewusst nur einfache
Eingabe-Constraints (`type="number"`, `maxLength`, …) — fachliche Prüfung
(min/max, Pflichtfeld) bleibt serverseitig (`answer-validation.ts`).

### Abschluss

Sobald `progress.canComplete === true`, erscheint ein Abschluss-Banner mit
Button; `POST /api/consultation/sessions/[id]/complete` liefert
`CompleteQuestionnaireResult`, danach Phase `sessionCompleted` mit direkten
Links zu Zusammenfassung, Empfehlung oder Übersicht.

### Fokus-Management (AP11)

Nach jedem erfolgreichen Speichern wandert der Fokus kontrolliert zur
Überschrift der aktiven Frage (`activeQuestionHeadingRef`, `tabIndex={-1}`)
— weder bleibt er auf einem ggf. nicht mehr sichtbaren Feld hängen, noch
springt er unkontrolliert zum Seitenanfang.

### Ungespeicherte Änderungen

Im `dirty`-Zustand registriert `QuestionFlow` einen `beforeunload`-Handler,
der den Browser-Standarddialog auslöst (kein eigener Dialogtext möglich).

## 4. Empfehlung und Begründung (`/consultation/[sessionId]/recommendation`, AP6/AP7)

Lädt `getLatestRecommendation()` (reiner Lesezugriff, funktioniert auch für
bereits `COMPLETED`-Sessions) und baut daraus `ConsultationRecommendationView`
über `buildConsultationRecommendationView()`. Existiert noch keine
Empfehlung, zeigt die Seite `EvaluateRecommendationButton` (löst
`POST /api/consultation/sessions/[id]/recommendation` aus, danach
`router.refresh()`) statt eines leeren Zustands.

`RecommendationList`/`RecommendationCard` zeigen bewusst **weder**
`businessPriorityScore` **noch** Provisions-/Margendaten — nur Preis,
Laufzeit, Attribute, Eignungskategorie (`customerFitLabel`) und Rang.

**Begründung (`RationaleDrawer`)**: aufklappbares Accordion (kein Modal),
zeigt `positiveEligibilityReasons` und `unmetSoftEligibilityCriteria`. Auf
Tablet-Portrait (<768 px, AP11) wird dasselbe Markup per CSS zu einem
fixierten Bottom-Sheet mit Scrim (schließt per Klick auf das Scrim oder
Escape-Taste) — auf Desktop/Tablet-Landscape bleibt das Scrim unsichtbar.

**Annehmen/Ablehnen/Zurückstellen (`OutcomeDialog`)**: eingebettetes,
nicht-modales Panel (bewusst kein `<dialog>`, damit die übrigen
Empfehlungskarten nicht verdeckt werden). Jedes `RecommendationItem` kann
genau einmal entschieden werden (`RecommendationOutcome` ist append-only);
existiert bereits ein Outcome, zeigt die Komponente nur noch den
gespeicherten Stand. Ablehnung erfordert die Auswahl eines mandanten-
gepflegten Ablehnungsgrunds aus fester Liste (kein Freitext — bewusste
Schema-Entscheidung aus AP5). Ein 409
(`RecommendationOutcomeAlreadyExistsError`, z. B. Doppelklick) wird nicht
als technischer Fehler angezeigt, sondern löst `router.refresh()` aus, um
den kanonischen Stand zu laden.

**"Angaben ändern"**: Link zurück in den Fragenfluss, nur sichtbar solange
`sessionStatus === "IN_PROGRESS"` — nach Abschluss bedeutet eine Änderung
organisatorisch eine neue Beratung, kein Wiederöffnen der Sitzung (Plan
Abschnitt 8, Stop-Punkt 2).

## 5. Cross-Selling (AP8)

`CrossSellingBanner` (rendert nichts, wenn keine Signale vorliegen — kein
Cross-Selling-Signal ist der häufige Regelfall) listet
`OpportunityCard`-Einträge aus `RecommendationResult.crossSellingSignals`.
Jede Karte zeigt Bedarf (`needLabel`), Begründung (`reasonText`),
optional das vorgeschlagene Produkt, sowie den `SalesOpportunity`-Status
mit Aktionsbuttons passend zum aktuellen Status (`OPEN` → Anbieten,
`OFFERED` → Angenommen/Abgelehnt/Zurückstellen, `DEFERRED` → Erneut
anbieten). Statusänderung über
`PATCH /api/consultation/sales-opportunities/[id]`; die angezeigten
Buttons spiegeln nur die Präsentationsschicht der serverseitig in
`opportunity-status.ts` durchgesetzten `ALLOWED_TRANSITIONS` — ein
veralteter, in einem anderen Tab bereits weiterbewegter Status führt zu
`InvalidOpportunityStatusTransitionError`, nicht zu stillschweigendem
Überschreiben.

## 6. Zusammenfassung und Abschluss (`/consultation/[sessionId]/summary`, AP9/AP10)

`SessionSummaryView` ist ein reiner Anzeige-Wrapper um das bereits
server-seitig komponierte `ConsultationSessionSummaryView`
(`buildConsultationSessionSummaryView()`): beantwortete Fragen (formatiert,
`formattedValue`) sowie Empfehlung/Cross-Selling über dieselben
Komponenten wie auf der Empfehlungsseite (Annehmen/Ablehnen bleibt auch
hier nutzbar, unabhängig vom Sitzungsstatus). Funktioniert unverändert für
noch `IN_PROGRESS`-Sitzungen — kein Abschluss-Gate, reine
Lesekomposition.

**Beratung abschließen (`CompleteConsultationButton`)**: löst
`POST /api/consultation/sessions/[id]/summary/complete` aus
(`completeConsultation()`, idempotent — ein zweiter Klick schreibt kein
zweites `CONSULTATION_COMPLETED`-Analytics-Event) und navigiert danach zur
Übersicht.

## 7. Manueller Abbruch (AP10, `AbandonConsultationButton`)

Verfügbar sowohl im Fragebogen-Arbeitsplatz als auch auf der Empfehlungs-
und Zusammenfassungsseite, jeweils nur solange die Sitzung
`IN_PROGRESS` ist. Zweistufig: erster Klick öffnet ein Bestätigungspanel
(eingebettet, kein Modal) mit optionalem, strukturiertem Abbruchgrund
(Radiobuttons: "Kunde möchte nicht fortfahren", "Kunde hat keine Zeit",
"Technischer Abbruch", "Sonstiger Grund" — kein Freitext, Auswahl ist
nicht verpflichtend); erst der zweite Klick auf "Abbruch bestätigen" sendet
`POST /api/consultation/sessions/[id]/summary/abandon`
(`abandonConsultation()`, schreibt `CONSULTATION_ABANDONED`). Ein 409
(`ConsultationAlreadyCompletedError`, z. B. weil die Sitzung
zwischenzeitlich abgeschlossen wurde) wird als fachliche Meldung
dargestellt. Nach Erfolg (auch im idempotenten
`alreadyAbandoned: true`-Fall) navigiert die UI zur Übersicht.

## 8. Fehlerbehandlung

Zwei Ebenen, bewusst getrennt:

1. **Bekannte Fachfehler** (`ConsultationSessionNotFoundError`,
   `StaleAnswerVersionError`, `InvalidAnswerError`,
   `RecommendationOutcomeAlreadyExistsError`,
   `InvalidOpportunityStatusTransitionError`,
   `ConsultationAlreadyCompletedError`, …) werden serverseitig in
   `http-errors.ts` auf HTTP-Statuscodes gemappt und clientseitig pro
   Komponente behandelt (siehe oben) — kein generischer Fehlertext.
2. **Unerwartete Rendering-/Laufzeitfehler** im Fragebogen-Arbeitsplatz
   werden von `ErrorBoundary.tsx` (React-Klassenkomponente, da Error
   Boundaries keine Hook-Variante unterstützen) abgefangen: zeigt einen
   "Seite neu laden"-Hinweis, protokolliert per `console.error` (bewusst
   kein Analytics-Kernereignis dafür), Antworten gehen dabei nicht
   verloren.

## 9. Responsive-/Tablet-Verhalten (AP11)

Drei Breakpoint-Stufen in `src/app/globals.css`: Mobile/Tablet-Portrait
(<768 px), Tablet-Landscape (768–1023 px) und Desktop (≥1024 px). Auf
Tablet-Landscape bleibt die Fragenfluss-Ansicht wie im Mobile-Layout
einspaltig (Navigator über der aktiven Frage), bekommt aber großzügigere
Abstände; erst ab Desktop (≥1024 px) stehen Navigator und aktive Frage
nebeneinander. Alle interaktiven Ziele (Buttons, Radio-/Checkbox-Labels)
sind auf mindestens 44×44 px Touch-Fläche ausgelegt. Lange Produktnamen/
Attributwerte brechen kontrolliert um (`overflow-wrap: anywhere`,
`hyphens: auto`) statt Layout zu sprengen.

## 10. Testabdeckung

**Komponententests** (Vitest + jsdom + Testing Library, AP12a–c,
`vitest.config.component.ts`): 18 Testdateien, 92 Tests, decken u. a.
`QuestionFlow`, `ProgressBar`, `StatusBanners`, `RationaleDrawer`,
`RecommendationCard`, `SessionSummaryView`, `StartConsultationForm` und
`OpportunityCard` ab.

**End-to-End-Tests** (Playwright, AP12d, `tests/e2e/`): vier Spezifikationen
gegen reproduzierbare, tenant-isolierte Seed-Daten
(`prisma/seed-e2e.ts`/`seed-output.ts`), Desktop- und Tablet-Projekt
(`playwright.config.ts`), Selektoren ausschließlich über Rollen/Labels
(kein CSS-/Textpositions-Selektor), keine festen Wartezeiten:

- `happy-path.spec.ts` — vollständiger Durchlauf Start → Fragen →
  Pfadänderung → Empfehlung → Begründung → Cross-Selling →
  Änderung/Ablehnung → Zusammenfassung → Abschluss.
- `abandonment.spec.ts` — separater Abbruchfall (Start → eine Frage
  beantworten → "Beratung abbrechen" → Grund wählen → "Abbruch
  bestätigen" → Rückkehr zur Übersicht).
- `customer-situations.spec.ts` — drei fachlich unterschiedliche
  Kundensituationen mit nachweislich unterschiedlicher, über die
  Fragen-Navigation geprüfter Fragenmenge.
- `tenant-isolation.spec.ts` — negativer Zugriffstest: ein bei Tenant A
  angemeldeter Mitarbeiter kann nicht auf eine Tenant-B-Session zugreifen
  (generische Prüfung auf fehlgeschlagene Antwort + fehlenden
  Fragebogen-Inhalt, kein angenommener Statuscode).

**Wichtige Einschränkung (Stand 2026-08-03, siehe
`docs/IMPLEMENTATION_STATUS.md`):** Playwright-Tests sind vollständig
implementiert und lokal statisch verifiziert (ESLint, Prettier, `tsc
--noEmit`), aber technisch erst ab AP14 in GitHub Actions tatsächlich
ausführbar (der zusammenhängende CI-Job mit Postgres-Service,
Next-Build und Playwright-Browser existiert erst nach dem
Phase-5-Commit/Push in AP14). Bis zum ersten grünen CI-Lauf gilt die
E2E-Stufe als "implementiert, lokal nicht ausführbar, CI-Verifikation
ausstehend" — nicht als "getestet" oder "erfolgreich".

## 11. Bekannte Einschränkungen / bewusst nicht umgesetzt

- Dev-Login (`/login`) ist ausdrücklich nicht produktionsreif (siehe
  Abschnitt 1).
- `/review` ist ein rein technisches Entwicklungswerkzeug, kein
  Endnutzer-Feature, und ist auf Nicht-Produktionsumgebungen beschränkt.
- `OutcomeDialog`/`AbandonConsultationButton` bieten bewusst kein
  Freitextfeld für Ablehnungs-/Abbruchgründe — nur mandantengepflegte bzw.
  feste Grundlisten (Schema-Entscheidung aus AP5/AP10).
- Nach Abschluss einer Beratung ist kein Wiederöffnen derselben Sitzung
  vorgesehen; eine gewünschte Änderung bedeutet organisatorisch eine neue
  Beratung (Plan Abschnitt 8, Stop-Punkt 2).

## 12. Relevante Dateien

```
src/app/login/page.tsx
src/app/consultation/page.tsx
src/app/consultation/[sessionId]/page.tsx
src/app/consultation/[sessionId]/recommendation/page.tsx
src/app/consultation/[sessionId]/summary/page.tsx
src/app/review/page.tsx

src/components/auth/DevLoginButton.tsx
src/components/consultation/QuestionFlow.tsx
src/components/consultation/QuestionRenderer.tsx
src/components/consultation/QuestionInputs.tsx
src/components/consultation/QuestionNavigator.tsx
src/components/consultation/ProgressBar.tsx
src/components/consultation/StatusBanners.tsx
src/components/consultation/ErrorBoundary.tsx
src/components/consultation/StartConsultationForm.tsx
src/components/consultation/RecommendationList.tsx
src/components/consultation/RecommendationCard.tsx
src/components/consultation/RationaleDrawer.tsx
src/components/consultation/OutcomeDialog.tsx
src/components/consultation/EvaluateRecommendationButton.tsx
src/components/consultation/CrossSellingBanner.tsx
src/components/consultation/OpportunityCard.tsx
src/components/consultation/SessionSummaryView.tsx
src/components/consultation/CompleteConsultationButton.tsx
src/components/consultation/AbandonConsultationButton.tsx

src/server/consultation-ui/view-models.ts
src/server/consultation-ui/completion.ts
src/server/consultation-ui/abandonment.ts

tests/component/*.test.tsx (18 Dateien, 92 Tests)
tests/e2e/happy-path.spec.ts
tests/e2e/abandonment.spec.ts
tests/e2e/customer-situations.spec.ts
tests/e2e/tenant-isolation.spec.ts
```

Siehe auch [ARCHITECTURE.md](ARCHITECTURE.md) (Tech-Stack),
[QUESTION_ENGINE.md](QUESTION_ENGINE.md) und
[RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md) (Fachlogik),
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) (laufender
Verifikationsstatus je Phase).
