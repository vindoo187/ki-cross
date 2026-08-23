# Phase 13 – Implementierungsplan: Campaign Management

Stand: 2026-08-24. Basiert auf `PHASE_13_DISCOVERY.md` (AP0),
ChatGPTs Architekturentscheidungen A–E dazu (2026-08-24, "Meine
Entscheidungen für Phase 13") sowie ChatGPTs drei Detailentscheidungen
zu diesem Plan (2026-08-24, "Damit ist AP1 für mich freigegeben").
Analog Phase 6–12: dieser Plan geht vor jedem AP1-Code an ChatGPT zur
Prüfung, danach an den Nutzer für das explizite Implementierungs-GO.

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
7. **Drei Detailentscheidungen (ChatGPT, 2026-08-24, "Damit ist AP1 für
   mich freigegeben"), verbindlich für AP1:**
   - **Eigene `CampaignCondition`-Tabelle: JA.** Eine Kampagne ist
     fachlich mehr als nur ein `CAMPAIGN_ACTIVE`-Signal und muss ihre
     eigenen Bedingungen beschreiben können, ohne die bestehende
     `PrioritizationRule`-Struktur dafür zu missbrauchen. Klare
     Trennung: `Campaign` = fachliche Identität, `CampaignVersion` =
     Draft/Publish-Version, `CampaignCondition` = Bedingungen, wann die
     Kampagne greift, bestehende `PrioritizationRule` = entscheidet
     weiterhin über Priorisierung/Empfehlung, `CAMPAIGN_ACTIVE` liefert
     der bestehenden Engine lediglich das Signal.
   - **`EXCLUDE`-Constraint ausschließlich innerhalb derselben
     `campaignId`.** Pro Campaign darf zu einem Zeitpunkt höchstens
     eine veröffentlichte/aktive Version für denselben fachlichen Scope
     aktiv sein — explizit **keine** globale Exklusivität über alle
     Kampagnen hinweg (Campaign A/Store 1 + Campaign B/Store 1 +
     Campaign C/Tenant + Campaign D/Store 2 dürfen alle gleichzeitig
     `ACTIVE` sein). Die Semantik von `DRAFT`/`ACTIVE`/`EXPIRED`/
     `ARCHIVED` bleibt unverändert aus Phase 8–10 übernommen — **kein**
     Goal-artiges "jede Version ist sofort gültig".
   - **Analytics-Grundlage: eigene `RecommendationCampaignSignal`-
     Tabelle**, analog dem bestehenden Muster
     `RecommendationCrossSellingSignal` — **nicht** ein zusätzliches
     Feld auf `RecommendationRationale` (vermeidet Aufblähung von
     `RecommendationRationale`, ermöglicht spätere eindeutige
     Auswertung: welche Kampagne/`CampaignVersion` hat welche
     Recommendation ausgelöst, später Kampagne→Deal-Conversion). In
     Phase 13 AP7 nur die technische Grundlage (append-only
     Signalstruktur), **kein** vollständiges Campaign-Analytics-
     Dashboard und keine Conversion-Logik.

   Nach AP1 (bevor AP2 beginnt) ein kurzer Discovery-/Review-Punkt mit
   ChatGPT, falls das tatsächliche Schema an einer Stelle von dieser
   Planung abweicht (ChatGPT-Auflage).

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

// Eigene Condition-Tabelle (ChatGPT-Entscheidung 2026-08-24, verbindlich,
// s. Abschnitt 1 Punkt 7), analog eligibility_rule_conditions/
// prioritization_rule_conditions: definiert, WAS eine Kampagne fachlich
// betrifft (Zielgruppe/Produkte laut Discovery-Lücke 1), unabhängig vom
// AP4-Wirkmechanismus CAMPAIGN_ACTIVE. Exakte Feldliste/DNF-Gruppierung
// wird in AP1 im Detail spezifiziert (Struktur unten ist eine Skizze).
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
Campaigns). Zusätzlich (Analytics-Grundlage, Abschnitt 1 Punkt 7):

```prisma
// Analog RecommendationCrossSellingSignal (append-only), verknüpft eine
// Recommendation mit der/den Campaign(s), deren CAMPAIGN_ACTIVE-Signal
// zur Auswahl beigetragen hat. Nur die technische Grundlage in AP7 --
// kein vollständiges Attributions-/Conversion-System in Phase 13.
model RecommendationCampaignSignal {
  id                   String
  tenantId             String
  recommendationItemId String
  campaignId           String
  campaignVersionId    String
  createdAt            DateTime
}
```

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

## 4. Von ChatGPT geklärte Detailfragen (2026-08-24)

Die drei ursprünglich offenen Detailfragen sind mit ChatGPTs
Entscheidungen vom 2026-08-24 ("Damit ist AP1 für mich freigegeben")
beantwortet und oben (Abschnitt 1 Punkt 7, Abschnitt 2) eingearbeitet:

1. Eigene `CampaignCondition`-Tabelle: **JA**, nicht die bestehenden
   `PrioritizationRule`/`CrossSellingRule`-Conditions für die
   Kampagnen-Zielgruppendefinition zweckentfremden.
2. `EXCLUDE`-Constraint ausschließlich innerhalb derselben `campaignId`,
   keine globale Exklusivität über alle Kampagnen.
3. AP7-Datenschnitt: eigene `RecommendationCampaignSignal`-Tabelle
   analog `RecommendationCrossSellingSignal`, kein Feld auf
   `RecommendationRationale`.

ChatGPT (verbatim, 2026-08-24): "Damit ist AP1 für mich freigegeben.
[...] Wenn AP1 fertig ist, sollten wir vor AP2 wieder einen kurzen
Discovery-/Review-Punkt einbauen, falls das tatsächliche Schema an
einer Stelle von dieser Planung abweicht."

## 5. Nächster Schritt

ChatGPT hat den Plan mit diesen drei Klarstellungen final freigegeben
und GO für AP1 erteilt. Auflage: nach AP1 (vor AP2) ein kurzer
Review-Punkt, falls das tatsächliche Schema von dieser Planung
abweicht. Ausstehend: explizites Nutzer-Implementierungs-GO vor
AP1-Code (analog dem in allen Vorgängerphasen etablierten Muster).
