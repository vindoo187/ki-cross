# Abschlussbericht Phase 14: Sales Playbook (Beratungsintelligenz)

Stand: 2026-08-31. Basis-Commit (letzter Phase-13-Commit): `e32bd6f`
("Phase 13 AP10: Abschlussbericht um CI #136-138 Nebenlaeufigkeitsfund/-fix
ergaenzt"). Letzter Phase-14-Commit vor diesem Bericht: `5456d5e` ("Phase 14
AP9: Dokumentation"). Massgeblicher CI-Nachweis fuer den bisherigen Stand:
**CI #154** (GitHub Actions, Commit `5456d5e`, "completed successfully",
4m 46s) unter
https://github.com/vindoo187/ki-cross/actions/workflows/ci.yml?query=branch%3Amain.

## 1. Commit-Historie mit CI-Status

| CI #        | Commit    | Status | Inhalt                                                                                  |
| ----------- | --------- | ------ | --------------------------------------------------------------------------------------- |
| 139 (Basis) | `e32bd6f` | ✅     | Phase 13 AP10: Abschlussbericht Phase 13 (finale Fassung)                               |
| 140         | `7587ed2` | ✅     | Phase 14 AP0: Discovery Sales Playbook / Beratungsintelligenz (kein Code)               |
| 141         | `80ecb2c` | ✅     | Phase 14: PHASE_14_IMPLEMENTATION_PLAN.md entwerfen (reine Planung, kein Code)          |
| 142         | `967793b` | ✅     | Phase 14 Plan: ChatGPT-Entscheidungen zu AP5/AP7 + Retrieval-Leitplanke eingearbeitet   |
| 143         | `219ab3b` | ✅     | AP1: Playbook-Datenmodell + Versionierung + Migration + RBAC                            |
| 144         | `3f4f2e2` | ✅     | AP2: playbook-admin.ts Service-Schicht (CRUD/Versionierung/Publish)                     |
| 145         | `1a20e58` | ✅     | AP3: API-Routen /api/admin/playbooks                                                    |
| 146         | `b855d52` | ❌     | AP4: Retrieval-Selektionsfunktion (playbook-retrieval.ts)                               |
| 147         | `c68f520` | ✅     | AP4 Fix: `noUncheckedIndexedAccess` tsc-Fehler in Testdatei behoben                     |
| 148         | `4795aba` | ✅     | AP5: Security-Grundgeruest (Trust Boundary, strukturell)                                |
| 149         | `e58466b` | ❌     | AP6: Admin-UI /admin/playbooks                                                          |
| 150         | `7c2ec54` | ✅     | AP6 Fix: contact-data-guard False Positive in createPlaybook()/createCampaign() behoben |
| 151         | `102bab8` | ❌     | AP7: Audit/Reproduzierbarkeit (gezielte Regressionstests)                               |
| 152         | `3e105c2` | ✅     | AP7 Fix: falsche Snapshot-Annahme korrigiert (JETZT-Semantik statt Zeitreise-Snapshot)  |
| 153         | `b6559db` | ✅     | AP8: Security/E2E fuer Playbook Management (erster Anlauf gruen)                        |
| **154**     | `5456d5e` | ✅     | **AP9: Dokumentation (DATA_MODEL.md + RECOMMENDATION_ENGINE.md), erster Anlauf gruen**  |

15 Commits im bisherigen Phase-14-Bereich, alle 15 durch CI geprueft. Drei
CI-Laeufe (#146, #149, #151) schlugen zunaechst fehl und wurden im jeweils
unmittelbar folgenden Commit behoben (siehe Abschnitt 9) -- alle uebrigen
zwoelf Laeufe waren im ersten Anlauf gruen. Keine rueckwirkenden
Korrekturen an bereits abgenommenen Arbeitspaketen.

## 2. Technische Versionen

Unveraendert gegenueber Phase 13: TypeScript, Next.js 15, React 19,
Prisma 6, PostgreSQL (echter Service-Container in CI), Zod, Vitest,
Playwright. Kein Dependency-Update in Phase 14 (`git diff
e32bd6f..5456d5e -- package.json package-lock.json` ist leer).

## 3. Ziel und bewusst gesetzte Grenzen der Phase

Nach Abschluss von Phase 13 (Campaign Management) verfuegte die
Recommendation Engine ueber Fragebogen, Regelwerk, Provisionsmodelle,
Ziele und Kampagnen als konfigurierbare Domaenen -- alle direkt in die
Tarifauswahl/Priorisierung eingebunden. Ziel von Phase 14 war ein neues,
davon bewusst getrenntes Domaenenmodell "Sales Playbook": versionierte,
mandantenscopte Text-Bausteine (Argumentationshilfen,
Einwandbehandlung, Produktargumente, Tonalitaetshinweise u. a.), die
Mitarbeitenden in der Beratung als Nachschlagewerk dienen sollen, sowie
eine reine Selektionsfunktion, die zu einem Beratungskontext passende
Abschnitte anhand von Metadaten (nicht Content!) auswaehlen kann.

**Explizit ausgeschlossen (durchgaengige Leitplanke aus
`PHASE_14_IMPLEMENTATION_PLAN.md` Abschnitt 1, von ChatGPT mehrfach
bestaetigt):**

- Keine Integration in die Recommendation Engine (`evaluate()`) -- Rule
  Engine/Campaigns entscheiden weiterhin ausschliesslich, WAS empfohlen
  wird; das Playbook-Subsystem entscheidet nirgends mit.
- Kein RAG/semantisches Retrieval, keine Vektordatenbank, kein
  Embedding-Schritt -- ausschliesslich regelbasierter Metadaten-Abgleich.
- Keine echte KI-/Prompt-Integration, kein Provider-Aufruf, kein
  Prompt-Assembler -- Playbook-Content wird bis AP9 an keiner Stelle
  ausserhalb des Admin-Bereichs gelesen oder weitergereicht.
- Diese Anbindung ist explizit dem spaeteren Phase-12-AP5c-Schritt
  (echter KI-Provider) vorbehalten, siehe Abschnitt 10.

Der Plan wurde von ChatGPT als Projektleiter vor AP1 freigegeben, unter
anderem mit der Korrektur, AP5 (Security) grundlegend auf strukturelle
statt heuristische Absicherung auszurichten (kein Pattern-Blacklist, siehe
Abschnitt 7); siehe `docs/PHASE_14_DISCOVERY.md` und
`docs/PHASE_14_IMPLEMENTATION_PLAN.md`.

## 4. Umfang AP0–AP9

- **AP0 — Discovery** (kein Code): Ist-Analyse von Phase 12 (KI-Extraction),
  Rule/Recommendation Engine, Campaign Management (Phase 13), RBAC,
  AuditLog und Versionierungsmustern; vollstaendiges 19-Abschnitte-Dokument
  `PHASE_14_DISCOVERY.md`.
- **AP1 — Datenmodell & Versionierung**: Migration
  `20260831180000_playbook_management`, `Playbook`/`PlaybookVersion`/
  `PlaybookSection`, RBAC-Grundgeruest (`config.playbooks.*`).
- **AP2 — Admin-Service** (`playbook-admin.ts`): Draft → Validate →
  Publish-Workflow analog Question/RuleSet/CommissionModel/Campaign.
- **AP3 — API-Routen** (`/api/admin/playbooks/...`), inkl. bewusster
  `/sections`-Planabweichung (siehe Abschnitt 8).
- **AP4 — Retrieval-Selektionsfunktion** (`playbook-retrieval.ts`): reine,
  DB-freie Metadaten-Selektion mit Budget-/Kostenkontrolle (siehe
  Abschnitt 6).
- **AP5 — Security-Grundgeruest**: strukturelle Trust-Boundary-Absicherung
  statt Pattern-Blacklist (siehe Abschnitt 7).
- **AP6 — Admin-UI** `/admin/playbooks`.
- **AP7 — Audit/Reproduzierbarkeit**: gezielte Regressionstests, deckte
  die JETZT-Semantik des Retrievals auf und dokumentierte sie (siehe
  Abschnitt 9).
- **AP8 — Security/E2E**: sechs Playwright-E2E-Tests (Desktop+Tablet),
  keine neuen Security-Tests noetig (strukturelle Entkopplung, kein
  Fingerprint-Analogon zu Campaign, siehe Abschnitt 9).
- **AP9 — Dokumentation**: `DATA_MODEL.md`/`RECOMMENDATION_ENGINE.md`
  aktualisiert (kein `PLAYBOOK_MANAGEMENT.md`, siehe Abschnitt 11).

## 5. Architektur: Datenmodell, Versionierung, Publish-Lifecycle

**Domaenenmodell:** `Playbook` (stabiler Schluessel `key` + `tenantId`,
keine eigene Version) → `PlaybookVersion` (versioniert, Lifecycle
`DRAFT`/`ACTIVE`/`EXPIRED`/`ARCHIVED` ueber das gemeinsame
`VersionStatus`-Enum, Scope `TENANT`/`STORE` via `scopeType`/`scopeId` --
polymorph, bewusst kein DB-Fremdschluessel, serverseitig in
`playbook-admin.ts` geprueft, identisches Muster wie Campaign/Goal --
Guelttigkeitsfenster `validFrom`/`validTo`) → `PlaybookSection`
(Delete-All-Then-Recreate je Version-Update, kein separates CRUD-Sub-Route,
identisches Muster wie `CampaignCondition`). Das Muster ist bewusst
identisch zu `CampaignVersion`/`CommissionModelVersion`: genau eine
`ACTIVE`-Version je Playbook und Scope kann zu einem Zeitpunkt aktiv sein,
aeltere Versionen wechseln beim Publish einer neuen Version auf `EXPIRED`.

`PlaybookSection` traegt `sectionType` (zehn feste Werte:
`CONVERSATION_GUIDANCE`, `ARGUMENTATION`, `OBJECTION_HANDLING`,
`PRODUCT_ARGUMENT`, `CUSTOMER_SITUATION`, `CLOSING`,
`UPSELL_CROSS_SELL`, `NO_GO`, `TONALITY`, `GENERAL_PRINCIPLE`),
`title`/`content` (Content bis 20.000 Zeichen, reiner Text -- niemals als
HTML interpretiert, siehe Abschnitt 7), `relatedTopics`/
`relatedProductKeys`/`relatedSituations`/`tags` (String-Arrays, reine
Retrieval-Metadaten, kein DB-FK), optionales `priority`-Feld als
Tie-Breaker und `active`.

**Migration `20260831180000_playbook_management`** (115 Zeilen, AP1):
additiv/non-breaking, neue Enums `PlaybookScopeType`
(`TENANT`/`STORE`) und `PlaybookSectionType`, drei neue Tabellen
`playbooks`/`playbook_versions`/`playbook_sections`, EXCLUDE-Constraint
`playbook_versions_no_overlap` gegen ueberlappende Gueltigkeitszeitraeume
je Playbook (exakt analog `campaign_versions_no_overlap`).

## 6. Retrieval-Architektur und Kostenbegrenzung (AP4)

`selectPlaybookSections()` (`playbook-retrieval.ts`) ist eine reine
Funktion ohne DB-Zugriff (analog `conditions.ts`/`extraction-validator.ts`
als Vorbild fuer testbare Kernlogik ohne I/O). Die DB-Aufloesung, welche
`PlaybookSection`s als Kandidaten in Frage kommen, ist bewusst in einer
separaten Datei (`playbook-retrieval-context.ts::loadActivePlaybookSectionCandidates()`,
analog `loadActiveCampaignKeys()`) gekapselt -- diese Trennung haelt die
Selektionslogik vollstaendig deterministisch und ohne Postgres testbar.

Die Selektion erfolgt ausschliesslich ueber regelbasierten
Metadaten-Abgleich (`relatedTopics`/`relatedProductKeys`/
`relatedSituations` gegen Produktschluessel/-kategorie,
Kundensituation/Beratungsschritt, aktuelle Frage, optional aktive
Recommendation-/Campaign-Keys) -- kein RAG, kein semantisches Retrieval,
kein Embedding-Schritt (Plan Abschnitt 1 Punkt 3).

**Kostenbegrenzung:** Die Funktion liest niemals das eigentliche
`PlaybookSection.content`-Feld selbst, sondern ausschliesslich Metadaten
plus die reine Zeichenlaenge des Contents (`contentLength`). Zwei
Budgetparameter (`maxSections`, `maxTotalContentChars`) begrenzen die
Ausgabe: Kandidaten werden nach Prioritaet sortiert und so lange
aufgenommen, bis eines der beiden Limits erreicht ist; die Anzahl
verworfener, inhaltlich eigentlich passender Sections wird als
`discardedForBudgetCount` zurueckgegeben (Nachvollziehbarkeit, AP0
Abschnitt 6.2). Die Ausgabe ist ausschliesslich eine Liste von
`PlaybookSection`-IDs -- kein Content, keine Interpretation. Ein spaeteres,
separates AP (nach AP5c) laedt bei Bedarf den tatsaechlichen `content` fuer
genau diese IDs. Diese Architekturgrenze (Rule Engine entscheidet WAS,
dieses Modul entscheidet nur WELCHE bereits vorhandenen Abschnitte
sprachlich relevant sein koennten) ist mehrfach im Code dokumentiert und
durch den in Abschnitt 7 beschriebenen Grep-Test dauerhaft abgesichert.

## 7. Security-/Trust-Boundary-Entscheidungen (AP5)

ChatGPTs verbindliche Korrektur vor AP5 (siehe
`project_ki_cross_phase14_ap4_status.md`): keine Pattern-Blacklist gegen
Prompt-Injection bauen, solange es keinen echten Prompt-Assembler gibt --
das waere eine Scheinloesung. Stattdessen wurde die Trust Boundary
**strukturell** abgesichert:

- `PlaybookSection.content` wird ausschliesslich als `<textarea>`-Wert
  gerendert (`PlaybookDraftEditor.tsx`), niemals ueber
  `dangerouslySetInnerHTML` -- HTML-/Skript-aehnliche Zeichenketten werden
  byte-identisch gespeichert und zurueckgegeben, aber nie interpretiert
  (regressionsgetestet, siehe `playbook-security.test.ts`).
- Content ist per Zod auf 20.000 Zeichen begrenzt; Ueberschreitung fuehrt
  zu einer strukturellen 400-Ablehnung vor jedem Speichern (kein
  Sanitisieren, keine stille Kuerzung).
- `AuditLog`-Eintraege beim Publish enthalten keinerlei Section-Content,
  nur IDs/Metadaten (identisches Muster wie Campaign/Commission/RuleSet).
- **Statischer Grep-Test** (`playbook-security.test.ts`, "kein Modul unter
  `src/server/recommendation/` referenziert 'playbook'"): beweist die in
  Abschnitt 6 beschriebene strukturelle Entkopplung dauerhaft als
  Regression, nicht nur als Momentaufnahme -- das ist die zentrale
  Sicherheitseigenschaft des gesamten Phase-14-Scopes.
- Retrieval (`loadActivePlaybookSectionCandidates()`/
  `selectPlaybookSections()`) veraendert keinerlei DB-Zustand (reine
  Lesevorgaenge, regressionsgetestet) und liefert bei zwei Mandanten mit
  je eigenem Playbook ausschliesslich die Sections des anfragenden
  Mandanten.

## 8. RBAC, Tenant-/Store-Isolation und API-Design

Drei neue, additive Permission-Keys in `config-permissions.ts`
(`ALL_CONFIG_PERMISSION_KEYS`, seit Phase 8/9/10/13 etabliertes Muster):
`config.playbooks.view`, `config.playbooks.edit`, `config.playbooks.publish`
-- durchgaengige additive Erweiterung der bestehenden `config_editor`/
`config_publisher`-Rollen, keine neuen Rollen. `permissionKeysForSeedRole()`
verdrahtet neue `config.<domain>.*`-Keys automatisch; nur der
E2E-Seed-Katalog (`rulePermissionKeys` in `prisma/seed-e2e.ts`) musste
manuell ergaenzt werden.

**API-Design-Abweichung (AP3, mit ChatGPT abgestimmt und bestaetigt):**
Der urspruengliche Plan sah ein eigenes `/sections`-Sub-Route vor; die
tatsaechliche Implementierung nutzt stattdessen -- wie Campaign
(`CampaignCondition`) -- Whole-Replace/Delete-All-Then-Recreate-Semantik
fuer `PlaybookSection[]` auf jeder Version-PATCH-Anfrage, keine separate
CRUD-Sub-Route. Grund: Sections gehoeren untrennbar zur Draft-Version,
identisches Muster wie Campaign-Bedingungen; ChatGPT bestaetigte die
Abweichung als korrekt.

Tenant-/Store-Isolation ist durchgaengig ueber den tenant-gescopten
Prisma-Client (`db`) sowie explizite Tests abgesichert: IDOR-Schutz ueber
`playbook-admin-routes.test.ts`/`playbook-admin-version-routes.test.ts`
und den E2E-Test "kein Zugriff auf fremden Tenant ueber manipulierte
Playbook-/Version-IDs".

## 9. Notable Incidents: drei CI-Fixrunden innerhalb der Phase

Alle drei CI-Fehlschlaege (#146, #149, #151) wurden im jeweils
unmittelbar folgenden Commit behoben, keiner betraf bereits abgenommene
Arbeitspakete rueckwirkend:

- **CI #146 (AP4):** `noUncheckedIndexedAccess`-tsc-Fehler in
  `playbook-retrieval-context.test.ts` (`candidates[0]` statt
  `candidates[0]!`) -- reiner Test-Tippfehler, kein Produktionsdefekt.
  Fix: Commit `c68f520`.
- **CI #149 (AP6):** `contact-data-guard`-Linter meldete einen False
  Positive in den Audit-Metadaten von `createPlaybook()` UND
  `createCampaign()` (letzteres ein zusaetzlicher, bei dieser Gelegenheit
  gefundener und mitbehobener Fund im bereits abgenommenen
  Campaign-Code). Fix: Commit `7c2ec54`.
- **CI #151 (AP7):** echter architektonischer Befund, kein reiner
  Test-Bug. Der urspruengliche Reproduzierbarkeits-Regressionstest ging
  davon aus, dass eine Abfrage mit einem alten `atTime`-Zeitpunkt (aus dem
  Gueltigkeitsfenster einer inzwischen `EXPIRED`en Version V1) nach
  Publish einer Folgeversion V2 weiterhin V1s Section liefert (echter
  Zeitreise-Snapshot). Tatsaechlich filtert
  `loadActivePlaybookSectionCandidates()` zusaetzlich nach
  `status: "ACTIVE"` zum Abfragezeitpunkt -- eine `EXPIRED`e Version wird
  bei JEDER kuenftigen Abfrage unsichtbar, unabhaengig vom `atTime`-Wert.
  Dies ist kein Bug, sondern konsistent mit dem bereits etablierten Muster
  aus Phase 13 AP4 (`CAMPAIGN_ACTIVE`) und Phase 9 AP9 (`ruleSetAt`) --
  "JETZT"-Semantik statt echtem historischem Snapshot. Die Testerwartung
  wurde korrigiert (nicht abgeschwaecht -- der Test beweist weiterhin eine
  echte Sicherheitseigenschaft: ein manipulierter/alter `atTime`-Wert kann
  eine ueberholte Version niemals wieder sichtbar machen). Neuer
  `docs/DECISION_LOG.md`-Eintrag ("Phase 14 AP7: Playbook-Retrieval folgt
  JETZT-Semantik ..."). Fix: Commit `3e105c2`.

AP8 (Security/E2E) fand bewusst KEINEN neuen Regressionsfund: im
Unterschied zu Campaign (Phase 13 AP8, wo ein echter
`evaluationFingerprint`-Defekt gefunden wurde) ist Playbook-Retrieval
strukturell von der Recommendation Engine entkoppelt (Abschnitt 7) -- es
gibt keinen Fingerprint-Beruehrungspunkt und damit kein Analogon zu diesem
Fund. Es wurde bewusst KEIN kuenstlicher Test konstruiert, nur um ein
Campaign-Praezedenzmuster zu wiederholen.

## 10. Beziehung zu AP5c / echtem KI-Provider

Phase 12 AP5b hatte bereits Anthropic/OpenAI/Mistral als moegliche
KI-Provider evaluiert; AP5c (echte Provider-PoC-API-Calls) ist bis heute
zurueckgestellt, da sie Nutzer-seitiges API-Key-Setup voraussetzt (siehe
`project_ki_cross_phase11_plan_go.md`), und laeuft laut ChatGPT ohne
Ordnungsabhaengigkeit parallel zu Phase 14.

Das Playbook-Subsystem wurde in Phase 14 bewusst so gebaut, dass eine
spaetere Integration risikoarm bleibt: Die Retrieval-Funktion liefert nur
IDs, nie Content; eine spaetere Integration muesste den `content` separat
laden und -- laut expliziter ChatGPT-Vorgabe (Phase 14 AP5,
`DECISION_LOG.md`) -- als **Kontext/Daten, nicht als hoeherpriorisierte
Instruktion** behandeln, um die bereits etablierte Trust-Hierarchie der
Recommendation Engine (Abschnitt "Wo KI zulaessig ist -- und wo nicht" in
`RECOMMENDATION_ENGINE.md`) nicht zu unterlaufen. Diese Anbindung ist
explizit NICHT Teil von Phase 14 und wird erst nach einer gesonderten
Entscheidung (voraussichtlich im Zuge von AP5c) angegangen.

## 11. Admin-UI und E2E-Abdeckung Desktop/Tablet

`/admin/playbooks` (Listing + Erstellung ueber `CreatePlaybookButton.tsx`)
und `/admin/playbooks/[id]/versions/[versionId]` (Detailseite) mit
`PlaybookDraftEditor.tsx` (Section-Editor: Titel/Content/sectionType/
Metadaten je Abschnitt, sichtbarer Zeichenzaehler bis zur 20.000er-Grenze),
`PlaybookVersionActionsBar.tsx` (Validate/Publish-Aktionen),
`PlaybookVersionHistoryPanel.tsx` (Versionshistorie) und
`CreateDraftPlaybookVersionButton.tsx`. UI-Muster und CSS-Ergaenzungen
(`globals.css`) folgen bewusst denselben Konventionen wie Rules/
Commissions/Goals/Campaigns.

`tests/e2e/admin-playbooks.spec.ts` (6 Tests, laeuft automatisch
Desktop+Tablet ueber die bestehenden Playwright-Projekte):

1. `config.playbooks.view`-Zugriff + Playbook sichtbar + playbookgescopter
   Hinweistext (explizit NICHT "GESAMTEN Mandanten").
2. Kein Zugriff ohne `config.playbooks.view` (normaler Mitarbeiter) →
   "Kein Zugriff".
3. Publish ohne `config.playbooks.publish` nicht moeglich, Hinweistext
   dennoch sichtbar.
4. Kein Zugriff auf fremden Tenant ueber manipulierte Playbook-/
   Version-IDs (IDOR).
5. Vollstaendiger Admin-Lifecycle: neues Playbook anlegen → erster
   Entwurf → Section hinzufuegen → Validate → Publish (playbookgescopter
   Bestaetigungsdialog "DIESES Playbooks").
6. Vollstaendiger Rollback-Flow: bestehendes `ACTIVE`-Playbook → neuer
   Entwurf → Publish → alte Version `EXPIRED` → Historie → neuer Entwurf
   aus historischer Version (Beschreibung korrekt aus der ORIGINALEN
   Seed-Version kopiert, nicht der zwischenzeitlich veroeffentlichten) →
   Validate → Publish.

## 12. Audit- und Reproduzierbarkeitsverhalten (AP7)

Disziplinierte Gap-Analyse gegen ChatGPTs AP7-Checkliste ergab: Publish-
Audit ohne Content, immutable Version History, keine Mutation
veroeffentlichter Versionen, deterministisches Retrieval sowie Tenant-/
Store-Isolation waren bereits durch bestehende Tests
(`playbook-security.test.ts`, `playbook-admin.test.ts`,
`playbook-retrieval.test.ts`, `playbook-retrieval-context.test.ts`)
abgedeckt. Neu geschrieben wurden zwei gezielte
Regressionstests (`playbook-audit-reproducibility.test.ts`):
Retrieval-Snapshot-Verhalten bei Publish einer Folgeversion, sowie der
Beweis, dass V1-Section-Content byte-identisch bleibt, nachdem eine von
V1 kopierte, editierte V2 veroeffentlicht wird.

**Bewusstes, dokumentiertes Verhalten -- "JETZT-Semantik" (siehe
Abschnitt 9):** Playbook-Retrieval folgt konsequent derselben Semantik
wie `CAMPAIGN_ACTIVE` (Phase 13) und `ruleSetAt` (Phase 9): der aktuelle,
veroeffentlichte Zustand zaehlt, kein echtes historisches
Zeitreise-Retrieval. Fuer eine spaetere echte KI-Integration (AP5c) soll
diese Grenze beibehalten werden; falls irgendwann echte historische
Reproduzierbarkeit gebraucht wird ("warum hat die KI an Datum X genau
diese Argumentation vorgeschlagen?"), soll dafuer ein expliziter
historischer Snapshot/persistierter Kontext gebaut werden -- keine
rueckwirkende Manipulierbarkeit des normalen Retrievals.

## 13. Dokumentationsentscheidung (AP9)

`docs/DATA_MODEL.md` erhielt einen neuen Abschnitt "Sales Playbook
(Beratungsintelligenz, Phase 14)" (Modellstruktur, Umsetzungsstand
AP0–AP8, expliziter Hinweis auf die strukturelle Entkopplung von der
Recommendation Engine) sowie eine neue ERD-Zeile. `docs/RECOMMENDATION_ENGINE.md`
erhielt einen kurzen neuen Absatz im bestehenden Abschnitt "Wo KI
zulaessig ist -- und wo nicht" (kein neuer Abschnitt noetig), der die
bewusste Nicht-Integration dokumentiert. Keine neuen `DECISION_LOG.md`-
Eintraege fuer AP8 (reine Tests, keine neue Architekturentscheidung).
Keine neue `PLAYBOOK_MANAGEMENT.md` -- analog ChatGPTs eigener
Entscheidung bei Phase 13 AP9 fuer Campaigns: Rules/Commissions/Goals/
Campaigns wurden ebenfalls nie als eigene lebende Referenzdatei
dokumentiert, sondern ausschliesslich im jeweiligen Abschlussbericht plus
punktuellen `DATA_MODEL.md`/`RECOMMENDATION_ENGINE.md`-Ergaenzungen.

## 14. Anzahl und Art aller Tests

Test-Gesamtbestand vor (`e32bd6f`) und nach (`5456d5e`) Phase 14:

| Ebene                         | Dateien vorher → nachher                        | Testfaelle vorher → nachher |
| ----------------------------- | ----------------------------------------------- | --------------------------- |
| Unit                          | 42 → 43 (+1 neue Datei, 2 bestehende erweitert) | —                           |
| Integration                   | 38 → 45 (+7 neue Dateien)                       | —                           |
| Unit + Integration gesamt     | —                                               | 1019 → 1121 (+102)          |
| E2E (Playwright-Spec-Dateien) | 9 → 10 (+1)                                     | 28 → 34 (+6)                |

**Neue Unit-Test-Datei:** `tests/unit/playbook/playbook-retrieval.test.ts`
(Retrieval-Selektionslogik, AP4).

**Bestehende Unit-Test-Dateien, erweitert:**
`tests/unit/authz/config-permissions.test.ts`,
`tests/unit/authz/seed-role-permissions.test.ts` (RBAC-Erweiterung um
`config.playbooks.*`, AP1).

**Neue Integrationstest-Dateien:**

| Datei                                                      |
| ---------------------------------------------------------- |
| `tests/integration/playbook-admin.test.ts`                 |
| `tests/integration/playbook-admin-routes.test.ts`          |
| `tests/integration/playbook-admin-version-routes.test.ts`  |
| `tests/integration/playbook-retrieval-context.test.ts`     |
| `tests/integration/playbook-scope-options-route.test.ts`   |
| `tests/integration/playbook-security.test.ts`              |
| `tests/integration/playbook-audit-reproducibility.test.ts` |

**Neue E2E-Spec-Datei:** `tests/e2e/admin-playbooks.spec.ts` (6 Testfaelle,
Desktop+Tablet-Playwright-Projekte, analog Goals/Rules/Commissions/
Campaigns).

## 15. Vollstaendige Pruefkommandos mit Ergebnissen

Lokale Verifikation ist in diesem Sandbox-Setup auf Prettier-
Formatierungspruefung (abhaengigkeitsfreies Standalone-Tarball, kein `npm
install`) und `node --experimental-strip-types --check` fuer
`.ts`-Syntaxpruefung beschraenkt (funktioniert nicht fuer `.tsx`). Die
volle `tsc`-Typpruefung und der komplette Test-Lauf (Unit/Integration/E2E
gegen echten PostgreSQL-Service-Container) laufen ausschliesslich in
GitHub Actions CI -- siehe Abschnitt 1 fuer alle 15 CI-Laeufe der Phase,
CI #154 (Commit `5456d5e`) als letzter, vollstaendig gruener Lauf: alle
Vitest-Unit- und Integrationstests (1121 Testfaelle ueber 88 Dateien),
alle Playwright-E2E-Testlaeufe (Desktop + Tablet), `tsc --noEmit` ohne
Fehler, ESLint ohne Fehler, Prettier-Formatierung konsistent.

## 16. Vollstaendige Liste erstellter und geaenderter Dateien

`git diff --stat e32bd6f..5456d5e -- . ':!package-lock.json'` (46 Dateien
geaendert, 8270 Zeilen hinzugefuegt, 10 Zeilen entfernt, keine
Dependency-Aenderungen):

```
docs/DATA_MODEL.md                                                  |  24 +
docs/DECISION_LOG.md                                                |  99 +++
docs/PHASE_14_DISCOVERY.md                                          | 805 +++++++++++++++++++++
docs/PHASE_14_IMPLEMENTATION_PLAN.md                                | 350 +++++++++
docs/RECOMMENDATION_ENGINE.md                                       |  14 +
prisma/migrations/20260831180000_playbook_management/migration.sql | 115 +++
prisma/schema.prisma                                                | 124 ++++
prisma/seed-e2e.ts                                                  |  68 ++
prisma/seed.ts                                                      |   9 +
src/app/admin/playbooks/[id]/versions/[versionId]/page.tsx         | 161 +++++
src/app/admin/playbooks/page.tsx                                    | 141 ++++
src/app/api/admin/playbooks/[id]/versions/[versionId]/publish/...  |  47 ++
src/app/api/admin/playbooks/[id]/versions/[versionId]/route.ts     |  71 ++
src/app/api/admin/playbooks/[id]/versions/[versionId]/validate/... |  41 ++
src/app/api/admin/playbooks/[id]/versions/route.ts                 |  67 ++
src/app/api/admin/playbooks/route.ts                                |  57 ++
src/app/api/admin/playbooks/scope-options/route.ts                 |  51 ++
src/app/consultation/page.tsx                                       |  11 +
src/app/globals.css                                                  |  71 ++
src/components/admin/CreateDraftPlaybookVersionButton.tsx           | 120 +++
src/components/admin/CreatePlaybookButton.tsx                       | 118 +++
src/components/admin/PlaybookDraftEditor.tsx                        | 492 +++++++++++++
src/components/admin/PlaybookVersionActionsBar.tsx                  | 130 ++++
src/components/admin/PlaybookVersionHistoryPanel.tsx                |  61 ++
src/server/admin/campaign-admin.ts                                   |  10 +-
src/server/admin/playbook-admin-errors.ts                            | 125 ++++
src/server/admin/playbook-admin.ts                                   | 789 ++++++++++++++++++++
src/server/admin/playbook-schemas.ts                                 | 121 ++++
src/server/admin/playbook-scope-options.ts                           |  64 ++
src/server/authz/config-permissions.ts                               |  18 +-
src/server/authz/seed-role-permissions.ts                            |  14 +-
src/server/consultation-ui/http-errors.ts                            |  60 ++
src/server/playbook/playbook-retrieval-context.ts                    |  97 +++
src/server/playbook/playbook-retrieval.ts                            | 219 ++++++
tests/e2e/admin-playbooks.spec.ts                                    | 379 ++++++++++
tests/e2e/seed-output.ts                                             |  13 +-
tests/integration/playbook-admin-routes.test.ts                      | 475 ++++++++++++
tests/integration/playbook-admin-version-routes.test.ts             | 503 +++++++++++++
tests/integration/playbook-admin.test.ts                             | 611 ++++++++++++++++
tests/integration/playbook-audit-reproducibility.test.ts             | 244 +++++++
tests/integration/playbook-retrieval-context.test.ts                | 280 +++++++
tests/integration/playbook-scope-options-route.test.ts              | 193 +++++
tests/integration/playbook-security.test.ts                          | 453 ++++++++++++
tests/unit/authz/config-permissions.test.ts                          |  63 +-
tests/unit/authz/seed-role-permissions.test.ts                       |  29 +-
tests/unit/playbook/playbook-retrieval.test.ts                       | 273 +++++++
46 files changed, 8270 insertions(+), 10 deletions(-)
```

(Die zwei Zeilen an `src/server/admin/campaign-admin.ts` sind der in
Abschnitt 9 dokumentierte, bei Gelegenheit der AP6-Fix-Runde miterledigte
`contact-data-guard`-Fund im bereits abgenommenen Campaign-Code.)

## 17. Vollstaendige bekannte Einschraenkungen

- **Keine Integration in die Recommendation Engine:** durch Design und
  durch einen dauerhaften Regressionstest (statischer Grep) abgesichert
  (Abschnitt 6/7) -- keine versehentliche spaetere Kopplung ohne
  aktives Aendern dieses Tests moeglich.
- **Kein RAG/semantisches Retrieval:** ausschliesslich regelbasierter
  Metadaten-Abgleich, keine Vektordatenbank, kein Embedding.
- **Retrieval liest nie den Content selbst**, nur Metadaten + Content-Laenge
  fuer die Budget-Kontrolle -- eine spaetere Content-Anbindung ist ein
  separater, noch zu entscheidender Schritt.
- **JETZT-Semantik statt echtem Zeitreise-Snapshot** (Abschnitt 12):
  bewusstes, dokumentiertes Verhalten, kein Bug.
- **Sandbox-Limitation:** lokale Verifikation ist auf Prettier + einfache
  Syntaxpruefung beschraenkt; volle `tsc`-/Testsuite-Verifikation laeuft
  ausschliesslich in CI. `api.github.com` ist im Sandbox-Netzwerk-Allowlist
  blockiert; CI-Status wurde fuer diesen Bericht per Browser-Scraping der
  gerenderten GitHub-Actions-Oberflaeche verifiziert (siehe Abschnitt 1).

## 18. Explizit nicht implementierte Funktionen

- Echte KI-/Prompt-Integration, Provider-Anbindung, Prompt-Assembler
  (siehe Abschnitt 10, vorgesehen fuer AP5c/eine spaetere, gesondert zu
  entscheidende Phase).
- Laden/Anzeigen von Playbook-Content ausserhalb des Admin-Bereichs (z. B.
  im Beratungsflow fuer Mitarbeitende) -- Phase 14 liefert nur die
  Verwaltung + die reine, ID-basierte Selektionsfunktion.
- Semantisches/RAG-basiertes Retrieval.
- Playbook-KPI-/Reporting-Dashboard.
- Aenderungen an Fragebogen-, Regel-, Provisions-, Ziele- oder
  Kampagnen-Modellen selbst -- Phase 14 ist rein additiv (drei neue
  Tabellen, keine Aenderung an bestehenden Verhaltensweisen dieser
  Domaenen, mit Ausnahme des in Abschnitt 9 dokumentierten, bei
  Gelegenheit mitbehobenen `contact-data-guard`-Funds in
  `campaign-admin.ts`).

## 19. Fazit

Phase 14 (Sales Playbook) ist mit AP0–AP9 vollstaendig umgesetzt:
Datenmodell, Admin-Service/-API/-UI, eine reine, budgetkontrollierte
Retrieval-Selektionsfunktion und eine strukturelle (nicht heuristische)
Security-Trust-Boundary. Zentrales Architekturprinzip der Phase ist die
bewusste, mehrfach im Code und in der Dokumentation verankerte und durch
einen dauerhaften Regressionstest abgesicherte Entkopplung von der
Recommendation Engine -- das Playbook-Subsystem liefert Text fuer
Mitarbeitende, beeinflusst aber an keiner Stelle, welche Tarife
priorisiert oder empfohlen werden. AP7 deckte einen architektonischen
Klaerungsbedarf auf (JETZT- statt Zeitreise-Semantik beim Retrieval), der
korrekt durch eine Korrektur der Testerwartung statt der
Produktionslogik geloest und dokumentiert wurde -- dieselbe Vorgehensweise,
die bereits in Phase 13 AP4 fuer `CAMPAIGN_ACTIVE` etabliert wurde. AP8
fand bewusst keinen kuenstlich konstruierten Regressionstest, da die
strukturelle Entkopplung den in Phase 13 gefundenen Fingerprint-Fehlertyp
strukturell ausschliesst. Der bisherige Stand (Commit `5456d5e`) ist durch
CI #154 vollstaendig gruen verifiziert (1121 Unit-/Integrationstests, 34
E2E-Testfaelle über Desktop+Tablet, `tsc`, ESLint, Prettier). Eine echte
KI-/Prompt-Integration bleibt bewusst ausserhalb des Phase-14-Scopes und
ist expliziter Gegenstand einer spaeteren, gesondert zu treffenden
Entscheidung (voraussichtlich im Zuge von AP5c).
