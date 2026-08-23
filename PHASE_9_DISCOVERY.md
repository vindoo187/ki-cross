# Phase 9 – Discovery: Regel-Editor (RuleSetVersion/EligibilityRule etc.)

Stand: 2026-08-18. Analysephase, **keine Implementierung** (analog
`PHASE_7_DISCOVERY.md`/`PHASE_8_DISCOVERY.md`). ChatGPT-Vorschlag
(2026-08-18): Phase 9 = Regel-Editor als nächster vertikaler Slice nach
Phase 8 (Fragenverwaltung), zunächst **ohne** visuellen Regel-Baukasten —
zuerst den vorhandenen strukturierten Regelbaum administrierbar machen.
Vier Untersuchungspunkte laut ChatGPT-Vorgabe, siehe Abschnitte 1–4.

## 1. Vorhandener RuleSetVersion-/EligibilityRule-Stand

Das Datenmodell ist bereits vollständig (seit Phase 3B), aber — identisch
zum Zustand vor Phase 8 — **ausschließlich über `prisma/seed.ts`
beschrieben, kein Schreibpfad im Code** (`grep -rn "ruleSet.create\|
ruleSetVersion.create\|eligibilityRule.create\|exclusionRule.create\|
prioritizationRule.create\|crossSellingRule.create" src/` — 0 Treffer).

**Struktur** (`prisma/schema.prisma`, Zeilen 1205–1455):

- `RuleSet` (`id`, `tenantId`, `key`) — reiner Container/Namensraum,
  `@@unique([tenantId, key])`.
- `RuleSetVersion` (`VersionStatus` DRAFT/ACTIVE/EXPIRED/ARCHIVED,
  `validFrom`/`validTo`) — hält **alle vier Regeltypen** einer Version:
  `eligibilityRules[]`, `exclusionRules[]`, `prioritizationRules[]`,
  `crossSellingRules[]`.
- **Vier Regeltypen**, jeweils mit eigener 1:n-Condition-Tabelle
  (`EligibilityRuleCondition`/`ExclusionRuleCondition`/
  `PrioritizationRuleCondition`/`CrossSellingRuleCondition`, strukturell
  identisch):
  - `EligibilityRule` — hartes Gate (`isRequired=true`, Default) oder
    gewichteter Fit-Score-Faktor (`isRequired=false`, `fitWeight`).
  - `ExclusionRule` — mit Pflichtfeld `reasonCode`
    (`@@unique([tenantId, ruleSetVersionId, reasonCode])`).
  - `PrioritizationRule` — `weight` + `commissionRequired`-Flag
    (steuert Abbruch vs. Fallback bei nicht auflösbarem
    Provisionsmodell).
  - `CrossSellingRule` — `needType`/`priority`/`reasonCode` +
    optionaler `suggestedProductVersionId`.

**Zentrale Architektur-Besonderheit (wichtigster Befund dieser
Discovery):** Anders als bei `QuestionnaireVersion` (Phase 8, ACTIVE-Scope
= **pro Questionnaire**) gilt bei `RuleSetVersion` ein
**mandantenweiter** ACTIVE-Scope — höchstens **eine** `RuleSetVersion`
über **alle** `RuleSet`s eines Mandanten hinweg darf gleichzeitig ACTIVE
sein (EXCLUDE-Constraint `rule_set_versions_tenant_active_no_overlap`,
NUR über `tenantId`, nicht `ruleSetId` — Kommentar in `schema.prisma`
Zeilen 1248–1257). In den Seed-Daten existiert dazu passend genau **ein**
`RuleSet` je Tenant (`key: "standardregeln"`, `prisma/seed.ts` Zeile 1331) mit genau einer ACTIVE `RuleSetVersion`. Für den Regel-Editor
bedeutet das: Publish muss (wie bei Questionnaire) die vorherige
mandantenweite ACTIVE-Version auf EXPIRED setzen — aber **unabhängig
davon, ob es sich um dasselbe `RuleSet` handelt oder nicht**. Ein Draft
unter einem anderen `RuleSet`-Key zu veröffentlichen würde die aktuell
aktive Version eines komplett anderen `RuleSet` beenden. Diese Semantik
muss im Implementierungsplan explizit übernommen werden (keine
versehentliche 1:1-Kopie des Phase-8-Musters).

**Auswertungspfad** (`src/server/recommendation/service.ts`,
`loadActiveRuleSetVersion()`, Zeile 264–275): lädt die aktuell ACTIVE
`RuleSetVersion` **ohne** `ruleSetId`-Filter — konsistent mit dem
mandantenweiten Scope oben.

## 2. Tatsächliche Regelbaum-Komplexität im Seed

Das Bedingungsmodell ist strukturell identisch zu `VisibilityCondition`
aus der Fragen-Engine: `groupIndex` gruppiert Bedingungen (gleicher
`groupIndex` = UND-Verknüpfung, unterschiedlicher `groupIndex` = ODER
zwischen Gruppen — eine Ebene, kein Nesting). Ausgewertet in
`src/server/recommendation/conditions.ts`
(`evaluateConditionGroups()`/`evaluateCondition()`).

**In der Praxis ist die Komplexität aktuell gering:** `grep -n
"groupIndex" prisma/seed.ts` zeigt **ausschließlich `groupIndex: 0`** —
die ODER-zwischen-Gruppen-Fähigkeit wird in den bestehenden Testdaten
**nie** genutzt, nur einfache UND-Verkettungen (max. 2 Bedingungen pro
Regel). Insgesamt je Tenant: 3 `EligibilityRule`, 1 `ExclusionRule`, 2
`PrioritizationRule`, 2 `CrossSellingRule` (8 Regeln), davon einige ganz
ohne Bedingungen (hartes Gate ohne echte Einschränkung, "immer erfüllt").
Das bestätigt die ChatGPT-Einschätzung: ein **Editor für den vorhandenen
strukturierten Baum** (Regel anlegen, Bedingungen als flache
Gruppen-Liste hinzufügen/entfernen) ist ausreichend — ein visueller
Regel-Baukasten mit verschachtelten AND/OR-Bäumen wäre für den aktuellen
Bedarf Overengineering, deckt sich mit ChatGPTs Vorgabe.

`ConditionSourceType` (QUESTION vs. ATTRIBUTE) + `attribute-registry.ts`
(`PRODUCT_ATTRIBUTE_DEFINITIONS`/`SESSION_ATTRIBUTE_DEFINITIONS`,
`assertOperatorAllowedForAttribute()`) sind bereits vollständige,
wiederverwendbare Bausteine für Validierung/Auswertung — hier ist analog
zu Phase 8 (Wiederverwendung von `validateQuestionnaireVersion()`) eine
hohe Wiederverwendbarkeit vorhanden, siehe Abschnitt 3.

## 3. Zwingend nötige serverseitige Validierung

**Anders als bei Phase 8: es gibt noch KEINE fertige
`validateRuleSetVersion()`-Funktion zum Wiederverwenden** (`grep -rn
"function validate" src/server/` findet nur
`validateQuestionnaireVersion()`, `validateVisibilityGraph()`,
`validateAnswerInput()` — nichts für Regeln). Eine neue Validierungsfunktion
muss für Phase 9 gebaut werden, kann sich aber auf bereits vorhandene
Bausteine stützen:

- `assertValidConditionSource()` (`conditions.ts`) — prüft, ob
  `questionId`/`attributeKey` konsistent zu `sourceType` gesetzt ist.
- `assertOperatorAllowedForAttribute()` (`attribute-registry.ts`) — prüft
  Operator-Kompatibilität zum Attributtyp.
- `getAttributeDefinition()` — prüft, ob ein `attributeKey` überhaupt
  existiert (Produkt-/Session-Attribute sind eine feste, im Code
  definierte Liste, keine dynamische Konfiguration — wichtig für den
  Scope: Attribute selbst sind vermutlich NICHT Teil des Regel-Editors,
  nur die Referenz darauf).

**Zusätzlich nötig (Regel-spezifisch, noch nicht vorhanden):**
Referenzintegrität von `questionId` (muss zu einer `Question` der
aktuell **verknüpften** `QuestionnaireVersion` gehören — analog dem
Phase-8-AP4-Risiko "Sichtbarkeitsregeln über Versionsgrenzen", hier aber
zusätzlich erschwert, weil `RuleSetVersion` und `QuestionnaireVersion`
**unabhängig** versioniert sind, siehe Abschnitt 4), Eindeutigkeit von
`ExclusionRule.reasonCode` je Version (DB-Constraint existiert bereits,
aber eine verständliche 422-Fehlermeldung vor dem DB-Fehler wäre besser),
Pflichtfeld-Vollständigkeit (`description`, `weight`/`priority` in
sinnvollen Wertebereichen), gültige `suggestedProductVersionId` bei
`CrossSellingRule` (muss zu einer existierenden `ProductVersion`
desselben Tenants gehören).

## 4. Unabhängigkeit Rule-Publish vs. Questionnaire-Publish

**Ja, beide sind bereits heute vollständig unabhängig versioniert — mit
einer wichtigen, im Implementierungsplan explizit zu behandelnden
Asymmetrie:**

`ConsultationSession.questionnaireVersionId` wird **einmalig beim
Session-Start gepinnt** (Phase 3B/8-Prinzip: laufende Beratungen bleiben
auf ihrer Version). `Recommendation.ruleSetVersionId` dagegen wird **bei
JEDER Empfehlungs-Generierung neu aufgelöst**
(`loadActiveRuleSetVersion()` in `service.ts`, aufgerufen pro
Auswertung, nicht einmalig beim Session-Start) und als Snapshot auf der
jeweiligen `Recommendation`-Zeile gespeichert — nicht auf der
`ConsultationSession`.

**Praktische Konsequenz:** Publiziert ein Admin während einer laufenden
Beratung eine neue `RuleSetVersion`, wirkt sich das **sofort** auf die
nächste Empfehlungs-Generierung dieser laufenden Session aus (anders als
bei Fragenänderungen, die eine laufende Session gar nicht erreichen).
Abgefedert wird das nur durch den bestehenden
Idempotenz-Mechanismus (`evaluationFingerprint`): identische Eingaben
liefern weiterhin dieselbe bereits gespeicherte `Recommendation` zurück,
erst eine **geänderte** Eingabe (z. B. neue Antwort) löst eine neue
Auswertung mit der dann aktuellen `RuleSetVersion` aus.

**Das ist eine reine Produktentscheidung, kein technischer Befund** (wie
in `PHASE_8_DISCOVERY.md` Abschnitt 8 für offene Fragen üblich): Soll
dieses Verhalten für Phase 9 unverändert bleiben ("neue Regeln wirken
sofort, auch in laufenden Beratungen"), oder soll — analog zum
Questionnaire-Pinning — eine `ConsultationSession.ruleSetVersionId`
eingeführt werden, um auch Empfehlungslogik pro Session zu pinnen? Diese
Frage sollte vor dem Implementierungsplan explizit an ChatGPT vorgelegt
werden, da sie Kernverhalten des bereits produktiv laufenden
Empfehlungspfads berühren würde (Risiko einer Regression in einer der am
gründlichsten getesteten Komponenten des Systems).

## 5. Auth-/RBAC-Voraussetzung

Bereits vollständig vorhanden aus Phase 8: `config.*`-Permission-Muster
(`config_editor`/`config_publisher`, TENANT-Scope,
`requireConfigPermission()`), Admin-Login
(`node:crypto scrypt`), Audit-Infrastruktur (`AuditLog`,
`action:"CREATE"/"UPDATE"/"DELETE"/"ACTIVATE"/"ROLLBACK"` bereits
etabliert). Für Phase 9 vermutlich **neue** Permission-Keys analog
`config.questions.*`, z. B. `config.rules.view/edit/publish` — reine
Fortführung des Phase-8-Musters, keine neue Architekturentscheidung
nötig.

## 6. Vorläufige Einschätzung für die nächste Stufe (nicht bindend)

Der Regel-Editor kann strukturell sehr eng am Phase-8-Muster gebaut
werden (Draft → Validate → Publish → Historie → Rollback → Audit,
gleiche RBAC-Architektur, gleicher API-vor-UI-Sicherheitsgrenze-Ansatz).
Zwei Punkte unterscheiden sich substanziell von Phase 8 und sollten im
Implementierungsplan explizit adressiert werden, bevor Code entsteht:

1. **Mandantenweiter statt entity-weiter ACTIVE-Scope** (Abschnitt 1) —
   Publish-Logik darf nicht 1:1 aus `publishDraftVersion()`
   (Questionnaire) kopiert werden.
2. **Fehlendes Session-Pinning für Regeln** (Abschnitt 4) — Klärung mit
   ChatGPT nötig, ob das Status quo bleibt oder sich ändert.

Diese Discovery wird ChatGPT zur Prüfung vorgelegt, bevor daraus ein
`PHASE_9_IMPLEMENTATION_PLAN.md` entsteht.
