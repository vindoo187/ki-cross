# Phase 13 – Discovery: Campaign Management (AP0)

Stand: 2026-08-24. Fünfte von ChatGPT vorgeschlagene Fachadministrations-/
Steuerungsphase, während Phase 12 (Freitext-KI-Angebot) bei AP5c pausiert
(wartet auf externe Provider-Accounts des Nutzers). Bestätigte
Gesamt-Reihenfolge laut Phase-11-Discovery: Provisionsmodell-Editor →
Ziele-Modell → Freitext-KI-Angebot → **Campaign-Management**.

Dieses Dokument fasst den Ist-Zustand zusammen und listet die zentralen,
noch offenen Architekturfragen, die vor einem Implementierungsplan mit
ChatGPT geklärt werden müssen (identisches Vorgehen wie AP0 in Phase 6–11).

## 1. Was "Campaign" im Projekt bisher bedeutet

Anders als bei Ziele (Phase 11, dort **kein** Datenbankmodell vorhanden)
existiert für Campaign bereits ein **Datenbank-Skelett aus der allerersten
Migration** (`20260731000000_init`, Phase 2) — aber seither unverändert,
nirgends im Server-Code referenziert und ohne fachliche Substanz:

```prisma
model Campaign {
  id, tenantId, key, name, createdAt
  versions CampaignVersion[]
}

model CampaignVersion {
  id, tenantId, campaignId, versionNumber
  status VersionStatus  // DRAFT/ACTIVE/EXPIRED/ARCHIVED
  validFrom, validTo
  description
}
```

Kein `storeId`/Scope-Feld, keine Produkt-/Kategorie-Zielgruppe, kein
Prioritäts-/Gewichtsfeld, keine Verknüpfung zu `PrioritizationRule` oder
`RuleCondition`. Es gibt **keinen** Admin-Service, keine API-Route, keine
Migration mit `EXCLUDE`-Constraint (anders als `RuleSetVersion`, die seit
Phase 2B einen Überlappungsschutz hat) — das Modell ist ein reiner
Phase-2-Platzhalter.

Konzeptionell taucht "Campaign" an zwei Stellen auf:

1. `docs/RECOMMENDATION_ENGINE.md` (Zeile 26-31): in der ursprünglichen
   Konzeption sollten "aktive `Campaign`-Schwerpunkte (zeitlich begrenzt)"
   neben Marge (`CommissionModelVersion`) und `Goal`-Vorgaben einer von
   drei Faktoren sein, die auf den `businessPriorityScore`
   (`PrioritizationRule`) einwirken.
2. `docs/DATA_MODEL.md` (Zeile 184, 219): "Campaign (Kampagne) — zeitlich
   begrenzt (CampaignVersion), priorisiert bestimmte Produkte/
   Cross-Selling-Schwerpunkte."

**Fazit:** Genau wie bei Goals (Phase 11) gibt es keine belastbare, bereits
implementierte Referenzarchitektur — nur ein leeres Namensschild im Schema
und zwei Sätze Konzeptbeschreibung. Der tatsächliche Beitrag zur
Priorisierung wurde nie gebaut (bestätigt: `prioritization.ts` kennt
weder `Campaign` noch irgendeinen darauf verweisenden `ConditionSourceType`).

## 2. Bestehende, wiederverwendbare Infrastruktur

### 2.1 Regel-/Condition-Modell (Phase 3B/9)

`PrioritizationRule` wirkt bereits mandantenweit auf den
`businessPriorityScore` (Summe aller getroffenen Regelgewichte,
`weight`-Feld, siehe `prioritization.ts`). Jede Regel hat
`RuleCondition`-Zeilen mit `sourceType ∈ {ANSWER, PRODUCT_ATTRIBUTE,
SESSION_ATTRIBUTE}`. Eine naheliegende, **aber nicht vorentschiedene**
Option: Campaign-Zugehörigkeit als vierter `ConditionSourceType`
(z. B. `CAMPAIGN_ACTIVE`) in dieses bestehende Regelwerk einhängen, statt
eine zweite, parallele Priorisierungslogik zu bauen (siehe Abschnitt 4.1).

### 2.2 Draft→Publish-Muster (Phase 8/9/10) vs. periodische Parallelität (Phase 11)

Zwei etablierte, aber gegensätzliche Muster stehen zur Wahl:

- **Einzelversion mit genau einer `ACTIVE`-Version je Tenant**
  (`RuleSetVersion`, `CommissionModelVersion`, `QuestionnaireVersion`) —
  neue Version löst die alte ab, per `EXCLUDE`-Constraint erzwungen.
- **Mehrere gleichzeitig aktive, unabhängige Instanzen** (`Goal`/
  `GoalVersion`, Phase 11) — z. B. ein Umsatzziel UND ein
  Abschlussquote-Ziel für dasselbe Quartal koexistieren.

Kampagnen sind ihrer Natur nach eindeutig der zweiten Kategorie: "DSL-Aktion
August" und "Glasfaser Q3" müssen gleichzeitig laufen können, eine neue
Kampagne "ersetzt" keine andere. Das bereits im Schema stehende
`CampaignVersion.status` (DRAFT/ACTIVE/EXPIRED/ARCHIVED) legt aber ein
Einzelversions-Muster pro **Kampagne** nahe (mehrere Kampagnen = mehrere
`Campaign`-Zeilen, aber jede mit ihrer eigenen Versionshistorie/aktuell
gültigen Version) — strukturell ähnlich `Goal`, nur mit `key`/`name` als
fachlicher Identität statt Scope+Metrik+Periode. Das ist plausibel, aber
eine der zentralen Fragen an ChatGPT (Abschnitt 4.2).

### 2.3 Config-Permissions-Muster (Phase 8-11)

`config.questions.*` / `config.rules.*` / `config.commissions.*` /
`config.goals.*` sind alle TENANT-scoped, additiv zu `config_editor`/
`config_publisher`, deny-by-default. `config.campaigns.*`
(`view`/`edit`/`publish`) würde sich nahtlos einreihen — vorbehaltlich
ChatGPT-Bestätigung, dass Kampagnen ebenfalls rein mandantenweit
modelliert werden (siehe Abschnitt 3, Scope-Frage).

### 2.4 Cross-Selling-Regelwerk (`CrossSellingRule`, Phase 3B/9)

Bereits vorhanden: `needType` (`NeedType`-Enum), `priority`, `reasonCode`,
`suggestedProductVersionId`. Eine Kampagne mit Cross-Selling-Schwerpunkt
(laut `DATA_MODEL.md`-Zeile 184) könnte hier andocken, statt ein
drittes Regel-Subsystem zu bauen — ebenfalls eine offene Frage.

### 2.5 Sonstige wiederverwendbare Bausteine

- `AuditLog` (append-only) — gleiches Prinzip wie Phase 8–11.
- Analytics-Grundlage (`kpis.ts`, `AnalyticsEvent`) — falls Kampagnen
  eigene Auswertung brauchen (Impression → Empfehlung → Annahme → Deal je
  Kampagne), fehlt aktuell jede Attributionsmöglichkeit (kein
  `campaignId`-Feld auf `Recommendation`/`RecommendationItem`/
  `AnalyticsEvent`).

## 3. Datenlücken, die ein Campaign-Modell zwingend braucht

1. **Zielgruppe/Targeting.** Wirkt eine Kampagne auf bestimmte Produkte
   (`ProductVersion`), eine ganze `ProductCategory`, einen `NeedType`
   (Cross-Selling-Ebene), oder eine Kombination? Aktuell kein Feld dafür.
2. **Scope.** Nur mandantenweit (passend zu `Campaign.tenantId` ohne
   `storeId`), oder auch filialspezifisch (z. B. "Aktion nur in Filiale
   München")? Das bestehende Skelett hat keinen Store-Bezug.
3. **Priorisierungswirkung.** Bekommt eine Kampagne ein eigenes
   Gewichtsfeld (analog `PrioritizationRule.weight`), das direkt in
   `businessPriorityScore` einfließt, oder wirkt sie ausschließlich über
   eine neue `RuleCondition` (`CAMPAIGN_ACTIVE`), die eine ganz normale,
   admin-konfigurierte `PrioritizationRule` referenziert? Der zweite Weg
   vermeidet ein zweites Priorisierungssystem, macht die Kampagne aber zu
   einem reinen "Schalter", dessen tatsächliches Gewicht weiterhin über
   den Regel-Editor gepflegt wird.
4. **Provisionsbezug.** Kann eine Kampagne einen Sonderbonus auslösen
   (`commissionRequired`-Mechanismus existiert bereits bei
   `PrioritizationRule`), oder ist das explizit außerhalb des Scopes?
5. **Verhältnis zu Goals (Phase 11).** Goals sind laut expliziter
   Phase-11-Entscheidung bewusst **reines Reporting ohne Rückkopplung** in
   die Empfehlungslogik. Campaigns sollen laut ursprünglichem Konzept
   genau diese Rückkopplung haben. Bleiben beide Konzepte bewusst getrennt
   (Goal = Ziel-vs.-Ist-Reporting, Campaign = aktive Steuerung der
   Empfehlung), oder gibt es eine gewünschte spätere Brücke (z. B.
   "Ziel nicht erreicht → automatisch Kampagne vorschlagen")? Für Phase 13
   vermutlich außerhalb des Scopes, aber wichtig, um keine widersprüchliche
   Architektur zu bauen.
6. **Attribution/Analytics.** Soll nachvollziehbar sein, wie viele
   Empfehlungen/Abschlüsse auf eine bestimmte Kampagne zurückgehen? Falls
   ja: neues `campaignId`-Feld auf `Recommendation`/`RecommendationItem`
   oder ein eigenes `RecommendationCampaignSignal` analog dem bestehenden
   `RecommendationCrossSellingSignal`-Muster.
7. **Überlappende Kampagnen.** Dürfen zwei Kampagnen gleichzeitig
   denselben Produkt-/Kategorie-Fokus haben (Gewichte addieren sich), oder
   gibt es eine Konfliktregel (z. B. höchste Priorität gewinnt)?

## 4. Zentrale Architekturfragen für ChatGPT (vor Implementation Plan)

### 4.1 Wie wirkt eine Kampagne konkret auf die Empfehlung?

Vorschlag (zur Diskussion, keine Vorentscheidung): Kampagnen bekommen
**kein eigenes Priorisierungssystem**, sondern ein neues,
`CAMPAIGN_ACTIVE`-`ConditionSourceType`, das eine bestehende
`PrioritizationRule` (und optional `CrossSellingRule`) referenzieren kann.
Das fügt sich in die bereits etablierte, getestete DNF-Condition-Engine
(`conditions.ts`) ein, statt eine dritte parallele Bewertungslogik zu
schaffen — direkt der von ChatGPT selbst mehrfach geäußerten Sorge
folgend, "keine zweite Recommendation Engine" zu bauen.

### 4.2 Datenmodell-Muster: Einzelversion pro Kampagne vs. Goal-artige Parallelität

Vorschlag: `Campaign` bleibt die fachliche Identität (wie bisher, `key`/
`name`), `CampaignVersion` bekommt eine Draft→Publish→ACTIVE/EXPIRED-Historie
**pro Kampagne** (analog Phase 8-10), aber **mehrere `Campaign`-Zeilen
mit gleichzeitig `ACTIVE`-Version** sind ausdrücklich erlaubt (kein
`EXCLUDE`-Constraint über alle Kampagnen hinweg, nur — falls gewünscht —
einer pro Einzelkampagne gegen zeitlich überlappende eigene Versionen).

### 4.3 Scope: mandantenweit oder auch filialspezifisch?

Falls filialspezifisch nötig: neues `scopeType`/`scopeId`-Paar analog
`Goal` (Phase 11) — dann aber auch dieselbe RBAC-Zweiteilung wie bei
Goals (Setzen = `config.campaigns.*`, Sehen = evtl. Management-Scope).
Falls rein mandantenweit: einfacher, passt zum bisherigen Skelett ohne
`storeId`.

### 4.4 RBAC-Namensraum

Vorschlag: `config.campaigns.view/edit/publish`, TENANT-scoped, additiv zu
`config_editor`/`config_publisher` — konsistent mit Phase 8-11, sofern
4.3 zugunsten "rein mandantenweit" entschieden wird.

### 4.5 Attribution/Analytics-Umfang für Phase 13

Empfehlung dieser Discovery: Attribution (Kampagne → Empfehlung → Deal)
als eigener, ggf. späterer Schritt behandeln, Phase 13 zunächst auf
Kampagnen-Verwaltung + Wirkung auf Priorisierung begrenzen — analog wie
Phase 11 KPI-Neuerungen bewusst ausgeklammert hat.

## 5. Risiken

- **Zweite Priorisierungslogik.** Größtes Risiko: Campaign bekommt ein
  eigenes, paralleles Gewichts-/Auswertungssystem statt sich in die
  bestehende `PrioritizationRule`/`RuleCondition`-Engine einzuhängen —
  würde zwei parallel zu pflegende, potenziell widersprüchliche
  Priorisierungsmechanismen erzeugen (siehe 4.1).
- **Schema-Altlast.** Das bestehende `Campaign`/`CampaignVersion`-Skelett
  aus Phase 2 hat keinen `EXCLUDE`-Constraint und keine der inzwischen
  etablierten Konventionen (z. B. `@@unique([tenantId, id])`-Composite-FK-
  Muster ist zwar vorhanden, aber Feldnamen/Struktur sind sehr
  rudimentär) — vermutlich nötig, das Skelett in Phase 13 AP1 signifikant
  zu erweitern statt nur additiv zu ergänzen; das sollte ChatGPT explizit
  bestätigen, um keine stille Breaking-Change-Migration zu riskieren.
- **Verwechslung mit Goals.** Ohne klare Abgrenzung (Abschnitt 3 Punkt 5)
  könnten Nutzer Kampagnen und Ziele als dieselbe Sache missverstehen —
  Doku/UI muss die begriffliche Trennung (Ziel = Kennzahl-Vorgabe,
  Kampagne = aktive Vertriebssteuerung) klar kommunizieren.
