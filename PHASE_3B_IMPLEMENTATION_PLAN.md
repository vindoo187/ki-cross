# Phase 3B – Implementierungsplan (überarbeitete Fassung nach viertem NO-GO)

Stand: 2026-08-01 (Revision 3.2, korrigierte Fassung). Grundlage:
`PHASE_3B_STARTPROMPT.md`
(Abschnitt 18 und 22 verlangen Ist-Zustand + Lückenanalyse +
Implementierungsplan vor jeder Codeänderung sowie explizites Warten auf das
Implementierungs-GO).

**Diese Fassung ersetzt Revision 3.1.** Verlauf: Revision 1 **NO-GO**
(Scope/Grundrichtung bestätigt, technische Präzision unzureichend) →
Revision 2 **NO-GO**, aber ausdrücklich als "nur noch klar begrenzte
Restauflagen" eingestuft (sechs Punkte) → Revision 3 adressierte diese sechs
Punkte, erhielt aber ein **drittes NO-GO** mit sechs konkreten Schema-/
Reproduzierbarkeitsfehlern (Architektur ausdrücklich als tragfähig
bestätigt) → Revision 3.1 adressierte diese sechs Punkte, erhielt aber ein
**viertes NO-GO**, mit vier von sechs Punkten bereits vollständig **GO**
(Cross-Selling-Source-Constraint, Snapshot-FK, Migration bestehender
`RULE_BASED`-Zeilen, `RuleSetVersion`-EXCLUDE-Constraint) und nur noch drei
eng begrenzten, ausdrücklich als "keine weitere Architekturrunde" (sondern
letzte Datenmodell-/Kanonisierungskorrekturen) eingestuften Restpunkten, mit
der Einschätzung, dass nach diesen Korrekturen ein Implementierungs-GO
möglich ist:

1. **Ausgewertete Produktattribute im Fingerprint** ergänzen — bisher enthält
   der Fingerprint nur `productVersionId`-Werte, nicht die tatsächlich
   gelesenen `PRODUCT_ATTRIBUTE`-Werte der jeweiligen `ProductVersion`
   (→ Abschnitt 3.7).
2. **Antwortwerte im Fingerprint** über den `QuestionVersion`-Antworttyp
   kanonisieren statt fälschlich über die `PRODUCT_ATTRIBUTE`/
   `SESSION_ATTRIBUTE`-Attribute-Registry (`ANSWER` ist ein eigener
   `sourceType`) (→ Abschnitt 3.7).
3. **Mehrdeutiges `RecommendationItem.commissionModelVersionId`** entfernen —
   das Pinning existiert ausschließlich auf `RecommendationRationale`, kein
   aggregierter Einzelwert auf Item-Ebene (→ Abschnitt 3.8).

Die fünfte Prüfung bestätigte alle drei Korrekturpunkte als fachlich/
architektonisch korrekt (Punkt 1 GO, Punkt 2 GO mit kleiner Präzisierung,
Punkt 3 "inhaltlich GO, Plan derzeit widersprüchlich"), bemängelte aber einen
rein redaktionellen Schemawiderspruch: Die Migrationsliste in Abschnitt 10
führte das gemäß Korrekturpunkt 3 entfernte Feld
`commission_model_version_id` weiterhin auf `recommendation_items` statt
ausschließlich auf `recommendation_rationales`. Diese Fassung korrigiert das
(siehe Abschnitt 10) und ergänzt zwei von ChatGPT vorgeschlagene, nicht
blockierende Präzisierungen im Fingerprint (Abschnitt 3.7): ein gelesenes,
aber auf der `ProductVersion` nicht gesetztes `PRODUCT_ATTRIBUTE` wird
deterministisch als JSON-`null` abgebildet statt weggelassen; `NUMBER`-Werte
werden einheitlich als normalisierter Dezimal-`String` (statt uneinheitlich
`Int`/`Float`) kanonisiert. Laut ChatGPT ist damit **kein offener
Architekturpunkt** mehr vorhanden — nach dieser redaktionellen Korrektur ist
das vollständige Implementierungs-GO möglich.

Bereits in Revision 2, Revision 3 **und** Revision 3.1 akzeptierte
Entscheidungen (unverändert übernommen, kein weiterer Anpassungsbedarf laut
ChatGPT): `expression` → `legacyExpression`-Umbenennung (3.2), Score-Trennung
Eligibility/Kundenpassung/Business-Priorisierung (3.3/3.5),
`customerFitScore` als Integer mit `round_half_up` (3.5), stabile Sortierung
inkl. Tie-Break (6), eindeutige Exclusion-Codes je `RuleSetVersion` (3.9),
Append-only-Scope (3.6), geschlossene Attribute-Registry (3.1),
Auswertbarkeits-Definition via `computeVisiblePath`/`computeProgress` (5),
P2002-Handling außerhalb des Transaktions-Callbacks (3.7), kontrollierter
Abbruch via `commissionRequired` (3.8), Cross-Selling-Source-Constraint über
Service-Layer-Validierung statt DB-`CHECK` (3.4), Snapshot-FKs mit `onDelete:
Restrict` (3.4), Upgrade-Pfad für bestehende `RULE_BASED`-Zeilen (10),
`RuleSetVersion`-EXCLUDE-Constraint (10). Diese Abschnitte sind unten
unverändert gegenüber Revision 3.1 belassen, mit Ausnahme der punktuellen
Korrekturen aus den drei Punkten oben. Jeder geänderte Abschnitt verweist
explizit auf den zugehörigen Korrekturpunkt. Noch keine Codeänderung wurde
vorgenommen.

## 1. Bestandsaufnahme (unverändert gegenüber Revision 1)

Das Prisma-Schema enthält bereits eine passende "logische Hülle" für die
Empfehlungs-Engine:

- **Regelmodell-Grundgerüst:** `RuleSet` → `RuleSetVersion` →
  `EligibilityRule` / `ExclusionRule` / `PrioritizationRule`, tenant-gescoped,
  mit `validFrom`/`validTo`/`status: VersionStatus` (gleiches
  Versionierungsmuster wie `QuestionnaireVersion`/`ProductVersion`).
- **Operatorsatz existiert bereits:** `VisibilityOperator` (`EQUALS,
NOT_EQUALS, GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN,
LESS_THAN_OR_EQUAL, IN, NOT_IN, CONTAINS, IS_ANSWERED, IS_NOT_ANSWERED`)
  wird bereits strukturiert (nicht als String-Expression) für
  `VisibilityCondition` verwendet (`targetQuestionId` + `operator` +
  `comparisonValue` + `combinator: LogicalCombinator`, referenziert
  `Question`, nicht `QuestionVersion` — dadurch versionsunabhängig gültig).
- **Ergebnisstruktur vorhanden:** `Recommendation` (Session + `RuleSetVersion`
  fixiert) → `RecommendationItem` (`productVersionId`, `eligibilityPassed`,
  `exclusionReasonCodes: String[]`, `businessPriorityScore: Float`,
  `priorityRank`) → `RecommendationRationale` (`factorKey`/`factorValue`/
  `weight`) und optional `RecommendationOutcome`
  (angenommen/abgelehnt/verschoben, mit `RejectionReason`).
- **Cross-Selling-Grundgerüst vorhanden, aber ohne Regelanbindung:**
  `DetectedNeed` (`needType`, `source: RULE_BASED|EMPLOYEE_MARKED`) →
  `SalesOpportunity` (`categoryId`, `status: OpportunityStatus`, `offeredAt`,
  `resolvedAt`). Es existiert **keine** Regeltabelle, die `RULE_BASED`
  tatsächlich erzeugt — das ist in Abschnitt 3.4 unten neu adressiert.
- **Versionierte Stammdaten:** `ProductVersion`, `CommissionModelVersion`,
  `ProductCostVersion`, `CampaignVersion` — alle mit
  `validFrom`/`validTo`/Exclusion-Constraint-Muster.
- **Tenant-Scoping/Fehlerbehandlung:** `withTenantScope()`,
  `runWithTenantContext()`, zentraler `AppError`-Mechanismus, direkt
  wiederverwendbar (`src/server/questionnaire/errors.ts` als Vorlage für
  `src/server/recommendation/errors.ts`).
- **Append-only-Muster etabliert:** `forbid_update_delete()`-Trigger (siehe
  `prisma/migrations/20260731000000_init/migration.sql`, Zeile ~1000) bereits
  auf `deal_financial_snapshots`, `audit_logs`, `configuration_changes`,
  `analytics_events`. `CustomerAnswer` ist bewusst **nicht** getriggert
  (CAS-Flip von `is_active`), dokumentiert in `docs/DECISION_LOG.md`.
- **Transaktions-/Analytics-Muster etabliert:**
  `src/server/questionnaire/service.ts` erzeugt `AnalyticsEvent`-Zeilen
  konsequent **innerhalb desselben** `db.$transaction(async (tx) => ...)`-
  Callbacks wie die fachliche Schreiboperation (siehe z. B. Zeile 536–570).
  Dieses Muster wird für die Empfehlungs-Engine 1:1 übernommen.
- **Frühere konzeptionelle Vorarbeit:** `docs/RECOMMENDATION_ENGINE.md`
  beschreibt Eignung → Priorisierung → Begründung sowie "keine erfundenen
  Preise" und "keine KI bei der Tarifauswahl".

## 2. Erkannte Lücken (unverändert gegenüber Revision 1, Referenzrahmen)

1. Regelinhalt ist aktuell eine unstrukturierte `expression: String` ohne
   erkennbare Struktur, Zielfeld oder Operator (Abschnitt 7 des Startprompts).
2. Kein separater Kundenpassungswert (Ebene 3 laut Abschnitt 4.3 des
   Startprompts, vgl. auch `docs/RECOMMENDATION_ENGINE.md` Schritt 1:
   "eligibility_score, z. B. Grad der Bedarfsdeckung").
3. `SalesOpportunity` deckt die in Abschnitt 5 geforderten Pflichtfelder
   (auslösende Regel/Antwort, Begründung, Priorität, ggf. Produktbezug, ggf.
   Rückfragegrund) nicht ab; zusätzlich fehlt komplett die Regeltabelle, die
   Cross-Selling-Vorschläge erzeugt.
4. Keine Append-only-Absicherung auf den Empfehlungstabellen.
5. Idempotenzstrategie nicht festgelegt.
6. Kein expliziter Bezug zu `CommissionModelVersion` in der Ergebnisstruktur.
7. Keine strukturierte Verknüpfung zwischen `ExclusionRule` und den
   gespeicherten `exclusionReasonCodes`.

## 3. Entscheidungen (überarbeitet gemäß ChatGPT-NO-GO, Punkt für Punkt)

### 3.1 Strukturiertes Bedingungsmodell — _Kritikpunkt: "targetFieldKey vermischt Antwort- und Produktattribut-Namespace"_

Kein einzelnes `targetFieldKey`-Feld. Stattdessen ein typisiertes
Operanden-Modell mit explizitem `sourceType`, umgesetzt als drei neue,
je an einen Regeltyp gebundene Tabellen (keine polymorphe gemeinsame Tabelle,
konsistent mit dem bisherigen Muster expliziter tenant-gescopeter FKs statt
generischer Polymorphie):

`EligibilityRuleCondition`, `ExclusionRuleCondition`,
`PrioritizationRuleCondition` — jeweils mit identischer Struktur:

| Feld              | Typ                                | Bedeutung                                                                                                                                                                                               |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `Uuid`                             | PK                                                                                                                                                                                                      |
| `tenantId`        | `Uuid`                             | Tenant-Scope                                                                                                                                                                                            |
| `<rule>Id`        | `Uuid`                             | FK auf die jeweilige Regel                                                                                                                                                                              |
| `groupIndex`      | `Int`                              | Gruppen-Nr. für die Kombinationslogik (siehe unten)                                                                                                                                                     |
| `sourceType`      | `ConditionSourceType` (neues Enum) | `ANSWER` \| `PRODUCT_ATTRIBUTE` \| `SESSION_ATTRIBUTE`                                                                                                                                                  |
| `questionId`      | `Uuid?`                            | Pflicht bei `ANSWER`, FK auf `Question` (versionsunabhängig, wie `VisibilityCondition.targetQuestionId`)                                                                                                |
| `attributeKey`    | `String?`                          | Pflicht bei `PRODUCT_ATTRIBUTE` (referenziert `TariffAttribute.attributeKey`, denormalisiert wie dort üblich) oder `SESSION_ATTRIBUTE` (fester, dokumentierter Schlüsselsatz, z. B. `consultationType`) |
| `operator`        | `VisibilityOperator`               | wiederverwendetes Enum, kein Duplikat                                                                                                                                                                   |
| `comparisonValue` | `String`                           | wie bei `VisibilityCondition`                                                                                                                                                                           |
| `createdAt`       | `DateTime`                         |                                                                                                                                                                                                         |

**Validierungsregel (Service-Schicht, nicht DB-Constraint, analog zu
bestehenden Zod-Validierungen für JSON-Felder):** genau eines von
`questionId`/`attributeKey` muss gesetzt sein, abhängig von `sourceType`;
bei `ANSWER` muss `questionId` zu einer in der referenzierten
`QuestionnaireVersion` erreichbaren Frage gehören.

**Geschlossene Key-/Typ-/Operator-Registry — _Restauflage 3: "attributeKey
allein definiert keine erlaubten Keys, Werttypen, Operator-Kompatibilität
oder Parsing-Regeln"_.** `attributeKey` ist **kein** freies String-Feld mehr
im Sinne beliebiger Werte, sondern muss gegen eine geschlossene, im Code
versionierte Registry validiert werden, bevor eine Regel-Condition
gespeichert werden kann (Validierung bei Regel-Erstellung/-Änderung, nicht
erst zur Auswertungszeit):

`src/server/recommendation/attribute-registry.ts` definiert je `sourceType`
ein `Record<string, AttributeDefinition>`:

```ts
type AttributeValueType = "INTEGER" | "DECIMAL" | "BOOLEAN" | "ENUM" | "STRING";

interface AttributeDefinition {
  valueType: AttributeValueType;
  allowedOperators: VisibilityOperator[];
  enumValues?: readonly string[]; // Pflicht bei valueType === "ENUM"
  parse: (raw: string) => unknown; // kanonische Parsing-Funktion, wirft bei ungueltigem Wert
}

const PRODUCT_ATTRIBUTE_DEFINITIONS: Record<string, AttributeDefinition> = {/* ... */};
const SESSION_ATTRIBUTE_DEFINITIONS: Record<string, AttributeDefinition> = {/* ... */};
```

- `PRODUCT_ATTRIBUTE`: Schlüssel müssen sowohl in `PRODUCT_ATTRIBUTE_DEFINITIONS`
  stehen als auch (bei Regel-Erstellung, per Stichprobe über aktive
  `ProductVersion`en) mit dem dort tatsächlich verwendeten
  `TariffAttribute.valueType` konsistent sein — die Registry ist die
  fachliche Wahrheit, `TariffAttribute.valueType` dient nur als
  Plausibilitätsprüfung, um Drift frühzeitig zu erkennen.
- `SESSION_ATTRIBUTE`: initial geschlossener Satz, abgeleitet aus
  `ConsultationSession`-Feldern ohne eigene `ANSWER`-Repräsentation, z. B.
  `consultationType` (`ENUM`, Werte = `ConsultationType`-Enum,
  Operatoren `EQUALS`/`NOT_EQUALS`/`IN`/`NOT_IN`). Erweiterungen der Registry
  erfordern eine Code-Änderung (Review-Pflicht), keine Laufzeit-Konfiguration.
- **Unbekannter Key:** Regel-Erstellung/-Änderung schlägt mit
  `UnknownAttributeKeyError` fehl (siehe Abschnitt 8) — es wird **nie**
  stillschweigend eine Bedingung mit unbekanntem Key gespeichert.
- **Operator nicht erlaubt für den Key:** `InvalidOperatorForAttributeError`.
- **`comparisonValue` nicht parsebar gemäß `valueType`:**
  `InvalidComparisonValueError` (z. B. `"abc"` bei `valueType = "INTEGER"`).
- Zur Auswertungszeit wird ausschließlich die kanonische `parse()`-Funktion
  der Registry verwendet (kein erneutes Ad-hoc-Parsing in `conditions.ts`),
  damit Schreib- und Lesepfad exakt dieselbe Interpretation von
  `comparisonValue` verwenden.

**Gruppen-Semantik (ersetzt den mehrdeutigen `combinator`-pro-Zeile-Ansatz):**
Bedingungen mit gleichem `groupIndex` werden UND-verknüpft; unterschiedliche
`groupIndex`-Werte werden ODER-verknüpft. Kein Nesting (eine Ebene, analog zur
dokumentierten Einschränkung bei `VisibilityCondition`). Diese Semantik ist
für den Piloten bewusst identisch mit Phase 3A gehalten, aber durch
`groupIndex` eindeutig statt durch einen pro-Zeile wiederholten
`combinator`-Wert, der bei gemischten AND/OR-Zeilen mehrdeutig wäre.

Das bestehende `expression: String`-Feld auf allen drei Regeltypen wird
**nicht gelöscht**, sondern siehe 3.2.

### 3.2 Umgang mit `expression` — _Kritikpunkt: "Dropping ist keine additive Migration"_

`expression` wird auf allen drei Regeltypen zu `legacyExpression: String?`
umbenannt (Migration: `ALTER TABLE ... RENAME COLUMN expression TO
legacy_expression`, Spalte wird nullable) und **aus dem aktiven
Auswertungspfad entfernt** — die Service-Schicht liest ausschließlich die
neuen Condition-Tabellen. `legacyExpression` dient nur noch als historischer/
dokumentarischer Rest (aktuell ohnehin nur synthetische Seed-Werte, keine
Produktivdaten). Physisches Löschen der Spalte erfolgt frühestens in einer
späteren, dedizierten Cleanup-Migration nach Phase 3B — nicht in dieser
Migration.

### 3.3 Rule-Effects je Regeltyp — _Kritikpunkt: "bare conditions alone are not a complete rule"_

- **`EligibilityRule`**: neues Feld `isRequired: Boolean @default(true)` und
  `fitWeight: Int @default(0)` (Basis-Punkte-Beitrag zu `customerFitScore`,
  0–100 skaliert, siehe 3.4). Effekt: Ist `isRequired = true` und die
  Bedingung(en) sind nicht erfüllt → `eligibilityPassed = false` (hartes
  Gate, wie bisher). Ist `isRequired = false`, beeinflusst die Regel nur den
  `customerFitScore` (gewichteter Beitrag), nie das harte Gate. Damit ist der
  von ChatGPT verlangte Effekttyp ("pass/fail oder gewichteter Beitrag") pro
  Regel explizit konfigurierbar statt implizit.
- **`ExclusionRule`**: Effekt bleibt strukturell hart (Ausschluss), ergänzt
  um `justificationParams: Json?` (strukturierte Parameter der auslösenden
  Bedingung, z. B. `{"requiredMonths": 24, "actualMonths": 6}`) zusätzlich
  zum bereits vorhandenen `reasonCode`. Siehe auch 3.8 zur referenzierten
  Speicherung im `RecommendationItem`.
- **`PrioritizationRule`**: Effekt bleibt wie bisher — bedingter, gewichteter
  Beitrag (`weight: Int`) zu `businessPriorityScore`, nur auf bereits
  eignungsgeprüften Produkten wirksam.
- **`CrossSellingRule`** (neue Tabelle, siehe 3.4): Effekt = `needType:
NeedType` + `priority: Int` + optional `suggestedProductVersionId`.

### 3.4 Cross-Selling-Regelmodell + unveränderlicher Snapshot — _Restauflage 2 (Revision 2): "SalesOpportunity ist mutable und hat keinen fixen Link zu ihrem generierten Ergebnis; direktes Schreiben in SalesOpportunity ist nicht reproduzierbar; verpflichtende Trigger-Felder brechen EMPLOYEE_MARKED"; Korrekturpunkte 1+2 (Revision 3.1): "Source-Constraint technisch nicht als DB-CHECK umsetzbar (source liegt auf DetectedNeed, nicht SalesOpportunity); onDelete: SetNull beim Snapshot-FK kollidiert mit Append-only-Trigger"_

**Kernkorrektur gegenüber Revision 2:** das Engine-Ergebnis wird **nicht**
mehr direkt in das mutable `SalesOpportunity` geschrieben. Stattdessen
entsteht eine neue, unveränderliche, an die auslösende `Recommendation`
gebundene Tabelle `RecommendationCrossSellingSignal` — analog zu
`RecommendationItem`, append-only (siehe 3.6). `SalesOpportunity` **liest**
aus dieser Tabelle bzw. übernimmt daraus kopierte Werte, ist aber nie selbst
die Quelle der Wahrheit für das Auswertungsergebnis.

Neue Tabelle `CrossSellingRule` (analog `PrioritizationRule`, gebunden an
`RuleSetVersion`, mit `CrossSellingRuleCondition` nach demselben Schema wie
3.1): `key`, `needType: NeedType`, `priority: Int`, `reasonCode: String`,
`suggestedProductVersionId: String?` (FK `ProductVersion`, `onDelete
SetNull`), `isActive: Boolean`.

**Neue Tabelle `RecommendationCrossSellingSignal`** (unveränderlich, Teil
desselben Auswertungslaufs wie `RecommendationItem`):

| Feld                        | Typ        | Bedeutung                                                                                                                                                                                                                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `Uuid`     | PK                                                                                                                                                                                                                                                   |
| `tenantId`                  | `Uuid`     | Tenant-Scope                                                                                                                                                                                                                                         |
| `recommendationId`          | `Uuid`     | FK `Recommendation`, `onDelete Restrict`                                                                                                                                                                                                             |
| `triggerRuleId`             | `Uuid`     | FK `CrossSellingRule`, `onDelete Restrict`                                                                                                                                                                                                           |
| `triggerRuleSetVersionId`   | `Uuid`     | FK `RuleSetVersion`, `onDelete Restrict` (Regel innerhalb `ACTIVE`-Version unveränderlich, macht die auslösende Regel reproduzierbar)                                                                                                                |
| `sourceAnswerId`            | `Uuid?`    | FK `CustomerAnswer`, `onDelete Restrict` (nullable — nicht jede Regel hat genau eine auslösende Antwort)                                                                                                                                             |
| `needType`                  | `NeedType` | Kopie von `CrossSellingRule.needType` zum Auswertungszeitpunkt                                                                                                                                                                                       |
| `reasonCode`                | `String`   | Kopie von `CrossSellingRule.reasonCode` zum Auswertungszeitpunkt                                                                                                                                                                                     |
| `justificationParams`       | `Json?`    | strukturierte Parameter, analog 3.3                                                                                                                                                                                                                  |
| `priority`                  | `Int`      | Kopie von `CrossSellingRule.priority` zum Auswertungszeitpunkt                                                                                                                                                                                       |
| `suggestedProductVersionId` | `Uuid?`    | Kopie/Auflösung, `onDelete Restrict` (korrigiert gegenüber Revision 3 — `SetNull` würde beim Löschen einer `ProductVersion` ein `UPDATE` auf diese append-only-getriggerte Zeile auslösen, siehe 3.6, und damit gegen den eigenen Trigger verstoßen) |
| `createdAt`                 | `DateTime` |                                                                                                                                                                                                                                                      |

Append-only-Trigger gilt für `recommendation_cross_selling_signals` (Ergänzung
zu 3.6). Dieses Signal ist damit exakt so reproduzierbar wie jedes andere
`RecommendationItem` desselben Laufs (gleicher Fingerprint, siehe 3.7).

**`SalesOpportunity`-Erweiterung (korrigiert: alle neuen Felder nullable,
kompatibel mit `EMPLOYEE_MARKED`):**

- `triggerSignalId: String?` (FK `RecommendationCrossSellingSignal`,
  `onDelete Restrict`, **nullable** — `NULL` bei `source = EMPLOYEE_MARKED`,
  gesetzt bei `source = RULE_BASED`)
- `reasonCode: String?` (bei `RULE_BASED`: beim Anlegen aus dem referenzierten
  Signal kopiert; bei `EMPLOYEE_MARKED`: vom Mitarbeitenden frei vergeben oder
  `NULL`)
- `justificationParams: Json?`
- `priority: Int?`
- `followUpRequired: Boolean @default(false)`
- `followUpReasonCode: String?`

**Korrektur gegenüber Revision 3 (Korrekturpunkt 1): kein DB-`CHECK` für die
Source-Konsistenz.** Der in Revision 3 vorgeschlagene
`CHECK ((source = 'RULE_BASED' AND trigger_signal_id IS NOT NULL) OR
(source = 'EMPLOYEE_MARKED' AND trigger_signal_id IS NULL))` ist technisch
nicht umsetzbar: `source` liegt auf `DetectedNeed`
(`DetectedNeed.source: RULE_BASED|EMPLOYEE_MARKED`, siehe Abschnitt 1), nicht
auf `SalesOpportunity` selbst — ein PostgreSQL-`CHECK` kann keine
Unterabfrage auf eine andere Tabelle ausführen und somit `source` gar nicht
prüfen. Von den drei durch ChatGPT skizzierten Varianten wird **Variante
(c)** gewählt (kein `source`-Duplikat auf `SalesOpportunity`, kein
DB-Trigger): `SalesOpportunity` erhält **nur** das nullable `triggerSignalId`-
Feld; die Herkunft (`RULE_BASED` vs. `EMPLOYEE_MARKED`) bleibt ausschließlich
über die Relation zum auslösenden `DetectedNeed` bestimmt (bereits heute so
etabliert, siehe Abschnitt 1 Bestandsaufnahme) — es entsteht **kein**
zusätzliches, potenziell divergierendes `source`-Feld auf
`SalesOpportunity`. Konsistenz zwischen `DetectedNeed.source` und
`triggerSignalId` wird stattdessen **am Service-Layer** erzwungen (nicht in
der DB): beim Anlegen einer `SalesOpportunity` prüft
`src/server/recommendation/sales-opportunity.ts`, dass bei
`DetectedNeed.source = RULE_BASED` ein `triggerSignalId` gesetzt sein muss
und bei `source = EMPLOYEE_MARKED` keines gesetzt sein darf; bei Verletzung
wird `SalesOpportunitySourceMismatchError` geworfen (siehe Abschnitt 8). Dies
ist bewusst eine Anwendungs- statt DB-Invariante, da eine korrekte
DB-Constraint hierfür eine funktionale Abhängigkeit über zwei Tabellen
(`sales_opportunities` → `detected_needs`) bräuchte, die PostgreSQL ohne
Trigger nicht abbilden kann und ein zusätzlicher Trigger die Komplexität
gegenüber dem bereits etablierten Service-Validierungsmuster (siehe
Attribute-Registry, 3.1) unverhältnismäßig erhöhen würde.

`sales_opportunities` bleibt **nicht** append-only (3.6 unverändert) — beim
Erzeugen werden die Kopie-Felder einmalig aus dem Signal übernommen,
nachfolgende Statuswechsel (`OFFERED`/`ACCEPTED`/... ) ändern nur den
mutable Lifecycle-Teil, nicht die Kopie-Felder.

Freitext-Begründung entfällt als alleinige Quelle vollständig; die
Formulierung in natürlicher Sprache (falls gewünscht) entsteht laut
`docs/RECOMMENDATION_ENGINE.md` erst in Schritt 3 aus diesen strukturierten
Feldern, nicht umgekehrt.

### 3.5 `customerFitScore` — _Kritikpunkt: "unbeschränkter Float ist nicht reproduzierbar"_

`RecommendationItem.customerFitScore: Int` (0–100, ganzzahlig, keine
`Float`/`Decimal`-Unschärfe). Berechnung:
`round_half_up(100 * Σ(matchedFitWeight) / Σ(allActiveFitWeight))`, wobei die
Summe über alle aktiven `EligibilityRule`-Zeilen mit `isRequired = false`
läuft (Regeln mit `isRequired = true` tragen nicht zum Score bei, sie sind
das harte Gate aus 3.3). **Normalisierung/Sonderfälle:**

- Sind für die Kategorie keine gewichteten (`isRequired = false`)
  `EligibilityRule`-Zeilen aktiv, ist `customerFitScore = 100` per
  Konvention (keine Differenzierung möglich → neutral, nicht 0), und
  `RecommendationRationale` vermerkt explizit `factorKey =
"no_weighted_eligibility_rules"`.
- `businessPriorityScore` wird ebenfalls von `Float` auf `Int` geändert
  (Summe der `PrioritizationRule.weight`-Werte matched Regeln — `weight` ist
  bereits `Int`, dadurch entfällt Gleitkomma-Unschärfe durchgängig).

Jeder einzelne Beitrag (welche Regel mit welchem Gewicht) wird als eigene
`RecommendationRationale`-Zeile gespeichert, mit `factorKey = <Regel-Key>`
und `weight = <Gewicht>` — die bereits vorhandene generische Struktur reicht
dafür aus, sobald der `factorKey` eindeutig auf die auslösende Regel
verweist (siehe 3.7 zur Eindeutigkeit von Regel-Keys je `RuleSetVersion`).

### 3.6 Append-only-Geltungsbereich — _Kritikpunkt: "SalesOpportunity ist bewusst mutable, gehört nicht unter den Trigger"_

`forbid_update_delete()` wird **nur** auf `recommendations`,
`recommendation_items`, `recommendation_rationales`,
`recommendation_outcomes` **und** `recommendation_cross_selling_signals`
gesetzt (Outcome und Cross-Selling-Signal sind wie Item jeweils eine
einmalige, unveränderliche Aufzeichnung — ergänzend zur ursprünglichen
Liste, da fachlich dieselbe Begründung wie bei den anderen Tabellen
gilt; siehe 3.4 zum Cross-Selling-Signal). **Nicht** auf
`sales_opportunities` — deren Lebenszyklus
(`OPEN → OFFERED → ACCEPTED/DECLINED/DEFERRED`, `resolvedAt`) ist bewusst
mutable und bleibt es.

**Delete-Cascade-Review (zusätzlich zum Trigger):** alle neuen FKs auf
Empfehlungs-/Cross-Selling-Tabellen verwenden `onDelete: Restrict` (löschen
von `RuleSetVersion`, `ProductVersion`, `CommissionModelVersion`,
`CustomerAnswer` o. ä. ist ohnehin durch bestehende Restrict-FKs blockiert,
solange referenzierende Zeilen existieren) — kein Cascade-Pfad, der
Empfehlungsdaten indirekt löschen könnte.

### 3.7 Idempotenz via Fingerprint — _Kritikpunkt: "neue Zeile pro Lauf vs. letzter Lauf ist keine Idempotenzstrategie"; Korrekturpunkte 1+2 (Revision 3.2): "ausgewertete Produktattribute fehlen im Fingerprint; Antwortwerte werden fälschlich über die Attribute-Registry statt über den QuestionVersion-Antworttyp kanonisiert"_

`Recommendation` erhält zwei neue Felder:

- `algorithmVersion: Int` (Konstante, aktuell `1`, in Code definiert als
  `RECOMMENDATION_ALGORITHM_VERSION`)
- `evaluationFingerprint: String` (`Char(64)`, SHA-256-Hex)

**Fingerprint-Berechnung** (deterministisch, in
`src/server/recommendation/fingerprint.ts`) — _korrigiert gegenüber Revision
3 (Korrekturpunkt 3): "Fingerprint deckt SESSION_ATTRIBUTE-Werte nicht ab
und verlässt sich bei Antworten nur auf (answerId, answerVersion) ohne
kanonischen Wert"_.

Statt einfacher String-Verkettung wird ein kanonisches JSON-Objekt gebildet
und dessen deterministische Serialisierung gehasht (Schlüssel in fixer,
alphabetischer Reihenfolge, keine Ambiguität durch Trennzeichen-Kollisionen
wie bei `|`-Konkatenation):

```json
{
  "algorithmVersion": <Int>,
  "answers": [
    { "answerId": "<Uuid>", "answerVersion": <Int>, "value": <kanonischer Wert gemäß QuestionVersion-Antworttyp> },
    ...
  ],
  "commissionModelVersionIds": ["<Uuid>", ...],
  "productInputs": [
    {
      "productVersionId": "<Uuid>",
      "attributes": [
        { "key": "<z. B. dataVolumeGb>", "value": <kanonischer, typisierter Wert> },
        ...
      ]
    },
    ...
  ],
  "questionnaireVersionId": "<Uuid>",
  "ruleSetVersionId": "<Uuid>",
  "sessionAttributes": [
    { "key": "<z. B. consultationType>", "value": <kanonischer, typisierter Wert> },
    ...
  ],
  "sessionId": "<Uuid>",
  "tenantId": "<Uuid>"
}
```

`sha256(canonicalJsonStringify(obj))`, wobei `canonicalJsonStringify`
Objektschlüssel rekursiv alphabetisch sortiert und `answers` nach
`answerId`, `productInputs` nach `productVersionId` (und darin `attributes`
nach `key`) sowie `sessionAttributes` nach `key` sortiert, **bevor**
serialisiert wird (Sortierung ist Teil der Kanonisierung, nicht nur der
Eingabe-Vorbereitung).

**Korrektur gegenüber Revision 3.1 (Korrekturpunkt 1): `productInputs` statt
`productVersionIds`.** Revision 3.1 enthielt im Fingerprint nur die
`productVersionId`-Werte, nicht die zum Auswertungszeitpunkt tatsächlich
gelesenen `PRODUCT_ATTRIBUTE`-Werte der jeweiligen `ProductVersion` (z. B.
`dataVolumeGb`, `pricePlanTier`). Zwei Läufe mit derselben
`productVersionId`, aber — bei einem Bug in der Unveränderlichkeits-
Durchsetzung aktiver `ProductVersion`-Zeilen — unterschiedlichen gelesenen
Attributwerten dürfen nicht denselben Fingerprint liefern; die reine
`productVersionId`-Referenz allein garantiert das nicht. Pro tatsächlich
ausgewerteter `ProductVersion` wird daher ein `productInputs`-Eintrag mit
`productVersionId` und der sortierten Liste der von mindestens einer
aktiven Regel der ausgewerteten `RuleSetVersion` tatsächlich gelesenen
`PRODUCT_ATTRIBUTE`-Schlüssel/Werte geführt (analog zu `sessionAttributes`
unten). `value` ist dabei der über die geschlossene Attribute-Registry
(3.1) geparste, typisierte Wert (dieselbe `parse()`-Funktion, die auch
Schreib- und Lesepfad der Registry verwendet) — für `PRODUCT_ATTRIBUTE` und
`SESSION_ATTRIBUTE` bleibt diese Kanonisierung über die Registry korrekt,
da beide als eigener `sourceType` genau dafür vorgesehen sind. Wird ein
Attribut von einer aktiven Regel gelesen, ist aber auf der jeweiligen
`ProductVersion` nicht gesetzt, wird `value` deterministisch als JSON-`null`
in den Fingerprint aufgenommen (kein Weglassen des Schlüssels — ein
fehlender Schlüssel und ein explizit gesetzter `null`-Wert sind für den
Fingerprint äquivalent zu behandeln, damit beide Fälle denselben,
vorhersehbaren Beitrag liefern).

**Korrektur gegenüber Revision 3.1 (Korrekturpunkt 2): Antwortwerte werden
nicht über die Attribute-Registry kanonisiert.** `answers[].value` wurde in
Revision 3.1 fälschlich als über dieselbe `parse()`-Funktion der
`PRODUCT_ATTRIBUTE`/`SESSION_ATTRIBUTE`-Registry (3.1) geparster Wert
beschrieben. `ANSWER` ist jedoch ein eigener, von `PRODUCT_ATTRIBUTE` und
`SESSION_ATTRIBUTE` unabhängiger `sourceType` in der bestehenden
Bedingungsmodell-Taxonomie (3.1) — die Registry kennt keinen Eintrag für
einzelne Fragen. Stattdessen wird `answers[].value` über den
**Antworttyp der zugehörigen, bereits fixierten `QuestionVersion`**
kanonisiert: `QuestionVersion.answerType` (`BOOLEAN`, `NUMBER`,
`SINGLE_CHOICE`, `MULTI_CHOICE`) bestimmt eine feste, in
`src/server/recommendation/fingerprint.ts` co-lokalisierte
Kanonisierungsfunktion je Antworttyp (`BOOLEAN` → `true`/`false`, `NUMBER`
→ **einheitlich eine normalisierte Dezimaldarstellung als `String`**, z. B.
über `Decimal.toFixed()` mit fester, dokumentierter Nachkommastellenzahl
statt eines je nach Feld wechselnden `Int`/`Float`-Subtyps — vermeidet
Gleitkomma-Serialisierungsunterschiede zwischen gleichwertigen Zahlenwerten
—, `SINGLE_CHOICE` → der gewählte Options-Key als `String`, `MULTI_CHOICE` →
alphabetisch sortiertes Array von Options-Keys) — unabhängig von und ohne
Aufruf der Attribute-Registry-`parse()`-Funktion. Zwei `CustomerAnswer`-Zeilen mit
demselben fachlichen Wert, aber unterschiedlicher Roh-Repräsentation (z. B.
`"true"` vs. `true` im rohen Antwort-JSON), liefern dadurch weiterhin
denselben Fingerprint-Beitrag — die Garantie aus Revision 3.1 bleibt
erhalten, nur die Quelle der Kanonisierungsregel ist korrigiert.

`sessionAttributes` umfasst alle `SESSION_ATTRIBUTE`-Keys aus der
geschlossenen Registry, die von mindestens einer aktiven Regel der
ausgewerteten `RuleSetVersion` tatsächlich gelesen wurden (z. B.
`consultationType`) — ändert sich ein solcher Attributwert zwischen zwei
Aufrufen ohne dass sich `sessionId` ändert, ändert sich damit auch der
Fingerprint, wie von ChatGPT verlangt.

**Constraint:** `@@unique([tenantId, consultationSessionId,
evaluationFingerprint])`.

**Ablauf — _korrigiert gegenüber Revision 2 (Restauflage 4: "P2002-Behandlung
darf nicht im selben, bereits fehlgeschlagenen Transaktions-Callback
erfolgen")_:**

1. Fingerprint deterministisch aus **allen tatsächlich ausgewerteten**
   Eingaben berechnen (inkl. der tatsächlich gelesenen `productInputs`-
   Attributwerte und `commissionModelVersionId`-Mengen, siehe 3.7-Formel
   oben — nicht nur der theoretisch verfügbaren).
2. **Vor** dem Öffnen der Transaktion: `SELECT` auf existierenden
   `Recommendation`-Datensatz mit diesem Fingerprint (Fast-Path außerhalb
   jeder Transaktion). Falls vorhanden → unverändert zurückgeben, fertig
   (kein Schreibzugriff, volle Idempotenz, kein Transaktions-Overhead im
   Regelfall wiederholter Aufrufe).
3. Falls nicht vorhanden: `db.$transaction(async (tx) => ...)` öffnen und
   `Recommendation` + alle `RecommendationItem`/`RecommendationRationale`/
   `RecommendationCrossSellingSignal` schreiben (siehe 3.4, 7).
4. **Der `try`/`catch` um Schritt 3 liegt außerhalb des
   `$transaction`-Callbacks, nicht darin.** Schlägt die Transaktion mit
   Prisma-Fehlercode `P2002` (Unique-Constraint-Verletzung auf
   `[tenantId, consultationSessionId, evaluationFingerprint]`) fehl, bedeutet
   das: ein paralleler Aufruf mit identischem Fingerprint hat zwischen
   Schritt 2 und Schritt 3 committet. Das `catch` fängt diesen Fehler **nach**
   dem gescheiterten `$transaction`-Aufruf ab (die fehlgeschlagene Transaktion
   wurde bereits vollständig zurückgerollt) und führt **außerhalb** jeder
   Transaktion eine neue, tenant-gescopte `SELECT`-Abfrage auf denselben
   Fingerprint aus.
5. Liefert diese Abfrage einen Treffer → diesen zurückgeben (Race korrekt
   aufgelöst, kein Fehler an den Aufrufer). Liefert sie **keinen** Treffer
   (der `P2002` bezog sich dann auf etwas anderes als den erwarteten Race,
   z. B. Datenkorruption oder ein Bug in der Fingerprint-Berechnung) → ein
   interner Konsistenzfehler wird ausgelöst (`RecommendationConsistencyError`,
   siehe Abschnitt 8) statt den `P2002` stillschweigend zu schlucken.

Damit ist ausgeschlossen, dass die Recovery-Logik innerhalb derselben
Transaktion läuft, die den Konflikt verursacht hat (dort wäre `tx` durch den
fehlgeschlagenen Aufruf bereits invalide) — die Recovery-Abfrage nutzt
konsequent eine neue, unabhängige DB-Verbindung/Query außerhalb von `tx`.

**"Aktueller Stand" einer Session:** `ORDER BY generatedAt DESC, id DESC
LIMIT 1` innerhalb des Tenants — `id DESC` als deterministischer Tie-Break,
falls zwei unterschiedliche Fingerprints (z. B. durch geänderte Antworten
zwischen zwei Aufrufen) zufällig denselben `generatedAt`-Zeitstempel haben
sollten.

### 3.8 `CommissionModelVersion`-Pinning — _Kritikpunkt (Revision 1): "Rekonstruktion über generatedAt ist bei rückwirkenden Änderungen unzuverlässig"; Restauflage 5 (Revision 2): "ID-Pinning korrekt, aber numerischer Snapshot fehlt; kontrollierter Abbruch bei zwingend benötigter, fehlender Version fehlt"; Korrekturpunkt 4 (Revision 3.1): "Widerspruch, ob commissionModelVersionId auf RecommendationRationale oder nur auf RecommendationItem liegt, muss eindeutig entschieden werden"; Korrekturpunkt 3 (Revision 3.2): "mehrdeutiges RecommendationItem.commissionModelVersionId entfernen oder konsequent auf NULL setzen bei mehreren Versionen"_

**Korrektur gegenüber Revision 3.1 (Korrekturpunkt 3): `RecommendationItem`
erhält kein `commissionModelVersionId`-Feld.** Revision 3.1 führte das Pinning
zusätzlich auf `RecommendationItem` ein und definierte für den Fall mehrerer,
unterschiedlicher `commissionModelVersionId`-Werte auf den zugehörigen
`RecommendationRationale`-Zeilen eine Konvention ("zuletzt ausgewertete bzw.
gewichtsstärkste Regel"), die laut ChatGPT keine eindeutige fachliche Aussage
hat — "zuletzt ausgewertet" und "gewichtsstärkste" sind zwei verschiedene,
nicht deckungsgleiche Regeln. Da ein einzelnes `RecommendationItem` mehrere
provisionsbasierte `RecommendationRationale`-Beiträge mit potenziell
unterschiedlichen `CommissionModelVersion`-Pins haben kann (siehe unten), gibt
es keinen fachlich korrekten Einzelwert, der auf Item-Ebene aggregiert werden
könnte. Das Pinning existiert daher **ausschließlich** auf
`RecommendationRationale.commissionModelVersionId`. Benötigt die
Mitarbeiteroberfläche künftig eine Item-weite Übersicht der verwendeten
Provisionsversionen, wird diese zur Lesezeit über die Menge der
`commissionModelVersionId`-Werte aller zum Item gehörenden
`RecommendationRationale`-Zeilen gebildet (`DISTINCT`-Abfrage,
`0..n` Ergebnisse) — nie als einzelner, denormalisierter Wert mit
irreführender Eindeutigkeit gespeichert.

Der Service löst die zum Auswertungszeitpunkt gültige
`CommissionModelVersion` je provisionsbasiertem `PrioritizationRule`-Beitrag
über das bestehende `validFrom`/`validTo`-Fenster auf und **persistiert die
aufgelöste ID direkt an der jeweiligen `RecommendationRationale`-Zeile**
(siehe Korrektur unten) — keine spätere Rekonstruktion über `generatedAt`
mehr nötig oder vorgesehen.

**Numerischer Snapshot (neu, Restauflage 5):** Die ID allein rekonstruiert
nicht, welcher Provisionswert tatsächlich in die Priorisierung eingeflossen
ist, falls sich das Berechnungsverfahren (nicht nur die Versionsdaten)
künftig ändert. `RecommendationRationale` erhält daher für jeden
provisionsbasierten `PrioritizationRule`-Beitrag zusätzlich zum bereits
vorhandenen `weight` ein neues Feld `commissionValueMinor: Int?`
(Kleinsteinheit, analog `monthlyPriceMinor`-Konvention) — der tatsächlich zum
Auswertungszeitpunkt aus der gepinnten `CommissionModelVersion` gelesene
numerische Provisionswert, unabhängig davon, wie sich die
`CommissionModelVersion`-Zeile später (falls überhaupt, append-only-artige
Stammdaten vorausgesetzt) interpretieren ließe.

**`commissionModelVersionId` ausschließlich auf `RecommendationRationale`
(Korrektur gegenüber Revision 3.1, Korrekturpunkt 3).**
`RecommendationRationale` erhält `commissionModelVersionId: String?` (FK
`CommissionModelVersion`, `onDelete Restrict`, nullable — `null` für nicht
provisionsbasierte Rationale-Zeilen). Da ein einzelnes `RecommendationItem`
mehrere provisionsbasierte `RecommendationRationale`-Beiträge haben kann
(z. B. mehrere `PrioritizationRule`-Treffer mit `commissionRequired = true`
auf unterschiedlichen Produktkategorien innerhalb desselben Items — Item und
Provisionsregel stehen nicht 1:1), ist pro Rationale-Zeile exakt
nachvollziehbar, welche `CommissionModelVersion` genau diesem einzelnen
`commissionValueMinor`-Wert zugrunde lag, unabhängig davon, ob dasselbe Item
weitere, ggf. anders versionierte Provisionsbeiträge enthält. Es gibt **kein**
zusätzliches, aggregiertes `commissionModelVersionId`-Feld auf
`RecommendationItem` — jeder Versuch, mehrere ggf. unterschiedliche
Rationale-Versionen auf einen einzelnen Item-Wert zu reduzieren, würde eine
fachlich nicht existierende Eindeutigkeit vortäuschen (siehe Korrektur oben).
Damit hält jede Rationale-Zeile sowohl ihre eigene `commissionModelVersionId`
(Referenz/Nachvollziehbarkeit auf Beitragsebene) als auch den tatsächlich
verwendeten Zahlenwert (Reproduzierbarkeit unabhängig von künftigen
Interpretationsänderungen der Versionsdaten).

**Kontrollierter Abbruch (neu, Restauflage 5):** `PrioritizationRule` erhält
ein neues Feld `commissionRequired: Boolean @default(false)`. Ist
`commissionRequired = true` und für die betroffene Produktkategorie zum
Auswertungszeitpunkt **keine** gültige `CommissionModelVersion` auflösbar,
wird die gesamte Auswertung für diese Session mit
`CommissionModelUnresolvedError` (siehe Abschnitt 8) kontrolliert
abgebrochen — es wird **keine** `Recommendation` mit unvollständiger,
fachlich falscher Provisionsgrundlage gespeichert. Ist `commissionRequired =
false` (Default), bleibt das bisherige Verhalten aus Revision 2 bestehen:
die einzelne Regel trägt mit Gewicht `0` bei (`RecommendationRationale`-
Eintrag `factorKey = "commission_model_unresolved"`), die Gesamtauswertung
läuft weiter. Diese Unterscheidung macht explizit, welche
Provisionsregeln fachlich zwingend sind (z. B. Provisions-optimierte
Priorisierung als Kernkriterium) und welche optional sind (z. B. Provision
als einer von mehreren Nebenfaktoren).

### 3.9 Exclusion-Codes — _GO mit Auflagen: eindeutige, denormalisierte Referenz statt Freitext-Array ohne Rückbindung_

`exclusionReasonCodes: String[]` bleibt bestehen (kein FK-Array in Postgres
sinnvoll), wird aber inhaltlich präzisiert: pro Ausschluss wird zusätzlich in
`RecommendationRationale` ein Eintrag mit `factorKey = "exclusion:<reasonCode>"`,
`factorValue` = strukturierte `justificationParams` (JSON-String) aus der
auslösenden `ExclusionRule` (3.3) sowie ein `sourceAnswerId`-Hinweis (falls
vorhanden) gespeichert, mit deterministischer Reihenfolge
(`ORDER BY <Regel-Key>` beim Schreiben). **Neue DB-Regel:**
`ExclusionRule.reasonCode` muss innerhalb einer `RuleSetVersion` eindeutig
und nicht leer sein — durchgesetzt über
`@@unique([tenantId, ruleSetVersionId, reasonCode])` und eine
`CHECK (reason_code <> '')`-Constraint in der Migration.

## 4. Nicht angetastete Bereiche (unverändert)

Wie in Abschnitt 17 des Startprompts vorgegeben, werden in Phase 3B **nicht**
angefasst: Mitarbeiteroberfläche, Geschäftsführer-Dashboard, Admin-Center,
grafischer Regeleditor, automatische Tarifimporte, Anbieterportal-
Integration, Browser-Erweiterung, Vertragsabschluss,
Rufnummernmitnahmeprozess, Kündigungsgenerator, KI/LLM,
Freitextinterpretation, Machine Learning, automatische Zieloptimierung,
vollständige Margen-/ROI-Auswertung sowie jede nachträgliche Erweiterung des
Phase-3A-Umfangs.

## 5. Definition "auswertbare Session" — _Restauflage 1: "eine aktive Antwort reicht nicht; alle sichtbaren Pflichtfragen müssen beantwortet sein, sonst kann eine Session mit nur einer Antwort trotz offener Pflichtfragen als auswertbar durchgehen"_

**Kernkorrektur gegenüber Revision 2:** Bedingung (2) ("mindestens eine
aktive Antwort") wird ersetzt durch eine Vollständigkeitsprüfung, die exakt
dieselbe Sichtbarkeits-/Pflichtfragenlogik wiederverwendet, die Phase 3A
bereits für den Fragebogen-Fortschritt implementiert hat
(`src/server/questionnaire/path.ts`: `computeVisiblePath()` +
`computeProgress()`). Es wird **keine** eigene, potenziell abweichende
zweite Vollständigkeitslogik für die Empfehlungs-Engine eingeführt.

Eine `ConsultationSession` ist auswertbar, wenn **alle** gelten:

1. `status = IN_PROGRESS` (Sonderfall `COMPLETED`/`ABANDONED` siehe unten).
2. Für den Tenant existiert genau eine `RuleSetVersion` mit `status =
ACTIVE`, deren `validFrom`/`validTo`-Fenster den Auswertungszeitpunkt
   einschließt (identisches Muster wie bei aktiven `QuestionnaireVersion`en).
   Existiert **mehr als eine** aktive Treffer-Zeile (wird durch den in
   Abschnitt 10 konkret definierten `EXCLUDE`-Constraint auf
   `RuleSetVersion.validFrom`/`validTo` bereits auf DB-Ebene verhindert,
   Korrekturpunkt 6 — nicht mehr nur als vorgesehen behauptet, siehe
   Kopfabschnitt), wird dies als interner Konfigurationsfehler behandelt,
   siehe Abschnitt 8.
3. **Vollständigkeit (neu, ersetzt die bisherige Bedingung 2):** Der Service
   lädt denselben `QuestionNode[]`-Baum und dieselben aktiven Antworten, die
   auch die Fragen-Engine für Fortschrittsberechnung verwendet, ruft
   `computeVisiblePath(nodes, answersByQuestionId)` und darauf
   `computeProgress(visiblePath)` auf und verlangt
   `progress.canComplete === true` (d. h. `missingRequiredQuestionIds.length
=== 0`). Nur Antworten, die zu einer laut `computeVisiblePath` aktuell
   sichtbaren Frage **derselben, an der Session fixierten**
   `QuestionnaireVersion` gehören, fließen ein — Antworten zu nicht mehr
   sichtbaren Fragen (siehe `findNewlyHiddenAnsweredQuestionIds`) oder zu
   Fragen außerhalb dieser `QuestionnaireVersion` werden nicht
   berücksichtigt, da `computeVisiblePath` ausschließlich mit den Knoten der
   fixierten Version aufgerufen wird.
4. Mindestens eine gültige `ProductVersion` existiert (Voraussetzung dafür,
   dass überhaupt ein Ergebnis entstehen kann) — geprüft, aber siehe
   `NoValidProductVersionError` in Abschnitt 8 für den Fall, dass dies
   kategoriespezifisch fehlschlägt statt die gesamte Auswertung zu blockieren.

**Fehlt (3):** `progress.missingRequiredQuestionIds` wird 1:1 in eine
strukturierte `InsufficientAnswerDataError` übernommen (Feld
`missingQuestionIds: string[]`, stabile Frage-IDs — keine Freitext-Meldung,
siehe Abschnitt 8). Damit ist die Fehlermeldung sowohl maschinenlesbar als
auch exakt konsistent mit der Anzeige des Fragebogen-Fortschritts aus Phase
3A. Fehlt (2), wird `RuleSetNotConfiguredError` zurückgegeben.

**`COMPLETED`-Sonderfall (klärt die in Revision 1 offen gelassene Frage
"warum sind COMPLETED-Sessions nicht auswertbar, wenn die Beratung doch
abgeschlossen ist"):** Es werden drei fachlich unterschiedliche Operationen
unterschieden, die bisher unter "Auswertung" vermischt waren:

- **Erstauswertung** (`status = IN_PROGRESS`): wie oben beschrieben, erzeugt
  bei fehlendem Fingerprint-Treffer einen neuen `Recommendation`-Lauf.
- **Abruf einer historischen Auswertung** (`status ∈ {IN_PROGRESS,
COMPLETED}`): reiner Lesezugriff auf die "aktuelle" `Recommendation`
  gemäß 3.7 (`ORDER BY generatedAt DESC, id DESC LIMIT 1`) — **keine**
  Auswertbarkeitsprüfung nötig, da nichts neu berechnet wird. Für
  `COMPLETED`-Sessions ist dies der Regelfall (die Beratung ist
  abgeschlossen, die zuletzt erzeugte Empfehlung bleibt abrufbar).
- **Bewusstes Nicht-Neuauswerten:** für `status = COMPLETED` wird **keine**
  neue Auswertung ausgelöst, selbst wenn sich zwischenzeitlich die
  `RuleSetVersion` geändert hätte — der Service unterscheidet einen
  `evaluate()`-Aufruf (nur für `IN_PROGRESS`, wirft
  `SessionNotEvaluableError` bei anderem Status) von einem
  `getLatestRecommendation()`-Aufruf (für jeden Status, reiner Lesezugriff).
  Diese Trennung war in Revision 2 nicht explizit — sie wird hiermit als
  zwei getrennte, im Fehlercode-Abschnitt (8) und im Dateiabschnitt (9)
  jeweils eigenständig geführte Operationen festgelegt.

Zusätzlich wird `Recommendation.inputDataCompletenessScore: Float?` als
Snapshot des zum Auswertungszeitpunkt gültigen
`ConsultationSession.dataCompletenessScore` gespeichert (bereits
existierendes Feld, hier nur referenziert/kopiert, nicht neu berechnet), da
sich der Session-Wert später ändern kann, der historische Empfehlungslauf
aber reproduzierbar bleiben muss.

## 6. Tie-Break-Regel — _neu, adressiert Section-22-Lücke_

`priorityRank` wird bestimmt durch, in dieser Reihenfolge: `businessPriorityScore
DESC` → `customerFitScore DESC` → `productVersion.monthlyPriceMinor ASC`
(günstiger zuerst, als bewusste, dokumentierte fachliche Tie-Break-Regel) →
`productVersionId ASC` (finaler, rein technischer Determinismus-Tie-Break).

## 7. Transaktionsgrenzen — _neu, adressiert Section-22-Lücke_

Der Fingerprint-Fast-Path-`SELECT` (siehe 3.7, Schritt 2) läuft **außerhalb**
jeder Transaktion. Findet er keinen Treffer, läuft der komplette Schreibteil
des Auswertungslaufs (`Recommendation`, alle `RecommendationItem`, alle
`RecommendationRationale`, alle `RecommendationCrossSellingSignal`,
`AnalyticsEvent` für `recommendation_generated`) in einem einzigen
`db.$transaction(async (tx) => ...)`-Block, exakt nach dem in
`src/server/questionnaire/service.ts` etablierten Muster (`AnalyticsEvent`
wird im selben Callback erzeugt wie die fachlichen Schreiboperationen). Die
Erzeugung einer `SalesOpportunity` aus einem `RecommendationCrossSellingSignal`
ist bewusst **kein** Teil dieser Transaktion — sie ist ein nachgelagerter
Schritt (analog zur bereits heute vom Auswertungslauf entkoppelten
`SalesOpportunity`-Erzeugung, siehe 3.4), da `SalesOpportunity` mutable ist
und ihr Anlegen eine eigenständige fachliche Entscheidung (z. B. durch
Mitarbeitende) sein kann. Innerhalb der Auswertungstransaktion selbst: kein
Zwei-Phasen-Commit, keine Nebenläufigkeits-Annahme
außerhalb dieser Transaktion.

## 8. Fehlercodes (Auszug, vollständige Liste in `src/server/recommendation/errors.ts`) — _neu, adressiert Section-22-Lücke; erweitert um Restauflagen 1/3/4/5_

Für `evaluate()` (Erstauswertung, siehe Abschnitt 5):
`SessionNotEvaluableError` (Status ≠ `IN_PROGRESS`),
`InsufficientAnswerDataError` (`missingQuestionIds: string[]` — sichtbare
Pflichtfragen unbeantwortet, siehe Abschnitt 5 Punkt 3),
`RuleSetNotConfiguredError` (keine aktive `RuleSetVersion`),
`NoValidProductVersionError` (keine aktive `ProductVersion` für eine
Kategorie zum Auswertungszeitpunkt — Engine erzeugt für diese Kombination
laut `docs/RECOMMENDATION_ENGINE.md` explizit **keine** Empfehlung statt
einer geschätzten Alternative), `CommissionModelUnresolvedError`
(`commissionRequired = true`-Regel ohne auflösbare `CommissionModelVersion`,
siehe 3.8), `RecommendationConsistencyError` (P2002 ohne anschließenden
Fingerprint-Treffer, siehe 3.7 — deutet auf Datenkorruption oder
Fingerprint-Bug hin, wird nicht stillschweigend geschluckt).

Für die Regel-Autoring-Validierung (siehe 3.1):
`UnknownAttributeKeyError`, `InvalidOperatorForAttributeError`,
`InvalidComparisonValueError`.

Für das Anlegen einer `SalesOpportunity` (siehe 3.4, Korrekturpunkt 1):
`SalesOpportunitySourceMismatchError` (`DetectedNeed.source = RULE_BASED`
ohne `triggerSignalId` oder `source = EMPLOYEE_MARKED` mit gesetztem
`triggerSignalId` — Service-Layer-Invariante, ersetzt den in Revision 3
vorgesehenen, technisch nicht umsetzbaren DB-`CHECK`).

Für `getLatestRecommendation()` (reiner Lesezugriff, jeder Status, siehe
Abschnitt 5): kein eigener Fehlercode nötig über die bestehende
Not-Found-Behandlung hinaus (keine `Recommendation` vorhanden → `null`
zurückgeben, kein Fehler).

Alle Fehlercodes erben vom bestehenden `AppError`-Muster aus der
Fragen-Engine.

## 9. Betroffene Dateien (voraussichtlich) — _neu, adressiert Section-22-Lücke_

- `prisma/schema.prisma` (neue Modelle/Enums/Felder, siehe Abschnitt 3)
- `prisma/migrations/<timestamp>_recommendation_engine/migration.sql`
- `src/server/recommendation/types.ts`
- `src/server/recommendation/errors.ts`
- `src/server/recommendation/conditions.ts` (Auswertung des
  Bedingungsmodells aus 3.1, analog `src/server/questionnaire/visibility.ts`)
- `src/server/recommendation/attribute-registry.ts` (geschlossene Key-/Typ-/
  Operator-/Parsing-Registry, siehe 3.1)
- `src/server/recommendation/fingerprint.ts`
- `src/server/recommendation/eligibility.ts`
- `src/server/recommendation/exclusion.ts`
- `src/server/recommendation/fit-score.ts`
- `src/server/recommendation/prioritization.ts`
- `src/server/recommendation/tie-break.ts`
- `src/server/recommendation/cross-selling.ts`
- `src/server/recommendation/sales-opportunity.ts` (neu, Service-Layer-
  Validierung Source/Signal-Konsistenz, siehe 3.4 Korrekturpunkt 1)
- `src/server/recommendation/service.ts` (Orchestrierung, `db.$transaction`)
- Seed-Skript (Pfad wird beim Implementierungsstart verifiziert, analog
  Phase-3A-Erweiterung der bestehenden Seed-Datei)
- Tests unter `src/server/recommendation/__tests__/` (Unit) und
  Integrationstests analog zum Phase-3A-Testaufbau (dedizierte Testdatenbank)
- `docs/RECOMMENDATION_ENGINE.md` (überarbeiten, bisher nur konzeptionell)
- `docs/DATA_MODEL.md`, `docs/IMPLEMENTATION_STATUS.md`, ggf.
  `docs/OPEN_DECISIONS.md`/`docs/RISK_REGISTER.md`

## 10. Migrationen — _Restauflage 6 (Revision 2): "Typkonvertierung, Bestandsprüfung, Upgrade-Test, Forward-Fix/Rollback fehlen"; Korrekturpunkte 5+6 (Revision 3.1): "Cross-Selling-Upgrade-Pfad fehlerhaft (neue trigger_signal_id-Spalte startet NULL, verletzt CHECK bei Bestandszeilen); RuleSetVersion-Zeitfenster-Exclusion-Constraint fehlt in der konkreten Migrationsliste"_

Eine neue additive Migration mit:

- Neuem Enum `ConditionSourceType`.
- Drei neuen Condition-Tabellen (`eligibility_rule_conditions`,
  `exclusion_rule_conditions`, `prioritization_rule_conditions`) sowie
  `cross_selling_rule_conditions`.
- Neuer Tabelle `cross_selling_rules`.
- Neuer Tabelle `recommendation_cross_selling_signals` (siehe 3.4).
- `expression` → `legacy_expression` (Rename, nullable) auf
  `eligibility_rules`, `exclusion_rules`, `prioritization_rules` (**kein**
  Drop in dieser Migration, siehe 3.2).
- Neuen Feldern `is_required`, `fit_weight` auf `eligibility_rules`.
- Neuem Feld `commission_required` (Boolean, `@default(false)`) auf
  `prioritization_rules` (siehe 3.8).
- Neuer `@@unique([tenantId, ruleSetVersionId, reasonCode])` +
  `CHECK (reason_code <> '')` auf `exclusion_rules`.
- Neuen, **nullable** Feldern auf `sales_opportunities` (`trigger_signal_id`,
  `reason_code`, `justification_params`, `priority`, `follow_up_required`,
  `follow_up_reason_code`) — **ohne** DB-`CHECK`-Constraint (Korrekturpunkt
  1, siehe 3.4: Source-Konsistenz wird am Service-Layer erzwungen, nicht in
  der DB; ein `CHECK` wäre technisch ohnehin nicht umsetzbar gewesen, siehe
  unten "Cross-Selling-Upgrade-Pfad").
- Neuer PostgreSQL-`EXCLUDE`-Constraint auf `rule_set_versions` gegen
  überlappende `[status = ACTIVE, validFrom, validTo)`-Zeitfenster je
  `tenantId` (Korrekturpunkt 6, siehe unten "RuleSetVersion-Zeitfenster-
  Constraint") — identisches Muster wie bei `ProductVersion`,
  `CommissionModelVersion`, `ProductCostVersion`, `CampaignVersion` (siehe
  Abschnitt 1 Bestandsaufnahme, ursprünglich in Phase 2B/Aufgabe "PostgreSQL
  Exclusion Constraints gegen überlappende Versionszeiträume" eingeführt):
  `EXCLUDE USING gist (tenant_id WITH =, tstzrange(valid_from, valid_to,
'[)') WITH &&) WHERE (status = 'ACTIVE')` (exakter Constraint-Name/DDL wird
  beim Schreiben der Migration an die dort bereits verwendete Konvention
  angeglichen, `btree_gist`-Extension ist laut Bestandsaufnahme bereits
  installiert, da für die bestehenden Versions-Constraints benötigt).
- `customer_fit_score` (Int) auf `recommendation_items`,
  `business_priority_score` Typwechsel `Float → Int`. **Kein**
  `commission_model_version_id` auf `recommendation_items` (Korrekturpunkt 3,
  Revision 3.2 — siehe 3.8: mehrdeutiges, aggregierendes Item-Feld entfernt).
- Neuen Feldern `commission_model_version_id` (FK, nullable) und
  `commission_value_minor` (Int, nullable) auf `recommendation_rationales`
  (siehe 3.8).
- Neuen Feldern `algorithm_version`, `evaluation_fingerprint` +
  `@@unique([tenantId, consultationSessionId, evaluationFingerprint])` auf
  `recommendations`, sowie `input_data_completeness_score`.
- Fünf `CREATE TRIGGER ... forbid_update_delete()`-Anweisungen auf
  `recommendations`, `recommendation_items`, `recommendation_rationales`,
  `recommendation_outcomes`, `recommendation_cross_selling_signals`
  (**nicht** `sales_opportunities`, siehe 3.6).

**Typkonvertierung:** Der einzige Typwechsel ist
`recommendation_items.business_priority_score` von `double precision` nach
`integer`. Da laut Bestandsaufnahme (Abschnitt 1) bisher ausschließlich
synthetische Seed-Daten existieren, erfolgt die Konvertierung als
`ALTER COLUMN ... TYPE integer USING round(business_priority_score)::integer`
in derselben Migration (kein separater Backfill-Schritt nötig, da keine
Produktivdaten-Bestände zu erhalten sind). Für eine spätere Umgebung mit
echten Bestandsdaten wäre stattdessen ein zweiphasiges Vorgehen (additive
Spalte, Backfill-Batch, Umschalten, Drop der alten Spalte) erforderlich —
das wird hier als dokumentierte Einschränkung festgehalten, da es außerhalb
des aktuellen Bestands nicht zutrifft.

**Bestandsprüfung (Pre-Migration-Check, Teil des Migrationsskripts oder
eines vorgelagerten Checks):** vor dem `ALTER TABLE` auf
`business_priority_score` wird geprüft, dass keine vorhandenen Werte
außerhalb eines plausiblen `Int`-Bereichs liegen (`abs(value) <
2147483647`).

**Cross-Selling-Upgrade-Pfad (korrigiert gegenüber Revision 3,
Korrekturpunkt 5): kein Backfill, kontrollierter Migrationsabbruch bei
Bestandszeilen.** Da in Revision 3.1 kein DB-`CHECK` mehr existiert (siehe
oben), verletzt eine neue, für alle Bestandszeilen `NULL`-wertige
`trigger_signal_id`-Spalte keine Constraint mehr — das in Revision 3
fälschlich behauptete Problem ("bestehende Zeilen bleiben gültig") entfällt
damit als DB-Frage vollständig. Es bleibt aber die fachliche Frage bestehen,
ob bereits vorhandene `RULE_BASED`-`SalesOpportunity`-Zeilen (angelegt vor
Einführung von Phase 3B, ggf. aus manuellen Tests oder Seed-Läufen vor
diesem Schema-Stand) mit `trigger_signal_id = NULL` fachlich korrekt sind.
Die Migration enthält daher als expliziten Pre-Migration-Check ein
`SELECT count(*) FROM sales_opportunities so JOIN detected_needs dn ON
dn.id = so.detected_need_id WHERE dn.source = 'RULE_BASED'`:

- Liefert die Zählung `0` (erwarteter Fall laut Bestandsaufnahme, Abschnitt
  1 — bisher ausschließlich synthetische Seed-Daten, keine vor Phase 3B
  erzeugten `RULE_BASED`-Opportunities), läuft die Migration ohne weiteren
  Eingriff durch; alle Bestandszeilen sind `EMPLOYEE_MARKED` oder haben
  keine `RULE_BASED`-Herkunft, `trigger_signal_id = NULL` ist für diese
  fachlich korrekt (kein Cross-Selling-Signal existiert für sie und soll
  auch keines vorgetäuscht werden).
- Liefert die Zählung einen Wert `> 0`, **bricht die Migration kontrolliert
  ab** (expliziter Check, `RAISE EXCEPTION` im Migrationsskript vor den
  strukturellen Änderungen) — es wird **kein** künstlicher/nachträglich
  erfundener `RecommendationCrossSellingSignal`-Snapshot für diese
  historischen Zeilen erzeugt, da ein solcher Snapshot per Definition nicht
  reproduzierbar wäre (er entstünde nicht aus einem tatsächlichen
  Auswertungslauf). In diesem Fall ist eine manuelle, fachliche Entscheidung
  vor dem erneuten Migrationsversuch nötig (z. B. Einzelfallprüfung, ob
  diese Zeilen nachträglich als `EMPLOYEE_MARKED` reklassifiziert werden
  können) — dieser Fall wird nicht automatisiert gelöst, da er außerhalb
  einer rein technischen Migration liegt.

Da laut Bestandsaufnahme (Abschnitt 1) aktuell ausschließlich synthetische
Seed-Daten ohne vor Phase 3B erzeugte `RULE_BASED`-Opportunities existieren,
wird der erwartete Ausgang dieses Checks (Zählung `0`) im Upgrade-Test unten
verifiziert, nicht nur angenommen.

**Upgrade-Test:** Migration wird gegen die dedizierte Test-Datenbank mit dem
bestehenden, um Phase-3B-Regeln erweiterten Seed-Datensatz ausgeführt
(analog Phase 3A: `prisma migrate deploy` gegen leere DB **und** gegen eine
bereits mit Phase-3A-Daten befüllte DB), gefolgt von einem Smoke-Test, der
mindestens eine `Recommendation` inkl. `RecommendationItem`,
`RecommendationRationale` und `RecommendationCrossSellingSignal` über die
neue Service-Schicht erzeugt und liest. Zusätzlich wird verifiziert: (a) der
Pre-Migration-Check für `RULE_BASED`-Bestandszeilen liefert auf der
Phase-3A-befüllten Test-DB tatsächlich `0` (bestätigt die Annahme oben statt
sie nur zu behaupten); (b) der neue `EXCLUDE`-Constraint auf
`rule_set_versions` weist einen absichtlich eingefügten, zeitlich
überlappenden zweiten `ACTIVE`-Datensatz für denselben Tenant zurück
(Integrationstest, analog zu den bereits bestehenden Tests für
`ProductVersion`/`CommissionModelVersion`-Überlappungen aus Aufgabe #29).

**Forward-Fix/Rollback-Verhalten:** Jede Prisma-Migration läuft in
PostgreSQL standardmäßig innerhalb einer einzelnen Transaktion (sofern kein
`CREATE INDEX CONCURRENTLY` verwendet wird — hier nicht der Fall); schlägt
ein Schritt fehl, wird die gesamte Migration automatisch zurückgerollt, der
DB-Zustand bleibt unverändert auf dem vorherigen Migrationsstand. Es ist
**kein** manuelles Rollback-Skript vorgesehen (Prisma-Konvention: Rollback
erfolgt nicht rückwärts, sondern durch eine neue, korrigierende
Forward-Migration, falls ein bereits deployter Stand fehlerhaft war) — das
entspricht dem bereits etablierten Vorgehen aus Phase 3A/3B-Vorarbeiten
(keine der bisherigen Migrationen in `prisma/migrations/` wurde nachträglich
verändert, siehe Abschnitt 10 Schlusssatz unten). Tritt ein Fehler **nach**
erfolgreichem Deploy in Produktion auf (z. B. durch eine übersehene
Dateninkonsistenz), ist die vorgesehene Reaktion eine neue, dedizierte
Forward-Fix-Migration, keine Rückabwicklung der bereits angewendeten.

Keine Änderung an bereits ausgeführten historischen Migrationen. Da bisher
nur synthetische Seed-Daten existieren, ist kein Daten-Backfill mit
Bestandsdaten nötig; der Rename `expression → legacy_expression` erhält
vorhandene Seed-Werte verlustfrei (reines Umbenennen, kein Datenverlust).

## 11. Testplan (Kurzfassung, Details siehe Startprompt Abschnitt 13)

Unit-Tests je Ebene: Bedingungsauswertung (`conditions.ts`, alle Operatoren ×
alle drei `sourceType`), Attribute-Registry (unbekannter Key →
`UnknownAttributeKeyError`, unerlaubter Operator →
`InvalidOperatorForAttributeError`, nicht parsebarer Wert →
`InvalidComparisonValueError`, gleiche `parse()`-Funktion auf Schreib- und
Lesepfad), Eignung (hartes Gate + gewichteter `customerFitScore`-Beitrag
inkl. Normalisierungs-Sonderfall ohne gewichtete Regeln), Ausschluss
(Reihenfolge, Eindeutigkeit `reasonCode`), Priorisierung (inkl.
`RecommendationRationale.commissionModelVersionId`-Auflösung je
provisionsbasiertem Beitrag, `commissionValueMinor`-Snapshot,
`commissionRequired = true` → `CommissionModelUnresolvedError` bei fehlender
Version, `commissionRequired = false` → Gewicht-0-Fallback — **sowie
dediziert**, dass zwei `RecommendationRationale`-Zeilen desselben
`RecommendationItem` unterschiedliche `commissionModelVersionId`-Werte
referenzieren können und dass `RecommendationItem` selbst kein
`commissionModelVersionId`-Feld besitzt, Korrekturpunkt 3), Tie-Break-
Sortierung, Cross-Selling-Regelauswertung inkl. Erzeugung des
`RecommendationCrossSellingSignal`-Snapshots. Zusätzlich:
Auswertbarkeitsprüfung (`computeVisiblePath`/`computeProgress`-Wiederverwendung:
Session mit einer beantworteten, aber weiteren sichtbaren unbeantworteten
Pflichtfrage → `InsufficientAnswerDataError` mit korrektem
`missingQuestionIds`; Session mit ausgeblendeten/fremden Antworten werden
nicht mitgezählt), `evaluate()` vs. `getLatestRecommendation()` (Aufruf auf
`COMPLETED`-Session: `evaluate()` wirft `SessionNotEvaluableError`,
`getLatestRecommendation()` liefert den letzten Lauf), Fingerprint-
Determinismus (gleiche Eingaben → gleicher Fingerprint, unterschiedliche
Antwort-/Regelversionen/Produkt-/Provisionsversionsmengen → unterschiedlicher
Fingerprint), Idempotenz bei wiederholtem Aufruf (kein zweiter
Schreibzugriff, Fast-Path-`SELECT` vor Transaktion), Race-Verhalten bei
simuliertem `P2002` **außerhalb** des Transaktions-Callbacks (Treffer nach
Retry-`SELECT` → derselbe Datensatz zurückgegeben; kein Treffer →
`RecommendationConsistencyError`). Integrationstests für vollständige
Session-Auswertungen, Tenant-Isolation, Append-only-Durchsetzung auf den fünf
getriggerten Tabellen, Mutable-Verhalten von `SalesOpportunity` inkl. der
Service-Layer-Validierung aus 3.4/Korrekturpunkt 1 (Erzeugen mit
`DetectedNeed.source = EMPLOYEE_MARKED` ohne `triggerSignalId` erfolgreich;
mit `source = RULE_BASED` ohne `triggerSignalId` wirft
`SalesOpportunitySourceMismatchError`; mit `source = EMPLOYEE_MARKED` und
dennoch gesetztem `triggerSignalId` wirft ebenfalls
`SalesOpportunitySourceMismatchError`), sowie ein Integrationstest für den
`EXCLUDE`-Constraint auf `RuleSetVersion` (siehe Abschnitt 10) — analog zur
Testdichte aus Phase 3A (Unit + Integration, dedizierte Testdatenbank).

## 12. Risiken und offene Punkte

- `legacyExpression`-Spalten bleiben vorerst bestehen (kein Datenverlust,
  aber technische Schuld) — physisches Entfernen ist explizit für eine
  spätere, dedizierte Cleanup-Migration vorgesehen, nicht Teil von Phase 3B.
- `RecommendationRationale.commissionModelVersionId` ist nullable und
  existiert **nicht** aggregiert auf `RecommendationItem` (3.8,
  Korrekturpunkt 3); falls eine spätere Phase (Analytics/GF-Dashboard) eine
  Item-weite Provisionsversions-Übersicht benötigt, ist die vorgesehene
  Lösung eine `DISTINCT`-Lese-Abfrage über die Rationale-Zeilen des Items,
  kein neues denormalisiertes Item-Feld — bewusste spätere Erweiterung,
  kein Rückbau.
- Fingerprint-Berechnung hängt von der korrekten, vollständigen Erfassung
  aller reproduzierbarkeitsrelevanten Eingaben ab (Antwort-IDs +
  -Versionen, Produktversionen, Provisionsversionen, Regelset-Version,
  Algorithmus-Version); jede künftige Erweiterung der Auswertungslogik um
  eine neue Eingabequelle muss den Fingerprint-Berechnungscode und die
  `algorithmVersion`-Konstante mit anfassen — wird als Implementierungs-
  Vorgabe in `fingerprint.ts` kommentiert.
- Die geschlossene Attribute-Registry (3.1) ist initial bewusst klein
  (im Wesentlichen `consultationType`); jede künftige Erweiterung um neue
  `PRODUCT_ATTRIBUTE`/`SESSION_ATTRIBUTE`-Keys erfordert eine Code-Änderung
  mit Review, keine Laufzeit-Konfiguration — das ist eine bewusste
  Einschränkung (Sicherheit/Nachvollziehbarkeit vor Flexibilität), kein
  Rückbau gegenüber Revision 2.
- `RecommendationCrossSellingSignal` verdoppelt strukturell einen Teil der
  bisher auf `SalesOpportunity` geplanten Felder (siehe 3.4); das ist
  beabsichtigt (Trennung von unveränderlichem Auswertungsergebnis und
  mutablem Vertriebs-Workflow), erhöht aber die Zahl der beim Lesen zu
  verknüpfenden Tabellen für UI-/Analytics-Zwecke — spätere Phasen sollten
  bei Bedarf eine gemeinsame Lese-View erwägen (nicht Teil von Phase 3B).
- Die Bestandsprüfung vor der `business_priority_score`-Typkonvertierung
  (Abschnitt 10) ist nur deshalb unkritisch, weil ausschließlich
  synthetische Seed-Daten existieren; sobald echte Bestandsdaten anfallen,
  muss dieser Migrationsschritt vor erneuter Anwendung auf ein
  zweiphasiges Backfill-Verfahren umgestellt werden (siehe Abschnitt 10).
- Die Source-Konsistenz zwischen `DetectedNeed.source` und
  `SalesOpportunity.triggerSignalId` (3.4, Korrekturpunkt 1) ist eine
  Anwendungs- statt DB-Invariante; sie gilt nur, solange alle
  schreibenden Pfade ausschließlich über
  `src/server/recommendation/sales-opportunity.ts` laufen. Ein künftiger
  direkter DB-Schreibzugriff (z. B. ein Admin-Tool oder Bulk-Import
  außerhalb dieses Service) könnte die Invarianz umgehen, ohne dass die DB
  dies verhindert — bewusst in Kauf genommen, da eine korrekte DB-Constraint
  hierfür einen Trigger über zwei Tabellen bräuchte (siehe 3.4).
- Der Pre-Migration-Check auf bestehende `RULE_BASED`-`SalesOpportunity`-
  Zeilen (Abschnitt 10, Korrekturpunkt 5) bricht die Migration kontrolliert
  ab, falls solche Zeilen gefunden werden; dieser Fall ist für den
  aktuellen, ausschließlich synthetischen Datenbestand nicht erwartet, aber
  falls er eintritt, ist eine manuelle fachliche Entscheidung vor dem
  erneuten Migrationsversuch nötig — kein automatisierter Recovery-Pfad
  vorgesehen.

## 13. Aussage zur Umsetzbarkeit

Der Auftrag ist weiterhin **ohne Erweiterung des in Abschnitt 17 festgelegten
Scopes** umsetzbar. Die in Revision 1 von ChatGPT bemängelten Punkte wurden
in Revision 2 einzeln adressiert; die sechs Restauflagen aus der zweiten
Prüfung wurden in Revision 3 größtenteils, aber nicht vollständig korrekt
umgesetzt — die dritte Prüfung bestätigte ausdrücklich, dass die
**Grundarchitektur tragfähig ist** und es sich bei den sechs benannten
Punkten nicht um eine neue Architekturrunde, sondern um konkrete Schema-/
Reproduzierbarkeitsfehler handelt. Revision 3.1 adressierte diese sechs
Punkte; die vierte Prüfung bestätigte vier davon vollständig als **GO**
(Cross-Selling-Source-Constraint, Snapshot-FK, Migrations-Upgrade-Pfad,
`RuleSetVersion`-EXCLUDE-Constraint) und benannte nur noch drei eng
begrenzte, ausdrücklich als "keine weitere Architekturrunde" eingestufte
Rest-Korrekturen an der Fingerprint-Kanonisierung und am
Provisionsversions-Bezug (siehe Kopfabschnitt). Diese drei Korrekturpunkte
sind in dieser Revision 3.2 punktuell, mit konkretem Zielschema und ohne
offene Alternativen, umgesetzt: Abschnitt 3.7 (Fingerprint um `productInputs`
mit den tatsächlich gelesenen `PRODUCT_ATTRIBUTE`-Werten je `ProductVersion`
erweitert; `answers[].value` wird über den `QuestionVersion`-Antworttyp statt
über die Attribute-Registry kanonisiert), 3.8 (das mehrdeutige,
aggregierende `RecommendationItem.commissionModelVersionId`-Feld entfernt —
das Pinning existiert ausschließlich auf `RecommendationRationale`). Die
fünfte Prüfung bestätigte alle drei Punkte fachlich, bemängelte aber, dass
die Migrationsliste in Abschnitt 10 das entfernte Item-Feld weiterhin
auflistete statt das neue Rationale-Feld — dieser redaktionelle Widerspruch
ist in dieser Fassung korrigiert, zusammen mit zwei nicht blockierenden
Präzisierungen am Fingerprint (deterministisches `null` für gelesene, aber
ungesetzte Produktattribute; normalisierte Dezimal-`String`-Darstellung für
`NUMBER`-Antworten statt uneinheitlichem `Int`/`Float`). Laut ChatGPT ist
damit kein offener Architektur- oder Schemapunkt mehr vorhanden. Es
handelt sich weiterhin um gezielte Schema-Ergänzungen und -Präzisierungen am
bestehenden Regelmodell, keine grundsätzliche Neustrukturierung — die bereits
in Revision 3.1 hinzugekommene Tabelle `RecommendationCrossSellingSignal`
folgt weiterhin exakt demselben Muster wie das bereits akzeptierte
`RecommendationItem`.
