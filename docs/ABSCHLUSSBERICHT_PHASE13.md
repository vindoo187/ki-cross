# Abschlussbericht Phase 13: Campaign Management

Stand: 2026-08-30. Basis-Commit (letzter Phase-12-Commit): `ff3ee76`
("Phase 12 AP5b: Provider-Evaluierung"). Letzter Phase-13-Commit: `2ffef2f`
("Fix CI #137: Prettier-Formatierung ABSCHLUSSBERICHT_PHASE13.md"). Der
AP10-Abschlussbericht-Commit selbst deckte einen echten
Nebenlaeufigkeits-Defekt in drei Publish-Workflows auf (siehe Abschnitt 10) -- dessen Fix ist Teil dieser Phase. Maßgeblicher CI-Nachweis für den
Gesamtabschluss: **CI #138** (GitHub Actions, Commit `2ffef2f`, "completed
successfully", 5m 35s) unter
https://github.com/vindoo187/ki-cross/actions?query=branch%3Amain.

## 1. Commit-Historie mit CI-Status

| CI #        | Commit        | Status         | Inhalt                                                                                                                          |
| ----------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 109 (Basis) | `ff3ee76`     | ✅             | Phase 12 AP5b: Provider-Evaluierung (Anthropic/OpenAI/Mistral), kein Code                                                       |
| 110         | `c9c2f73`     | ✅             | Phase 13 AP0: Discovery Campaign Management (kein Code)                                                                         |
| 111         | `4f03e00`     | ✅             | Phase 13: Implementation Plan, basierend auf ChatGPT-Entscheidungen A–E                                                         |
| —           | `c4da4d0`     | _kein CI-Lauf_ | Plan: drei ChatGPT-Detailentscheidungen eingearbeitet, AP1-GO — **enthielt versehentliche Massenlöschung, siehe Abschnitt 8**   |
| —           | `4e30b1e`     | _kein CI-Lauf_ | Fix: Massenlöschung aus `c4da4d0` rückgängig gemacht (außer `ci.yml`, PAT-Scope-Limit)                                          |
| —           | `af0e456`     | _kein CI-Lauf_ | Plan-Wiederherstellung nach Massenlöschungs-Incident                                                                            |
| 112         | `54868a7`     | ✅             | CI: `.github/workflows/ci.yml` wiederhergestellt (fehlte seit dem Incident, PAT jetzt mit workflow-Scope)                       |
| 113         | `64042bd`     | ❌             | Phase 13 AP1: Campaign-Datenmodell & Versionierung                                                                              |
| 114         | `f7c13b8`     | ✅             | AP1 Fix: fehlenden Unique-Index auf `campaign_versions` ergänzt                                                                 |
| 115         | `d9a7615`     | ❌             | AP2: Campaign-Management-Service (`campaign-admin.ts`)                                                                          |
| 116         | `591beb1`     | ❌             | AP2 Fix: Prettier-Formatierung                                                                                                  |
| 117         | `55fe06a`     | ❌             | AP2 Fix 2: Prettier-Formatierung korrekt angewendet                                                                             |
| 118         | `8991597`     | ❌             | AP2 Fix 3: `tsc --noEmit` (`noUncheckedIndexedAccess`) behoben                                                                  |
| 119         | `982695b`     | ✅             | AP2 Fix 4: FK-Verletzung in Integrationstests behoben                                                                           |
| 120         | `af5e4a9`     | ❌             | AP3: API-Routen für Campaign-Management                                                                                         |
| 121         | `10847da`     | ✅             | AP3 Fix 1: `campaignInput()` Zufalls-Key durch fixen Key ersetzt                                                                |
| 122         | `f3dadcb`     | ❌             | AP4: `CAMPAIGN_ACTIVE`-Bedingung in Prioritization-/Cross-Selling-Engine                                                        |
| 123         | `fb7712b`     | ✅             | AP4 Fix 1: `tsc`-Fehler durch erweitertes `ConditionSourceType` behoben                                                         |
| 124         | `ec69141`     | ✅             | AP4: Tenant-Isolation-Test für `loadActiveCampaignKeys()` (ChatGPT-Nachforderung)                                               |
| 125         | `30e6470`     | ✅             | AP4: Architekturentscheidung `ruleSetAt`/JETZT dokumentiert                                                                     |
| 126         | `1542b88`     | ❌             | AP5: Konflikt-/Parallelitätslogik mehrerer aktiver Campaigns (Tests)                                                            |
| 127         | `440dba0`     | ✅             | AP5 Fix 1: `tsc`-Fehler in `recommendation-campaign-conflict.test.ts` behoben                                                   |
| 128         | `d6d2fda`     | ❌             | AP6: Admin-UI `/admin/campaigns`                                                                                                |
| 129         | `64ce116`     | ❌             | AP6 Fix 1: ungenutztes `eslint-disable` entfernt                                                                                |
| 130         | `4881bd2`     | ✅             | AP6 Fix 2: 422-Validate-Test nutzt echte-aber-inaktive Frage statt `randomUUID()`                                               |
| 131         | `3a7528b`     | ✅             | AP7: Campaign-Attribution (`RecommendationCampaignSignal`)                                                                      |
| 132         | `3989ff1`     | ❌             | AP8: Security/Regression/E2E für Campaign Management                                                                            |
| 133         | `2429cd6`     | ❌             | AP8 Fix 1: `evaluationFingerprint` um `campaignVersionIds` ergänzt (echter Defekt aus CI #132)                                  |
| 134         | `c6be8b8`     | ✅             | AP8 Fix 2: Kampagnenname in `admin-campaigns.spec.ts` projekt-/retry-eindeutig gemacht (Tablet-Flake aus CI #133)               |
| 135         | `961bb82`     | ✅             | AP9: Dokumentation (`DATA_MODEL.md` + `RECOMMENDATION_ENGINE.md`)                                                               |
| 136         | `131d275`     | ❌             | AP10: Abschlussbericht Phase 13 verfassen — deckte echten `now`-vor-Lock-Nebenlaeufigkeitsdefekt auf, siehe Abschnitt 10        |
| 137         | `a6a7f12`     | ❌             | AP10 Fix: `now`-vor-Lock-Defekt in drei Publish-Workflows behoben — CI schlug an Prettier-Formatierung des Berichts selbst fehl |
| **138**     | **`2ffef2f`** | **✅**         | **Fix CI #137: Prettier-Formatierung `ABSCHLUSSBERICHT_PHASE13.md`**                                                            |

Von 32 Commits im Phase-13-Bereich wurden 29 durch CI geprüft (die drei
Commits des Massenlöschungs-Incidents liefen ohne CI, da die
Workflow-Datei selbst zeitweise fehlte, siehe Abschnitt 8). Dreizehn der 29
CI-Läufe schlugen zunächst fehl und wurden im jeweils folgenden Commit
behoben — davon zwei (CI #136/#137) im Zuge von AP10 selbst, ausgeloest
durch den in Abschnitt 10 dokumentierten echten Nebenlaeufigkeitsdefekt
und dessen Formatierungs-Nachbesserung; alle uebrigen sind AP-interne
Fix-Iterationen, keine rückwirkenden Korrekturen an bereits abgenommenen
Arbeitspaketen.

## 2. Technische Versionen

Unverändert gegenüber Phase 12: TypeScript, Next.js 15, React 19, Prisma 6,
PostgreSQL (echter Service-Container in CI), Zod, Vitest, Playwright. Kein
Dependency-Update in Phase 13 (`git diff ff3ee76..961bb82 -- package.json
package-lock.json` ist leer).

## 3. Ausgangslage und Ziel der Phase

Nach Abschluss von Phase 12 (Freitext-KI-Angebotsfeature, Mock-Provider)
verfügte die Recommendation-Engine über Fragebogen (Phase 3), Regelwerk
(Phase 9), Provisionsmodelle (Phase 10) und Ziele (Phase 11) als
eigenständige, konfigurierbare Domänen. Ziel von Phase 13 war ein neues,
eigenständiges Domänenmodell "Campaign" (zeitlich befristete
Vertriebsaktionen), das in die bestehende Prioritization-/Cross-Selling-
Regel-Engine als neuer Bedingungstyp `CAMPAIGN_ACTIVE` integriert wird,
inklusive Admin-Verwaltung (Draft → Validate → Publish, analog Rules/
Commissions/Goals) und einer ersten Attributionskette (welche Campaign hat
zu welcher Empfehlung beigetragen). Der grundlegende Plan wurde von
ChatGPT als Projektleiter anhand von fünf Detailentscheidungen (A–E) vor
AP1 freigegeben; siehe `docs/PHASE_13_IMPLEMENTATION_PLAN.md` und
`docs/PHASE_13_DISCOVERY.md`.

## 4. Umfang AP0–AP9

- **AP0 — Discovery** (kein Code): Ist-Analyse des bestehenden
  `campaigns`/`campaign_versions`-Schema-Skeletts (existierte bereits seit
  der initialen Migration `20260731000000_init`, aber ungenutzt), der
  Rule-Engine-Architektur und offener Geschäftsfragen.
- **AP1 — Campaign-Datenmodell & Versionierung**: Migration
  `20260824180000_campaign_management`, `Campaign`/`CampaignVersion`
  (Scope-/Audit-Felder ergänzt) sowie zwei neue Tabellen
  `CampaignCondition` und `RecommendationCampaignSignal`.
- **AP2 — Admin-Service** (`campaign-admin.ts`): Draft → Validate →
  Publish-Workflow analog Question/RuleSet/CommissionModel.
- **AP3 — API-Routen** (`/api/admin/campaigns/...`).
- **AP4 — `CAMPAIGN_ACTIVE`-Integration**: neuer `ConditionSourceType` in
  `PrioritizationRuleCondition`/`CrossSellingRuleCondition`, ausgewertet
  zum Zeitpunkt `ruleSetAt` (JETZT-Semantik, nicht Session-gepinnt).
- **AP5 — Konflikt-/Parallelitätslogik**: Testabsicherung für mehrere
  gleichzeitig aktive Campaigns (TENANT-/STORE-Scope, Zeitfenster-Grenzen).
- **AP6 — Admin-UI** `/admin/campaigns`.
- **AP7 — Campaign-Attribution**: `RecommendationCampaignSignal`-
  Schreibpfad, bewusst auf `PrioritizationRule → RecommendationItem`
  beschränkt.
- **AP8 — Security/Regression/E2E**: deckte den in Abschnitt 8
  beschriebenen echten Fingerprint-Defekt auf und behob ihn.
- **AP9 — Dokumentation**: `DATA_MODEL.md`/`RECOMMENDATION_ENGINE.md`
  aktualisiert (kein `CAMPAIGN_MANAGEMENT.md`, siehe Abschnitt 12).

## 5. Architektur

**Domänenmodell:** `Campaign` (stabiler Schlüssel `key` + `tenantId`) →
`CampaignVersion` (versioniert, Lifecycle `DRAFT`/`PUBLISHED`/`EXPIRED`,
Scope `TENANT`/`STORE`, Gültigkeitsfenster `validFrom`/`validUntil`) →
`CampaignCondition` (eine oder mehrere Bedingungen je Version, die
bestimmen, wann die Campaign inhaltlich "aktiv" zählt). Das Muster ist
bewusst identisch zu `RuleSetVersion`/`CommissionModelVersion`: genau eine
`PUBLISHED`-Version je Campaign und Scope kann zu einem Zeitpunkt aktiv
sein, ältere Versionen wechseln beim Publish einer neuen Version auf
`EXPIRED`.

**Regel-Integration:** `CAMPAIGN_ACTIVE` ist ein neuer Wert des
gemeinsamen `ConditionSourceType`-Enums, nutzbar sowohl in
`PrioritizationRuleCondition` als auch `CrossSellingRuleCondition`.
Serverseitig auf diese beiden Regeltypen beschränkt
(`rule-admin.ts::validateDraftRuleSetVersion()`), nicht über einen
DB-Constraint, da `EligibilityRuleCondition`/`ExclusionRuleCondition`
denselben Enum-Typ verwenden. Die eigentliche Prüfung erfolgt über
`service.ts::loadActiveCampaignContext()` (lädt alle zum Zeitpunkt
`ruleSetAt` aktiven CampaignVersions für Tenant/Store), deren Ergebnis in
`conditions.ts::evaluateCondition()` für `CAMPAIGN_ACTIVE`-Bedingungen
konsultiert wird.

**Attributionskette (AP7):** `conditions.ts::extractMatchedCampaignActiveKeys()`
ermittelt, welche `CAMPAIGN_ACTIVE`-Bedingungen tatsächlich zum Treffer
einer `PrioritizationRule` beigetragen haben (dupliziert bewusst die
DNF-Gruppierungslogik von `evaluateConditionGroups()` in einer separaten,
rein lesenden Funktion, um die bereits abgenommene Kernfunktion nicht
anzufassen). `prioritization.ts::evaluatePrioritizationRules()`
dedupliziert und sortiert die getroffenen Campaign-Keys über alle
getroffenen Regeln. `service.ts::evaluate()` schreibt daraus je
`RecommendationItem` ein oder mehrere `RecommendationCampaignSignal`-Zeilen
atomar in derselben Transaktion wie `Recommendation`/`RecommendationItem`.

## 6. Schema-/Migrationsänderungen

Zwei neue Migrationen, beide additiv/non-breaking (keine Änderung an
bestehenden Zeilen, keine eingehenden Fremdschlüssel auf
`campaign_versions` vor dieser Phase):

- **`20260824180000_campaign_management`** (99 Zeilen, AP1): neuer Enum
  `CampaignScopeType` (`TENANT`/`STORE`); `scope_type`/`scope_id` auf
  `campaign_versions` (zunächst NULLable ergänzt); zwei neue Tabellen
  `campaign_conditions` und `recommendation_campaign_signals` (Letztere
  mit FK ausschließlich auf `RecommendationItem`, append-only per
  DB-Trigger `recommendation_campaign_signals_append_only`, siehe
  Abschnitt 9).
- **`20260830140000_campaign_active_condition_source_type`** (13 Zeilen,
  AP4): `ALTER TYPE "ConditionSourceType" ADD VALUE 'CAMPAIGN_ACTIVE'` —
  rein additiver Enum-Wert, keine Zeilenänderung.

## 7. RBAC und Tenant-Isolation

Drei neue, additive Permission-Keys in `config-permissions.ts` (Katalog
`ALL_CONFIG_PERMISSION_KEYS`, seit Phase 8/9/10 etabliertes Muster):
`config.campaigns.view`, `config.campaigns.edit`, `config.campaigns.publish`.
Tenant-Isolation ist durchgängig über den tenant-gescopten Prisma-Client
(`db`) sowie explizite Tests abgesichert: identischer `Campaign.key` in
einem fremden Mandanten zählt nicht als aktiv
(`recommendation-campaign-active.test.ts`), Signal-Tabelle ist
tenant-isoliert (`recommendation-campaign-attribution.test.ts`),
IDOR-Schutz und Scope-Grenzen (`TENANT`/`STORE`) sind über
`campaign-admin-routes.test.ts`/`campaign-admin-version-routes.test.ts`
abgedeckt. Details siehe [[project_ki_cross_phase13_ap4_status]] und
[[project_ki_cross_phase13_ap8_status]].

## 8. Notable Incident: versehentliche Massenlöschung (vor AP1)

Commit `c4da4d0` (Einarbeitung dreier ChatGPT-Detailentscheidungen in den
Implementierungsplan) löschte versehentlich einen Großteil des
Repository-Inhalts mit. Der Fehler wurde vor jeglichem CI-Lauf gegen
diesen Commit bemerkt (die Workflow-Datei `.github/workflows/ci.yml` war
selbst Teil der Löschung, wodurch für diesen und den folgenden
Wiederherstellungs-Commit gar kein CI-Lauf ausgelöst werden konnte).
Commit `4e30b1e` stellte alle gelöschten Dateien bis auf
`.github/workflows/ci.yml` wieder her (PAT hatte zu diesem Zeitpunkt noch
keinen `workflow`-Scope); Commit `af0e456` wiederholte die eigentliche
Plan-Änderung sauber. Commit `54868a7` stellte schließlich die
Workflow-Datei wieder her (PAT-Scope inzwischen erweitert) und ist der
erste wieder CI-geprüfte Commit der Phase (CI #112, grün). Es handelte
sich um einen reinen Werkzeug-/Prozessfehler beim Bearbeiten des
Plandokuments, nicht um einen Defekt an Anwendungscode; keine der
gelöschten/wiederhergestellten Dateien enthielt zu diesem Zeitpunkt bereits
Phase-13-Anwendungscode.

## 9. Notable Incident: fehlender `campaignVersionIds` im Idempotenz-Fingerprint (AP8)

Der in AP8 geforderte Reproduzierbarkeits-Regressionstest
(`recommendation-campaign-attribution.test.ts`) deckte in CI #132 einen
echten Produktionsdefekt auf, keinen Testfehler: `evaluationFingerprint`
(`fingerprint.ts`) enthielt die zum Auswertungszeitpunkt aktiven
`CampaignVersion`-IDs nicht — im Unterschied zu `commissionModelVersionIds`,
das exakt für diesen Zweck existiert. Eine Campaign-Aktivierung/
-Deaktivierung nach der ersten Auswertung einer Session änderte den
Fingerprint bei sonst unverändertem Input nicht: der Idempotenz-Fast-Path
griff fälschlich, eine erneute `evaluate()`-Auswertung lieferte weiterhin
die alte, veraltete `Recommendation` samt altem Signal zurück statt neu
auszuwerten. Das betraf nicht nur die Signal-Attribution, sondern
grundsätzlich die `CAMPAIGN_ACTIVE`-Bedingungsauswertung selbst — eine seit
AP4 bestehende, bis dahin unbemerkte Lücke.

**Fix (Commit `2429cd6`, ChatGPT-GO):** `FingerprintInput.campaignVersionIds:
string[]` ergänzt, exakt analog zu `commissionModelVersionIds`: sortiert in
`buildFingerprintObject()`, in `service.ts::evaluate()` aus dem dort
bereits geladenen `activeCampaignContext` befüllt (kein zusätzlicher
DB-Zugriff, kein Schema-Change). Ein zusätzlicher Testschritt ("Schritt
1b", ChatGPT-Vorgabe) beweist zugleich, dass der Fast-Path bei
UNVERÄNDERTEM Campaign-Zustand weiterhin korrekt greift — der Fix
deaktiviert die Idempotenz nicht generell, sondern macht sie präzise.
`docs/DECISION_LOG.md` enthält den vollständigen Root-Cause-Eintrag
("Phase 13 AP8: `evaluationFingerprint` fehlte `campaignVersionIds`").

**Zweiter, kleinerer Fix (Commit `c6be8b8`, kein Produktionsdefekt):**
CI #133 zeigte danach einen isolierten Playwright-Strict-Mode-Fehler nur im
`tablet-ipad-landscape`-Projekt in `admin-campaigns.spec.ts`. Ursache:
Playwright führt Desktop- und Tablet-Projekt parallel gegen dieselbe
Test-Datenbank/denselben Tenant aus; der Campaign-Key war bereits
projekt-/retry-eindeutig, der Anzeigename jedoch hartkodiert, wodurch zwei
Listeneinträge denselben Heading-Text erzeugten. Fix: Name analog zum Key
um `testInfo.project.name`/`testInfo.retry` ergänzt.

**Verifizierte Invariante nach dem Fix:** Campaign V1 aktiv →
Recommendation A → Signal referenziert V1. Campaign V2 veröffentlicht (V1
wird `EXPIRED`) → erneute Auswertung derselben Session erzeugt eine NEUE
Recommendation B mit Signal V2. Recommendation A und ihr Signal bleiben
dauerhaft unverändert bei V1 (append-only-Trigger auf
`recommendation_campaign_signals` bestätigt dies zusätzlich auf
DB-Ebene).

## 10. Notable Incident: `now`-vor-Lock-Nebenlaeufigkeitsdefekt in drei Publish-Workflows (AP10)

Der AP10-Commit selbst (`docs/ABSCHLUSSBERICHT_PHASE13.md`, rein
dokumentarisch) loeste CI #136 aus, das FEHLSCHLUG -- an einer Stelle, die
nichts mit dem Bericht zu tun hat: dem bestehenden AP2-Regressionstest
"zwei GLEICHZEITIGE Publish-Versuche fuer ZWEI VERSCHIEDENE
DRAFT-Versionen DERSELBEN Campaign" in
`tests/integration/campaign-admin.test.ts`. Root Cause:
`publishCampaignVersion()` (`campaign-admin.ts`) bestimmte
`const now = new Date()` VOR dem `db.$transaction()`-Aufruf, also VOR dem
Warten auf den Campaign-Row-Lock (`SELECT ... FOR UPDATE`). Bei echter
Nebenlaeufigkeit konnte die zweite, durch den Lock blockierte Transaktion
nach dessen Freigabe einen FRUEHEREN Zeitstempel besitzen als das
`validFrom`, das die erste Transaktion soeben gesetzt hatte. Der Versuch,
die frisch aktivierte Version mit diesem zu fruehen `validTo` zu expiren,
erzeugte einen ungueltigen Bereich (`validFrom > validTo`, Postgres-Fehler 22000) -- ein roher, von `translatePublishError()` nicht abgefangener
Fehler, genau das, was der Test verhindern soll.

**ChatGPT-Entscheidung (2026-08-30, verbindlich):** Echter
Nebenlaeufigkeits-Defekt, kein Testfehler, kein Flake. GO fuer den Fix
(Implementierung reparieren, Test unveraendert lassen) sowie fuer einen
zusaetzlichen, nicht-prophylaktischen projektweiten Audit desselben Musters
in allen anderen Draft-&gt;Publish-Workflows mit Row-Lock.

**Fix:** In allen drei betroffenen Funktionen wird `now = new Date()` jetzt
INNERHALB der Transaktion, UNMITTELBAR NACH dem erfolgreichen Erwerb des
jeweiligen Row-Locks bestimmt, statt davor:

- `publishCampaignVersion()` (`campaign-admin.ts`, Campaign-Row-Lock)
- `publishCommissionModelVersion()` (`commission-admin.ts`, Phase 10,
  CommissionModel-Row-Lock) -- identisches Muster im Audit gefunden,
  ebenfalls behoben
- `publishRuleSetVersion()` (`rule-admin.ts`, Phase 9, Tenant-Row-Lock) --
  identisches Muster im Audit gefunden, ebenfalls behoben

Kein Schema-Change, keine Aenderung an `translatePublishError()` noetig. Da
der jeweilige Row-Lock die Publish-Transaktionen bereits serialisiert, ist
ein danach bestimmter Zeitstempel garantiert monoton in
Serialisierungsreihenfolge.

**Audit-Ergebnis fuer die uebrigen Workflows:** `publishDraftVersion()`
(Fragebogen, `question-admin.ts`, Phase 8) verwendet KEINEN Row-Lock und
verlaesst sich ausschliesslich auf den EXCLUDE-Constraint als
Nebenlaeufigkeitsschutz -- es gibt keine Lock-Wartephase, in der ein vorab
bestimmter Zeitstempel veralten koennte, das Muster ist nicht anwendbar.
Goals (`goal-admin.ts`) haben keinen Draft-&gt;Publish-&gt;ACTIVE/EXPIRED-
Lebenszyklus, ebenfalls nicht anwendbar.

**Test:** Die drei bereits bestehenden Nebenlaeufigkeits-Regressionstests
(`campaign-admin.test.ts`, `commission-admin.test.ts`,
`rule-admin-publish.test.ts`) decken den Fix vollstaendig ab und wurden
unveraendert gelassen -- sie sind die Regression, die den jeweiligen Fix
beweist. Vollstaendiger Root-Cause- und Fix-Eintrag: `docs/DECISION_LOG.md`
("Phase 13 AP10: `publishCampaignVersion()` bestimmte `now` VOR statt NACH
dem Campaign-Row-Lock").

## 11. Audit und Reproduzierbarkeit

`RecommendationCampaignSignal` ist strukturell append-only: DB-Trigger
`recommendation_campaign_signals_append_only` (BEFORE UPDATE OR DELETE,
ruft `forbid_update_delete()`) verhindert jede nachträgliche Änderung oder
Löschung auf Datenbankebene, unabhängig vom Anwendungscode. Zusammen mit
dem AP8-Fingerprint-Fix ist damit sichergestellt, dass identische
Auswertungsinputs (inklusive aktivem Campaign-Zustand) deterministisch
dieselbe, unveränderte Recommendation liefern, während jede echte
Zustandsänderung (Campaign-Publish, Regel-/Provisions-/Zielwechsel) korrekt
eine neue Auswertung mit neuer, ebenfalls unveränderlicher Signal-Historie
erzeugt.

## 12. Admin-UI

`/admin/campaigns` (Listing + Erstellung über `CreateCampaignButton.tsx`)
und `/admin/campaigns/[id]/versions/[versionId]` (Detailseite) mit
`CampaignDraftEditor.tsx` (Bedingungs-Editor für die drei
`ConditionSourceType`-Quellen), `CampaignVersionActionsBar.tsx`
(Validate/Publish-Aktionen), `CampaignVersionHistoryPanel.tsx`
(Versionshistorie) und `CreateDraftCampaignVersionButton.tsx`. UI-Muster
und CSS-Ergänzungen (`globals.css`) folgen bewusst denselben Konventionen
wie Rules/Commissions/Goals (Phase 9–11).

## 13. Dokumentationsentscheidung (AP9)

`docs/PHASE_13_IMPLEMENTATION_PLAN.md` sah für AP9 ursprünglich eine
eigenständige `CAMPAIGN_MANAGEMENT.md` "analog RECOMMENDATION_ENGINE.md/
RULE_EDITOR.md" vor. Recherche vor der Umsetzung ergab: `RULE_EDITOR.md`
existiert nicht und hat nie existiert — Rules (Phase 9), Commissions
(Phase 10) und Goals (Phase 11) wurden nie als eigene lebende
Referenzdatei dokumentiert, sondern ausschließlich im jeweiligen
Abschlussbericht plus punktuellen `DATA_MODEL.md`/
`RECOMMENDATION_ENGINE.md`-Ergänzungen. Nach Abstimmung mit ChatGPT
(bestätigt: keine `CAMPAIGN_MANAGEMENT.md` anlegen) wurde stattdessen
`DATA_MODEL.md` aktualisiert (veralteter "Admin-Service/API/UI folgen in
AP2ff."-Satz durch den tatsächlichen AP0–AP8-Stand ersetzt) und
`RECOMMENDATION_ENGINE.md` um einen neuen Abschnitt "Campaign-
Priorisierung und Attribution" ergänzt (deckt `CAMPAIGN_ACTIVE`,
`ruleSetAt`/JETZT-Semantik, Attributionsregeln inkl. Dedup und
Cross-Selling-Lücke sowie den AP8-Fingerprint-Befund samt Fix ab).

## 14. Anzahl und Art aller Tests

Test-Gesamtbestand vor (`ff3ee76`) und nach (`961bb82`) Phase 13:

| Ebene                         | Dateien vorher → nachher                           | Testfälle (`it`/`test`) vorher → nachher        |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Unit                          | 42 → 42 (keine neue Datei, 5 bestehende erweitert) | —                                               |
| Integration                   | 32 → 38 (+6 neue Dateien)                          | —                                               |
| Unit + Integration gesamt     | —                                                  | 908 → 1019 (+111)                               |
| E2E (Playwright-Spec-Dateien) | 8 → 9 (+1)                                         | 22 → 28 (+6, je Desktop+Tablet-Projekt gezählt) |

**Geänderte Unit-Test-Dateien (bestehend, erweitert):**

| Datei                                              | Testfälle vorher → nachher |
| -------------------------------------------------- | -------------------------- |
| `tests/unit/recommendation/conditions.test.ts`     | 17 → 31 (+14)              |
| `tests/unit/recommendation/prioritization.test.ts` | 6 → 12 (+6)                |
| `tests/unit/authz/seed-role-permissions.test.ts`   | 17 → 19 (+2)               |
| `tests/unit/recommendation/fingerprint.test.ts`    | 21 → 23 (+2)               |
| `tests/unit/recommendation/cross-selling.test.ts`  | 5 → 6 (+1)                 |

**Neue Integrationstest-Dateien:**

| Datei                                                           | Testfälle |
| --------------------------------------------------------------- | --------- |
| `tests/integration/campaign-admin.test.ts`                      | 22        |
| `tests/integration/campaign-admin-version-routes.test.ts`       | 20        |
| `tests/integration/campaign-admin-routes.test.ts`               | 16        |
| `tests/integration/recommendation-campaign-active.test.ts`      | 9         |
| `tests/integration/recommendation-campaign-attribution.test.ts` | 8         |
| `tests/integration/recommendation-campaign-conflict.test.ts`    | 7         |

**Bestehende Integrationstest-Datei, erweitert:**
`tests/integration/rule-admin-validate.test.ts`: 15 → 19 (+4, `CAMPAIGN_ACTIVE`-Validierung, AP4).

**Neue E2E-Spec-Datei:** `tests/e2e/admin-campaigns.spec.ts` (6 Testfälle,
Desktop+Tablet-Playwright-Projekte, analog Goals/Rules/Commissions).

## 15. Vollständige Prüfkommandos mit Ergebnissen

Lokale Verifikation ist in diesem Sandbox-Setup auf Prettier-
Formatierungsprüfung (abhängigkeitsfreies Standalone-Tarball, kein `npm
install`) und `node --experimental-strip-types --check` für
`.ts`-Syntaxprüfung beschränkt (funktioniert nicht für `.tsx`). Die volle
`tsc`-Typprüfung und der komplette Test-Lauf (Unit/Integration/E2E gegen
echten PostgreSQL-Service-Container) laufen ausschließlich in GitHub
Actions CI — siehe Abschnitt 1 für alle 29 CI-Läufe der Phase, CI #138
(Commit `2ffef2f`) als letzter, vollständig grüner Lauf: alle Vitest-Unit-
und Integrationstests (1019 Testfälle über 80 Dateien, unveraendert
gegenueber CI #135 -- der AP10-Fix aenderte nur Implementierung, keine
Tests), alle 28 Playwright-E2E-Testläufe (Desktop + Tablet, 14 Testfälle ×
2 Projekte, 5m 35s Gesamtlaufzeit), `tsc --noEmit` ohne Fehler, ESLint
ohne Fehler, Prettier-Formatierung konsistent.

## 16. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat ff3ee76..2ffef2f -- . ':!package-lock.json'` (56 Dateien
geändert, 9536 Zeilen hinzugefügt, 34 Zeilen entfernt, keine
Dependency-Änderungen -- Differenz zur AP9-Zwischenzählung: 2 zusätzliche
Dateien (`commission-admin.ts`, `rule-admin.ts`) durch den in Abschnitt 10
dokumentierten AP10-Nebenläufigkeitsfix):

```
docs/ABSCHLUSSBERICHT_PHASE13.md                                            | 501 ++++++++++
docs/DATA_MODEL.md                                                          |  18 +-
docs/DECISION_LOG.md                                                        | 275 +++++++
docs/PHASE_13_DISCOVERY.md                                                  | 214 ++++++
docs/PHASE_13_IMPLEMENTATION_PLAN.md                                        | 267 +++++++
docs/RECOMMENDATION_ENGINE.md                                               |  64 +-
prisma/migrations/20260824180000_campaign_management/migration.sql         |  99 +++
prisma/migrations/20260830140000_campaign_active_condition_source_type/... |  13 +
prisma/schema.prisma                                                        | 109 ++-
prisma/seed-e2e.ts                                                          |  54 ++
prisma/seed.ts                                                              |   9 +
src/app/admin/campaigns/[id]/versions/[versionId]/page.tsx                 | 161 ++++
src/app/admin/campaigns/page.tsx                                            | 142 ++++
src/app/api/admin/campaigns/[id]/versions/[versionId]/publish/route.ts     |  46 ++
src/app/api/admin/campaigns/[id]/versions/[versionId]/route.ts             |  63 ++
src/app/api/admin/campaigns/[id]/versions/[versionId]/validate/route.ts    |  40 +
src/app/api/admin/campaigns/[id]/versions/route.ts                        |  67 ++
src/app/api/admin/campaigns/route.ts                                       |  57 ++
src/app/api/admin/campaigns/scope-options/route.ts                        |  51 ++
src/app/consultation/page.tsx                                              |  11 +
src/app/globals.css                                                        |  23 +
src/components/admin/CampaignDraftEditor.tsx                              | 395 ++++++++
src/components/admin/CampaignVersionActionsBar.tsx                        | 131 ++++
src/components/admin/CampaignVersionHistoryPanel.tsx                      |  61 ++
src/components/admin/CreateCampaignButton.tsx                             | 118 +++
src/components/admin/CreateDraftCampaignVersionButton.tsx                 | 120 +++
src/server/admin/campaign-admin-errors.ts                                 | 123 +++
src/server/admin/campaign-admin.ts                                        | 861 +++++++++++++
src/server/admin/campaign-schemas.ts                                       | 117 +++
src/server/admin/campaign-scope-options.ts                                |  65 ++
src/server/admin/commission-admin.ts                                      |  13 +-
src/server/admin/rule-admin.ts                                             |  48 +-
src/server/admin/rule-schemas.ts                                           |  11 +-
src/server/authz/config-permissions.ts                                    |  15 +-
src/server/authz/seed-role-permissions.ts                                 |  22 +-
src/server/consultation-ui/http-errors.ts                                 |  58 ++
src/server/recommendation/conditions.ts                                   | 102 ++-
src/server/recommendation/cross-selling.ts                                |  10 +-
src/server/recommendation/fingerprint.ts                                  |  22 +-
src/server/recommendation/prioritization.ts                               |  20 +-
src/server/recommendation/service.ts                                      | 135 ++-
src/server/recommendation/types.ts                                        |  20 +-
tests/e2e/admin-campaigns.spec.ts                                          | 376 +++++++
tests/e2e/seed-output.ts                                                   |  13 +-
tests/integration/campaign-admin-routes.test.ts                           | 477 ++++++++
tests/integration/campaign-admin-version-routes.test.ts                   | 583 ++++++++
tests/integration/campaign-admin.test.ts                                  | 693 ++++++++++
tests/integration/recommendation-campaign-active.test.ts                  | 516 ++++++++
tests/integration/recommendation-campaign-attribution.test.ts             | 679 ++++++++++
tests/integration/recommendation-campaign-conflict.test.ts                | 824 +++++++++++++
tests/integration/rule-admin-validate.test.ts                             | 157 ++++
tests/unit/authz/seed-role-permissions.test.ts                            |  30 +-
tests/unit/recommendation/conditions.test.ts                              | 255 +++-
tests/unit/recommendation/cross-selling.test.ts                           |  46 +-
tests/unit/recommendation/fingerprint.test.ts                             |  17 +
tests/unit/recommendation/prioritization.test.ts                          | 153 ++++
56 files changed, 9536 insertions(+), 34 deletions(-)
```

## 17. Vollständige bekannte Einschränkungen

- **Cross-Selling-Attribution-Lücke (bewusst, ChatGPT-Entscheidung
  2026-08-30):** eine `CrossSellingRule` kann seit AP4 ebenfalls über
  `CAMPAIGN_ACTIVE` matchen, erzeugt dabei aber bewusst KEIN
  `RecommendationCampaignSignal`, da `recommendation_campaign_signals`
  strukturell nur einen FK auf `RecommendationItem` vorsieht, nicht auf
  `RecommendationCrossSellingSignal`. Dokumentiert in
  `docs/DECISION_LOG.md` ("Phase 13 AP7 ..."); als späterer Nachtrag
  zurückgestellt, sobald ein konkreter Reporting-/Analytics-Bedarf dafür
  entsteht.
- **Kein Campaign-KPI-Dashboard:** AP7 liefert nur die
  Attributions-Datengrundlage (Signal-Tabelle + einfache Lesefunktion),
  bewusst keine Reporting-API oder KPI-Aggregation.
- **`CAMPAIGN_ACTIVE` folgt JETZT-Semantik, nicht Session-Pinning:** zwei
  identische `evaluate()`-Aufrufe derselben, noch laufenden Session können
  unterschiedliche `CAMPAIGN_ACTIVE`-Ergebnisse liefern, wenn zwischen den
  Aufrufen eine Campaign-Version veröffentlicht wird oder ihr
  Gültigkeitsfenster beginnt/endet — bewusstes, dokumentiertes Verhalten
  (siehe Abschnitt "AP4" in `docs/DECISION_LOG.md`), kein Bug.
- **Sandbox-Limitation:** lokale Verifikation ist auf Prettier + einfache
  Syntaxprüfung beschränkt; volle `tsc`/Testsuite-Verifikation läuft
  ausschließlich in CI. `api.github.com` ist im Sandbox-Netzwerk-Allowlist
  blockiert; CI-Status wurde für diesen Bericht per Browser-Scraping der
  gerenderten GitHub-Actions-Oberfläche verifiziert (siehe Abschnitt 1).
- **Massenlöschungs-Incident (vor AP1, siehe Abschnitt 8):** vollständig
  behoben, ohne Auswirkung auf späteren Anwendungscode, aber Teil der
  vollständigen Commit-Historie der Phase.

## 18. Explizit nicht implementierte Funktionen

- Cross-Selling-Campaign-Attribution (siehe Abschnitt 16).
- Campaign-KPI-/Reporting-Dashboard.
- Automatisierte Campaign-Terminierung/-Benachrichtigung außerhalb des
  bestehenden Publish-Workflows.
- Änderungen an Fragebogen-, Regel-, Provisions- oder Ziele-Modellen
  selbst — Phase 13 ist rein additiv (neuer `ConditionSourceType`-Wert,
  neue Tabellen, keine Änderung an bestehenden Verhaltensweisen dieser
  Domänen).

## 19. Fazit

Phase 13 (Campaign Management) ist mit AP0–AP9 vollständig umgesetzt:
Datenmodell, Admin-Service/-API/-UI, Regel-Integration
(`CAMPAIGN_ACTIVE`), Attributionskette (`RecommendationCampaignSignal`)
und Dokumentation. AP8 deckte einen echten, seit AP4 bestehenden
Reproduzierbarkeitsdefekt im Idempotenz-Fingerprint der
Recommendation-Engine auf, der korrekt durch eine Erweiterung der
bestehenden Fingerprint-Struktur (nicht durch Abschwächung des Tests)
behoben wurde — dieselbe Vorgehensweise, die bereits in früheren Phasen
etabliert war. Der AP10-Abschlussbericht-Commit selbst deckte einen
weiteren echten Nebenläufigkeitsdefekt auf (`now`-Zeitstempel vor statt
nach dem jeweiligen Row-Lock in `publishCampaignVersion()`), der bei einem
projektweiten, nicht-prophylaktischen Audit als identisches Muster auch in
zwei Phase-9/10-Publish-Workflows gefunden und dort ebenfalls sauber
behoben wurde, statt nur dokumentiert zu werden -- ein weiterer Beleg
dafür, dass Regressionstests in diesem Projekt ernst genommen und nicht
abgeschwächt werden. Der finale Commit `2ffef2f` ist durch CI #138
vollständig grün verifiziert (1019 Unit-/Integrationstests, 28
E2E-Testläufe, `tsc`, ESLint, Prettier). Offene, bewusst zurückgestellte
Punkte (Cross-Selling-Attribution, KPI-Dashboard) sind dokumentiert und
nicht Teil des Phase-13-Scopes.
