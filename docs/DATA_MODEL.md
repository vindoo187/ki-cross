# Zentrales Datenmodell

Dieses Dokument beschreibt das tatsächlich implementierte Datenmodell
(siehe [`prisma/schema.prisma`](../prisma/schema.prisma) als verbindliche
Quelle; die Migration in
`prisma/migrations/20260731000000_init/migration.sql` ist gegen
`@electric-sql/pglite` verifiziert – siehe `docs/IMPLEMENTATION_STATUS.md`
und `docs/ABSCHLUSSBERICHT_PHASE2.md`). Feldlisten hier sind weiterhin
vereinfacht/exemplarisch (die vollständige, autoritative Spaltenliste steht
in `schema.prisma`), aber die Entitäten, Beziehungen und Modellnamen
entsprechen dem echten Schema, nicht mehr nur einem Phase-1-Konzept.

**Abgrenzung:** Einzelne in Phase 1 skizzierte Konzepte (`Goal`,
`KpiSnapshot`, sowie die eigentliche Fragen-/Empfehlungslogik) sind
bewusst **noch nicht** Teil des in Phase 2/2B implementierten Schemas –
ihr Bau ist ausdrücklich für eine spätere Phase vorgesehen und wurde in
Phase 2B nicht begonnen (siehe Stop-Vorgabe des Projektleiters). Wo das
hier der Fall ist, ist es explizit vermerkt.

## Mandanten- und Organisationsstruktur

```
Tenant (Mandant)
 └─ Company (Unternehmen)          -- z. B. das eigene Handelsunternehmen; später ggf. mehrere pro Mandant
     └─ Store (Filiale)            -- 5 Filialen in den Demo-/Testdaten
         └─ Employee (Mitarbeiter)
```

- `tenant_id` ist Pflichtattribut auf jeder mandantenscoped Tabelle (Row-Level-Scoping), zusätzlich über zusammengesetzte Fremdschlüssel `(tenant_id, x_id) → (tenant_id, id)` durchgesetzt (siehe `DECISION_LOG.md`).
- Es gibt bewusst **keine eigene `Region`-Ebene** zwischen `Company` und `Store`: `Store` referenziert `Company` direkt. Eine Gruppierung von Filialen (falls künftig benötigt) müsste als eigenständige, additive Erweiterung nachgezogen werden.
- `Employee` hat genau eine "Heimatfiliale" (`store_id`), kann aber (**Annahme**) rollenabhängig für mehrere Filialen berechtigt sein (z. B. Springer) – dies wird über `RoleAssignment` abgebildet, nicht über mehrere `Employee`-Datensätze.

## Rollen & Berechtigungen

Siehe [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md) für das vollständige Modell. Kernentitäten im implementierten Schema: `Role`, `Permission`, `RolePermission`, `RoleAssignment` (scoped auf Tenant, optional Company/Store je nach `scope_type`; Konsistenz zwischen `scope_type` und gesetzten `company_id`/`store_id` wird per DB-CHECK-Constraint erzwungen, siehe `DECISION_LOG.md`/`migration.sql`).

## Produkt- und Tarifdaten (versioniert)

```
Provider (Platzhalter, z. B. "Provider A", "Provider B" – synthetische Testdaten, keine echten Anbieternamen)
 └─ ProductCategory (Mobilfunkvertrag, Verlängerung, DSL/Glasfaser, Gerät,
                      Partnerkarte/Family, Streaming/Zusatzoption, Zubehör)
     └─ Product (z. B. konkreter Tarif oder Gerätemodell)
         └─ ProductVersion            -- zeitlich gültig: valid_from, valid_to
             ├─ price (Grundpreis, Rabatt-Bedingungen)
             ├─ attributes (Datenvolumen, Laufzeit, Konditionen …)
             └─ CommissionModelVersion -- Provision je ProductVersion, ebenfalls zeitversioniert
```

**Hinweis zu Anbieternamen:** Es werden ausschließlich Platzhalter-/Testnamen verwendet (z. B. `"Provider A"`), niemals reale Netzbetreiber- oder Markennamen – konsistent mit der Vorgabe, keine echten Geschäftsdaten oder erfundenen Herstellerbezüge im Projekt zu verwenden.

**Zentrale Regel:** `ProductVersion` und `CommissionModelVersion` sind **unveränderlich** (append-only). Eine Preis- oder Provisionsänderung erzeugt eine neue Version mit neuem `valid_from`; die alte Version bleibt für historische Auswertungen erhalten (`valid_to` wird gesetzt). Damit verfälschen rückwirkende Änderungen keine vergangenen KPI-Berechnungen (Vorgabe aus dem Auftrag).

Jede `Recommendation` und jeder `Deal` referenziert die **konkrete Versions-ID**, nicht nur das Produkt – so bleibt nachvollziehbar, zu welchem Preis/welcher Provision zu welchem Zeitpunkt beraten wurde.

**Annahme:** Tarifdaten werden zunächst manuell/importiert gepflegt (CSV/Admin-UI), keine automatisierte Provider-API-Anbindung in dieser Phase (siehe Qualitätsanforderungen im Auftrag: keine erfundenen Anbieter-APIs).

## Fragebogen- und Regelwerk (versioniert)

Seit Phase 3A implementiert (Fragen-Engine, siehe
[QUESTION_ENGINE.md](QUESTION_ENGINE.md)):

```
Questionnaire (tenant, key)
 └─ QuestionnaireVersion (label, validFrom/validTo, status DRAFT/ACTIVE/EXPIRED)
     └─ Question (key, sortOrder, optional needType)  -- stabile Frage, mehrere Versionen möglich
         └─ QuestionVersion (label, answerType, isRequired,
                              minValue/maxValue, maxLength,
                              minSelections/maxSelections,
                              validFrom/validTo, status)
             ├─ AnswerOption[] (key, label, sortOrder)      -- für Choice-Antworttypen
             └─ VisibilityCondition[]                       -- macht diese QuestionVersion
                 (targetQuestionId, operator, comparisonValue,   von einer früheren Antwort
                  combinator AND/OR)                             abhängig (eine Ebene, kein Nesting)
```

`answerType` ist einer von `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `BOOLEAN`,
`INTEGER`, `DECIMAL`, `SHORT_TEXT`, `DATE`. `Question` und `QuestionVersion`
sind bewusst getrennt (wie bei `QuestionnaireVersion`): die `Question` ist
die stabile Identität (z. B. für `VisibilityCondition.targetQuestionId`),
die `QuestionVersion` trägt die veränderliche Definition (Text,
Validierungsgrenzen, Antwortoptionen). So bleiben abgeschlossene
`ConsultationSession`s auch nach einer späteren Änderung der
Frageformulierung oder -grenzen reproduzierbar (siehe
[DECISION_LOG.md](DECISION_LOG.md), "Fixierung der QuestionnaireVersion
beim Beratungsstart").

Die in Phase 1 skizzierte `RuleSetVersion` (`EligibilityRule`/
`ExclusionRule`/`PrioritizationRule`) war **nicht** Teil der Fragen-Engine
(Phase 3A); sie ist seit Phase 3B implementiert und gehört zur
Empfehlungs-Engine (siehe unten, [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md)
und den Ausschluss-Abschnitt in [QUESTION_ENGINE.md](QUESTION_ENGINE.md)).

## Regelwerk und Empfehlungen (seit Phase 3B implementiert)

```
RuleSetVersion (tenant, validFrom/validTo, status DRAFT/ACTIVE/EXPIRED/ARCHIVED)
 -- höchstens eine ACTIVE Version je Tenant zu jedem Zeitpunkt
 -- (PostgreSQL EXCLUDE USING gist Constraint)
 ├─ EligibilityRule (isRequired, fitWeight) ── RuleCondition[]
 ├─ ExclusionRule (reasonCode, eindeutig je RuleSetVersion) ── RuleCondition[]
 ├─ PrioritizationRule (weight, commissionRequired) ── RuleCondition[]
 └─ CrossSellingRule (needType, priority) ── RuleCondition[]

RuleCondition (identische Struktur für alle vier Regeltypen)
 ├─ groupIndex, sourceType (ANSWER | PRODUCT_ATTRIBUTE | SESSION_ATTRIBUTE)
 ├─ questionId (bei ANSWER) | attributeKey (bei PRODUCT_/SESSION_ATTRIBUTE)
 └─ operator (VisibilityOperator, wiederverwendet aus der Fragen-Engine), comparisonValue

Recommendation (append-only, ein Lauf je Fingerprint-Treffer)
 ├─ consultationSessionId, ruleSetVersionId, algorithmVersion
 ├─ evaluationFingerprint (SHA-256, Idempotenzschlüssel)
 ├─ inputDataCompletenessScore (Snapshot zum Auswertungszeitpunkt)
 ├─ RecommendationItem[] (append-only)
 │   ├─ productVersionId, eligibilityPassed, exclusionReasonCodes[]
 │   ├─ customerFitScore, businessPriorityScore, priorityRank
 │   └─ RecommendationRationale[] (append-only)
 │       ├─ factorKey, factorValue (strukturiertes JSON)
 │       └─ commissionModelVersionId?, commissionValueMinor?
 │           -- Provisions-Pinning liegt ausschließlich hier, nicht auf
 │           -- RecommendationItem (siehe DECISION_LOG.md, Phase 3B)
 └─ RecommendationCrossSellingSignal[] (append-only)
     └─ needType, reasonCode, justificationParams, priority

SalesOpportunity (mutable, bewusst NICHT append-only)
 -- kann aus einem RecommendationCrossSellingSignal (source=RULE_BASED,
 -- triggerSignalId gesetzt) oder manuell durch Mitarbeitende
 -- (source=EMPLOYEE_MARKED, triggerSignalId=null) entstehen
```

**Attribute-Registry:** `PRODUCT_ATTRIBUTE`/`SESSION_ATTRIBUTE`-Werte
(z. B. `dataVolumeGb`, `hasEuRoaming`, `pricePlanTier`,
`contractCommitmentMonths`, `consultationType`) werden über eine
geschlossene, im Code gepflegte Registry typisiert und geparst — keine
Laufzeit-Konfiguration neuer Attributschlüssel ohne Code-Änderung
(bewusste Einschränkung, siehe [DECISION_LOG.md](DECISION_LOG.md)).

**Append-only-Umfang (Phase 3B):** Genau fünf Tabellen tragen den
`forbid_update_delete()`-DB-Trigger: `recommendations`,
`recommendation_items`, `recommendation_rationales`,
`recommendation_outcomes`, `recommendation_cross_selling_signals`.
`sales_opportunities` ist bewusst ausgenommen und bleibt veränderlich, da
sie den laufenden Vertriebs-Workflow abbildet.

## Beratungssitzung (Kernprozess)

```
ConsultationSession
 ├─ tenant_id, store_id, employee_id, customer_reference_id (optional)
 ├─ questionnaire_version_id   -- bei Start fixiert, danach unveränderlich (DB-Trigger)
 ├─ consultation_type
 ├─ started_at, ended_at, pause_seconds, status (IN_PROGRESS/COMPLETED/…)
 └─ CustomerAnswer[]
     ├─ question_version_id, answer_type
     ├─ typisierte Wertspalten je nach answer_type: integer_value,
     │  decimal_value, boolean_value, date_value, choice_values[],
     │  free_text_value
     ├─ is_active (false = überholt/nicht mehr sichtbar, nie gelöscht)
     ├─ answer_version (für optimistisches Locking bei Änderungen)
     └─ answered_at
     -- (kein direkter Klarname-Zwang – siehe Datensparsamkeit in PRIVACY_AND_SECURITY.md)

Recommendation (je Auswertungslauf; vollständiges, seit Phase 3B
implementiertes Schema mit RecommendationItem/RecommendationRationale
siehe Abschnitt "Regelwerk und Empfehlungen" oben)
 └─ RecommendationOutcome (angenommen / abgelehnt / geändert / ignoriert)
     └─ rejection_reason (aus fester Liste + optional Freitext)

Deal (Abschluss)
 ├─ session_id, product_version_id[]
 ├─ closed_at, total_monthly_value, margin_estimate
 └─ status (abgeschlossen / storniert)
```

**Wichtig:** `Recommendation` ist von `RecommendationOutcome` getrennt, weil eine Empfehlung mehrfach den Status wechseln kann (z. B. erst ignoriert, dann nach Rückfrage doch angenommen) und weil Ablehnungsgründe eigenständig auswertbar sein müssen (Vorgabe: "Gründe für abgelehnte Empfehlungen").

## Kunde – bewusst minimal

**Annahme (zu bestätigen, siehe OPEN_DECISIONS.md):** Es wird **kein separates Kundenstammdaten-Objekt mit Klarnamen** im Beratungssystem geführt. Die Sitzung erfasst nur die für die Beratung nötigen strukturierten Antworten (Bedarf, nicht Identität). Ein Name/Kontaktdatensatz wird nur erfasst, wenn er für den Abschluss zwingend nötig ist, und dann als separate, klar zweckgebundene Entität behandelt – im implementierten Schema `CustomerReference` (pseudonym, für Deal-Zuordnung) plus die davon getrennten `CustomerContactData`/`ContactPurpose`/`ConsentRecord`-Modelle für tatsächliche Kontaktdaten mit eigenem Zweckbindungs- und Löschkonzept (`RetentionPolicy`, `DeletionRequest`) – getrennt von den Analyse-/Antwortdaten (siehe Trennungsprinzip in [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md)).

## Ziele, Kampagnen, KPIs

```
Campaign (Kampagne)       -- zeitlich begrenzt (CampaignVersion), priorisiert bestimmte Produkte/Cross-Selling-Schwerpunkte
AnalyticsEvent            -- append-only Ereignisprotokoll, Basis aller KPI-Berechnungen
BaselineMeasurement       -- Referenzwerte vor Rollout, fuer Vorher/Nachher-Vergleiche (siehe ANALYTICS_AND_KPIS.md)
```

**Noch nicht implementiert (späterer Ausbau, kein Bestandteil von Phase 2/2B):** `Goal` (Ziel-Objekt) und `KpiSnapshot` (periodisch aggregierte KPI-Snapshots) sind Phase-1-Konzepte aus [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md), aber (noch) keine Modelle in `schema.prisma`. KPIs werden aktuell konzeptionell direkt aus `AnalyticsEvent`/`ConsultationSession`/`Deal` berechnet, ohne vorab persistierte Snapshots.

## Audit

```
AuditLog
 ├─ tenant_id, actor_user_id (optional)
 ├─ entity_type, entity_id, action (CREATE/UPDATE/ACTIVATE/DEACTIVATE/ROLLBACK/DELETION_REQUESTED)
 ├─ metadata (strukturiertes JSON, ohne Kontaktdaten/Freitext – technisch per Zod erzwungen, siehe DECISION_LOG.md)
 └─ occurred_at

ConfigurationChange   -- separates Append-only-Protokoll speziell für Konfigurationswerte
                         (z. B. ConfigurableThreshold, RetentionPolicy), getrennt von AuditLog
```

Jede Änderung an `Question`, `RuleSet`, `Campaign`, `ProductVersion`, `CommissionModelVersion`, Rollen/Berechtigungen wird auditiert und ist zurückrollbar (fachliche Anforderung: "Änderungen nachvollziehen und zurückrollen"). `AuditLog` und `ConfigurationChange` sind append-only (DB-seitig per Trigger erzwungen, keine `UPDATE`/`DELETE` möglich).

## Entity-Relationship-Übersicht (vereinfacht)

```
Tenant 1─n Company 1─n Store 1─n Employee
Tenant 1─n Provider 1─n ProductCategory 1─n Product 1─n ProductVersion 1─n CommissionModelVersion
Tenant 1─n QuestionnaireVersion 1─n Question 1─n AnswerOption
Tenant 1─n RuleSetVersion 1─n (EligibilityRule|ExclusionRule|PrioritizationRule|CrossSellingRule)
Store 1─n Employee 1─n ConsultationSession
ConsultationSession 1─n CustomerAnswer
ConsultationSession 1─n Recommendation 1─1 RecommendationOutcome
Recommendation 1─n RecommendationItem 1─n RecommendationRationale
Recommendation 1─n RecommendationCrossSellingSignal 0─1 SalesOpportunity (mutable)
ConsultationSession 0─1 Deal
Tenant 1─n Campaign, AnalyticsEvent, BaselineMeasurement
alle Entitäten → AuditLog (bei Änderung)
```
