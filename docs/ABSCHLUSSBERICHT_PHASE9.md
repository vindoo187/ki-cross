# Abschlussbericht Phase 9 – Regel-Editor (RuleSetVersion/EligibilityRule etc.)

Stand: 2026-08-19. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (gleiches Prinzip wie in den Abschlussberichten der Vorphasen).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Commit-Verlauf dieser Phase** (`git log --oneline de287fb..c681afe`,
`de287fb` = Berichts-Commit Phase 8):

| Commit    | Inhalt                                                                                   |  CI-Lauf   |                     Ergebnis                      |
| --------- | ---------------------------------------------------------------------------------------- | :--------: | :-----------------------------------------------: |
| `7b70ea6` | AP0 – Discovery (`PHASE_9_DISCOVERY.md`, keine Implementierung)                          |            |                         –                         |
| `d8a419f` | Implementierungsplan (Entwurf)                                                           |            |                         –                         |
| `6a8c085` | ChatGPT-Entscheidungen zu 4 offenen Plan-Fragen eingearbeitet, finales GO                |   CI #49   |     **Cancelled** (Infra, siehe Abschnitt 9)      |
| `495b1a2` | AP1 – Rule-Admin-RBAC (`config.rules.view/edit/publish`)                                 | gebündelt¹ |                         –                         |
| `6bacf80` | AP2 – RuleSet-/Version-Management API                                                    | gebündelt¹ |                         –                         |
| `94eb79e` | AP3 – Rule-CRUD für den flachen Condition-Baum (4 Regeltypen)                            | gebündelt¹ |                         –                         |
| `a3064c0` | AP4 – Serverseitiger RuleSet-Validator                                                   |   CI #50   |                    **Failure**                    |
| `e9046c7` | AP5 – Mandantenweiter Publish-Workflow                                                   | gebündelt² |                         –                         |
| `b74b219` | AP6 – Versionshistorie + Rollback                                                        | gebündelt² |                         –                         |
| `dfd234c` | AP7 – Audit-Re-Prüfung der Mutationskette AP1–AP6                                        | gebündelt² |                         –                         |
| `99e32a9` | AP8 – Admin-UI für den Regel-Editor                                                      | gebündelt² |                         –                         |
| `7985d7a` | AP9 – RuleSetVersion-Auswertung auf Auswertungszeitpunkt korrigiert                      | gebündelt² |                         –                         |
| `95d71a1` | AP9 – Nebenläufigkeitstest für mandantenweiten Publish-Workflow                          | gebündelt² |                         –                         |
| `d2e816e` | AP9 – Publish-Konflikt bei echter Nebenläufigkeit sauber auf 409 gemappt                 | gebündelt² |                         –                         |
| `cc887d6` | AP9 – `/admin/rules` E2E-Testsuite (Playwright)                                          |   CI #51   |                    **Failure**                    |
| `32a518d` | Fix CI #51 – `audit_logs`-FK-Verletzung durch erfundenen `randomUUID()`-Actor            |   CI #52   |                    **Failure**                    |
| `055731e` | Fix CI #52 – weitere FK-Verletzung + Draft-Guard-Bug (Rollback-Fixture)                  |   CI #53   |                    **Failure**                    |
| `cab20ce` | Fix CI #53 – zwei echte Testfixture-Bugs (Overlap-Constraint, ungültiger `attributeKey`) | gebündelt³ |                         –                         |
| `fab1ed6` | Diagnose – EXCLUDE-Constraint-Existenz vor Nebenläufigkeits-Fix geprüft                  |   CI #54   |                    **Failure**                    |
| `927b573` | Fix CI #54 – echte Nebenläufigkeits-Lücke behoben (Tenant-Row-Lock)                      |   CI #55   |                    **Failure**                    |
| `7774b39` | Fix CI #55 – fehlender `uuid`-Typ-Cast im Tenant-Row-Lock                                |   CI #56   |                    **Failure**                    |
| `4e0a280` | Diagnose – DB-Endzustand im Concurrency-Test vor Assertion erfasst                       |   CI #57   |                    **Failure**                    |
| `1cc43d6` | AP9 – Concurrency-Test-Semantik korrigiert (Tenant-Lock serialisiert korrekt)            |   CI #58   |          **Failure** (neuer E2E-Befund)           |
| `b24d0f1` | AP9 E2E-Befund 1 – `copyFromVersionId` auf RuleSet-Liste ergänzt                         |   CI #59   |          **Failure** (neuer E2E-Befund)           |
| `1c9e072` | AP9 E2E-Befund 2 – Draft-Label pro Playwright-Projekt eindeutig gemacht                  |   CI #60   | **Failure** (neuer E2E-Befund, nach Infra-Hänger) |
| `c681afe` | AP9 E2E-Befund 3 – v1-Referenzen über `href` statt Label                                 | **CI #61** |                    **Success**                    |

¹ `495b1a2`/`6bacf80`/`94eb79e` wurden zusammen mit `a3064c0` in einem
Push übertragen – CI lief einmal auf dem damaligen `HEAD` (`a3064c0` = CI
#50), nicht separat je Commit (Trigger `on: push`, nicht `on: commit`).
² `e9046c7` bis `d2e816e` wurden zusammen mit `cc887d6` in einem Push
übertragen – CI lief einmal auf `cc887d6` (CI #51).
³ `cab20ce` wurde zusammen mit `fab1ed6` in einem Push übertragen – CI
lief einmal auf `fab1ed6` (CI #54).

Maßgeblich für den technischen Nachweis dieser Phase ist **CI #61** auf
dem finalen Stand `c681afe` – dieser Lauf deckt den gesamten kumulierten
Codestand von AP1 bis AP9 ab (24/24 E2E-Tests, Desktop + Tablet, siehe
Abschnitt 10/11). Zwölf Zwischenläufe (CI #50–#60) schlugen fehl – **alle
waren echte, von CI gefundene Bugs bzw. Testfixture-/Testisolationsfehler,
keine Sandbox-Artefakte**; Root Causes und Fixes siehe Abschnitt 7/8. `git
status` zum Zeitpunkt der Fertigstellung dieses Berichts: sauber bis auf
die für diesen Bericht gehörenden Dokumentationsänderungen und die seit
Phase 7/8 bekannten untracked Altlasten (Abschnitt 13).

## 1. Technische Versionen

Unverändert gegenüber Phase 8 – **keine neuen Abhängigkeiten** in Phase 9
(`git diff --stat de287fb..c681afe -- package.json package-lock.json`
liefert keine Treffer):

- Node.js: `>=20.11 <23` (`package.json` `engines.node`)
- Paketmanager: npm (`packageManager: "npm@10.9.4"`)
- Next.js: `^15.5.22`
- React / React-DOM: `^19.2.8`
- Prisma / `@prisma/client`: `^6.19.3`
- Zod: `^3.25.76`
- TypeScript: `^5.9.3`
- Vitest: `^3.2.7`, `@playwright/test`: `^1.62.1`
- ESLint: `^9.19.0`, Prettier: `^3.4.2`

## 2. Ausgangslage und Ziel der Phase

Vor Phase 9 existierte das Regel-Datenmodell (`RuleSet`, `RuleSetVersion`,
`EligibilityRule`/`ExclusionRule`/`PrioritizationRule`/`CrossSellingRule`
inkl. Bedingungs-Tabellen) bereits vollständig im Schema seit Phase 3B —
identisch zum Zustand der Fragen-Engine vor Phase 8 — aber **ausschließlich
über `prisma/seed.ts` beschrieben, kein Schreibpfad im Code**
(Kernbefund AP0, `PHASE_9_DISCOVERY.md`).

**Zentrale Architektur-Besonderheit, bereits in AP0 identifiziert:** anders
als bei `QuestionnaireVersion` (ACTIVE-Scope pro Questionnaire) gilt bei
`RuleSetVersion` ein **mandantenweiter** ACTIVE-Scope — höchstens **eine**
`RuleSetVersion` über **alle** `RuleSet`s eines Mandanten hinweg darf
gleichzeitig ACTIVE sein. Diese Semantik durfte nicht 1:1 aus dem
Phase-8-Muster (`publishDraftVersion()`) kopiert werden und ist der
Kernunterschied dieser Phase (Abschnitt 4).

**ChatGPT-Scope-Entscheidung:** Phase 9 = Regel-Editor für den bereits
strukturierten Regelbaum (Draft → Validate → Publish → Historie →
Rollback → Audit, gleiche RBAC-Architektur wie Phase 8), **ohne**
visuellen Regel-Baukasten (die Praxis-Komplexität im Seed ist gering: nur
flache UND-Verkettungen, keine verschachtelten AND/OR-Bäume, siehe
`PHASE_9_DISCOVERY.md` Abschnitt 2).

## 3. Umfang dieser Phase (AP0–AP10)

- **AP0** – Discovery (`PHASE_9_DISCOVERY.md`, 187 Zeilen): Ist-Analyse
  von Datenmodell, mandantenweitem ACTIVE-Scope, Regelbaum-Komplexität,
  Validierungsbedarf, Session-Pinning-Frage.
- **Implementierungsplan** (`PHASE_9_IMPLEMENTATION_PLAN.md`, 380 Zeilen):
  ChatGPT-GO mit vier verbindlichen Entscheidungen (Abschnitt 15 des
  Plans): (1) Rollenmodell additiv zu `config_editor`/`config_publisher`,
  keine neuen Rollen; (2) Referenzintegrität von `questionId` gegen die
  aktuell ACTIVE `QuestionnaireVersion`; (3) `priority` nicht negativ,
  `weight`/`fitWeight` negativ zulässig (Engine unterstützt das); (4)
  AP-Struktur AP9 (Security/Regression inkl. Concurrency-Test) getrennt
  von AP10 (Hardening/CI) und AP11 (Abschlussbericht).
- **Zentrale Leitplanke (bindend, aus AP0):** `ConsultationSession` bekommt
  KEIN `ruleSetVersionId`-Feld — Regeln werden bei **jeder**
  Empfehlungs-Generierung neu aufgelöst ("Questionnaire = Session-Pinning
  / RuleSet = Evaluation-Snapshot"), im Gegensatz zu Fragen, die einmalig
  beim Session-Start gepinnt werden. Mit einem echten Testfall bewiesen
  (Abschnitt 8, `recommendation-ruleset-snapshot.test.ts`).
- **AP1** – Rule-Admin-RBAC: `config.rules.view/edit/publish` additiv zu
  den bestehenden `config_editor`/`config_publisher`-Rollen.
- **AP2** – RuleSet-/Version-Management API: Liste, Detail, Draft anlegen
  (inkl. RuleSet-übergreifender Kopie via `copyFromVersionId`).
- **AP3** – Rule-CRUD für den flachen Condition-Baum: CRUD-Routen für alle
  vier Regeltypen (Eligibility/Exclusion/Prioritization/CrossSelling),
  jeweils mit ihrer 1:n-Condition-Tabelle.
- **AP4** – Serverseitiger RuleSet-Validator (`validateDraftRuleSetVersion()`,
  rein lesend), stützt sich auf bereits vorhandene Bausteine
  (`assertValidConditionSource()`, `assertOperatorAllowedForAttribute()`,
  `getAttributeDefinition()`) plus neue, regel-spezifische Prüfungen
  (Referenzintegrität `questionId`, Eindeutigkeit `reasonCode`,
  Pflichtfelder, `suggestedProductVersionId`).
- **AP5** – Mandantenweiter Publish-Workflow (`publishRuleSetVersion()`):
  EXPIRE der vorherigen mandantenweiten ACTIVE-Version **unabhängig vom
  RuleSet**, dann Ziel-Draft → ACTIVE, dann Audit — in einer Transaktion
  (Abschnitt 4).
- **AP6** – Versionshistorie + Rollback (`getRuleSetVersionHistory()`,
  `rollbackToRuleSetVersion()`) — analog Phase 8, Deep-Copy einer
  historischen Version als neuer Draft.
- **AP7** – Audit-Re-Prüfung der Mutationskette AP1–AP6 gegen die
  tatsächlichen UI-Mutationspfade.
- **AP8** – Admin-UI für den Regel-Editor (`/admin/rules`,
  `/admin/rules/[id]/versions/[versionId]`, `RuleDraftEditor` (851
  Zeilen), `RuleVersionActionsBar`, `RuleVersionHistoryPanel`).
- **AP9** – Security/Regression **plus** Hardening/CI (in der tatsächlichen
  Umsetzung zusammengeführt — alle Implementierungs-Commits dieses Blocks
  tragen das Präfix "Phase 9 AP9", siehe Commit-Tabelle): RuleSet-Timing-Fix
  (Abschnitt 6), Nebenläufigkeitstest für den mandantenweiten
  Publish-Workflow (Abschnitt 7, "einer der wichtigsten Punkte des Plans"
  laut ChatGPT), Publish-Konflikt-Mapping auf 409, vollständige
  Playwright-E2E-Testsuite (Desktop + Tablet), sowie der gesamte
  CI-Härtungszyklus CI #50–#61 (Abschnitt 7/8).
- **AP10** – dieser Abschlussbericht (im ursprünglichen Plan als AP11
  vorgesehen — durch die Zusammenführung von AP9/AP10 im tatsächlichen
  Ablauf um eins vorgerückt, gleiches inhaltliches Ergebnis).

Von ChatGPT final abgenommen am 2026-08-19 auf Basis von CI #61
("Ja. AP9 ist damit final abgenommen. [...] Damit ist die komplette
Phase-9-Kette tatsächlich durch die CI bestätigt.").

## 4. Architektur: mandantenweiter Draft → Validate → Publish

**Zustandsmaschine** (`VersionStatus` auf `RuleSetVersion`, identisch zum
Phase-8-Enum):

```
DRAFT --validate()--> DRAFT (mit Validierungsergebnis, keine Statusänderung)
DRAFT --publish()--> ACTIVE (vorherige MANDANTENWEITE ACTIVE-Version -> EXPIRED)
```

**Kernunterschied zu Phase 8 (Questionnaire):** `publishRuleSetVersion()`
sucht die vorherige ACTIVE-Version **ohne** `ruleSetId`-Filter — bewusst,
weil der DB-EXCLUDE-Constraint `rule_set_versions_tenant_active_no_overlap`
NUR über `tenantId` definiert ist, nicht über `ruleSetId`. Ein Draft unter
einem beliebigen `RuleSet` zu veröffentlichen beendet die aktuell aktive
Version eines möglicherweise **komplett anderen** `RuleSet` desselben
Mandanten. Diese Semantik war die zentrale, bereits in AP0 identifizierte
Anforderung, die nicht 1:1 aus `publishDraftVersion()` (Questionnaire)
kopiert werden durfte.

**Transaktionsreihenfolge** in `publishRuleSetVersion()` (identisch zu
Phase 8, plus einen neuen Schritt 0, siehe Abschnitt 7):

```
0. Tenant-Row-Lock:  SELECT id FROM tenants WHERE id = $1 FOR UPDATE
a. vorherige mandantenweite ACTIVE-Version (falls vorhanden, aus
   BELIEBIGEM RuleSet) -> EXPIRED (validTo = now)
b. Ziel-Draft per updateMany({where:{id,status:"DRAFT"}}) -> ACTIVE
   (Race-Guard: count !== 1 wirft, gesamte Transaktion rollt zurück)
c. AuditLog (action:"ACTIVATE") in derselben Transaktion
```

Anders als bei Questionnaire/Question gibt es hier **keinen** Schritt
"Kind-Versionen aktivieren" — die vier Regeltypen haben keinen eigenen
Status, nur die `RuleSetVersion` selbst wird versioniert.

**Rollback** ist wie in Phase 8 kein Statuswechsel einer alten Version,
sondern ein neuer Publish-Vorgang: `rollbackToRuleSetVersion()` erzeugt
eine neue DRAFT-Version als vollständige Tiefkopie einer historischen
Version und durchläuft danach regulär `validateDraftRuleSetVersion()`/
`publishRuleSetVersion()`.

**Publish-Konflikt-Mapping (AP9, `d2e816e`):** ein Verlierer eines echten
Wettlaufs erhält keinen rohen 500 mehr. `translatePublishError()` (in
`rule-admin.ts`, exportiert für Tests) erkennt **ausschließlich** den
bekannten Constraint-Namen `rule_set_versions_tenant_active_no_overlap` in
der rohen Prisma-Fehlermeldung (kein `P2002`-Code verfügbar, da der
Constraint nicht in `schema.prisma` modelliert ist) und übersetzt nur
diesen einen Fall in `RuleSetVersionPublishConflictError` → HTTP 409; jeder
andere Fehler wird unverändert weitergeworfen.

## 5. Schema-/Migrationsänderungen

**Keine neue Migration und keine Änderung an `prisma/schema.prisma`** in
Phase 9 (`git diff --stat de287fb..c681afe -- 'prisma/migrations/*'
prisma/schema.prisma` liefert keine Treffer). Das komplette
Regel-Datenmodell inkl. des mandantenweiten EXCLUDE-Constraints
`rule_set_versions_tenant_active_no_overlap` existierte bereits seit der
Migration `20260801130000_recommendation_engine` (Phase 3B) — Phase 9 hat
ausschließlich Schreibpfade in `src/` für ein bereits vollständiges Schema
gebaut, identisch zum Muster von Phase 8.

## 6. RuleSet-Timing-Korrektur (AP9, `7985d7a`)

**Befund:** `evaluate()` (`src/server/recommendation/service.ts`, seit
Phase 3B) verwendete für alle vier zeitabhängigen Konfigurationsquellen
(`QuestionVersion`, `RuleSetVersion`, `ProductVersion`,
`CommissionModelVersion`) einheitlich `atTime = session.startedAt`. Für
`RuleSetVersion` war das ein vorbestehender Korrektheitsfehler: eine
`RuleSetVersion`, die nach Session-Start per Publish EXPIRED wird, erfüllt
den Auswahlfilter (`validFrom <= atTime AND (validTo IS NULL OR validTo >
atTime)`) für `atTime = session.startedAt` weiterhin — eine erneute
Auswertung derselben, noch laufenden Session verwendete dadurch dauerhaft
die zum Session-Start aktive, ggf. längst abgelöste `RuleSetVersion`. Erst
durch den in Phase 9 eingeführten echten Publish-Workflow wurde dieser
Befund praktisch relevant.

**Entscheidung (ChatGPT-Vorgabe, dokumentiert in `docs/DECISION_LOG.md`):**

- `RuleSetVersion`-Auflösung verwendet ab sofort den tatsächlichen
  Auswertungszeitpunkt (`ruleSetAt = new Date()`), nicht mehr
  `session.startedAt`. `Recommendation.ruleSetVersionId` speichert
  weiterhin unveränderlich (append-only) je Auswertung, welche Version
  tatsächlich verwendet wurde.
- `QuestionVersion`-Auflösung (`questionnaireAt = session.startedAt`)
  bleibt unverändert Session-gepinnt.
- `ProductVersion`-/`CommissionModelVersion`-Auflösung
  (`commercialAt = session.startedAt`) bleiben ABSICHTLICH ebenfalls
  Session-gepinnt (Preis-/Provisionsstabilität während einer laufenden
  Beratung) — eine eigenständige, bewusst getroffene Entscheidung, keine
  versehentliche Inkonsistenz.

**Test:** `tests/integration/recommendation-ruleset-snapshot.test.ts`
bildet den von ChatGPT vorgegebenen Kern-Testfall nach: Session startet
mit RuleSet v1 (aktiv), v2 wird über den echten `publishRuleSetVersion()`-
Pfad veröffentlicht (v1 dadurch mandantenweit EXPIRED), dieselbe Session
wird erneut ausgewertet und muss v2 verwenden, während
`questionnaireVersionId` der Session unverändert bleibt.

## 7. Der Concurrency-Test-Lernprozess (AP9, CI #51–#58)

Dies ist der detaillierteste Härtungsverlauf der bisherigen
Projektgeschichte und wird hier bewusst vollständig nachvollziehbar
dokumentiert (ChatGPT-Auflage für diesen Bericht).

**Ausgangspunkt (`95d71a1`):** ein neuer Test in
`rule-admin-publish.test.ts` führt zwei **echte** parallele
`publishRuleSetVersion()`-Aufrufe für verschiedene DRAFT-Versionen
verschiedener `RuleSet`s desselben Mandanten aus (`Promise.allSettled()`,
kein sequentielles `await`) und prüft die Invariante "höchstens eine
ACTIVE `RuleSetVersion` pro Mandant".

**CI #51–#53 – zunächst reine Testfixture-Bugs, kein Produktcode-Problem:**
mehrere neue Phase-9-Integrationstests liefen vor dem ersten Batch-Push nie
gegen echte Postgres (Sandbox-Limitierung, `npx vitest run` nicht
ausführbar). Erste echte CI-Ausführung deckte klassische Erstausführungs-
Bugs auf: erfundene `randomUUID()`-Actors ohne zugehörige `User`-Zeile
verletzten die `audit_logs`-FK (`32a518d`, `055731e`), ein Rollback-Fixture
nutzte die echten Draft-CRUD-Funktionen für eine bewusst bereits-ACTIVE
Quellversion (`RuleSetVersionNotDraftError`), zwei ACTIVE-Versionen in
einer Fixture überlappten sich zeitlich (`cab20ce`).

**CI #53 – erster ernsthafter Befund:** nach Behebung der obigen
Fixture-Bugs zeigte der Concurrency-Test selbst einen echten Fehlschlag —
zwei echt parallele Publishes lieferten **2 statt maximal 1** erfolgreichen
Abschluss. ChatGPT-Vorgabe: _"erst beweisen, dann fixen"_ — vor jeder
Änderung an `publishRuleSetVersion()` musste ein gezielter Diagnosetest
zeigen, ob der EXCLUDE-Constraint in der CI-Postgres-Instanz überhaupt
korrekt existiert.

**CI #54 (`fab1ed6`):** neuer Diagnosetest ("DIAGNOSE: EXCLUDE-Constraint
... existiert und ist btree_gist-basiert") bestätigt via
`pg_constraint`/`pg_get_constraintdef`/`pg_extension`: der Constraint
existiert korrekt — kein Migrations-/CI-Problem, sondern ein **echter
Race** in `publishRuleSetVersion()`.

**Root Cause:** existiert zum Zeitpunkt zweier echt paralleler Publishes
noch **keine** vorherige ACTIVE-Version desselben Mandanten, gibt es keine
gemeinsame Zeile, auf die sich beide Transaktionen synchronisieren
könnten — beide `updateMany()`-Aufrufe auf zwei verschiedenen Draft-Zeilen
committen dann parallel erfolgreich, bevor der GiST-Index die
Zeitfenster-Überlappung als Konflikt erkennt.

**Fix (`927b573`, ChatGPT-Vorgabe):** `publishRuleSetVersion()` sperrt
jetzt als **erste** Operation der Transaktion die `tenants`-Zeile des
aktuellen Mandanten (`SELECT ... FROM tenants WHERE id = $1 FOR UPDATE`) —
diese Zeile existiert immer, anders als eine vorherige ACTIVE-Version. Das
serialisiert alle Publish-Transaktionen desselben Mandanten vollständig
und macht den EXCLUDE-Constraint zum reinen Backstop statt zum alleinigen
Schutz. Rohes SQL ist hier zulässig, da `Tenant` ein `GLOBAL_MODEL` ist
(siehe `scoped-client.ts`).

**CI #55 (`7774b39`):** eigener Folgefehler im Lock-Fix selbst — die
`tenants.id`-Spalte ist `uuid`, Prisma übergab den Parameter ohne
expliziten Cast als `text` ("operator does not exist: uuid = text").
Direkt behoben (kein Testfixture-Bug, sondern ein echter Code-Fehler im
eigenen Fix).

**CI #56/#57 – Beweisführung des korrekten Verhaltens statt weiterer
Produktcode-Änderung:** der Concurrency-Test scheiterte weiterhin
("expected 2 to be less than or equal to 1"), aber ohne Evidenz, _warum_.
ChatGPT-Vorgabe (`4e0a280`): DB-Endzustand (ACTIVE-Anzahl, Draft-Status
beider Versionen, `ACTIVATE`-Audit-Count) **vor** der scharfen Assertion
erfassen und bei Fehlschlag ausgeben, um zwischen zwei möglichen Fällen zu
unterscheiden: (A) der Tenant-Lock verhindert den Race technisch nicht,
oder (B) der Lock serialisiert korrekt, aber beide Publishes sind dabei
sequentiell erfolgreich.

**CI #57/#58 – der Beweis (Fall B):** der Diagnose-Block bestätigte: der
Tenant-Row-Lock funktioniert korrekt (`activeCount=1`, kein Doppel-ACTIVE,
Verlierer sauber EXPIRED), aber beide parallelen Publishes waren
**technisch erfolgreich** (`fulfilledCount=2`, keine Rejections,
`activateAuditCount=2`) — weil `publishRuleSetVersion()` einen während der
eigenen Wartezeit neu entstandenen `previousActive` **by design**
automatisch übernimmt, statt abzulehnen. Das ist konsistent mit der
Architekturregel "Publish ersetzt die aktuell aktive Regelkonfiguration
des gesamten Mandanten".

**Finale Entscheidung (ChatGPT, `1cc43d6`): kein Produktcode-Eingriff.**
Die ursprüngliche Testerwartung ("genau ein Gewinner, der andere muss
fehlschlagen") wurde durch die tatsächlich bewiesene und fachlich korrekte
Invariante ersetzt:

> Nach beliebig vielen parallelen, validen Publishes existiert exakt eine
> ACTIVE-Version, und jeder tatsächlich erfolgreiche Publish ist
> vollständig und genau einmal auditiert.

Testname und Assertions wurden entsprechend aktualisiert, keine feste
Gewinner-Reihenfolge mehr erwartet. Der Diagnose-Block aus `4e0a280` bleibt
als dauerhaftes Sicherheitsnetz erhalten.

**Bewertung dieses Verlaufs:** acht CI-Iterationen (CI #51–#58) für einen
einzigen Testfall — durchgängig nach dem Muster "erst beweisen, dann
fixen", mit expliziter ChatGPT-Konsultation vor jeder Produktcode-Änderung
und einem Diagnosetest, bevor überhaupt ein Fix versucht wurde. Das Ergebnis
ist kein Produktbug, sondern eine präzisierte, jetzt mit einem echten
Concurrency-Test bewiesene fachliche Invariante.

## 8. Drei E2E-Befunde dieser Session (AP9, CI #58–#61)

Nachdem der Concurrency-Test-Verlauf (Abschnitt 7) abgeschlossen war,
zeigte CI #58 erstmals einen **neuen, unabhängigen** Fehlschlag im
Playwright-E2E-Test `admin-rules.spec.ts:134` (Regel-Editor Happy Path:
DRAFT bearbeiten → Validate → Publish → Historie → Rollback → Validate →
Publish) — ein 3-Minuten-Timeout beim Klick auf den "Bearbeiten"-Button
eines frisch erstellten Entwurfs. Dieser Befund durchlief drei
aufeinanderfolgende, jeweils per ChatGPT-Konsultation vor Code-Änderung
abgestimmte Runden:

**Befund 1 (Produktbug, `b24d0f1`):** `src/app/admin/rules/page.tsx` (die
RuleSet-Liste) rief `<CreateDraftRuleSetVersionButton ruleSetId={rs.id}
label="Neuen Entwurf erstellen" />` **ohne** `copyFromVersionId` auf —
anders als die Detailseite, die korrekt
`copyFromVersionId={versionId}` übergibt. Ohne `copyFromVersionId` bleibt
`sourceVersionId` in `createDraftRuleSetVersion()` `null`, wodurch
`copyRuleSetVersionContents()` nie aufgerufen wird — jeder von der Liste
aus erstellte Entwurf war **permanent leer**, unabhängig davon, welche
Version gerade aktiv war. Das erklärte den Timeout: die Regel
"e2e_ausreichendes_datenvolumen" existierte im frischen Entwurf schlicht
nicht, der "Bearbeiten"-Button erschien nie.

**Fix (ChatGPT-Vorgabe, mit explizitem Guardrail):**
`page.tsx` ermittelt jetzt pro `RuleSet` `const activeVersion =
rs.versions.find((v) => v.status === "ACTIVE")` und übergibt
`copyFromVersionId={activeVersion?.id}` — explizit **kein** Fallback auf
eine beliebige historische Version, falls keine ACTIVE-Version existiert
(dann bleibt `copyFromVersionId` weiterhin `undefined`, bewusst
unverändertes altes Verhalten für diesen Randfall). Verifiziert: CI #59
zeigte den ursprünglichen Testfall auf `desktop-chromium` in 2,4 Sekunden
grün (vorher 3-Minuten-Timeout).

**Befund 2 (Testisolation, `1c9e072`):** CI #59 zeigte einen **neuen**
Fehlschlag, ausschließlich auf `tablet-ipad-landscape` — eine
Playwright-Strict-Mode-Violation, weil zwei Versionen mit identischem
Label "E2E Entwurf v2" existierten. Root Cause: `tests/e2e/global-setup.ts`
seedet die Test-DB genau **einmal** für die gesamte Suite,
`playwright.config.ts` hat `fullyParallel: true` mit zwei Projekten
(Desktop-Chromium, Tablet-iPad-Landscape), die gegen **denselben**
`webServer`/dieselbe DB laufen. Der mutierende Test verwendete ein festes,
per `window.prompt()` eingegebenes Draft-Label — beide Projekt-Instanzen
erzeugten dadurch unabhängig voneinander eine Version mit demselben Label
im selben `RuleSet`.

**Fix:** `draftLabel = \`E2E Entwurf v2 (${testInfo.project.name})\`` —
das Label wird pro Playwright-Projekt eindeutig gemacht (`testInfo`aus
dem Testkontext). Explizite Guardrails aus dem GO: kein`.first()`, keine
Änderung an `RuleSetVersion.label`-Schema, kein Eingriff in
`global-setup.ts`/`seed-e2e.ts`.

**Befund 3 (Testisolation, `c681afe`):** nachdem Befund 2 behoben war,
zeigte ein erneuter CI-Lauf (nach einem separaten, unten beschriebenen
Infrastruktur-Hänger, siehe Abschnitt 9) einen **dritten**, strukturell
verwandten Kollisionsfehler — wieder nur auf `tablet-ipad-landscape`, in
der Historie-Prüfung des Tests: der Locator für die ursprüngliche
Seed-Version "E2E Standardregeln v1" matchte zwei Elemente statt eines,
weil ein bereits vom Desktop-Projekt durchgeführter Rollback eine neue
Version mit dem generierten Label `Rollback von "E2E Standardregeln v1"
(...)` erzeugt hatte — der unverankerte Regex-Locator matchte diesen
Teilstring ebenfalls.

**Fix (ChatGPT-Vorgabe, robuster Ansatz statt weiterer Text-Heuristik):**
statt das Label weiter zu verschärfen, ermittelt der Test die konkrete
`href` der ursprünglichen v1-Version jetzt **einmalig ganz zu Testbeginn,
vor jeder Mutation durch dieses oder das parallele Projekt**, und
referenziert sie danach ausschließlich über einen CSS-Attribut-Selektor
(`a[href="..."]`) statt über Text-/Regex-Matching. Explizite Guardrails:
kein `.first()`/`.nth(0)`, kein komplizierterer Regex, keine Änderung an
Produktcode oder `seed-e2e.ts`. ChatGPTs allgemeiner Testdesign-Grundsatz
dazu: _"Bei mutierenden E2E-Tests niemals eine historische Entität
ausschließlich über einen nicht-eindeutigen Anzeigenamen referenzieren,
wenn deren stabile ID verfügbar ist."_

**Ergebnis:** CI #61 (`c681afe`) — 24/24 Playwright-E2E-Tests grün auf
beiden Projekten (Desktop + Tablet), inklusive des ursprünglichen
Testfalls auf `tablet-ipad-landscape` in 4,8 Sekunden.

## 9. Infrastruktur-Anomalien (kein Code-Bezug)

Zwei GitHub-Actions-Läufe dieser Phase zeigten Verhalten, das eindeutig
nicht auf Code-Änderungen zurückzuführen war:

- **CI #49** (`6a8c085`, reiner Dokumentations-Commit ohne Code-Änderung):
  Status "Cancelled" nach 6h 1min — der GitHub-Actions-Standard-Job-Timeout
  (6 Stunden) griff, ohne dass der Lauf jemals ein sinnvolles Ergebnis
  geliefert hätte. Da der Commit ausschließlich `PHASE_9_IMPLEMENTATION_PLAN.md`
  änderte, ist ein Code-Zusammenhang ausgeschlossen.
- **CI #60** (`1c9e072`, Attempt 1): der Schritt "Playwright-Browser
  installieren (Chromium + WebKit)" hing über 20 Minuten fest (vs. 46s–5m6s
  in allen anderen Läufen dieser Phase), Log-Fortschritt komplett
  eingefroren, obwohl dieser Schritt (`npx playwright install --with-deps`)
  keinerlei Repository-Code berührt. Der Lauf wurde manuell abgebrochen
  ("Cancel workflow") und über "Re-run all jobs" neu gestartet — der
  zweite Versuch (Attempt 2) lief normal durch (4m34s) und zeigte den in
  Abschnitt 8 beschriebenen Befund 3.

Beide Anomalien wurden als reine GitHub-Actions-Infrastruktur-Aussetzer
bewertet (kein Zusammenhang zu Repository-Code) und ohne weitere
ChatGPT-Konsultation operativ behoben (Cancel/Re-run), da es sich um eine
reine CI-Betriebsmaßnahme handelt, keine Code- oder Testdesign-Entscheidung.

## 10. Anzahl und Art aller Tests

Vier Testebenen, insgesamt **721 Testfälle** (627 aus Phase 8 + 94 neu in
Phase 9), grep-basiert gezählt (`grep -crE '^\s*it\(|^\s*test\('` je Datei,
konsistent mit der Zählmethode der Vorphasen-Berichte):

| Ebene                                    | Phase 8 | Neu in Phase 9 | Gesamt Phase 9 | Neue/geänderte Dateien                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------: | -------------: | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`npm run test:unit`)               |     327 |             14 |            341 | `tests/unit/authz/config-permissions.test.ts` (+5 auf 17), `tests/unit/authz/seed-role-permissions.test.ts` (+3 auf 13), `tests/unit/admin/rule-admin-publish-error-mapping.test.ts` (6, neu)                                                                                                                       |
| Component (`npm run test:component`)     |     117 |              0 |            117 | keine neuen Component-Tests in Phase 9                                                                                                                                                                                                                                                                              |
| Integration (`npm run test:integration`) |     176 |             75 |            251 | `tests/integration/rule-admin-crud.test.ts` (15, neu), `rule-admin-publish.test.ts` (11, neu), `rule-admin-rollback.test.ts` (13, neu), `rule-admin-validate.test.ts` (15, neu), `rule-admin.test.ts` (16, neu), `rule-admin-audit-regression.test.ts` (4, neu), `recommendation-ruleset-snapshot.test.ts` (1, neu) |
| E2E (`npm run test:e2e`)                 |       7 |              5 |             12 | `tests/e2e/admin-rules.spec.ts` (5, neu)                                                                                                                                                                                                                                                                            |
| **Gesamt**                               | **627** |         **94** |        **721** |                                                                                                                                                                                                                                                                                                                     |

**Inhalt der zentralen neuen Testdateien** (ausschließlich echte
Postgres-/Playwright-Fixtures, kein Mocking der DB-Schicht):

- `rule-admin-crud.test.ts` (645 Zeilen) — Draft-CRUD aller vier
  Regeltypen inkl. Conditions, RBAC-Grenzen, 409-Sperren gegen Mutation
  nicht-DRAFT-Versionen.
- `rule-admin-validate.test.ts` (685 Zeilen) — serverseitiger Validator:
  Referenzintegrität, Wertebereiche, Pflichtfelder, Eindeutigkeit.
- `rule-admin-publish.test.ts` (487 Zeilen) — mandantenweiter
  Publish-Workflow inkl. des in Abschnitt 7 beschriebenen echten
  Concurrency-Tests und des EXCLUDE-Constraint-Diagnosetests.
- `rule-admin-rollback.test.ts` (537 Zeilen) — Versionshistorie, Rollback
  als Deep-Copy, regulärer Durchlauf durch den Publish-Pfad.
- `rule-admin.test.ts` (554 Zeilen) — RuleSet-/Version-Management-API
  (Liste, Detail, Draft-Erstellung inkl. RuleSet-übergreifender Kopie).
- `rule-admin-audit-regression.test.ts` (289 Zeilen) — Audit-Vollständigkeit
  über die gesamte Mutationskette AP1–AP6.
- `recommendation-ruleset-snapshot.test.ts` (319 Zeilen) — der in
  Abschnitt 6 beschriebene RuleSet-Timing-Beweis.
- `tests/e2e/admin-rules.spec.ts` (340 Zeilen, 5 Testfälle) — u. a. der
  vollständige Happy Path aus Abschnitt 8 (DRAFT → Validate → Publish →
  Historie → Rollback → Validate → Publish), auf beiden Playwright-
  Projekten (Desktop + Tablet).

## 11. Vollständige Prüfkommandos mit Ergebnissen

| Kommando                                                            | Ergebnis                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` (Stand `c681afe`)                                      | sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen und die bekannten untracked Altlasten (Abschnitt 13)                                                                                                                                                                                            |
| `npx tsc --noEmit`                                                  | durchgängig identisch zur bekannten 17-Fehler-Baseline (9 `passwordHash`-, 2 `AuditAction.DELETE`-, 6 weitere bereits aus Phase 8 bekannte Sandbox-Fehler durch fehlendes `prisma generate` ohne Netzwerk) — keine neuen Fehler, bei jedem der Fixes in Abschnitt 7/8 einzeln gegen die gespeicherte Baseline diffgeprüft |
| `npx eslint .` / `npx eslint <Datei>`                               | durchgängig sauber                                                                                                                                                                                                                                                                                                        |
| `npx prettier --check .` / `--write`                                | durchgängig sauber/unverändert                                                                                                                                                                                                                                                                                            |
| `npx vitest run` (alle vier Testebenen)                             | in dieser Sandbox nicht ausführbar (bekannte, sandboxweite `@rollup/rollup-linux-arm64-gnu`-Limitierung, unverändert seit Phase 2) — Verifikation ausschließlich über CI                                                                                                                                                  |
| GitHub Actions (`vindoo187/ki-cross/actions`, via Claude-in-Chrome) | CI #49–#61 (Details Commit-Tabelle, Abschnitt 0); **CI #61 (`c681afe`): Success, 4m 9s** — maßgeblicher Nachweis für diese Phase                                                                                                                                                                                          |

**CI #61 im Detail:** vollständiger Lauf über den kumulierten Codestand
AP0–AP9, deckt ab: Lint/Prettier/`tsc` sauber, Migrationen gegen echte
Postgres-Test-DB angewendet, alle 709 Unit-/Component-/Integrationstests
grün, Produktions-Build (`next build`) erfolgreich, Playwright-E2E-Tests
**24/24 grün auf beiden Projekten** (Desktop + Tablet), keine Regression
in Phase 2–8. ChatGPT-Bestätigung: _"CI #61 ist der entscheidende Nachweis:
vollständiger Lauf grün, inklusive echter Postgres-Integrationstests und
24/24 Playwright-E2E-Tests auf Desktop + Tablet. Damit ist die komplette
Phase-9-Kette tatsächlich durch die CI bestätigt: RBAC → Tenant-Isolation
→ Rule CRUD → Validation → mandantenweiter Publish → echter
Concurrency-Test → Audit → Rollback → RuleSet-Timing → Admin-UI → E2E
Desktop + Tablet."_

**Sandbox-Einschränkung dieser Sitzung (unverändert seit Phase 2):** `npx
vitest run` konnte in dieser Sandbox nicht direkt ausgeführt werden. Die
tatsächliche Ausführung aller 721 Testfälle ist ausschließlich über die
CI-Läufe #49–#61 belegt, deren Status über Claude-in-Chrome-Browserzugriff
auf die GitHub-Actions-Oberfläche ausgelesen wurde (clientseitig
gerenderte Seite, daher kein statischer `WebFetch`-Abruf). `tsc`/
`eslint`/`prettier` wurden in dieser Sitzung nach jedem einzelnen Fix
tatsächlich lokal ausgeführt.

## 12. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat de287fb..c681afe` (`de287fb` = Berichts-Commit Phase 8,
`c681afe` = letzter Commit dieser Phase): **48 Dateien geändert, 9.341
Zeilen hinzugefügt, 51 Zeilen entfernt.**

```
PHASE_9_DISCOVERY.md                                              |  187 + (neu)
PHASE_9_IMPLEMENTATION_PLAN.md                                    |  380 + (neu)
docs/DECISION_LOG.md                                              |   53 +
prisma/seed-e2e.ts                                                |  171 +-
prisma/seed.ts                                                    |   15 +-
src/app/admin/rules/[id]/versions/[versionId]/page.tsx            |  169 + (neu)
src/app/admin/rules/page.tsx                                      |  130 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  cross-selling-rules/[ruleId]/route.ts                            |   52 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  cross-selling-rules/route.ts                                     |   37 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  eligibility-rules/[ruleId]/route.ts                               |   53 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  eligibility-rules/route.ts                                       |   39 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  exclusion-rules/[ruleId]/route.ts                                 |   52 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  exclusion-rules/route.ts                                         |   37 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  prioritization-rules/[ruleId]/route.ts                            |   52 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  prioritization-rules/route.ts                                    |   37 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  publish/route.ts                                                  |   34 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  rollback/route.ts                                                 |   47 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/route.ts     |   29 + (neu)
src/app/api/admin/rule-sets/[id]/versions/[versionId]/
  validate/route.ts                                                 |   34 + (neu)
src/app/api/admin/rule-sets/[id]/versions/route.ts                 |   57 + (neu)
src/app/api/admin/rule-sets/route.ts                                |   25 + (neu)
src/app/consultation/page.tsx                                       |   11 +
src/app/globals.css                                                  |   30 +
src/components/admin/CreateDraftRuleSetVersionButton.tsx            |   64 + (neu)
src/components/admin/RuleDraftEditor.tsx                            |  851 + (neu)
src/components/admin/RuleVersionActionsBar.tsx                       |  131 + (neu)
src/components/admin/RuleVersionHistoryPanel.tsx                    |  108 + (neu)
src/server/admin/rule-admin-errors.ts                                |  130 + (neu)
src/server/admin/rule-admin.ts                                       | 1932 + (neu)
src/server/admin/rule-schemas.ts                                     |  136 + (neu)
src/server/auth/session.ts                                           |   12 +-
src/server/authz/config-permissions.ts                               |   52 +-
src/server/authz/seed-role-permissions.ts                            |   24 +-
src/server/consultation-ui/http-errors.ts                            |   58 +
src/server/recommendation/service.ts                                 |   50 +-
tests/e2e/admin-rules.spec.ts                                        |  340 + (neu)
tests/e2e/helpers.ts                                                  |   27 +
tests/e2e/seed-output.ts                                             |   14 +
tests/integration/recommendation-ruleset-snapshot.test.ts            |  319 + (neu)
tests/integration/rule-admin-audit-regression.test.ts                |  289 + (neu)
tests/integration/rule-admin-crud.test.ts                            |  645 + (neu)
tests/integration/rule-admin-publish.test.ts                         |  487 + (neu)
tests/integration/rule-admin-rollback.test.ts                        |  537 + (neu)
tests/integration/rule-admin-validate.test.ts                        |  685 + (neu)
tests/integration/rule-admin.test.ts                                 |  554 + (neu)
tests/unit/admin/rule-admin-publish-error-mapping.test.ts            |  103 + (neu)
tests/unit/authz/config-permissions.test.ts                          |   64 +-
tests/unit/authz/seed-role-permissions.test.ts                       |   49 +-
48 files changed, 9341 insertions(+), 51 deletions(-)
```

Zusätzlich mit diesem Berichts-Commit: `docs/ABSCHLUSSBERICHT_PHASE9.md`
(neu, dieses Dokument).

## 13. Vollständige bekannte Einschränkungen

- **Zentrale Sandbox-Einschränkung (unverändert seit Phase 2):**
  `@rollup/rollup-linux-arm64-gnu`-Problem weiterhin ungelöst — `npx
vitest run` lief in dieser Sitzung nicht direkt, Verifikation
  ausschließlich über CI #49–#61.
- **`npx prisma generate` ohne Netzwerkzugriff nicht ausführbar** — führt
  zu der bekannten 17-Fehler-`tsc`-Baseline gegen veraltete lokale
  Client-Typen (unverändert seit Phase 8), kein Produktivcode-Problem.
- **FUSE-Mount-Eigenheit dieser Sandbox** (wiederholt aufgetreten, jedes
  Mal folgenlos gelöst): Git-Befehle hinterließen mehrfach phantomhafte
  `index.lock`/`HEAD.lock`-Dateien — gelöst durch Umbenennen (nicht
  Löschen) der Lock-Datei und Wiederholung des Git-Befehls.
- **Zwei GitHub-Actions-Infrastruktur-Anomalien** (CI #49 Cancelled nach
  6h-Timeout, CI #60 Attempt 1 hing 20+ Minuten im Playwright-Browser-
  Install fest) — beide nachweislich ohne Code-Bezug (Abschnitt 9), durch
  Cancel/Re-run operativ behoben.
- **Acht CI-Iterationen für einen einzigen Concurrency-Testfall** (CI
  #51–#58, Abschnitt 7) — deutlich mehr Iterationen als in Phase 7/8,
  bedingt durch die Kombination aus Sandbox-Testausführungs-Limitierung
  (jeder Fix konnte erst in CI, nie lokal, verifiziert werden) und der
  Tiefe des tatsächlich untersuchten Nebenläufigkeitsproblems.
- **Drei sequenzielle E2E-Testisolationsbefunde** (CI #58–#61, Abschnitt 8)
  — alle auf denselben Grundmechanismus zurückzuführen (Desktop- und
  Tablet-Playwright-Projekt teilen sich dieselbe geseedete Test-DB), nicht
  auf drei unabhängige Ursachen.
- **Keine Rate-Begrenzung, kein User-Lifecycle-System, zwei parallele
  Login-Mechanismen** — alle unverändert aus Phase 8 übernommene,
  bewusste Einschränkungen, siehe `docs/ABSCHLUSSBERICHT_PHASE8.md`
  Abschnitt 12.
- **Bekannte Altlasten** (unverändert seit Phase 7/8): die Dateien
  `.gitignore_smoke_tmp_1786993826` und
  `prisma/migrations/_discarded_20260818170000_questionnaire_version_active_unique/`
  ließen sich aus der Sandbox heraus nicht löschen (FUSE "Operation not
  permitted") — beide untracked, nicht committet, ohne jede Wirkung auf
  Repository/CI. Der Nutzer kann sie bei Gelegenheit manuell per Finder
  entfernen.
- **Testzahlen in Abschnitt 10 sind grep-basiert gezählt**, nicht aus
  einem in dieser Sitzung tatsächlich ausgeführten Testlauf — die
  tatsächliche Ausführung ist ausschließlich über die CI-Läufe #49–#61
  belegt.

## 14. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **Visueller Regel-Baukasten** (verschachtelte AND/OR-Bäume) — bewusst
  außerhalb des Scopes (ChatGPT-Entscheidung AP0, aktuelle Praxis-
  Komplexität rechtfertigt das nicht, siehe Abschnitt 2).
- **`ConsultationSession.ruleSetVersionId`-Pinning** — bewusst NICHT
  eingeführt (zentrale Leitplanke AP0/Abschnitt 3); Regeln bleiben pro
  Auswertung aktuell, anders als Fragen.
- **Campaign-Management, Ziele-Modell, Provisionsmodell-Editor** — bereits
  in Phase 8 explizit außerhalb des Scopes, weiterhin nicht begonnen.
- **Freitext-KI-Angebotsfeature** — bereits in Phase 5 als Backlog-Item
  nach MVP-Abnahme freigegeben, weiterhin nicht begonnen.
- **Rate-Limiting/Brute-Force-Schutz, Passwort-Reset-/Einladungsflow,
  User-Lifecycle-System** — unverändert aus Phase 8 offen.
- **Sidebar-Feature** (AP-Navigation) — bereits vor Phase 8 zurückgestellt,
  weiterhin offen.

## 15. Fazit

Phase 9 hat den Regel-Editor als zweite große Fachadministrations-Fläche
in ki-cross eingeführt — strukturell eng am Phase-8-Muster (Draft →
Validate → Publish → Historie → Rollback → Audit), aber mit einer
substanziell anderen Kernanforderung: dem **mandantenweiten** statt
entity-weiten ACTIVE-Scope von `RuleSetVersion`, korrekt umgesetzt und
durch einen echten, gegen Postgres ausgeführten Nebenläufigkeitstest
bewiesen.

Besonders hervorzuheben sind zwei Verläufe dieser Phase, die den in diesem
Projekt etablierten Konsultationsprozess exemplarisch zeigen: der
Concurrency-Test-Lernprozess (Abschnitt 7, acht CI-Iterationen nach dem
Muster "erst beweisen, dann fixen", der am Ende **keinen** Produktcode-
Eingriff, sondern eine präzisierte, bewiesene fachliche Invariante
lieferte) und die drei aufeinanderfolgenden E2E-Testisolationsbefunde
(Abschnitt 8, jeweils mit vollständiger Root-Cause-Analyse vor jeder
Code-Änderung, der letzte davon mit einer strukturell robusteren
Lösung — Referenzierung über stabile IDs statt Anzeigenamen — statt einer
weiteren kurzfristigen Text-Heuristik).

Der technische Nachweis für die gesamte Phase ist CI #61 (Commit
`c681afe`, grün, 4m9s), der neben Build/TypeScript und allen bestehenden
Regressionstests aus Phase 2–8 auch die 94 neuen Phase-9-Tests (inkl. des
echten Concurrency-Tests und der vollständigen Playwright-E2E-Suite auf
Desktop + Tablet) gegen eine echte Postgres-Datenbank erfolgreich
ausführt. AP9 wurde von ChatGPT auf dieser Basis final abgenommen
("Damit ist die komplette Phase-9-Kette tatsächlich durch die CI
bestätigt"); dieser Bericht (AP10) schließt die Phase formal ab.
