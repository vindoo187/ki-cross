# IMPLEMENTIERUNGSPLAN – PHASE 5: MITARBEITER-UI (MVP-QUALITÄT)

_Erstellt gemäß `PHASE_5_STARTPROMPT.md`. Enthält noch keinen Anwendungscode._

**Update (2026-08-02):** ChatGPT (Projektleiter) hat alle vier Stop-Punkte aus Abschnitt 15 mit den in diesem Plan vorgeschlagenen Lösungen bestätigt (Dev-Login minimal, "Ändern" nur während `IN_PROGRESS`, `SalesOpportunity`-Statusfrage wie vorgeschlagen, Sichtbarkeit von Score/Priorität gemäß Vorschlag in Abschnitt 7). Der Plan hat damit das Projektleiter-GO. Es fehlt weiterhin das separate, explizite Implementierungs-GO des Nutzers (siehe Abschnitt 19), bevor mit AP1 aus Abschnitt 16 begonnen wird.

## 0. Bestätigter Ausgangsstand

- Branch `main`, HEAD `69e754e` — per `git log --oneline -1` bestätigt, stimmt mit `PHASE_5_STARTPROMPT.md` Abschnitt 0 überein.
- `git status --short` zeigt ausschließlich zwei unveränderte, bereits bekannte Alt-Stände: `PHASE_5_STARTPROMPT.md` (untracked, gehört zu dieser Phase) und `_rmtest.txt` (bekannte harmlose Altlast, siehe `docs/IMPLEMENTATION_STATUS.md` und `docs/LOCAL_DEVELOPMENT.md`, Abschnitt "Bekannte, harmlose Altlasten"). Keine unerwarteten, nicht zu Phase 5 gehörenden Änderungen vorhanden — es gibt nichts, das versehentlich überschrieben werden könnte.
- Phase 3A (Fragen-Engine) und Phase 3B (Empfehlungs-Engine) sind laut `docs/IMPLEMENTATION_STATUS.md` und beiden Abschlussberichten abgeschlossen und von ChatGPT final freigegeben (CI-Lauf #20 grün). Die Abhängigkeiten von Phase 5 gemäß `docs/IMPLEMENTATION_PLAN.md` sind damit erfüllt.

## 1. Analyse der vorhandenen Architektur

### 1.1 Frontend

`src/app/` enthält aktuell ausschließlich: `layout.tsx` (minimales Root-Layout, deutsches `lang`-Attribut), `page.tsx` (Platzhalter-Startseite, die explizit erklärt, dass dies "ausschließlich das technische Projektgerüst" ist), `globals.css` (kein CSS-Framework, keine Utility-Klassen — handgeschriebene Basisstile für Text/Tabellen), `review/page.tsx` (206 Zeilen, technische Dev/Test-Prüfansicht der Seed-Daten, per `isReviewPageEnabled()` auf `development`/`test`-`NODE_ENV` beschränkt, **kein** Endnutzer-Feature) und `api/health/route.ts` (trivialer Health-Check).

Es existiert **keine einzige** Mitarbeiter-facing Seite. Phase 5 baut die komplette Oberfläche neu auf. `package.json` bestätigt: kein UI-Komponenten-Framework, kein CSS-Framework (kein Tailwind, kein Styled-Components etc.), kein State-Management (kein Redux/Zustand/Jotai/TanStack Query). Next.js `^15.5.22` mit React `^19.2.8` (App Router, Server Components standardmäßig verfügbar).

### 1.2 API

`src/app/api/health/route.ts` ist die **einzige** existierende Route. Es gibt keine API-Schicht für Fragebogen- oder Empfehlungs-Operationen. Beide Engines (`src/server/questionnaire/service.ts`, `src/server/recommendation/service.ts`) werden bisher ausschließlich als TypeScript-Funktionen direkt aus Integrationstests aufgerufen — nie über HTTP.

### 1.3 Auth/Rollen

**Zentraler Befund:** Es existiert **kein** Authentifizierungssystem — kein Login, keine Session-/Token-Ausstellung, keine Middleware, die eine `TenantContext` aus einem echten Request befüllt. `src/server/tenant/context.ts` definiert `TenantContext { tenantId, userId, employeeId?, roles[] }` über `AsyncLocalStorage`, aber `runWithTenantContext()` wird aktuell ausschließlich manuell in Tests aufgerufen (siehe `tests/`). `ROLES_AND_PERMISSIONS.md` beschreibt ein RBAC-Modell rein konzeptionell — nicht implementiert.

Das Datenmodell ist für Auth bereits vorbereitet: `User` (tenant-gebunden, `email`, **kein Passwort-/Credential-Feld**, `isSynthetic`-Flag), `Employee` (verknüpft `User` optional mit `Store` und Anzeigename), `Role`/`Permission`/`RolePermission`/`RoleAssignment` (Scope `TENANT`/`COMPANY`/`STORE`, siehe `prisma/schema.prisma` Kommentar zu Scope-Integrität). Die Tabellen sind also vollständig da — nur der Laufzeit-Mechanismus (Login → Session → `TenantContext`-Befüllung) fehlt komplett.

**Wichtiger Fund, der über den Wortlaut des Startprompts hinausgeht:** `.env.example` enthält bereits `DEV_AUTH_SECRET="change-me-in-local-env-only"` mit Kommentar _"Platzhalter fuer Entwicklungs-Authentifizierung ... NICHT produktionsreif. Kein oeffentliches Deployment mit Mock-Auth."_ Dieselbe Variable ist in `.github/workflows/ci.yml` als `DEV_AUTH_SECRET: "ci-only-placeholder-secret"` gesetzt. **Diese Variable wird aktuell nirgends im Code (`src/`) gelesen oder verwendet** — sie ist ein bereits dokumentiertes, aber noch nicht eingelöstes Vorhaben aus einer früheren Phase. Das ist eine Doku-Code-Divergenz im Sinne von Abschnitt 8 des Startprompts: die Absicht ("es soll einen einfachen Dev-Auth-Mechanismus geben") ist dokumentiert, die Umsetzung fehlt vollständig. Siehe Abschnitt 15 (Stop-Punkte) für die daraus abgeleitete Empfehlung.

### 1.4 Tenant-Isolation

Zwei unabhängige Schichten (siehe `docs/DECISION_LOG.md`): (1) DB-seitige composite Foreign Keys `(tenant_id, x_id) → (tenant_id, id)` als primäre Schranke, (2) `withTenantScope()` Prisma-Client-Extension (`src/server/tenant/scoped-client.ts`) als Defense-in-Depth, gespeist aus derselben `TenantContext`. Beide Schichten sind bereits vollständig implementiert und getestet — sie benötigen nur eine korrekt befüllte `TenantContext`, um zu greifen. Phase 5 ändert an dieser Schicht nichts, sondern muss sie korrekt aufrufen (`runWithTenantContext()` pro Request).

### 1.5 Test-/CI-/Styling-Konfiguration

- **Vitest** (`vitest.config.ts`): `environment: "node"`, `globals: false`, Tests unter `tests/**/*.test.ts`, Coverage-Provider `v8` auf `src/server/**/*.ts` beschränkt — **kein** Component-Testing-Setup (kein `jsdom`/`happy-dom`-Environment, kein React-Testing-Library in `devDependencies`).
- **E2E:** kein Framework installiert (kein Playwright, kein Cypress in `package.json`).
- **CI** (`.github/workflows/ci.yml`): `npm ci` → `prisma generate` → `prisma migrate deploy` (gegen echten Postgres-16-Service-Container) → `lint` → `format --check` → `typecheck` → `test:unit` → `test:integration` → `build`. Läuft nur auf `push`/`pull_request` gegen `main`.
- **Lint/Format:** ESLint Flat Config (`eslint.config.mjs`) auf Basis `next/core-web-vitals` + `next/typescript`, `no-unused-vars` mit `^_`-Ausnahme. Prettier `3.4.2` (Default-Konfiguration, keine sichtbare `.prettierrc`-Anpassung außer Scripts in `package.json`).
- **Styling:** reines CSS über `globals.css`, kein Framework, keine Design-Tokens, keine Komponentenbibliothek. `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, Pfad-Alias `@/* → ./src/*`.

## 2. Vorhandene und fehlende Schnittstellen

### 2.1 Vorhanden (öffentliche Service-Funktionen, direkt wiederverwendbar)

**Fragen-Engine** (`src/server/questionnaire/service.ts`): `startQuestionnaire(input)`, `loadQuestionnaireState(consultationSessionId)`, `saveAnswer(input)` (nur Erstantwort), `changeAnswer(input)` (CAS über `expectedAnswerVersion`), `recalculateVisiblePath(...)`, `getProgress(consultationSessionId)`, `completeQuestionnaire(consultationSessionId)`, `validateQuestionnaireVersion(...)` (Admin-Funktion, für Phase 5 irrelevant), `assertQuestionnaireVersionIsEditable(...)` (intern).

**Empfehlungs-Engine** (`src/server/recommendation/service.ts`): `evaluate(consultationSessionId)` (neue, idempotente Auswertung inkl. `SalesOpportunity`-Erzeugung aus Cross-Selling-Signalen), `getLatestRecommendation(consultationSessionId)` (reiner Lesezugriff, funktioniert auch für `COMPLETED`-Sessions).

Beide Engines liefern bereits saubere, DB-unabhängige DTOs (`QuestionnaireState`, `QuestionForAnswering`, `AnswerWriteResult`, `RecommendationResult`, `RecommendationItemResult`, `RecommendationCrossSellingSignalResult`) — genau die "Read-Models", die Abschnitt 4.1 des Startprompts verlangt. Diese DTOs müssen nicht neu erfunden werden, nur über HTTP transportiert werden.

### 2.2 Fehlend (müssen als dünne Ergänzung entstehen — keine neue Fachlogik)

1. **HTTP-API-Schicht vollständig.** Es gibt keine einzige Route für Fragebogen-/Empfehlungsoperationen. Muss als Next.js Route Handlers unter `src/app/api/consultation/...` ergänzt werden, die 1:1 die bestehenden Service-Funktionen aufrufen, Eingaben mit Zod validieren und `TenantContext` aus der (noch zu bauenden) Auth-Schicht befüllen. Enthält **keine** neue fachliche Logik, nur Transport/Validierung/Fehler-Mapping.
2. **Auth-/Session-Schicht.** Kein Login, keine Session. Muss neu entstehen (siehe Abschnitt 15, Stop-Punkt).
3. **`recordRecommendationOutcome()`-Äquivalent.** `RecommendationOutcome` existiert als Prisma-Modell (`outcome: ACCEPTED|REJECTED|DEFERRED`, `rejectionReasonId`, `decidedByEmployeeId`, `decidedAt`, `@@unique([tenantId, recommendationItemId])` — pro `RecommendationItem` genau ein Outcome, append-only-Trigger aktiv) und `RejectionReason` als gepflegte Lookup-Tabelle (`key`, `label`, `isActive`) — **aber keine einzige Zeile Service-Code schreibt oder liest diese Tabellen**. Muss neu ergänzt werden: eine Funktion, die ein Outcome für ein `RecommendationItem` anlegt, die Unique-Constraint-Verletzung (bereits entschiedenes Item) in einen sprechenden Fehler übersetzt, und das passende Analytics-Ereignis schreibt.
4. **`updateSalesOpportunityStatus()`-Äquivalent.** `SalesOpportunity.status` (`OPEN|OFFERED|ACCEPTED|DECLINED|DEFERRED`) ist mutabel per Design, aber es existiert nur `createSalesOpportunitiesForSignals()` (intern, nur beim `evaluate()`-Schreibpfad aufgerufen). Keine Funktion aktualisiert den Status. Muss neu ergänzt werden: tenant-gescopte Statusaktualisierung mit Erlaubte-Übergänge-Prüfung (z. B. kein Sprung von `DECLINED` zurück zu `OPEN` ohne fachliche Klärung — als offene Frage an ChatGPT, siehe Abschnitt 15).
5. **Session-Zusammenfassung.** Kein dediziertes Service-Read-Model für "abschließende Beratungszusammenfassung" (Punkt 10 in Startprompt Abschnitt 1). Kann laut Ist-Analyse als reine **Komposition** aus bereits vorhandenen Daten gebaut werden — `loadQuestionnaireState()` (Status `COMPLETED`, alle Antworten) + `getLatestRecommendation()` (Empfehlungsstand) + neu zu lesende `RecommendationOutcome`-Zeilen + `SalesOpportunity`-Liste der Session. Keine neue Fachlogik, nur ein zusammenfassender Adapter/View-Model auf Server-Seite.
6. **Employee-/Store-Auswahl für `startQuestionnaire()`.** `StartQuestionnaireInput` verlangt `storeId`, `employeeId`, `questionnaireKey`. Aktuell gibt es keinen Lesezugriff, der einem eingeloggten Mitarbeiter "seine" `storeId`/`employeeId` oder die Liste verfügbarer `questionnaireKey`-Werte liefert. Muss ergänzt werden — trivial, sobald die Auth-Schicht steht (Werte kommen direkt aus der Session).

### 2.3 Bewusst nicht ergänzt

Kein Deal-Abschluss/`Deal`-Erzeugung: Startprompt Abschnitt 1 verlangt nur "Empfehlung ablehnen oder Beratung ändern" und "abschließende Zusammenfassung", nicht das Anlegen eines `Deal`-Datensatzes. Passend dazu existiert im `AnalyticsEventType`-Enum (siehe Abschnitt 10) **keine** `DEAL_CLOSED`-Entsprechung — das im Dokument `ANALYTICS_AND_KPIS.md` genannte Kernereignis `deal_closed` hat aktuell keinen Code-Gegenpart. Das ist eine reale Lücke, aber außerhalb des Phase-5-Auftrags (siehe Abschnitt 6 des Startprompts: "keine Erweiterung über den Mitarbeiter-MVP hinaus") — wird in Abschnitt 15 als dokumentierte, bewusst nicht behobene Divergenz festgehalten.

## 3. Empfohlener Seiten- und Komponentenaufbau

Neuer Ordner `src/app/consultation/` (Next.js App Router, Server Components für Daten-Shell, Client Components für interaktive Teile):

- `src/app/consultation/page.tsx` — Einstieg: neue Beratung starten (Fragebogen-Auswahl, sofern mehr als einer aktiv ist) oder laufende Sitzung fortsetzen.
- `src/app/consultation/[sessionId]/page.tsx` — Haupt-Beratungsarbeitsplatz: aktuelle Frage/Fragengruppe, Fortschrittsanzeige, Navigation zu bereits beantworteten Fragen.
- `src/app/consultation/[sessionId]/recommendation/page.tsx` — Empfehlungsübersicht nach `evaluate()`.
- `src/app/consultation/[sessionId]/summary/page.tsx` — Abschließende Zusammenfassung nach `completeQuestionnaire()`.
- `src/app/login/page.tsx` — Minimaler Dev-Login (siehe Abschnitt 15, nur wenn Auth-Stop-Punkt freigegeben wird).

Komponenten unter `src/components/consultation/` (rein clientseitig, keine eigene Fachlogik):

- `QuestionRenderer` (dispatcht je `answerType` auf sieben Unterkomponenten: `SingleChoiceInput`, `MultipleChoiceInput`, `BooleanInput`, `IntegerInput`, `DecimalInput`, `ShortTextInput`, `DateInput` — jede kapselt Eingabe + Validierungsanzeige + Tastatur-/Touch-Bedienung),
- `ProgressBar` (aus `QuestionnaireProgress`),
- `QuestionNavigator` (Liste bereits beantworteter Fragen, Sprung zurück),
- `RecommendationList` / `RecommendationCard` (Rang, Produktname, Preis, Fit-Zusammenfassung, nächster Schritt),
- `RationaleDrawer` (aufklappbarer Bereich/Drawer, siehe Abschnitt 7),
- `CrossSellingBanner` / `OpportunityCard`,
- `OutcomeDialog` (Ablehnungsgrund-Auswahl),
- `SessionSummaryView`,
- gemeinsame Statuskomponenten: `SavingIndicator`, `ConflictBanner`, `OfflineBanner`, `ErrorBoundary`-Wrapper.

Serverseitig, außerhalb von `src/app`: `src/server/consultation-ui/` als neue, dünne Adapter-Schicht (View-Models, Analytics-Mapping-Tabelle, Outcome-/Opportunity-Statusfunktionen) — bewusst getrennt von `src/server/questionnaire/` und `src/server/recommendation/`, um Abschnitt 4.1 des Startprompts einzuhalten ("keine zweite Fachlogik aufbauen"): dieser Ordner enthält **ausschließlich** Komposition/Übersetzung, keine Regeln.

## 4. State-Management-Entscheidung

**Entscheidung:** kein neuer globaler State-Manager. Begründung: der vorhandene Stack (Next.js App Router mit Server Components + `fetch` gegen die neuen Route Handlers) deckt den Ablauf ohne Redux/Zustand/TanStack Query sauber ab, weil (a) der maßgebliche Zustand (Sitzung, Antworten, Empfehlung) ohnehin serverseitig persistiert ist und bei jeder relevanten Aktion neu vom Server geladen wird, (b) die Seitenzahl klein und die Navigation linear ist, (c) eine zusätzliche Abhängigkeit gegen Abschnitt 6 des Startprompts ("kein allgemeines Design-System-Rewrite") und den Minimalismus-Grundsatz verstieße.

Stattdessen: pro interaktiver Client-Komponente ein lokal typisierter `useReducer` für den Fragebogen-Arbeitsplatz (siehe Abschnitt 6 für die genauen Zustände), `fetch`-Aufrufe gegen die neuen Route Handlers, React `Suspense`/Server Components für den initialen Ladezustand. Keine parallele Schattenkopie der vollständigen Beratungssitzung im Browser — der Reducer hält nur: aktuell angezeigte Frage(n), lokale Eingabewerte vor dem Speichern, Speicherstatus, zuletzt vom Server bestätigter `QuestionnaireState`.

Explizite UI-Zustände (Reducer-States), wie in Startprompt 4.2 gefordert: `loading`, `ready`, `dirty` (lokale Änderung vorhanden), `saving`, `saved`, `validationError`, `versionConflict`, `networkError`, `pathComplete`, `evaluating`, `recommendationReady`, `noEvaluableRecommendation`, `sessionCompleted`.

**Speicherverhalten:** Speichern pro Antwort (nicht gesammelt) — passend zum bestehenden `saveAnswer()`/`changeAnswer()`-Design, das genau eine Frage pro Aufruf erwartet und serverseitig sofort Sichtbarkeits-/Pfadänderungen zurückmeldet (`hiddenQuestionIds`). Kein Debouncing bei diskreten Eingaben (Single/Multi/Boolean/Date — Speichern direkt bei Auswahl); Debouncing (ca. 400–600 ms, **Annahme**, im Implementierungspaket zu bestätigen) bei Freitext-/Zahlen-Feldern, um nicht bei jedem Tastendruck zu schreiben. Wiederholung nach Netzwerkfehlern: ein manueller "Erneut speichern"-Button statt automatischem Retry, um keine unkontrollierten Doppel-Requests zu erzeugen — kombiniert mit einem clientseitigen In-Flight-Lock pro Frage (Button deaktiviert während eines laufenden Requests), zusätzlich zur bereits vorhandenen serverseitigen Absicherung (`AnswerAlreadyExistsError` bei `saveAnswer()`-Doppel-Race, CAS bei `changeAnswer()`).

**Verlassen mit ungespeicherten Eingaben:** `beforeunload`-Warnung nur im `dirty`-Zustand (lokale Eingabe ohne Bestätigung durch den Server). Da pro-Antwort-Speichern der Regelfall ist, sollte dieser Zustand selten und kurzlebig sein.

**Optimistic Locking:** `changeAnswer()` verlangt `expectedAnswerVersion`. Die UI hält `currentAnswerVersion` aus dem zuletzt geladenen `QuestionForAnswering` und schickt sie mit. Bei `StaleAnswerVersionError` (z. B. Zweitgerät, Parallelbearbeitung) zeigt die UI den `versionConflict`-Zustand: aktuellen Serverwert neu laden, dem Mitarbeiter beide Werte anzeigen, keine automatische Konfliktauflösung.

**Pfadänderung durch eine Antwort:** `AnswerWriteResult.hiddenQuestionIds` wird nach jedem Speichern ausgewertet — betroffene, nun verdeckte Fragen werden aus der lokalen Anzeige entfernt, ihre lokal zwischengespeicherten (noch ungespeicherten) Eingaben verworfen. Es wird **nie** clientseitig angenommen, welche Fragen sichtbar sind — nach jeder Antwort wird der vom Server zurückgegebene, autoritative Zustand übernommen (kein eigenes Sichtbarkeits-Reimplementieren im Client, siehe Abschnitt 4.1 des Startprompts).

## 5. Datenfluss vom Laden einer Sitzung bis zum Abschluss

1. Mitarbeiter öffnet `/consultation` → Server Component lädt (über neue Auth-Session) verfügbare `storeId`/`employeeId` → Mitarbeiter startet neue Sitzung oder wählt eine laufende (`status = IN_PROGRESS`) fort.
2. Neue Sitzung: `POST /api/consultation/sessions` → ruft `startQuestionnaire()` → Redirect zu `/consultation/[sessionId]`.
3. `/consultation/[sessionId]` lädt serverseitig `loadQuestionnaireState()` → rendert aktuelle Frage(n) + Fortschritt.
4. Jede Antwort: Client → `POST/PATCH /api/consultation/sessions/[id]/answers` → `saveAnswer()`/`changeAnswer()` → Antwort enthält aktualisierten `AnswerWriteResult`; Client fordert bei Bedarf aktualisierten `QuestionnaireState` an (oder Route Handler liefert ihn direkt mit zurück, um einen Extra-Request zu sparen — Implementierungsdetail, siehe Abschnitt 16).
5. Wenn `progress.missingRequiredQuestionIds` leer ist: UI zeigt "Fragebogen abschließbar" → Mitarbeiter löst `POST /api/consultation/sessions/[id]/complete` aus → `completeQuestionnaire()` → Status `COMPLETED`.
6. Mitarbeiter löst Auswertung aus: `POST /api/consultation/sessions/[id]/recommendation` → `evaluate()` → Redirect/Anzeige `/consultation/[sessionId]/recommendation`.
7. Empfehlungsübersicht: `GET /api/consultation/sessions/[id]/recommendation` → `getLatestRecommendation()` (idempotent, kann beliebig oft neu geladen werden, auch nach Abschluss).
8. Je Empfehlung: Begründung öffnen (rein clientseitig, keine neue Server-Anfrage — Daten sind bereits Teil von `RecommendationResult`), Cross-Selling-Hinweis bearbeiten (`PATCH /api/consultation/sales-opportunities/[id]`), Empfehlung annehmen/ablehnen (`POST /api/consultation/recommendation-items/[id]/outcome`).
9. Bei "Beratung ändern": zurück zu Schritt 3/4 (Fragen erneut bearbeitbar, sofern Session-Status das zulässt — siehe Abschnitt 8 zur Statusfrage), danach erneut Schritt 6 (`evaluate()` erneut, Fingerprint-Idempotenz entscheidet, ob eine neue `Recommendation` entsteht).
10. Abschluss: `/consultation/[sessionId]/summary` komponiert `loadQuestionnaireState()` + `getLatestRecommendation()` + Outcomes + Opportunities zu einer Lesezusammenfassung.

## 6. Verhalten bei Speichern, Konflikten und Pfadänderungen

Bereits in Abschnitt 4 (State-Management) im Detail behandelt: pro-Antwort-Speichern, Debouncing nur bei Freitext/Zahlen, manuelles Retry statt Auto-Retry, In-Flight-Lock gegen Doppel-Requests, `StaleAnswerVersionError` → `versionConflict`-Zustand mit Neuladen statt automatischer Zusammenführung, `hiddenQuestionIds` treibt eine autoritative Neusynchronisation der sichtbaren Fragen nach jedem Schreibvorgang.

Zusätzlich zu klären (Implementierungsdetail, keine Grundsatzfrage): ob `saveAnswer()`/`changeAnswer()`-Route Handler direkt den vollständigen aktualisierten `QuestionnaireState` zurückgeben (ein Request-Roundtrip weniger, aber größere Payload) oder nur `AnswerWriteResult` (Client fordert bei Bedarf separat nach). **Empfehlung:** direkte Rückgabe des vollständigen Zustands, da Antwortgrößen bei den bestehenden DTOs klein sind (keine Massendaten) und ein zusätzlicher Roundtrip auf Tablets mit schwächerer Verbindung vermieden wird.

## 7. Konzept für Recommendation- und Rationale-Darstellung

Eigenes, typisiertes UI-Read-Model `ConsultationRecommendationView` (in `src/server/consultation-ui/`), das `RecommendationResult` unverändert durchreicht und zusätzlich eine deterministische Übersetzungsfunktion `translateRationale(factorKey, factorValue): string` bereitstellt. Diese Funktion ist eine reine Nachschlagetabelle (`Record<string, (value: string) => string>` je bekanntem `factorKey`) — **kein** Sprachmodell, keine Interpretation. Unbekannte `factorKey`-Werte lösen **keinen** Rateversuch aus, sondern eine generische, sichere Fallback-Anzeige ("Zusätzlicher Faktor: {factorKey} = {factorValue}") plus ein serverseitiges Log-/Telemetrie-Ereignis (nicht Teil der Analytics-Kernereignisse, sondern technisches Monitoring), damit unbekannte Faktoren auffallen, bevor sie unbemerkt falsch angezeigt werden.

Hauptansicht (`RecommendationCard`): `priorityRank`, Produkt-/Tarifbezeichnung (aus referenzierter `ProductVersion`, per zusätzlichem Read über `productVersionId` — noch zu ergänzender einfacher Lookup, keine neue Fachlogik), ausschließlich in `ProductVersion`/`RecommendationItemResult` gespeicherte Preise/Eigenschaften, verständliche Eignungszusammenfassung aus den `eligibility`-Rationale-Einträgen, `customerFitScore` sichtbar als grobe Kategorie (z. B. "hohe/mittlere Eignung" statt Rohzahl — **Annahme**, zu bestätigen: Rohzahlen könnten Mitarbeiter zu Fehlinterpretationen verleiten), relevante Cross-Selling-Hinweise, ein klarer nächster Handlungsschritt-Button ("Annehmen" / "Ablehnen" / "Begründung ansehen").

Begründungsansicht: **aufklappbarer Bereich (Accordion) pro Karte auf Desktop, Bottom-Sheet/Drawer auf Tablet** — Begründung dafür: ein Dialog/Modal würde bei Tablet-Querformat den Gesprächskontext (übrige Empfehlungen) verdecken, was Abschnitt 4.7 explizit verbietet ("wichtige Aktionen ohne Verlust des Gesprächskontexts erreichbar"); ein Accordion bleibt im Seitenfluss, ist tastaturbedienbar (`aria-expanded`) und erfordert keine zusätzliche Fokus-Falle wie ein Modal-Dialog.

Klare Trennung: positive Eignungsgründe, Ausschlussgründe (`exclusionReasonCodes`) und Cross-Selling-Gründe werden in **separaten, farblich/strukturell unterschiedlichen Abschnitten** der Begründungsansicht dargestellt — nie vermischt. `businessPriorityScore` und Provisions-/Margendaten (`commissionValueMinor`, `commissionModelVersionId`) werden **nicht** in der Mitarbeiter-UI anzeigt (nur intern für spätere Geschäftsführer-Dashboards relevant, siehe `docs/RECOMMENDATION_ENGINE.md` Abschnitt "Wo KI zulässig ist"; **offene Frage an ChatGPT**, ob Mitarbeiter zumindest die Kampagnen-/Priorisierungs-Kennzeichnung ohne konkrete Zahl sehen dürfen, wie in `docs/RECOMMENDATION_ENGINE.md` Zeile 32 als Beispiel genannt — siehe Abschnitt 15).

## 8. Ablehnungs- und Änderungsflow

**Empfehlung ablehnen:** `OutcomeDialog` zeigt strukturierte Ablehnungsgründe aus `RejectionReason` (tenant-gepflegt, `isActive`-gefiltert) plus optionales, kurzes Freitextfeld ohne Zwang zu personenbezogenen Angaben. `POST /api/consultation/recommendation-items/[id]/outcome` → neue Service-Funktion (Abschnitt 2.2, Punkt 3) → `RecommendationOutcome`-Zeile anlegen. Die `@@unique([tenantId, recommendationItemId])`-Constraint verhindert serverseitig bereits doppelte Outcomes für dasselbe Item; die UI fängt den daraus resultierenden Fehler ab und zeigt "Bereits entschieden am {decidedAt}" statt eines technischen Fehlers — dadurch erzeugen wiederholte Klicks (Doppel-Request-Race) keine unkontrollierten Duplikate. Passendes Analytics-Ereignis: siehe Abschnitt 10 (Divergenz zu klären).

**Beratung ändern:** Button "Angaben ändern" führt zurück zu `/consultation/[sessionId]` (Fragenansicht). Voraussetzung, die vor der Umsetzung zu klären ist (siehe Abschnitt 15): `ConsultationSession.status` kennt aktuell nur `IN_PROGRESS`/`COMPLETED`/`ABANDONED` (aus `QuestionnaireRunStatus`) sowie die serverseitige Regel "Status ist final, kein Wiedereröffnen" (`docs/DECISION_LOG.md`, Phase-3A-Entscheidung "completion is final, no reopening"). Das bedeutet: eine bereits `COMPLETED`-Sitzung kann laut heutiger Fragen-Engine-Invariante **nicht** über `saveAnswer()`/`changeAnswer()` erneut verändert werden (`QuestionnaireRunNotModifiableError`). Der im Startprompt geforderte Änderungsflow ("Mitarbeiter gelangt gezielt zurück zu den Antworten") ist also nur **vor** dem Abschluss des Fragebogens möglich, nicht danach — das ist eine Diskrepanz zwischen Startprompt-Erwartung (Abschnitt 1, Punkt 9: "Empfehlung ablehnen **oder** die Beratung ändern") und der bestehenden Fachlogik-Invariante aus Phase 3A, die laut Abschnitt 6 des Startprompts **nicht** angetastet werden darf ("keine Änderung der Kernlogik aus Phase 3A oder 3B"; "Wenn eine notwendige UI-Anforderung eine Änderung an Phase 3A/3B verlangt: stoppen und den Konflikt dokumentieren"). Diese Konsequenz wird hiermit dokumentiert und **nicht** eigenmächtig aufgelöst — siehe Abschnitt 15, Stop-Punkt.

Praktikable Lösung ohne Kernlogik-Änderung (**Vorschlag zur Abstimmung mit ChatGPT**, keine Vorwegnahme): Empfehlungen können bereits **vor** `completeQuestionnaire()` ausgewertet werden (`evaluate()` verlangt nur `status = IN_PROGRESS` plus vollständige Pflichtfragen im sichtbaren Pfad — nicht zwingend einen bereits abgeschlossenen Fragebogen). Der "Ändern"-Button ist also nur sichtbar/aktiv, solange die Sitzung noch `IN_PROGRESS` ist; nach `completeQuestionnaire()` ist die Beratung endgültig, und "Ändern" bedeutet dann organisatorisch "neue Beratungssitzung starten" statt Bearbeitung der bestehenden. Nach jeder Änderung: sichtbarer Pfad und Vollständigkeit werden serverseitig neu berechnet (bestehende Logik), anschließend erneuter `evaluate()`-Aufruf; die Fingerprint-Idempotenz der Empfehlungs-Engine sorgt automatisch dafür, dass unveränderte Wiederholungen keine neue `Recommendation`-Zeile erzeugen, während tatsächlich geänderte Eingaben eine neue, zusätzliche `Recommendation` erzeugen — alte Recommendations bleiben unverändert und nachvollziehbar (append-only, wie bereits in Phase 3B umgesetzt). Die UI zeigt in diesem Fall eine Historie ("frühere Empfehlung vom …") statt die alte zu verstecken.

## 9. Cross-Selling-/SalesOpportunity-Flow

`RecommendationCrossSellingSignal` wird unverändert aus `RecommendationResult.crossSellingSignals` gelesen und **nie** durch die UI verändert (kein Schreibpfad dafür vorgesehen). Die zugehörige `SalesOpportunity`-Zeile (durch `evaluate()` bereits automatisch angelegt, `status = OPEN`) wird über die neue Statusfunktion (Abschnitt 2.2, Punkt 4) aktualisiert: `OpportunityCard` zeigt Bedarf/Grund (aus `CrossSellingSignalResult`, `needType`/`reasonCode`/`justificationParams` — dieselbe Übersetzungstabelle wie bei Rationales verwendet), Mitarbeiter markiert `OFFERED`/`ACCEPTED`/`DECLINED`/`DEFERRED`. Da `evaluate()` bei identischem Fingerprint keine neuen Signale/Opportunities erzeugt (Idempotenz bereits in Phase 3B sichergestellt), entsteht bei wiederholtem Laden derselben Seite keine doppelte Opportunity. Statusänderungen laufen über dieselbe Route-Handler-Schicht wie alles andere — tenant-gescoped über `TenantContext`, rollenabhängig abgesichert (nur Mitarbeiter der eigenen `storeId`/`tenantId`, sobald die Rollenprüfung existiert — siehe Abschnitt 15).

**Offene Frage an ChatGPT** (Abschnitt 15): sind alle fünf `OpportunityStatus`-Übergänge von der UI aus frei wählbar, oder gibt es eine erlaubte Übergangsreihenfolge (z. B. `OPEN → OFFERED → ACCEPTED|DECLINED`, `DEFERRED` nur aus `OFFERED`)? Das Prisma-Schema erzwingt keine Übergangsreihenfolge; ohne Klärung würde Phase 5 eine eigene Annahme treffen müssen, die ggf. mit einer späteren Pilot-Phase-Erwartung kollidiert.

## 10. Analytics-Mapping

**Wichtige Doku-Code-Divergenz, die vor der Umsetzung geklärt werden muss:** Die acht "Kernereignisse" aus `docs/ANALYTICS_AND_KPIS.md` (`session_started`, `question_answered`, `session_topic_completed`, `recommendation_generated`, `recommendation_outcome_set`, `deal_closed`, `session_abandoned`, `session_ended`) sind **snake_case-Konzeptnamen**, die **nicht 1:1** dem tatsächlichen `AnalyticsEventType`-Enum in `prisma/schema.prisma` entsprechen. Das echte Enum kennt 14 Werte: `CONSULTATION_STARTED`, `CONSULTATION_TOPIC_OPENED`, `QUESTIONNAIRE_STARTED`, `QUESTION_ANSWERED`, `ANSWER_CHANGED`, `PATH_RECALCULATED`, `QUESTIONNAIRE_COMPLETED`, `NEED_DETECTED`, `OPPORTUNITY_OFFERED`, `OPPORTUNITY_DECLINED`, `RECOMMENDATION_GENERATED`, `RECOMMENDATION_ACCEPTED`, `RECOMMENDATION_REJECTED`, `CONSULTATION_COMPLETED`, `CONSULTATION_ABANDONED`. Bisher schreibt der Code nur sechs davon tatsächlich (`QUESTIONNAIRE_STARTED`, `QUESTION_ANSWERED`, `PATH_RECALCULATED`, `ANSWER_CHANGED`, `QUESTIONNAIRE_COMPLETED` in `questionnaire/service.ts`; `RECOMMENDATION_GENERATED` in `recommendation/service.ts`). Es gibt **kein** Enum-Äquivalent zu `deal_closed`.

Vorgeschlagene Zuordnungstabelle (zur Bestätigung durch ChatGPT, da sie zwei bestehende Dokumente in Einklang bringen muss, ohne eines davon einseitig für "richtig" zu erklären):

| Nutzeraktion (UI)               | `ANALYTICS_AND_KPIS.md`-Konzept | tatsächlicher `AnalyticsEventType`                                                                                                                                                                   | Auslöser                                                           | bereits im Code geschrieben?                  |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| Sitzung starten                 | `session_started`               | `QUESTIONNAIRE_STARTED`                                                                                                                                                                              | `startQuestionnaire()`                                             | ja                                            |
| Antwort speichern               | `question_answered`             | `QUESTION_ANSWERED` (Erstantwort) / `ANSWER_CHANGED` (Änderung)                                                                                                                                      | `saveAnswer()`/`changeAnswer()`                                    | ja                                            |
| Themenblock abgeschlossen       | `session_topic_completed`       | **kein passendes Enum-Feld** — `CONSULTATION_TOPIC_OPENED` existiert nur für "geöffnet", nicht "abgeschlossen"; `ConsultationTopic`-Modell wird im Service-Code aktuell nirgends beschrieben/befüllt | —                                                                  | nein, echte Lücke                             |
| Empfehlung erzeugt              | `recommendation_generated`      | `RECOMMENDATION_GENERATED`                                                                                                                                                                           | `evaluate()`                                                       | ja                                            |
| Empfehlung angenommen/abgelehnt | `recommendation_outcome_set`    | `RECOMMENDATION_ACCEPTED` / `RECOMMENDATION_REJECTED` (zwei Enum-Werte statt einem generischen Ereignis)                                                                                             | neue Outcome-Funktion (Abschnitt 2.2)                              | nein, zu ergänzen                             |
| Vertrag abgeschlossen           | `deal_closed`                   | **kein Enum-Wert vorhanden**                                                                                                                                                                         | —                                                                  | nein, außerhalb Phase-5-Scope (Abschnitt 2.3) |
| Sitzung abgebrochen             | `session_abandoned`             | `CONSULTATION_ABANDONED`                                                                                                                                                                             | noch kein Auslöser implementiert (z. B. Timeout/manueller Abbruch) | nein, zu ergänzen                             |
| Sitzung/Beratung beendet        | `session_ended`                 | `CONSULTATION_COMPLETED` (zu unterscheiden von `QUESTIONNAIRE_COMPLETED`, das bereits existiert und den Fragebogen-Abschluss meint, nicht zwingend die gesamte Beratung inkl. Empfehlung/Outcome)    | Abschluss der Zusammenfassungsseite                                | nein, zu ergänzen                             |

Zusätzlich zu klären: `CONSULTATION_TOPIC_OPENED`, `NEED_DETECTED`, `OPPORTUNITY_OFFERED`, `OPPORTUNITY_DECLINED` sind im Enum vorhanden, aber weder in `ANALYTICS_AND_KPIS.md` als Kernereignis genannt noch bisher im Code geschrieben — vermutlich für den Cross-Selling-/Opportunity-Flow gedacht (Abschnitt 9). **Empfehlung:** `OPPORTUNITY_OFFERED`/`OPPORTUNITY_DECLINED` beim Statuswechsel einer `SalesOpportunity` schreiben (passt inhaltlich exakt), `NEED_DETECTED` nur falls der `DetectedNeed`-Pfad (aktuell laut Ist-Analyse nicht vom Cross-Selling-Regelfall genutzt, siehe `sales-opportunity.ts`-Kommentar) in Phase 5 überhaupt zum Einsatz kommt — sonst ungenutzt lassen.

**Payload/Idempotenz/Fehlerbehandlung:** `AnalyticsEvent.payload` ist Zod-validiert (`src/server/validation/event-payload-schemas.ts`, bereits vorhanden) — Phase 5 muss für jeden neu geschriebenen `eventType` (`RECOMMENDATION_ACCEPTED`, `RECOMMENDATION_REJECTED`, `CONSULTATION_COMPLETED`, `CONSULTATION_ABANDONED`, ggf. `OPPORTUNITY_OFFERED`/`OPPORTUNITY_DECLINED`) ein passendes Payload-Schema ergänzen, falls noch nicht vorhanden (zu verifizieren in der Implementierungsphase). Analytics-Schreibfehler: **Empfehlung** (offene Frage an ChatGPT) — der Fachvorgang (z. B. Outcome speichern) darf nicht an einem fehlschlagenden Analytics-Schreibvorgang scheitern; stattdessen Analytics-Schreiben in derselben Transaktion versuchen, bei Fehler kontrolliert loggen und den Fachvorgang trotzdem als erfolgreich zurückmelden (asymmetrisch zur bestehenden Praxis in `questionnaire/service.ts`/`recommendation/service.ts`, wo Analytics-Events aktuell **innerhalb** derselben Transaktion wie der Fachdatensatz geschrieben werden — dort blockiert ein Analytics-Fehler also aktuell den ganzen Vorgang. Phase 5 sollte diesem bestehenden Muster folgen, um konsistent zu bleiben, nicht ein eigenes Verhalten einführen).

## 11. Desktop- und Tablet-Konzept

Kein CSS-Framework vorhanden (Abschnitt 1.5) — **Vorschlag:** CSS-Grid/Flexbox mit wenigen, klar benannten CSS-Variablen (Abstände, Schriftgrößen, Touch-Ziel-Mindestgröße 44×44px) in `globals.css`, ergänzt um Layout-Container-Klassen. Kein neues Design-System (verboten laut Startprompt Abschnitt 6). Breakpoints (**Annahme**, zu bestätigen): Desktop ≥1024px (zweispaltig: Frage links, Kontext/Fortschritt rechts), Tablet Querformat 768–1023px (einspaltig, größere Touch-Ziele), Tablet Hochformat <768px (einspaltig, Begründungs-Drawer als Bottom-Sheet statt Accordion, siehe Abschnitt 7). Keine horizontalen Scrollzwänge: lange deutsche Bezeichnungen (z. B. Tarifnamen) per `overflow-wrap`/`hyphens: auto` behandeln statt fixer Breiten. Bildschirmtastatur: Formularfelder mit korrektem `inputmode` (`numeric` für Integer/Decimal, `text` für ShortText) und ausreichendem Scroll-Padding, damit die Tastatur keine Eingabefelder verdeckt. Fokusreihenfolge folgt der visuellen Lesereihenfolge; nach jedem Speichern wandert der Fokus kontrolliert zur nächsten offenen Pflichtfrage (nicht zurück zum Seitenanfang).

## 12. Testmatrix gegen die fünf MVP-Abnahmekriterien

| #   | Abnahmekriterium                                                             | Testebene(n)                                                                                            | Konkreter Nachweis                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mitarbeiter führt vollständiges Gespräch ohne Entwicklerunterstützung durch  | E2E + manueller Mitarbeitertest                                                                         | E2E-Test deckt Start→Fragen→Empfehlung→Begründung→Cross-Selling→Ablehnung/Änderung→Zusammenfassung ab (Startprompt Abschnitt 7); manueller Test ist das einzige echte, entwicklerunabhängige Nachweismittel (siehe Abschnitt 13) |
| 2   | ≥3 unterschiedliche Kundensituationen → spürbar unterschiedliche Fragenpfade | E2E (3 Szenarien) + Integrationstest (bereits für die Engine vorhanden, hier UI-seitig wiederverwendet) | Drei E2E-Fixtures mit unterschiedlichen Antwortmustern, Assertion auf tatsächlich unterschiedliche sichtbare Fragenlisten                                                                                                        |
| 3   | Jede Empfehlung per Klick auf Regel-Begründung zurückführbar                 | Komponententest (`RationaleDrawer`) + E2E-Klick-Test                                                    | Komponententest: Rendering aller bekannten `factorKey`-Werte + Fallback für unbekannte; E2E: Klick öffnet Begründung, Inhalte stimmen mit API-Response überein                                                                   |
| 4   | Keine Empfehlung mit Preis/Eigenschaft außerhalb der Stammdaten              | Integrationstest (API-Ebene) + Stichprobe im manuellen Test                                             | Integrationstest prüft, dass jede angezeigte `RecommendationItemResult` ausschließlich Felder aus `ProductVersion`/`RecommendationRationale` enthält (keine clientseitige Anreicherung möglich, da UI nur durchreicht)           |
| 5   | Alle Kernereignisse korrekt geschrieben                                      | Integrationstest je Ereignis (Analytics-Mapping-Tabelle aus Abschnitt 10 als Testgrundlage)             | Für jeden tatsächlich in Phase 5 geschriebenen `eventType`: Test prüft Auslöser, Payload-Schema-Konformität, Nicht-Duplizierung bei Wiederholung                                                                                 |

Zusätzlich (nicht eines der fünf MVP-Kriterien, aber vom Startprompt gefordert): Unit-/Komponententests für alle sieben Antworttypen, Fortschritts-/Fehlerdarstellung, Button-/Statuslogik. Integrationstests für Optimistic-Lock-Konflikt, Tenant-Isolation (kein Zugriff auf fremde `consultationSessionId`), Berechtigungen (sobald Rollenprüfung existiert).

## 13. Plan für den echten Mitarbeitertest

Kurzes, neutrales Testskript (**Entwurf, vor Durchführung mit ChatGPT/Nutzer abzustimmen**): Mitarbeiter erhält nur eine Ausgangssituation (z. B. "Ein Kunde möchte einen SIM-only-Vertrag mit möglichst viel Datenvolumen") schriftlich, kein Entwickler führt vor oder greift ein. Protokolliert werden: benötigte Zeit (Start bis Zusammenfassung), Stellen mit Rückfragen, Fehlbedienungen, nicht verstandene Begriffe (insbesondere deutsche Übersetzung von `factorKey`-Werten und Cross-Selling-Bezeichnungen), abgebrochene Schritte, tatsächlich erkannte Empfehlung, Verständnis der Begründung (Nachfrage: "Warum wurde das empfohlen?"), Verständnis von Ablehnung und Änderung (Nachfrage: "Wie würden Sie eine andere Empfehlung anfordern?"), genutztes Gerät (Desktop/Tablet, Quer-/Hochformat), Ergebnis bestanden/nicht bestanden gegen die fünf MVP-Kriterien. Mindestens ein Testlauf auf Desktop und einer auf Tablet. Ein durch Entwickler geführter Test erfüllt das Abnahmekriterium ausdrücklich **nicht** (Startprompt Abschnitt 7) — dieser Test muss von einem tatsächlichen Mitarbeiter selbstständig durchgeführt werden, was organisatorisch außerhalb der reinen Code-Implementierung liegt und rechtzeitig mit dem Nutzer zu terminieren ist.

## 14. Voraussichtlich zu erstellende und zu ändernde Dateien

**Neu:**

- `src/app/consultation/page.tsx`, `src/app/consultation/[sessionId]/page.tsx`, `src/app/consultation/[sessionId]/recommendation/page.tsx`, `src/app/consultation/[sessionId]/summary/page.tsx`
- `src/app/login/page.tsx` (nur falls Auth-Stop-Punkt freigegeben wird)
- `src/app/api/auth/dev-login/route.ts`, `src/app/api/auth/logout/route.ts` (nur falls freigegeben)
- `src/app/api/consultation/sessions/route.ts`, `src/app/api/consultation/sessions/[id]/route.ts`, `src/app/api/consultation/sessions/[id]/answers/route.ts`, `src/app/api/consultation/sessions/[id]/complete/route.ts`, `src/app/api/consultation/sessions/[id]/recommendation/route.ts`, `src/app/api/consultation/recommendation-items/[id]/outcome/route.ts`, `src/app/api/consultation/sales-opportunities/[id]/route.ts`
- `src/components/consultation/*.tsx` (siehe Abschnitt 3, ca. 10–14 Dateien)
- `src/server/consultation-ui/view-models.ts`, `src/server/consultation-ui/rationale-translation.ts`, `src/server/consultation-ui/errors.ts`
- `src/server/recommendation/outcome.ts` (neue Outcome-Service-Funktion), `src/server/recommendation/opportunity-status.ts` (neue Status-Service-Funktion) — **innerhalb** des bestehenden Empfehlungs-Engine-Ordners, da fachlich Teil davon, nicht der reinen UI-Adapter-Schicht
- `src/server/auth/*.ts` (nur falls freigegeben)
- `tests/unit/consultation-ui/*.test.ts`, `tests/integration/consultation-api/*.test.ts`, ggf. `tests/e2e/*.spec.ts` (Framework-Entscheidung offen, siehe Abschnitt 16)
- `docs/CONSULTATION_UI.md` (neue Fachdokumentation analog `docs/QUESTION_ENGINE.md`/`docs/RECOMMENDATION_ENGINE.md`)

**Zu ändern:**

- `src/app/page.tsx` (Platzhalter-Startseite durch echten Einstiegspunkt/Link ersetzen oder ergänzen)
- `.env.example`, `docs/PRIVACY_AND_SECURITY.md` (Dev-Auth-Mechanismus konkretisieren, sobald Stop-Punkt entschieden ist)
- `docs/DATA_MODEL.md` (falls neue Felder/Tabellen für Auth-Sessions nötig werden)
- `docs/ANALYTICS_AND_KPIS.md` (Klarstellung snake_case-Konzept vs. Enum-Werte, siehe Abschnitt 10)
- `docs/IMPLEMENTATION_STATUS.md`, `docs/RISK_REGISTER.md`, `docs/DECISION_LOG.md` (laufende Fortschreibung, wie in Phase 3A/3B)
- `package.json` (neue Dependency nur für E2E-Framework, siehe Abschnitt 16 — sonst keine neuen Abhängigkeiten nötig)

## 15. Risiken, offene Entscheidungen und Stop-Punkte

**Status (2026-08-02): Alle vier Stop-Punkte von ChatGPT wie vorgeschlagen bestätigt.** Die folgenden vier Unterabschnitte sind damit von "offener Klärungsbedarf" zu "bestätigte Grundlage für AP1–AP16" übergegangen — der Wortlaut bleibt zur Nachvollziehbarkeit unverändert stehen.

**Stop-Punkt 1 (wichtigster offener Punkt): Authentifizierung.** Ohne irgendeine Form von Identität lässt sich keine der in Abschnitt 4.9 des Startprompts geforderten Eigenschaften einhalten ("tenant-gescoped", "vorhandene Rollen-/Berechtigungsprüfungen verwenden", "keine fremden Sessions über erratene IDs offenlegen"). Gleichzeitig ist der Bau eines vollständigen Auth-Systems (Passwort-Hashing, IdP-Integration, Passwort-Reset etc.) weder von `PHASE_5_STARTPROMPT.md` verlangt noch mit dem MVP-Charakter des Projekts ("Rollen: Mitarbeiter + ein technischer Admin (kein volles RBAC über mehrere Rollen)", `docs/MVP_SCOPE.md`) vereinbar. **Empfehlung:** minimaler Dev-/Pilot-Mechanismus exakt entlang der bereits in `.env.example` dokumentierten, aber nie umgesetzten Absicht — Mitarbeiter wählt sich aus einer Liste seeded `User`/`Employee`-Datensätze aus (kein Passwort), Server stellt ein mit `DEV_AUTH_SECRET` signiertes, httpOnly-Cookie aus, das `{userId, employeeId, tenantId, roles}` enthält; jede Route liest dieses Cookie und ruft `runWithTenantContext()` auf. Ausdrücklich **nicht produktionsreif** (wie schon in `.env.example` kommentiert) und **nicht** für ein öffentliches Deployment gedacht. Dies weicht spürbar vom wörtlichen Auftrag "Mitarbeiter-UI" ab (es ist zusätzlich ein Mini-Auth-System) — bevor das umgesetzt wird, wird dies **ChatGPT als Projektleiter zur Abstimmung vorgelegt** (gemäß der Nutzervorgabe, Maßnahmen mit ChatGPT abzustimmen, wenn die eigene Einschätzung von einer wörtlichen Auslegung abweicht), nicht eigenmächtig entschieden.

**Stop-Punkt 2: "Beratung ändern" nach Abschluss.** Wie in Abschnitt 8 hergeleitet, verbietet die bestehende, laut Startprompt Abschnitt 6 nicht änderbare Phase-3A-Invariante ("completion is final, no reopening") eine Bearbeitung nach `completeQuestionnaire()`. Der vorgeschlagene Ausweg (Empfehlung bereits vor Abschluss ermöglichen, "Ändern" nur vor Abschluss aktiv) ist eine Auslegung, keine Vorgabe — zur Bestätigung an ChatGPT.

**Stop-Punkt 3: `SalesOpportunity`-Statusübergänge.** Keine erzwungene Reihenfolge im Schema — Phase 5 müsste eine Annahme treffen, ohne dass diese Annahme irgendwo dokumentiert ist. Zur Klärung vorlegen (Abschnitt 9).

**Stop-Punkt 4: `customerFitScore`/Kampagnen-Kennzeichnung in der Mitarbeiter-UI.** `docs/RECOMMENDATION_ENGINE.md` nennt als Beispiel explizit, dass der Mitarbeiter sehen soll "3 passende Tarife, davon einer aktuell mit Kampagnen-Priorität" — das ist strenggenommen ein Blick auf `businessPriorityScore`-Herkunft, nicht nur auf `customerFitScore`. Abschnitt 7 dieses Plans schlägt vor, `businessPriorityScore` selbst nicht anzuzeigen, aber die reine Kampagnen-Kennzeichnung (ohne Zahl) schon. Zur Bestätigung vorlegen, da hier zwei Dokumente (`RECOMMENDATION_ENGINE.md` vs. Startprompt-Vorsicht bei "interne Provisionen/Margen/Business-Prioritäten nicht ungeprüft kundensichtbar machen") unterschiedliche Schwerpunkte setzen — wobei "kundensichtbar" hier ohnehin nicht zutrifft, da die UI mitarbeiter-, nicht kundenseitig ist; dennoch zur Klarstellung vorzulegen.

**Risiko 1:** Kein E2E-Framework vorhanden — Einführung von Playwright (kleinstmögliche, gängigste Wahl für Next.js-Projekte, **Vorschlag zur Bestätigung**, keine Installation vor Plan-Freigabe) bedeutet eine neue Abhängigkeit und CI-Erweiterung (Browser-Download in der CI-Pipeline, zusätzliche Laufzeit). Alternative: Integrationstests auf API-Ebene plus manueller Test decken die MVP-Kriterien auch ohne echtes Browser-E2E ab — als Rückfalloption zu benennen, falls ChatGPT eine neue Abhängigkeit ungern sieht.

**Risiko 2:** Kein Component-Testing-Setup (`jsdom`) vorhanden — `vitest.config.ts` läuft mit `environment: "node"`. Für Komponententests wird entweder die Vitest-Umgebung projektweit oder testdatei-spezifisch (`// @vitest-environment jsdom`) auf `jsdom` umgestellt plus `@testing-library/react` als neue Dev-Dependency ergänzt — ebenfalls eine neue Abhängigkeit, vor Plan-Freigabe nicht zu installieren.

**Risiko 3:** Analytics-Event-Schreiben aktuell transaktional an den Fachvorgang gekoppelt (Abschnitt 10) — bei Erweiterung um neue Ereignistypen in neuen Transaktionen (Outcome, Opportunity-Status) muss dasselbe Muster diszipliniert fortgesetzt werden, sonst entsteht Inkonsistenz zwischen bereits vorhandenen und neuen Schreibpfaden.

**Risiko 4:** `deal_closed` bleibt eine dokumentierte, aber nicht einlösbare KPI-Vorgabe aus `ANALYTICS_AND_KPIS.md`, solange kein `Deal`-Anlagepfad existiert — außerhalb des Phase-5-Auftrags, aber zur Kenntnisnahme für eine spätere Phase festzuhalten (ggf. `docs/OPEN_DECISIONS.md` ergänzen).

## 16. Umsetzungsschritte in Arbeitspaketen

1. **AP1 – Klärung der Stop-Punkte** (Abschnitt 15) mit ChatGPT, danach ggf. mit Nutzer. Kein Code vor Abschluss dieses Pakets.
2. **AP2 – Dünne API-Schicht** für bereits vorhandene Engine-Funktionen (Fragebogen starten/laden/beantworten/ändern/abschließen, Empfehlung auswerten/laden) inkl. Zod-Validierung und Fehler-Mapping (Engine-Fehlerklassen → HTTP-Statuscodes/strukturierte Fehlerkörper).
3. **AP3 – Minimaler Dev-Auth-Mechanismus** (nur nach Freigabe aus AP1) inkl. Middleware, die `runWithTenantContext()` pro Request aufruft.
4. **AP4 – Fragenfluss-UI**: `QuestionRenderer` mit allen sieben Antworttypen, Fortschrittsanzeige, Navigation, Speicherzustände (Abschnitt 4/6).
5. **AP5 – Neue Service-Ergänzungen**: `RecommendationOutcome`-Schreibpfad, `SalesOpportunity`-Statusfunktion (Abschnitt 2.2) inkl. zugehöriger Unit-/Integrationstests — bewusst vor der UI, die sie nutzt, damit die Fachlogik unabhängig testbar ist.
6. **AP6 – Empfehlungs-/Begründungs-UI**: `RecommendationList`, `RationaleDrawer`, Übersetzungstabelle (Abschnitt 7).
7. **AP7 – Ablehnungs-/Änderungsflow-UI** (Abschnitt 8) inkl. `OutcomeDialog`.
8. **AP8 – Cross-Selling-UI** (Abschnitt 9).
9. **AP9 – Zusammenfassungsseite** (Abschnitt 5, Schritt 10).
10. **AP10 – Analytics-Vervollständigung** entlang der bestätigten Mapping-Tabelle (Abschnitt 10).
11. **AP11 – Responsive/Tablet-Feinschliff** (Abschnitt 11), Tastatur-/Barrierefreiheitsprüfung.
12. **AP12 – Testsuite**: Unit/Komponente, Integration, E2E (Framework-Entscheidung aus AP1), Testmatrix aus Abschnitt 12 vollständig abdecken.
13. **AP13 – Dokumentation**: `docs/CONSULTATION_UI.md`, Fortschreibung `IMPLEMENTATION_STATUS.md`/`RISK_REGISTER.md`/`DECISION_LOG.md`.
14. **AP14 – Lokale Verifikation** (Abschnitt 17), Commit/Push, CI-Verifikation.
15. **AP15 – Echter Mitarbeitertest** (Abschnitt 13) — organisatorisch, nicht rein Code.
16. **AP16 – Abschlussbericht** Phase 5 analog Phase 3A/3B, an ChatGPT und Nutzer.

## 17. Exakte Prüfkommandos

Identisch zu den bereits etablierten, projektweiten Kommandos (`docs/LOCAL_DEVELOPMENT.md`), keine neuen Skripte außer ggf. `test:e2e`:

```
npm run lint
npm run format
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

Falls Playwright eingeführt wird (Risiko 1): zusätzlich `npm run test:e2e` (neues Skript, gegen lokal gestarteten `next start`/`next dev`-Server). CI (`.github/workflows/ci.yml`) müsste um einen Playwright-Browser-Install-Schritt sowie den neuen Testlauf erweitert werden — als Diff zur bestehenden Pipeline explizit im Umsetzungspaket AP12 auszuweisen, nicht stillschweigend.

## 18. Definition of Done

Phase 5 gilt als abgeschlossen, wenn: alle zehn in Startprompt Abschnitt 1 genannten Fähigkeiten in der UI nachweisbar funktionieren; alle fünf MVP-Abnahmekriterien aus Abschnitt 12 durch tatsächlich ausgeführte (nicht nur behauptete) Tests belegt sind; der reale, entwicklerunabhängige Mitarbeitertest (Abschnitt 13) mit Ergebnis "bestanden" protokolliert vorliegt; alle Prüfkommandos aus Abschnitt 17 lokal und in CI grün sind; keine der in Abschnitt 15 genannten Kernlogik-Invarianten aus Phase 3A/3B verletzt wurde; die Analytics-Mapping-Tabelle vollständig umgesetzt und getestet ist; `docs/CONSULTATION_UI.md` sowie die laufenden Statusdokumente aktualisiert sind; ein Abschlussbericht analog Phase 3A/3B erstellt und sowohl an ChatGPT als auch an den Nutzer geliefert wurde.

## 19. GO-/NO-GO-Empfehlung

**Ursprüngliche Empfehlung:** kein sofortiges Implementierungs-GO, solange die vier Stop-Punkte aus Abschnitt 15 nicht durch ChatGPT bestätigt sind.

**Status (2026-08-02):** ChatGPT hat alle vier Stop-Punkte mit den in diesem Plan vorgeschlagenen Lösungen bestätigt. Damit liegt das Projektleiter-GO für diesen Plan vor. **Es fehlt weiterhin das separate, explizite Implementierungs-GO des Nutzers** (zweite Freigabestufe, siehe `PHASE_5_STARTPROMPT.md` und die Zweistufigkeit aus Phase 3A/3B) — erst danach beginnt AP1 aus Abschnitt 16.
