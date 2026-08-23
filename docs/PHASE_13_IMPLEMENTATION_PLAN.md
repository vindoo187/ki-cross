# Phase 13 – Implementierungsplan: Campaign Management

Stand: 2026-08-24. Basiert auf `PHASE_13_DISCOVERY.md` (AP0) und
ChatGPTs Architekturentscheidungen A–E dazu (2026-08-24, "Meine
Entscheidungen für Phase 13"). Analog Phase 6–12: dieser Plan geht vor
jedem AP1-Code an ChatGPT zur Prüfung, danach an den Nutzer für das
explizite Implementierungs-GO.

## 1. Verbindliche Architekturentscheidungen (ChatGPT, 2026-08-24)

1. **Kein zweites Priorisierungssystem (Entscheidung A).** Campaigns
   bekommen keine eigene Recommendation-/Priorisierungslogik. Stattdessen
   ein neuer `ConditionSourceType`-Wert `CAMPAIGN_ACTIVE`, der sich in
   die bestehende `RuleCondition`/DNF-Engine (`conditions.ts`) einhängt.
   Eine aktive Kampagne liefert **nur einen prüfbaren Kontextzustand**
   ("ist Kampagne X gerade aktiv für diese Session/Store"), auf den
   bestehende `PrioritizationRule`-Zeilen (und optional
   `CrossSellingRule`-Zeilen) reagieren können. Eine aktive Kampagne
   bewirkt für sich genommen **nie automatisch** eine Empfehlung.
   Verbindliche Kette bleibt: Fragebogen → Needs → Eligibility →
   Prioritization → Recommendation → Cross-Selling. Campaigns wirken
   ausschließlich über diese Kette, niemals daran vorbei (kein
   `Campaign → direktes Produkt → Mitarbeiter`-Pfad).
2. **Versionierung (Entscheidung B).** `Campaign` bleibt die fachliche
   Identität (analog Phase 8–10: `key`/`name`), `CampaignVersion`
   bekommt eine Draft→Publish-Historie **pro Kampagne** (`DRAFT` →
   `ACTIVE` → `EXPIRED`/`ARCHIVED`, wiederverwendet `VersionStatus`).
   Mehrere verschiedene `Campaign`-Zeilen dürfen gleichzeitig eine
   `ACTIVE`-Version haben — **kein** `EXCLUDE`-Constraint über alle
   Kampagnen hinweg. Die Exklusivität/Überlappungsprüfung gilt nur
   **innerhalb derselben** Campaign (eine Kampagne hat zu jedem Zeitpunkt
   höchstens eine `ACTIVE`-Version, analog `CommissionModelVersion`).
3. **Scope (Entscheidung C).** Nur `TENANT` und `STORE` — bewusst
   **kein** `EMPLOYEE`- und **kein** `COMPANY`-Scope (anders als bei
   Goals). Eine Kampagne gilt entweder mandantenweit oder für eine
   einzelne Filiale.
4. **RBAC (Entscheidung D).** Neuer, additiver Namespace
   `config.campaigns.view/edit/publish`, TENANT-scoped, serverseitig
   erzwungen (UI-Gating nur zusätzlich) — konsistent mit Phase 8–11. Die
   fachliche Scope-Begrenzung der einzelnen Kampagne (TENANT/STORE, s.
   Punkt 3) ist davon strikt getrennt: `config.campaigns.edit` entscheidet
   **wer** Kampagnen pflegen darf, nicht **auf welchen Store** sich eine
   konkrete Kampagne bezieht.
5. **Analytics/Attribution (Entscheidung E).** In Phase 13 nur die
   **Grundlage**, keine vollständige Attribution bis zum Deal. Es muss
   mindestens nachvollziehbar sein: Kampagne aktiv → Kampagnenbedingung
   hat zur Empfehlung beigetragen → Empfehlung angezeigt/ausgewählt.
   Die vollständige Kette Campaign → Recommendation → Outcome → Deal →
   Umsatz/Marge ist ausdrücklich ein **späteres, separates AP/Feature**,
   nicht Teil von AP1–AP9 dieses Plans.
6. **Schema-Erweiterung (zusätzliche Entscheidung, "Campaign-Skelett").**
   Explizites GO für eine **substanzielle** Erweiterung des bestehenden
   Phase-2-Skeletts, nicht nur additive Minimal-Migrationen. Vor jeder
   Schema-Änderung (AP1) müssen bestehende Foreign Keys/Referenzen auf
   `Campaign`/`CampaignVersion` geprüft werden (aktuell: keine, siehe
   AP0-Discovery) — **keine stille Breaking-Change-Migration**.

**Explizit ausgeschlossen** (aus Entscheidung A/E, analog dem
Scope-Schutz-Muster aus Phase 11): eine zweite/parallele
Priorisierungs- oder Recommendation-Logik, automatische
Deal-Attribution in Phase 13, `EMPLOYEE`/`COMPANY`-Scope, automatische
Produktempfehlung allein durch Kampagnen-Aktivierung ohne
`PrioritizationRule`-Beteiligung, Rückkopplung zu/Verwechslung mit
Goals (Goals bleiben reines Reporting ohne Recommendation-Einfluss,
siehe Phase 11).

## 2. Schema (Skizze, verbindliche Feldliste folgt in AP1)

```prisma
enum CampaignScopeType { TENANT STORE } // eigenes, kleineres Enum als
  // GoalScopeType (kein EMPLOYEE/COMPANY, s. Entscheidung C) und NICHT
  // RoleScopeType wiederverwenden (RoleScopeType hat COMPANY, das hier
  // bewusst nicht erlaubt ist).

model Campaign {
  id        String
  tenantId  String
  key       String
  name      String
  createdAt DateTime

  versions CampaignVersion[]

  @@unique([tenantId, id])
  @@unique([tenantId, key])
}

model CampaignVersion {
  id             String
  tenantId       String
  campaignId     String
  versionNumber  Int
  status         VersionStatus   // DRAFT/ACTIVE/EXPIRED/ARCHIVED (wiederverwendet)
  scopeType      CampaignScopeType
  scopeId        String          // TENANT -> tenantId, STORE -> Store.id (im selben Tenant)
  validFrom      DateTime
  validTo        DateTime?
  description    String?
  createdAt      DateTime
  createdByUserId String

  campaign Campaign @relation(fields: [tenantId, campaignId], references: [tenantId, id], onDelete: Restrict)

  conditions CampaignCondition[] // s.u.

  @@unique([tenantId, campaignId, versionNumber])
}

// Neue Condition-Tabelle, analog eligibility_rule_conditions/
// prioritization_rule_conditions: definiert, WAS eine Kampagne fachlich
// betrifft (Zielgruppe/Produkte laut Discovery-Lücke 1), unabhängig vom
// AP4-Wirkmechanismus CAMPAIGN_ACTIVE. Details (Feldliste, DNF-Gruppierung)
// werden in AP1 im Detail spezifiziert und vor Code mit ChatGPT bestätigt.
model CampaignCondition {
  id               String
  tenantId         String
  campaignVersionId String
  groupIndex       Int
  sourceType       ConditionSourceType // ANSWER/PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE (wiederverwendet)
  questionId       String?
  attributeKey     String?
  operator         VisibilityOperator
  comparisonValue  String
}
```

Nur EINE `ACTIVE`-Version je `Campaign` gleichzeitig (Exklusivität
**innerhalb** der Campaign, analog `CommissionModelVersion` — per
`EXCLUDE`-Constraint auf `(campaignId, tstzrange(validFrom, validTo))`
WHERE `status = 'ACTIVE'`, keine globale Exklusivität über alle
Campaigns). Die exakte Constraint-Syntax und ob `CampaignCondition`
wirklich als eigene Tabelle nötig ist oder ob AP4 stattdessen
`CAMPAIGN_ACTIVE` direkt als neuen `sourceType`-Wert in die
**bestehenden** `PrioritizationRule`/`CrossSellingRule`-Conditions
einführt (ohne eigene `CampaignCondition`-Tabelle), ist eine der ersten
Detailfragen für AP1 (siehe Abschnitt 4).

## 3. Arbeitspakete

- **AP0** – Discovery (bereits erledigt, `PHASE_13_DISCOVERY.md`).
- **AP1** – Datenmodell & Versionierung: `Campaign`, `CampaignVersion`,
  `CampaignScopeType`-Enum, Schema-/Referenzanalyse des bestehenden
  Phase-2-Skeletts (keine FKs vorhanden, siehe AP0), expliziter
  Migrationsplan, `EXCLUDE`-Constraint innerhalb einer Campaign,
  PGlite-Verifikation, RBAC-Grundgerüst
  `config.campaigns.view/edit/publish` additiv zu
  `ALL_CONFIG_PERMISSION_KEYS`. Vor Code: Detailfrage aus Abschnitt 2
  (eigene `CampaignCondition`-Tabelle vs. Erweiterung bestehender
  Condition-Tabellen) mit ChatGPT klären.
- **AP2** – Service-Schicht `campaign-admin.ts`: CRUD für `Campaign`
  (fachliche Identität) + `CampaignVersion` (Draft-Erstellung,
  Bearbeitung, Publish, Historie/Rollback analog Phase 8–10),
  `scopeId`-Validierung gegen die reale Organisationsstruktur
  (`TENANT` ⇒ `scopeId === tenantId`; `STORE` ⇒ `Store` muss im selben
  Tenant existieren, analog Phase-11-Lehre zu Goal-`scopeId`),
  concurrency-sichere `versionNumber`-Vergabe (Row-Lock, analog der in
  Phase 10 AP9-Fix gefundenen Falle).
- **AP3** – Scope/RBAC: API-Routen `/api/admin/campaigns`,
  `/api/admin/campaigns/[id]/versions`, `requireConfigPermission()`
  gegen `config.campaigns.*`, Tenant-Isolation/IDOR-Tests (kein
  Zugriff auf `Campaign`/`CampaignVersion` anderer Tenants, kein
  `STORE`-scopeId anderer Tenants).
- **AP4** – Campaign Rule Integration: `CAMPAIGN_ACTIVE` in
  `ConditionSourceType` (`types.ts`) und `conditions.ts` (DNF-Engine)
  einhängen, sodass bestehende `PrioritizationRule`-/
  `CrossSellingRule`-Conditions auf "ist Campaign X gerade aktiv"
  prüfen können. Kein neuer Auswertungspfad außerhalb der bestehenden
  Eligibility→Prioritization→Recommendation-Kette.
- **AP5** – Konflikt-/Parallelitätslogik: deterministisches Verhalten
  bei mehreren gleichzeitig aktiven Campaigns mit überlappendem
  Produkt-/Kategorie-/Store-Fokus (Gewichte summieren sich über die
  normale `PrioritizationRule.weight`-Summenlogik, keine
  Sonderbehandlung nötig, da Campaigns nicht selbst gewichten, sondern
  nur als Condition-Zustand referenziert werden — muss in AP5 mit
  Tests explizit belegt werden, nicht nur behauptet).
- **AP6** – Admin-UI `/admin/campaigns` (Liste, Detail, Draft-Editor,
  Validate/Publish, Versionshistorie/Rollback, Scope-Auswahl
  TENANT/STORE, Bedingungs-Editor) — strukturell analog Phase 9
  (Regel-Editor) und Phase 10 (Provisionsmodell-Editor).
- **AP7** – Analytics-Grundlage (Entscheidung E): minimale
  Attributionskette Kampagne-aktiv → Kampagnenbedingung traf zu →
  Empfehlung, ohne vollständige Deal-Attribution. Konkreter
  Datenschnitt (neues Feld auf `RecommendationRationale` vs. neues
  `RecommendationCampaignSignal` analog `RecommendationCrossSellingSignal`)
  wird in AP7 mit ChatGPT abgestimmt, bevor Code entsteht.
- **AP8** – Security/Regression/E2E (Desktop+Tablet, gleiche Härte wie
  Phase 8–12): RBAC, Tenant-Isolation/IDOR, Scope-Grenzen (TENANT vs.
  STORE), Mehrfach-Campaign-Parallelität, Audit/Reproduzierbarkeit
  (spätere Campaign-Änderung ändert nicht rückwirkend vergangene
  Empfehlungen/Rationale-Einträge).
- **AP9** – Dokumentation (`CAMPAIGN_MANAGEMENT.md` analog
  `RECOMMENDATION_ENGINE.md`/`RULE_EDITOR.md`, `DATA_MODEL.md`-Korrektur).
- **AP10** – Abschlussbericht Phase 13.

## 4. Offene Detailfragen für AP1 (vor Code mit ChatGPT klären)

1. Eigene `CampaignCondition`-Tabelle (Skizze Abschnitt 2) vs.
   `CAMPAIGN_ACTIVE` direkt als Bedingungswert innerhalb bestehender
   `PrioritizationRule`/`CrossSellingRule`-Conditions ohne separate
   Campaign-eigene Condition-Tabelle — beeinflusst, ob eine Kampagne
   selbst eine Zielgruppen-/Produktdefinition trägt, oder ob sie nur
   ein benannter Schalter ist, auf den bestehende Regeln verweisen.
2. Exakte `EXCLUDE`-Constraint-Syntax für "eine `ACTIVE`-Version pro
   Campaign" (analog `CommissionModelVersion`, ggf. 1:1 übertragbar).
3. AP7-Datenschnitt für die Analytics-Grundlage (s. o.).

## 5. Nächster Schritt

Plan geht jetzt an ChatGPT zur Prüfung. Nach ChatGPT-Freigabe: explizites
Nutzer-Implementierungs-GO vor AP1-Code (analog dem in allen
Vorgängerphasen etablierten Muster).
