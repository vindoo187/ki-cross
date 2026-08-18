# IMPLEMENTIERUNGSPLAN – PHASE 9: REGEL-EDITOR (TEIL 2: BERATUNGS-/EMPFEHLUNGSREGELN)

## 0. Bestätigter Ausgangsstand

Phase 8 (Sichere Fachadministration – Teil 1: Fragen & Fragebogenversionen)
ist offiziell abgeschlossen: finaler Commit `de287fb`, CI #48 grün,
ChatGPT-GO vom 2026-08-18.

Phase 9 AP0 (Discovery, keine Implementierung) ist abgeschlossen:
`PHASE_9_DISCOVERY.md`, Commit `7b70ea6`. ChatGPT hat den Befund
akzeptiert und zwei verbindliche Entscheidungen getroffen:

**Phase 9 = Regel-Editor**, Fortsetzung des in Phase 8 etablierten
Fachadministrations-Musters (Draft → Validate → Publish → Historie →
Rollback → Audit) für `RuleSetVersion`/`EligibilityRule`/`ExclusionRule`/
`PrioritizationRule`/`CrossSellingRule`. Explizit **nicht** in Phase 9:
visueller Regel-Builder (verschachtelte AND/OR-Bäume), Campaign-
Management, Ziele-Modell, Provisionsmodell-Editor, Freitext-KI,
Änderungen am Questionnaire-Pinning aus Phase 8.

**Zentrale Leitplanke 1 (Architektur-Besonderheit, ChatGPT bestätigt):**
Der ACTIVE-Scope von `RuleSetVersion` ist **mandantenweit**, nicht pro
`RuleSet` — höchstens eine `RuleSetVersion` über alle `RuleSet`s eines
Mandanten hinweg darf gleichzeitig ACTIVE sein (EXCLUDE-Constraint
`rule_set_versions_tenant_active_no_overlap`, nur über `tenantId`). Der
Publish-Mechanismus aus Phase 8 (`publishDraftVersion()` für
`QuestionnaireVersion`, ACTIVE-Scope = pro Questionnaire) darf **nicht**
1:1 kopiert werden.

**Zentrale Leitplanke 2 (Architektur-Entscheidung, ChatGPT 2026-08-18,
wörtlich):** `ConsultationSession` bekommt **kein** `ruleSetVersionId`.
Fragen bleiben pro Session gepinnt (`questionnaireVersionId`), Regeln
werden weiterhin bei **jeder** Empfehlungs-Generierung neu aufgelöst
(`loadActiveRuleSetVersion()`) und nur als Snapshot auf der jeweiligen
`Recommendation`-Zeile gespeichert. Eine während einer laufenden Beratung
veröffentlichte neue `RuleSetVersion` wirkt sich damit **bewusst sofort**
auf die nächste Empfehlungs-Generierung dieser Session aus — dieses
Verhalten bleibt unverändert, wird aber in Phase 9 erstmals explizit
dokumentiert und mit einem End-zu-Ende-Test bewiesen (siehe AP9).

**Status dieses Plans:** ChatGPT hat den ausformulierten Plan geprüft und
alle vier offenen Klärungspunkte (Abschnitt 15) am 2026-08-18 entschieden
— Details siehe die jeweiligen Abschnitte unten. ChatGPT-GO für den Plan
liegt vor ("Ja — der Plan passt", "Jetzt kann AP1 beginnen"). Ausstehend
vor AP1: explizites Implementierungs-GO des Nutzers (wie bei Phase 7/8,
da Phase 9 den produktiven Empfehlungspfad berührt).

## 1. Scope-Rahmen (aus AP0-Review + ChatGPT-Entscheidungen, verbindlich)

**In Scope:**

- Neue `config.rules.*`-Permissions (analog `config.questions.*`,
  deny-by-default, TENANT-Scope), mindestens eine Rolle mit Edit- und eine
  mit Publish-Recht (kann dieselbe `config_editor`/`config_publisher`-
  Rolle aus Phase 8 um die neuen Permission-Keys erweitern, statt neue
  Rollen einzuführen — siehe AP1).
- Draft → Validate → Publish-Workflow für `RuleSetVersion` inkl. aller
  vier Regeltypen und ihrer Condition-Tabellen (Erstellen, Bearbeiten im
  Entwurf, Validieren, Veröffentlichen — **mandantenweiter** ACTIVE-
  Wechsel, siehe Leitplanke 1), Versionshistorie, Rollback.
- Admin-UI für Regelverwaltung (Liste, Editor für den vorhandenen flachen
  Condition-Baum, Publish-Flow) — **kein** visueller Regel-Builder.
- Audit-Trail für alle Regel-Config-Änderungen (gleiches `AuditLog`-
  Muster wie Phase 8).
- Vollständige Security-/Regressionstests analog Phase-8-Muster
  (Tenant-Isolation, Permission-Grenzen, IDOR, mandantenweite
  ACTIVE-Invariante, Rule-Version-Verhalten in laufenden Sessions gemäß
  Leitplanke 2).

**Out of Scope (ChatGPT, wörtlich):** visueller Regel-Builder,
Campaign-Management, Ziele-Modell, Provisionsmodell-Editor, Freitext-KI,
Änderungen am Questionnaire-Pinning, Änderungen an der
Empfehlungs-Auswertungslogik selbst (`conditions.ts`/`eligibility.ts`/
`exclusion.ts`/`prioritization.ts`/`cross-selling.ts` bleiben
unangetastet — Phase 9 baut nur die Verwaltungsschicht **darüber**).

## 2. Architektur-Entscheidungen dieses Plans

### 2.1 RBAC als additive Erweiterung von Phase 8 (nicht neue Rollen)

- Vier neue Permission-Keys: `config.rules.view`, `config.rules.edit`,
  `config.rules.publish` (analog `config.questions.*`).
- **Entschieden (ChatGPT-GO, 2026-08-18):** Die bestehenden Rollen
  `config_editor`/`config_publisher` aus Phase 8 werden um die neuen
  `config.rules.*`-Keys erweitert — **keine** neuen
  `rules_editor`/`rules_publisher`-Rollen. Begründung (ChatGPT, wörtlich):
  "Das hält das RBAC-Modell übersichtlich und entspricht dem Prinzip aus
  Phase 8: Rolle beschreibt die administrative Fähigkeit, Permission
  beschreibt den konkreten Konfigurationsbereich."
- `requireConfigPermission()` (Phase 8, unverändert) wird für die neuen
  Keys wiederverwendet — keine neue Middleware-Architektur.

### 2.2 Mandantenweiter Publish (zentrale Abweichung von Phase 8)

```
DRAFT --validate()--> DRAFT (mit Validierungsergebnis)
DRAFT --publish()--> ACTIVE (vorherige ACTIVE-Version DES GESAMTEN MANDANTEN
                               -> EXPIRED, unabhängig vom RuleSet)
```

`publishDraftRuleSetVersion()` läuft als eine Transaktion: die
**mandantenweit** aktuell ACTIVE `RuleSetVersion` (`WHERE tenantId=...
AND status="ACTIVE"`, **ohne** `ruleSetId`-Filter) → EXPIRED
(`validTo=now`) → neue Version → ACTIVE (Race-Guard analog Phase 8:
`updateMany({where:{status:"DRAFT"}})`, `count!==1` wirft) → `AuditLog`
(`action:"ACTIVATE"`). Die Reihenfolge EXPIRE-vor-ACTIVATE ist wie in
Phase 8 zwingend wegen der bestehenden EXCLUDE-Constraint. Anders als bei
Questionnaire kann sich die vorherige ACTIVE-Version dabei auf ein
**anderes** `RuleSet` beziehen als die neue — das ist **beabsichtigtes**
Verhalten (mandantenweit genau eine Regelkonfiguration aktiv), nicht ein
Bug, muss aber in UI/Validate klar kommuniziert werden ("Veröffentlichen
ersetzt die aktuell aktive Regelkonfiguration des gesamten Mandanten,
auch wenn sie zu einem anderen Regelwerk gehört").

### 2.3 Rollback (analog Phase 8, mandantenweiter Publish-Pfad)

`rollbackToRuleSetVersion()` erzeugt eine neue DRAFT-Version als
vollständige Deep-Copy einer historischen (ACTIVE/EXPIRED/ARCHIVED)
`RuleSetVersion` desselben `RuleSet` (inkl. aller vier Regeltypen +
Conditions), durchläuft danach reguär den AP5-Publish-Pfad — keine zweite
Publish-Logik, identisches Prinzip wie Phase 8 AP5.

### 2.4 Kein Session-Pinning für Regeln (Leitplanke 2, hier konkretisiert)

Keine Schema-Änderung an `ConsultationSession`. Einziger Unterschied zu
Phase 8: kein "Bestandsschutz laufender Beratungen"-Test im Sinne von
"Session bleibt auf alter Version", sondern der **Gegenfall** muss
bewiesen werden — eine laufende Session verwendet nach einem Publish
**bewusst** die neue `RuleSetVersion` bei der nächsten Auswertung
(AP9-Testfall, siehe Abschnitt 10).

### 2.5 Validierung (neu zu bauen, Bausteine wiederverwenden)

`validateDraftRuleSetVersion()` (neu, analog
`validateQuestionnaireVersion()` aus Phase 3A/8) prüft mindestens:

- Für jede Regel: `assertValidConditionSource()` (bestehend) für jede
  Condition, `assertOperatorAllowedForAttribute()` (bestehend) bei
  `sourceType=ATTRIBUTE`, `getAttributeDefinition()` (bestehend) für
  Existenzprüfung von `attributeKey`.
- Für `sourceType=QUESTION`: `questionId` muss zu einer `Question`
  gehören, die in der aktuell **verknüpften** `QuestionnaireVersion`
  vorkommt (siehe Abschnitt 2.6 zur Verknüpfungsfrage).
- `ExclusionRule.reasonCode`-Eindeutigkeit je Version (verständlicher 422
  vor dem DB-Constraint-Fehler).
- `CrossSellingRule.suggestedProductVersionId`, falls gesetzt: muss zu
  einer existierenden `ProductVersion` desselben Tenants gehören.
- Pflichtfeld-Vollständigkeit (`description` nicht leer) sowie
  Wertebereiche für `priority`/`weight`/`fitWeight` (**entschieden**,
  ChatGPT 2026-08-18, siehe unten).

**Entschieden (ChatGPT-GO, 2026-08-18) — Wertebereiche:**

- `priority`: **nicht negativ.**
- `weight`: negativ grundsätzlich zulässig, **sofern** die bestehende
  Recommendation-Engine negative Gewichtung mathematisch unterstützt.
- `fitWeight`: negativ grundsätzlich zulässig, **sofern** dieselbe
  Semantik im bestehenden Empfehlungscode bereits implementiert ist.
- Begründung (ChatGPT, wörtlich): "Ein negatives Gewicht kann fachlich
  durchaus bedeuten: 'Diese Eigenschaft spricht gegen die Empfehlung.'
  Wir sollten dem Validator keine neue Fachsemantik erfinden lassen." Der
  AP4-Validator muss die bereits im Recommendation-Code (`eligibility.ts`/
  `prioritization.ts`) definierte Semantik spiegeln — **nicht** eigene
  Regeln erfinden. Falls der bestehende Code `weight`/`fitWeight`
  ausdrücklich als nichtnegative Größen behandelt, dann entsprechend in
  AP4 ablehnen. **Verbindlich:** Validator und Runtime müssen dieselbe
  Mathematik haben — vor AP4 ist daher ein kurzer Code-Check von
  `eligibility.ts`/`prioritization.ts` nötig, um zu klären, ob negative
  Werte dort überhaupt sinnvoll verarbeitet werden.

### 2.6 Referenzintegrität über Questionnaire-Grenzen (entschieden)

Da `RuleSetVersion` und `QuestionnaireVersion` **unabhängig** versioniert
werden (Leitplanke 2), stellte sich die Frage, gegen **welche**
`QuestionnaireVersion` eine `questionId`-Referenz in einer
`RuleSetVersion`-Condition bei der Validierung geprüft werden soll.

**Entschieden (ChatGPT-GO, 2026-08-18):** Prüfung gegen die aktuell ACTIVE
`QuestionnaireVersion` zum Zeitpunkt der Regel-Validierung — nicht nur
"Question mit dieser ID existiert irgendwo", sondern "Diese Frage ist
Bestandteil der aktuell ACTIVE QuestionnaireVersion." Begründung (ChatGPT,
wörtlich): "Das passt zur Laufzeitlogik und verhindert Regeln, die zwar
formal auf eine existierende historische Question zeigen, aber im
aktuellen Fragebogen niemals beantwortet werden können." Wichtig: Das ist
Validierung, keine nachträgliche Mutation historischer Daten.

## 3. AP1 – Rule-Admin-RBAC/Auth (Anbindung an Phase-8-Infrastruktur)

- Vier neue `Permission`-Zeilen (`config.rules.view/edit/publish`) im
  Seed (drei, siehe 2.1 — `view` wird wie bei Fragen implizit durch
  `edit`/`publish` mitgegeben oder explizit ergänzt, analog
  Phase-8-Muster).
- Erweiterung der bestehenden `config_editor`/`config_publisher`-Rollen
  um die neuen Keys (vorbehaltlich ChatGPT-Bestätigung 2.1).
- Kein neuer Auth-Mechanismus — `admin-login`/Session/
  `requireConfigPermission()` vollständig wiederverwendet.
- Tests: `deriveConfigPermissions()` liefert die neuen Keys korrekt,
  `sales_employee` bekommt sie weiterhin **nicht** (Regressionsschutz
  nach demselben Muster wie der proaktive Fix in Phase 8 AP2).

## 4. AP2 – RuleSet-/Version-Management API

- `GET /api/admin/rule-sets` — Liste aller `RuleSet`s mit Versionen +
  Status (analog `GET /api/admin/questionnaires`).
- `GET /api/admin/rule-sets/:id/versions/:versionId` — Detailansicht
  einer Version inkl. aller vier Regeltypen + Conditions.
- `POST /api/admin/rule-sets/:id/versions` — neue DRAFT-Version anlegen
  (leer oder als Kopie der aktuell mandantenweit ACTIVE Version, **auch
  wenn diese zu einem anderen `RuleSet`** gehört — Kopie über
  `RuleSet`-Grenzen hinweg ist ein Novum gegenüber Phase 8 und muss
  explizit getestet werden).
- `requireConfigPermission("config.rules.edit"/"config.rules.view")`
  konsistent zu Phase 8.

## 5. AP3 – Rule-CRUD für den vorhandenen flachen Condition-Baum

- `POST/PATCH/DELETE` je Regeltyp innerhalb einer DRAFT-Version
  (`EligibilityRule`/`ExclusionRule`/`PrioritizationRule`/
  `CrossSellingRule`, jeweils inkl. verschachtelter
  `...Condition`-Payload, analog dem bestehenden Muster aus
  `addQuestionToDraft()`/`AnswerOption`/`VisibilityCondition`).
- Serverseitige Sperre: Mutation einer nicht-DRAFT-Version → 409 (gleiche
  `requireDraftVersion()`-Guard-Funktion wie Phase 8, wiederverwendet
  statt dupliziert).
- Vier flache Top-Level-`createMany()`-Aufrufe mit explizitem `tenantId`
  für Conditions (verbindliches Muster aus Phase 8 AP3/CI #39-Fix, gilt
  auch hier wegen identischer composite-FK-Struktur).

## 6. AP4 – Serverseitiger RuleSet-Validator

`validateDraftRuleSetVersion()` (siehe 2.5), aufgerufen von
`POST /api/admin/rule-sets/:id/versions/:versionId/validate`
(`config.rules.edit`), liefert strukturierte Fehlerliste (keine
Boolean-Antwort, analog Phase 8 AP4).

## 7. AP5 – Tenantweiter Validate/Publish-Workflow

`publishDraftRuleSetVersion()` (siehe 2.2) als atomare Transaktion,
`POST /api/admin/rule-sets/:id/versions/:versionId/publish`
(`config.rules.publish`, getrennt von `edit`). Re-Validierung
serverseitig vor jedem Publish (niemals nur Client-Validierung
vertrauen, wie in Phase 8).

## 8. AP6 – Historie + Rollback

`GET /api/admin/rule-sets/:id/versions` (vollständige Historie je
`RuleSet`), `POST .../rollback` (siehe 2.3). **Neuer Pinning-Test**
(Kernbeweis für Leitplanke 2, siehe Abschnitt 10 für den vollständigen
Testfall).

## 9. AP7 – Audit + Reproduzierbarkeit

`AuditLog`-Einträge für alle mutierenden Regel-Operationen (CREATE/
UPDATE/DELETE je Regeltyp, ACTIVATE/ROLLBACK für die Version), identisches
Muster wie Phase 8 AP7 — diesmal von Anfang an vollständig eingebaut
(nicht nachträglich wie in Phase 8, wo die Lücke erst in AP7 gefunden
wurde). **Reproduzierbarkeit:** `Recommendation.ruleSetVersionId` (bereits
vorhanden seit Phase 3B) macht jede historische Empfehlung nachvollziehbar
— kein neues Feld nötig, nur zu bestätigen/testen, dass der Audit-Trail
auf der Config-Seite (wer hat wann welche Regel geändert) und der
Snapshot auf der Recommendation-Seite (welche Regelversion wurde
tatsächlich verwendet) zusammen ein vollständiges Bild ergeben.

## 10. AP8 – Admin-UI

Neue Route `/admin/rules` (Server Component,
`requireConfigPermission(session, "config.rules.view")`, analog
`/admin/questions`-Struktur aus Phase 8): Liste aller `RuleSet`s mit
Versionen/Status-Badges. `/admin/rules/[id]/versions/[versionId]`:
Versionsdetail, bei DRAFT editierbar (vier Abschnitte für die vier
Regeltypen, je mit flacher Bedingungsliste — **kein** visueller Baum),
`VersionActionsBar` (Validieren/Veröffentlichen), sonst read-only mit
"Neuen Entwurf erstellen". `VersionHistoryPanel` mit Rollback-Aktion. Alle
Mutationen ausschließlich über `fetch()` gegen die AP2–AP6-Routen — keine
eigene Fach-/Tenant-/Permission-Logik in der UI (identische Leitplanke
wie Phase 8 AP6). Deutlicher Hinweis in der UI beim Publish-Vorgang:
"Veröffentlichen ersetzt die aktuell aktive Regelkonfiguration des
gesamten Mandanten" (siehe 2.2).

## 11. AP9 – Security / Regression / Rule-Version-Verhalten in laufenden Sessions

- Tenant-Isolation, Permission-Grenzen (`config_editor` ohne
  Publish-Recht → 403), IDOR (fremde `ruleSetId`/`versionId` → 403/404),
  Mutations-Sperre nicht-DRAFT-Versionen → 409, alle analog Phase 8 AP8.
- **Mandantenweite ACTIVE-Invariante:** echter Concurrency-Test (analog
  Phase 8 AP8) — zwei parallele Publishes für **unterschiedliche**
  `RuleSet`s desselben Tenants → maximal eine ACTIVE-Version über beide
  hinweg (nicht nur pro `RuleSet`, das wäre der Phase-8-Fehler in neuem
  Gewand).
- **Kern-Testfall für Leitplanke 2 (verbindlich vorgegeben von ChatGPT,
  wörtlich):** Beratung A startet, RuleSet v1 ist ACTIVE → Recommendation
  A wird mit v1 erzeugt → RuleSet v2 wird veröffentlicht → dieselbe
  Session (kein neuer Session-Start) → eine neue Recommendation-Auswertung
  innerhalb dieser Session verwendet v2 → die alte Recommendation A
  referenziert weiterhin v1 (append-only, unveränderlich). Das beweist
  explizit: Session-Pinning für Fragen, Evaluation-Snapshot für Regeln.
- Vollständige Regressionsprüfung gegen den bestehenden
  Empfehlungspfad (Phase 3B) — Phase 9 darf `conditions.ts`/
  `eligibility.ts`/etc. nicht verändern, nur die neue
  Verwaltungsschicht darüber legen.

## 12. AP10 – Hardening/CI

Lokale Vollverifikation (Lint, Format, `tsc --noEmit`, Unit-/
Integrationstests, `verify_migration_pglite.mjs` für alle neuen
Migrationen), Commit, Push durch Nutzer, CI-Prüfung — wie in jeder
Vorphase.

## 13. AP11 – Abschlussbericht Phase 9

Analog `docs/ABSCHLUSSBERICHT_PHASE8.md`: Commit-Tabelle, Testzahlen,
Scope-Entscheidungen, Umsetzungsstand je AP, GO/NO-GO-Abschnitt, explizite
Auflistung dessen, was bewusst nicht implementiert wurde (visueller
Regel-Builder, Campaigns, Ziele, Provisionsmodelle, Freitext-KI).

## 14. Risiken

- **Mandantenweiter Publish-Scope ist fehleranfällig, falls versehentlich
  aus Phase 8 kopiert:** größtes technisches Risiko dieser Phase (siehe
  2.2). Gegenmaßnahme: expliziter Concurrency-Test über zwei
  verschiedene `RuleSet`s (AP9), nicht nur innerhalb eines `RuleSet`.
- **Referenzintegrität über unabhängig versionierte Entitäten
  (`RuleSetVersion` vs. `QuestionnaireVersion`):** siehe offene Frage
  2.6 — falsche Annahme hier könnte zu Regeln führen, die auf nicht mehr
  existierende oder falsche Fragen verweisen. Muss vor AP4 geklärt sein.
- **Vier Regeltypen statt einer Entität** (wie bei Fragen) bedeuten
  ca. 4x mehr CRUD-Endpunkte/UI-Abschnitte — höherer Umfang als Phase 8,
  aber strukturell identisches, bereits bewährtes Muster je Regeltyp
  (kein neues Konzept, nur Wiederholung).
- **Session-Pinning-Verhalten (Leitplanke 2) ist eine bewusste
  Verhaltensbestätigung eines bereits produktiven Pfads** — Risiko, dass
  der neue Testfall (AP9) eine bisher unbemerkte Abweichung vom
  dokumentierten Verhalten aufdeckt (wäre ein echter, wertvoller Fund,
  kein Show-Stopper, aber zeitlich einzuplanen).

## 15. Klärungspunkte — ChatGPT-Entscheidungen (2026-08-18, alle GO)

1. **Rollenmodell (2.1):** GO für Erweiterung der bestehenden
   `config_editor`/`config_publisher`-Rollen — keine neuen Rollen.
2. **Referenzintegrität (2.6):** GO für Prüfung gegen die aktuell ACTIVE
   `QuestionnaireVersion`.
3. **Wertebereiche (2.5):** `priority` nicht negativ; `weight`/
   `fitWeight` negativ zulässig, sofern die bestehende Engine dies
   mathematisch unterstützt (vor AP4 zu verifizieren).
4. **AP-Nummerierung:** GO für AP11 als eigenen Abschlussbericht-AP,
   getrennt von AP10 (Hardening/CI). ChatGPT-Präzisierung (wörtlich):
   "AP11 als separater Abschlussbericht ist richtig", mit der zusätzlichen
   Empfehlung, AP9 (Security/Regression) explizit inklusive des
   mandantenweiten Concurrency-Tests zu verstehen und AP10 rein als
   Hardening/CI-Verifikationsblock zu halten (bereits so in diesem Plan
   umgesetzt, siehe Abschnitt 11/12).

**Ergänzung zum mandantenweiten Concurrency-Test (AP9), von ChatGPT als
"einer der wichtigsten Punkte des Plans" bezeichnet — exaktes Beweisziel:**

```
Tenant A
 ├── RuleSet A / v1 ACTIVE
 └── RuleSet B / v1 DRAFT

Publish RuleSet B
        ↓
RuleSet A / v1 → EXPIRED
RuleSet B / v1 → ACTIVE

und NICHT versehentlich:

RuleSet A / v1 → ACTIVE
RuleSet B / v1 → ACTIVE   ❌
```

Zusätzliche ChatGPT-Klarstellung zu Leitplanke 2: RuleSet-Versionierung
darf niemals dazu führen, dass eine bereits erzeugte `Recommendation`
nachträglich ihre verwendete `ruleSetVersionId` verliert oder überschrieben
bekommt — die alte `Recommendation` bleibt unverändert, nur zukünftige
Evaluationen verwenden die neue ACTIVE-Version. Kurzformel (ChatGPT):
"Questionnaire = Session-Pinning / RuleSet = Evaluation-Snapshot."

**Plan-Status: ChatGPT-GO vollständig erteilt ("Jetzt kann AP1
beginnen"). Ausstehend: Implementierungs-GO des Nutzers.**
