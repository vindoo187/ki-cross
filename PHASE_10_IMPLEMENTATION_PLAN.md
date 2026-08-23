# Phase 10 – Implementierungsplan: Provisionsmodell-Editor

Stand: 2026-08-21. Basiert auf `PHASE_10_DISCOVERY.md` (Commit
`e71c20b`) und ChatGPTs GO + fünf Architekturentscheidungen vom
2026-08-21 (siehe dortiges Zitat, hier als bindend übernommen). **Noch
kein Implementierungs-GO für AP1** — dieser Plan geht zunächst an
ChatGPT zur Prüfung, danach an den Nutzer zur expliziten Freigabe
(analog Phase 7/8/9).

## 0. Bindende Vorgaben aus AP0 (Zusammenfassung, siehe Discovery für Details)

1. **TIERED wird vollständig implementiert** (Abschnitt 4 unten für den
   konkreten Designvorschlag, noch zu bestätigen).
2. **Mehrere `CommissionModel`s pro Produkt bleiben erlaubt**, aber der
   bisherige technische Tie-Breaker ("kleinste `id` gewinnt") wird durch
   eine fachliche, explizite Regel ersetzt (Abschnitt 3).
3. **Traceability der verwendeten `CommissionModelVersion` bei Deals**
   wird ergänzt — **mit einer Korrektur zur ursprünglichen ChatGPT-
   Formulierung, siehe Abschnitt 1 unten (wichtig, vor Implementierung
   zu bestätigen).**
4. **RBAC**: `config.commissions.view/edit/publish`.
5. **Publish-Scope bleibt pro `CommissionModel`**, kein Tenant-Row-Lock
   ohne vorherigen Beweis eines echten Race (analog der Lehre aus Phase
   9 AP9).

## 1. Korrektur zu Entscheidung 3: Traceability gehört auf `DealItem`, nicht `DealFinancialSnapshot`

**Wichtiger Befund, der vor der Umsetzung mit ChatGPT abgestimmt werden
muss** (Regel: bei nachweislich besserer eigener Einschätzung aktiv
abstimmen, nicht einseitig abweichen):

ChatGPTs Formulierung war "`DealFinancialSnapshot` um eine Referenz auf
die tatsächlich verwendete `CommissionModelVersion` erweitern". Das
funktioniert jedoch nur, wenn ein Deal ausschließlich Items **eines
einzigen** Produkts enthält. Tatsächlich resolved
`deals/service.ts` (Zeile 153–163) die Provisions-Zeile **pro
`productId`** in eine `Map<productId, CommissionModelVersionRow |
null>` — ein Deal mit z. B. zwei verschiedenen Mobilfunk-Tarifen kann
zwei unterschiedliche `CommissionModelVersion`-Zeilen gleichzeitig
verwenden. Ein einzelnes skalares FK-Feld auf `DealFinancialSnapshot`
(einer Zeile pro **gesamtem** Deal) kann das nicht abbilden.

**Vorschlag**: die neue Spalte gehört stattdessen auf `DealItem`
(`commissionModelVersionId String? @map("commission_model_version_id")
@db.Uuid`, `onDelete: Restrict`, analog zum bestehenden
`RecommendationRationale.commissionModelVersionId`-Muster) — dort
existiert bereits ein `productVersionId`-Bezug pro Zeile, die
Zuordnung ist also natürlicherweise 1:1 pro Item. `DealFinancialSnapshot`
bleibt unverändert (reine Aggregat-Summe, wie heute). Dieser Punkt wird
ChatGPT vor Beginn von AP6 explizit zur Bestätigung vorgelegt.

## 2. Migrationen (neu in Phase 10, im Gegensatz zu Phase 8/9)

Anders als in Phase 8/9 (dort war das Zielschema bereits vollständig)
sind in Phase 10 **zwei Migrationen** absehbar:

- **AP4/AP-TIERED**: neue Tabelle für Provisions-Staffeln (Name/Struktur
  siehe Abschnitt 4), append-only-artig analog zu den bestehenden
  Condition-Tabellen aus Phase 9 (`EligibilityRuleCondition` etc.).
- **AP6**: `DealItem.commissionModelVersionId` (siehe Abschnitt 1) —
  nullable (historische, vor Phase 10 entstandene `DealItem`-Zeilen
  haben keinen Wert), FK mit `onDelete: Restrict`.

Beide Migrationen werden wie in allen Vorphasen lokal gegen PGlite
verifiziert (`scripts/verify_migration_upgrade_pglite.mjs`, bereits
etabliertes Muster), keine neue Tooling-Entscheidung nötig.

## 3. AP1 – RBAC + Commission-Admin-Grundlage

- `CONFIG_COMMISSIONS_PERMISSION_KEYS = ["config.commissions.view",
"config.commissions.edit", "config.commissions.publish"]` additiv zu
  `ALL_CONFIG_PERMISSION_KEYS` in `config-permissions.ts` (1:1-Muster
  aus Phase 9 AP1).
- `seed-role-permissions.ts`: `config_editor` → zusätzlich
  `config.commissions.view+edit`, `config_publisher` → zusätzlich
  `config.commissions.view+edit+publish` (additiv, keine neuen Rollen).
- Neues Modul `src/server/admin/commission-admin.ts` (analog
  `rule-admin.ts`/Frage-Pendant), zunächst nur Grundgerüst
  (Fehlerklassen in `commission-admin-errors.ts`, Zod-Schemas in
  `commission-schemas.ts`).

## 4. AP2 – CommissionModel-/Version-Management + Kardinalitäts-Regel

- API: Liste/Detail für `CommissionModel` je Tenant (mit allen
  Versionen), Draft-Erstellung (`copyFromVersionId` analog Phase 9 AP2
  — **inklusive** des in Phase 9 gefundenen Produktbugs als Lehre: der
  Button auf der Listenseite muss den `copyFromVersionId` der
  ACTIVE-Version korrekt übergeben, von Anfang an, nicht erst nach
  einem eigenen E2E-Befund).
- **Kardinalitäts-Regel (Entscheidung 2)**: beim Anlegen eines neuen
  `CommissionModel` für ein Produkt, das bereits ein `CommissionModel`
  besitzt, muss der Editor das bestehende `CommissionModel`
  **anzeigen und zur Wiederverwendung anbieten**, statt stillschweigend
  ein zweites zu erzeugen — die UI führt Nutzer aktiv zur bestehenden
  Versionshistorie. Serverseitig bleibt das Anlegen eines zweiten
  `CommissionModel` für dasselbe Produkt technisch weiterhin möglich
  (ChatGPT: "keine erzwungene 1:1-Beziehung"), aber `commission.ts`
  bekommt einen neuen, fachlich begründeten Tie-Breaker statt "kleinste
  `id`" — Vorschlag: bei mehreren gleichzeitig ACTIVE Zeilen für
  dasselbe Produkt wird das `CommissionModel` mit dem **zuletzt**
  gepublishten `validFrom` gewählt (jüngste Version gewinnt) statt
  eines technischen ID-Vergleichs. Dieser Vorschlag wird ChatGPT vor
  AP2-Umsetzung zur Bestätigung vorgelegt (fachliche Entscheidung, kein
  rein technischer Fix).

## 5. AP3 – Commission-Feld-CRUD (FLAT/PERCENTAGE, Grundgerüst für TIERED)

CRUD-Route für die drei bestehenden `CommissionModelVersion`-Felder
(`commissionType`, `commissionAmountMinor`,
`commissionPercentageBasisPoints`, `recurringCommissionAmountMinor`)
im DRAFT-Status, analog dem Update-Endpoint aus Phase 8 für
`QuestionnaireVersion`-Metadaten (kein eigener Regelbaum wie Phase 9,
da hier nur flache Skalarfelder + optional Tier-Zeilen).

## 6. AP4 – Validator + TIERED-Design (zur Bestätigung, nicht final)

**Designvorschlag für TIERED** (Umsetzung erst nach ChatGPT-
Bestätigung, da neue Fachlogik, kein reiner CRUD):

Neue Tabelle `CommissionTier`:

```
model CommissionTier {
  id                     String @id @default(uuid()) @db.Uuid
  tenantId               String @map("tenant_id") @db.Uuid
  commissionModelVersionId String @map("commission_model_version_id") @db.Uuid
  thresholdMinor         Int    @map("threshold_minor")   // untere Schwelle (inklusiv)
  tierAmountMinor        Int?   @map("tier_amount_minor")
  tierPercentageBasisPoints Int? @map("tier_percentage_basis_points")
  sortOrder              Int    @map("sort_order")

  commissionModelVersion CommissionModelVersion @relation(fields: [tenantId, commissionModelVersionId], references: [tenantId, id], onDelete: Cascade)

  @@unique([commissionModelVersionId, sortOrder])
  @@index([tenantId])
  @@map("commission_tiers")
}
```

- Nur relevant, wenn `commissionType = TIERED`.
- Auswertung analog `computeCommissionAmountMinor()`: gegen denselben
  `baseAmountMinor` (einmalig oder monatlich, wie heute bei
  `PERCENTAGE`) wird die **höchste** Schwelle gewählt, die
  `thresholdMinor <= baseAmountMinor` erfüllt; deren `tierAmountMinor`
  (fix) oder `tierPercentageBasisPoints` (prozentual auf
  `baseAmountMinor`) bestimmt den Betrag — pro Staffel wählbar fix
  ODER prozentual, nicht gemischt pro Zeile.
- Validierung: mindestens eine Stufe mit `thresholdMinor = 0`
  (Startstufe deckt jeden Betrag ab), aufsteigend eindeutige
  `thresholdMinor`-Werte, keine Lücken nötig (letzte passende Stufe
  gewinnt).
- Server-Validator (`validateCommissionModelVersion()`, neue Funktion,
  analog `validateDraftRuleSetVersion()` aus Phase 9): Pflichtfelder je
  `commissionType`, `currency`-Konsistenz, bei `TIERED` mindestens eine
  Stufe mit `thresholdMinor = 0`.

**Dieser gesamte Abschnitt ist ein Vorschlag, kein bereits fixierter
Beschluss** — ChatGPT bat um "klar definierte, serverseitig validierte,
deterministische Staffel-Logik", ohne die konkrete Datenstruktur
vorzugeben. Wird vor AP4-Umsetzung explizit vorgelegt.

## 7. AP5 – Publish (model-scoped)

- `publishCommissionModelVersion()`: EXPIRE der vorherigen ACTIVE-
  Version **desselben** `CommissionModel` (nicht mandantenweit, siehe
  Entscheidung 5), dann Ziel-Draft → ACTIVE, Audit — analog
  `publishDraftVersion()` (Phase 8-Muster, kein Tenant-Row-Lock).
- **Concurrency-Test**: ein gezielter Test mit zwei echt parallelen
  Publishes **unterschiedlicher** `CommissionModel`s (dürfen beide
  unabhängig erfolgreich sein) UND zwei parallelen Publishes
  **desselben** `CommissionModel`s (der bestehende EXCLUDE-Constraint
  muss hier greifen) — explizit bewiesen, nicht nur angenommen (Lehre
  aus Phase 9 AP9).
- Publish-Konflikt-Mapping auf 409 analog `translatePublishError()`
  aus Phase 9, hier für den Constraint-Namen
  `commission_model_versions_no_overlap`.

## 8. AP6 – Deal-Historisierung (`DealItem.commissionModelVersionId`)

- Migration aus Abschnitt 2 (nach Bestätigung von Abschnitt 1).
- `deals/service.ts`: beim Erzeugen der `DealItem`-Zeilen wird die
  bereits vorhandene `commissionRowByProductId`-Map (Zeile 155–163)
  genutzt, um pro Item die passende `commissionModelVersionId`
  mitzuschreiben — **keine Änderung** an `closedAt`-Semantik oder
  `computeDealFinancialSnapshot()` (Aggregat-Formel v1 bleibt
  unangetastet).
- Regressionstest: bestehende `deals-service.test.ts`/
  `financial-snapshot.test.ts` müssen unverändert grün bleiben, neue
  Tests prüfen zusätzlich die korrekte `commissionModelVersionId` je
  Item (inkl. Fall "kein aktives Provisionsmodell" → `null`).

## 9. AP7 – Audit/Regression

Analog Phase 8 AP7/Phase 9 AP7: Nachweis, dass jede Mutation
(Create/Update/Delete/Publish/Rollback) über die tatsächlichen
UI-/API-Pfade einen korrekten `AuditLog`-Eintrag erzeugt. Zusätzlich:
Regressionstest, dass die Recommendation Engine (`session.startedAt`-
Pinning) und die Deal-Erfassung (`closedAt`) durch den neuen
Publish-Workflow **nicht** in ihrem Zeitbezug verändert werden
(explizite Leitplanke aus AP0, siehe Discovery Abschnitt 2).

## 10. AP8 – Admin-UI

Analog Phase 9 (`RuleDraftEditor`/`RuleVersionActionsBar`/
`RuleVersionHistoryPanel`), hier aber ein flaches Formular
(`CommissionDraftEditor`) statt Regelbaum: Feldgruppen je
`commissionType` (FLAT/PERCENTAGE zeigen die drei Beträge, TIERED zeigt
eine editierbare Stufenliste), Validate/Publish-Bar, Historie-Panel mit
Rollback — 1:1 wiederverwendbares UI-Muster.

## 11. AP9 – E2E/Security/Regression

Playwright-Suite `tests/e2e/admin-commissions.spec.ts`, Desktop +
Tablet, **von Anfang an** mit href-/ID-basierter Referenzierung
historischer Versionen (nicht Label-basiert) — direkte Anwendung der
Phase-9-Lehre, nicht erst nach einem eigenen Befund. Deckt ab: RBAC,
Tenant-Isolation/IDOR, Draft→Validate→Publish→Historie→Rollback,
TIERED-Editor-Interaktion, paralleles Publish (Concurrency), Deal-
Erfassung mit historisierter `commissionModelVersionId`.

## 12. AP10 – Abschlussbericht Phase 10

Analog dem Muster aus `ABSCHLUSSBERICHT_PHASE9.md`.

## 13. Explizit NICHT Teil von Phase 10 (Non-Scope, aus Discovery Abschnitt 7)

- Produktkombinationen ("bestimmte Kombination = Bonus").
- Mindestmarge als Publish-/Auswahl-Bedingung (Provisions- und
  Margen-Berechnung bleiben unabhängige Berechnungen).
- Kampagnenbonus (`Campaign`/`CampaignVersion` bleiben ungenutzt,
  Gegenstand der späteren Phase "Campaign-Management").
- Ziele-Modell, Freitext-KI (spätere, bereits vom Nutzer bestätigte
  Folgephasen).

## 14. ChatGPT-Rückmeldung zu den drei offenen Punkten (2026-08-21, alle GO, mit Präzisierungen)

**Punkt 1 — `DealItem.commissionModelVersionId`: GO, unverändert
übernommen.** Zusätzliche Vorgaben: FK referenziert die konkret
verwendete Version, wird bei der Deal-Erfassung **atomar** mit der
Provisionsermittlung geschrieben (dieselbe Transaktion wie
`dealItem.createMany()`), die historische Referenz wird **niemals**
nachträglich neu aufgelöst. `DealFinancialSnapshot` bleibt unverändert
als reines Aggregat, `DealItem.productVersionId` bleibt zusätzlich
bestehen.

**Punkt 2 — `CommissionTier`: GO, mit Präzisierung der Validierung.**
Pro Tier-Zeile ist **genau eines** von `tierAmountMinor` oder
`tierPercentageBasisPoints` gesetzt (nicht "eines von beiden
optional", sondern exklusiv — Validator muss das erzwingen).
Zusätzliche verbindliche Validierungsregeln: `thresholdMinor >= 0`,
keine doppelten Schwellen innerhalb einer Version, `sortOrder`
eindeutig und konsistent aufsteigend mit `thresholdMinor`, mindestens
eine Stufe, **erste Stufe zwingend `thresholdMinor = 0`**, Änderungen
nur an DRAFT-Versionen möglich. `CommissionTier` gehört immer zu genau
einer `CommissionModelVersion` — ältere Versionen (und die Deals, die
sie referenzieren) behalten dadurch unverändert ihre eigene
Berechnungsgrundlage, auch wenn eine neuere Version andere Staffeln
definiert.

**Punkt 3 — Tie-Breaker: GO für die Grundidee, aber verschärft.**
Nicht nur `validFrom DESC`, sondern **`validFrom DESC, id DESC`** als
deterministischer zweiter Tie-Breaker (falls zwei `CommissionModel`s
exakt denselben `validFrom`-Zeitpunkt haben, wäre eine reine
`validFrom`-Sortierung nicht eindeutig). Zusätzlich explizit
festgehalten (unverändert gegenüber Discovery Abschnitt 2, hier nur
noch einmal ausdrücklich bestätigt): `evaluationTime` ist bei der
Deal-Ermittlung `closedAt`, bei der Recommendation Engine
`session.startedAt` — diese Zeitsemantik wird durch den neuen
Tie-Breaker nicht verändert.

**Explizites GO für AP1** unter diesen drei Präzisierungen. Damit ist
dieser Implementierungsplan aus ChatGPT-Sicht implementierungsreif.

## 15. Finaler Regel-Katalog (verbindlich für AP1ff., konsolidiert aus Abschnitt 14)

| Thema                                   | Entscheidung                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Historische Commission-Version          | FK auf `DealItem`, atomar mit Provisionsermittlung geschrieben, nie nachträglich neu aufgelöst                        |
| `DealFinancialSnapshot`                 | unverändert, bleibt reines Aggregat                                                                                   |
| TIERED                                  | eigene `CommissionTier`-Tabelle, gehört zu genau einer `CommissionModelVersion`                                       |
| Tier-Berechnung                         | höchste Schwelle `<= baseAmountMinor` gewinnt                                                                         |
| Tier-Basis                              | genau `tierAmountMinor` ODER `tierPercentageBasisPoints`, nie beide/keins                                             |
| Mindest-Tier                            | `thresholdMinor = 0` als erste Stufe zwingend                                                                         |
| Weitere Tier-Validierung                | `thresholdMinor >= 0`, keine doppelten Schwellen, `sortOrder` eindeutig + konsistent aufsteigend, nur DRAFT mutierbar |
| `CommissionModel`-Auswahl (Tie-Breaker) | `ORDER BY validFrom DESC, id DESC LIMIT 1`                                                                            |
| Deal-Zeitpunkt                          | `closedAt` (unverändert)                                                                                              |
| Recommendation-Zeitpunkt                | `session.startedAt` (unverändert)                                                                                     |

## 16. Nächster Schritt

Dieser Plan geht jetzt an den Nutzer zur expliziten Implementierungs-
GO-Freigabe für AP1 — analog dem etablierten Muster aus Phase 7/8/9
(ChatGPT-GO allein startet noch keinen Code, der Nutzer muss zusätzlich
explizit zustimmen).
