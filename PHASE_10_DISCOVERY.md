# Phase 10 – Discovery: Provisionsmodell-Editor (CommissionModel/CommissionModelVersion)

Stand: 2026-08-21. Analysephase, **keine Implementierung** (analog
`PHASE_8_DISCOVERY.md`/`PHASE_9_DISCOVERY.md`). ChatGPT-Vorschlag
(2026-08-21, nach Abwägung von vier Optionen — Ziele-Modell,
Provisionsmodell-Editor, Campaign-Management, Freitext-KI-Angebot):
Phase 10 = Provisionsmodell-Editor als nächster vertikaler Slice nach
Phase 9 (Regel-Editor), weil die Architektur dafür bereits vorbereitet
ist (`CommissionModelVersion` existiert seit Phase 3B) und er die
wirtschaftliche Steuerung des Verkaufsprozesses komplettiert. Vom
Nutzer bestätigte Folge-Reihenfolge: Provisionsmodell-Editor →
Ziele-Modell → Freitext-KI → Campaign-Management (jeweils als eigene,
saubere Phase, nicht parallel).

## 1. Vorhandener CommissionModel-/CommissionModelVersion-Stand

Das Datenmodell ist bereits vollständig (seit Phase 3B), aber —
identisch zum Zustand vor Phase 8/9 — **ausschließlich über
`prisma/seed.ts` beschrieben, kein Schreibpfad im Code**
(`grep -rn "commissionModel\.create\|commissionModelVersion\.create"
src/` — 0 Treffer, nur in `prisma/seed.ts`).

**Struktur** (`prisma/schema.prisma`, Zeilen 557–600):

- `CommissionModel` (`id`, `tenantId`, `productId`, `name`) — reiner
  Container, referenziert genau ein `Product`. **Kein** `@@unique` auf
  `[tenantId, productId]` — schema-seitig sind mehrere
  `CommissionModel`-Zeilen für dasselbe Produkt nicht ausgeschlossen
  (siehe Abschnitt 3, bereits im Code-Kommentar von
  `src/server/pricing/commission.ts` als bekannte Unschärfe
  dokumentiert).
- `CommissionModelVersion` (`VersionStatus` DRAFT/ACTIVE/EXPIRED/
  ARCHIVED, `validFrom`/`validTo`) — hält pro Version: `commissionType`
  (`CommissionType`-Enum: `FLAT`/`PERCENTAGE`/`TIERED`), `currency`,
  `commissionAmountMinor` (einmalig), `commissionPercentageBasisPoints`,
  `recurringCommissionAmountMinor` (wiederkehrend).
- Referenziert von `RecommendationRationale.commissionModelVersionId`
  (optionaler FK, append-only-Snapshot je Empfehlung) — **nicht** von
  `DealItem`/`Deal` direkt (siehe Abschnitt 6, Traceability-Lücke).

**Publish-Scope: pro `CommissionModel`, NICHT mandantenweit.** Der
EXCLUDE-Constraint `commission_model_versions_no_overlap`
(`prisma/migrations/20260731000000_init/migration.sql`, Zeile 961–964)
ist über `tenant_id` UND `commission_model_id` definiert — strukturell
identisch zum `ProductVersion`-/`ProductCostVersion`-Muster (Phase
6/8-artig), **nicht** zum mandantenweiten `RuleSetVersion`-Muster aus
Phase 9. Für den Provisionsmodell-Editor bedeutet das: Publish-Logik
kann sich am Phase-8-Muster (`publishDraftVersion()` für
`QuestionnaireVersion`, entity-weiter Scope) orientieren, **nicht** am
Phase-9-Tenant-Row-Lock-Muster — es sei denn, ChatGPT entscheidet sich
bewusst für eine andere Semantik (siehe offene Entscheidung 1).

## 2. Bestehende Business-Logik (bereits produktiv, wird durch Phase 10 NICHT ersetzt)

`src/server/pricing/commission.ts` (Phase 6 AP3, aus
`recommendation/service.ts` herausgelöst, siehe dortiger
Modulkommentar) ist die zentrale, bereits von zwei Aufrufern geteilte
Resolution-Schicht:

- `loadActiveCommissionModelVersions(client, atTime)` — lädt alle zum
  Zeitpunkt `atTime` ACTIVE `CommissionModelVersion`-Zeilen.
- `buildResolveCommission(rows)` — löst pro `productId` **genau eine**
  Zeile auf; existieren mehrere gleichzeitig gültige Zeilen für
  dasselbe Produkt (durch die fehlende Unique-Constraint aus Abschnitt
  1 möglich), wird deterministisch die mit der lexikographisch
  kleinsten `id` gewählt — ein bewusster, aber technischer statt
  fachlicher Tie-Breaker (siehe Abschnitt 3).
- `computeCommissionAmountMinor(row, baseAmountMinor, fixedAmountMinor)`
  — berechnet den konkreten Minor-Betrag; bei `PERCENTAGE` über
  `commissionPercentageBasisPoints` auf `baseAmountMinor`, sonst wird
  `fixedAmountMinor` unverändert durchgereicht.

**Zwei unabhängige Aufrufer, mit unterschiedlichem Zeitbezug (bereits
bewusst so entschieden, siehe `docs/DECISION_LOG.md` Phase-9-AP9-Eintrag
zur RuleSetVersion-Timing-Korrektur — CommissionModelVersion war davon
ausdrücklich NICHT betroffen):**

1. **Recommendation Engine** (`recommendation/service.ts`, Zeile 568):
   `commercialAt = session.startedAt` — Provisions-Auflösung bleibt für
   die gesamte Dauer einer Beratung auf den Session-Start gepinnt
   (identisch zu `ProductVersion`). Ergebnis fließt nur informativ in
   `RecommendationRationale` ein, noch **ohne** finalen Verkaufspreis
   (`commissionValueMinor` bei `PERCENTAGE` bewusst `null`).
2. **Deal-Erfassung** (`deals/service.ts`, Zeile 123/153):
   `closedAt = new Date()` — Provisions-Auflösung erfolgt zum
   tatsächlichen Abschlusszeitpunkt, nicht gepinnt. Hier ist der finale
   Preis bekannt, `computeCommissionAmountMinor()` liefert daher auch
   bei `PERCENTAGE` einen konkreten Betrag
   (`deals/financial-snapshot.ts`, `computeDealFinancialSnapshot()`).

Für Phase 10 wichtig: **beide bestehenden Konsumenten dürfen durch
einen neuen Publish-Workflow nicht in ihrem Zeitbezug verändert
werden** — der Editor fügt nur einen Schreibpfad hinzu, die bereits
etablierte, mehrfach getestete Leseseite bleibt unangetastet.

## 3. Lücke 1: `CommissionType.TIERED` ist im Enum definiert, aber nirgends implementiert

`grep -rn "TIERED" src/` liefert **0 Treffer** außerhalb der
Enum-Definition selbst (`prisma/schema.prisma` Zeile 73–77). Weder
`computeCommissionAmountMinor()` noch irgendeine andere Stelle
unterscheidet `TIERED` von `FLAT` — beide fallen im Code auf denselben
`else`-Zweig (`fixedAmountMinor` unverändert durchreichen). Auch in
`prisma/seed.ts` wird ausschließlich `CommissionType.FLAT` verwendet
(4 Vorkommen, alle vier Produkt-Provisionsmodelle im Seed sind FLAT).
`PERCENTAGE` ist zwar implementiert, aber ebenfalls nie geseedet.

**Das ist eine zu klärende Scope-Frage, kein Bug**: Phase 10 kann
`TIERED` entweder (a) im Editor bewusst nicht anbieten und den
Enum-Wert unverändert als "reserviert, noch nicht implementiert" stehen
lassen, oder (b) eine echte Staffel-Logik (z. B. zusätzliche
Konditions-/Schwellenwert-Tabelle) einführen. Das wäre eine
substanziell größere Erweiterung als ein reiner CRUD-Editor über die
bestehenden drei Felder — siehe offene Entscheidung 2.

## 4. Lücke 2: fehlende Eindeutigkeit CommissionModel ↔ Product

Wie in Abschnitt 1/2 erwähnt: `CommissionModel` hat keinen
`@@unique([tenantId, productId])`. Das ist im Bestand harmlos (Seed
legt genau ein `CommissionModel` je Produkt an), wird aber für einen
Editor **wesentlich**, sobald Nutzer selbst neue `CommissionModel`-
Zeilen anlegen können: ohne UI-/Server-seitige Beschränkung könnten pro
Produkt versehentlich mehrere unabhängige `CommissionModel`-"Container"
mit jeweils eigener Versionshistorie entstehen, deren Auflösung dann
weiterhin dem technischen "kleinste `id`"-Tie-Breaker aus
`buildResolveCommission()` unterläge — für ein Admin-Werkzeug
schwer nachvollziehbar. Empfehlung für den Implementierungsplan: Phase
10 sollte entweder (a) den bestehenden Tie-Breaker durch eine fachlich
sinnvollere/explizitere Regel ersetzen, oder (b) serverseitig
durchsetzen, dass pro Produkt höchstens ein `CommissionModel`
existiert (ggf. sogar per neuer Unique-Constraint) — siehe offene
Entscheidung 3.

## 5. Wiederverwendbare Phase-8/9-Admin-Infrastruktur (hohe Wiederverwendbarkeit)

Strukturell sehr eng am Phase-8/9-Muster aufsetzbar:

- **RBAC**: `src/server/authz/config-permissions.ts` ist bereits
  bewusst so gebaut, dass ein dritter Permission-Block additiv
  ergänzt werden kann (`CONFIG_QUESTIONS_PERMISSION_KEYS` +
  `CONFIG_RULES_PERMISSION_KEYS` → `ALL_CONFIG_PERMISSION_KEYS`).
  Analoge Erweiterung um `CONFIG_COMMISSIONS_PERMISSION_KEYS =
["config.commissions.view", "config.commissions.edit",
"config.commissions.publish"]` folgt exakt demselben Muster wie
  Phase 9 AP1 (additive Erweiterung von `config_editor`/
  `config_publisher`, keine neuen Rollen, TENANT-Scope,
  Deny-by-default) — siehe `seed-role-permissions.ts` Zeile 27–30 für
  das dortige Vorbild.
- **Versionierungs-Zustandsmaschine**: DRAFT → Validate → Publish →
  EXPIRE-vorherige-ACTIVE-Version → Audit, identisch zu Phase 8
  (`publishDraftVersion()`), da der Scope entity-weit ist (Abschnitt
  1. — der Tenant-Row-Lock aus Phase 9 ist hier voraussichtlich NICHT
     nötig (kein mandantenweiter Constraint).
- **Rollback/Historie**: `getXVersionHistory()`/`rollbackToXVersion()`
  aus Phase 8/9 (Deep-Copy einer historischen Version als neuer Draft)
  ist 1:1 übertragbar.
- **Admin-UI-Muster**: Liste → Detail/Editor → Validate/Publish-Bar →
  Historie-Panel (`RuleDraftEditor.tsx`/`RuleVersionActionsBar.tsx`/
  `RuleVersionHistoryPanel.tsx` aus Phase 9 als direkte Vorlage, hier
  aber ein flaches Formular statt eines Regelbaum-Editors — vermutlich
  einfacher als Phase 9, näher an Phase 8).
- **E2E-Teststruktur**: `tests/e2e/admin-rules.spec.ts` als Vorlage,
  inklusive der in Phase 9 hart erarbeiteten Lehren zur Testisolation
  bei parallelen Playwright-Projekten (href-/ID-basierte Referenzierung
  statt Label/Substring, siehe `docs/ABSCHLUSSBERICHT_PHASE9.md`
  Abschnitt 8) — sollte von Anfang an so gebaut werden, nicht erst nach
  einem eigenen Befund.
- **Audit**: `AuditLog`-Infrastruktur (`action:"CREATE"/"UPDATE"/
"DELETE"/"ACTIVATE"/"ROLLBACK"`) unverändert wiederverwendbar.

## 6. Lücke 3: keine Deal-seitige Traceability, welche CommissionModelVersion tatsächlich verwendet wurde

`DealFinancialSnapshot` (Abschnitt "Deal" im Schema) speichert nur
aggregierte Minor-Beträge (`commissionAmountMinor`,
`expectedRecurringCommissionMinor`) über alle `DealItem`s hinweg —
**keine** Referenz auf die dabei verwendete(n)
`CommissionModelVersion`-Zeile(n). Anders als bei
`RecommendationRationale.commissionModelVersionId` (append-only-
Snapshot je Empfehlung) lässt sich bei einem abgeschlossenen Deal im
Nachhinein nicht mehr direkt nachvollziehen, welches Provisionsmodell
in welcher Version tatsächlich abgerechnet wurde — nur der berechnete
Minor-Betrag ist bekannt. Das ist vermutlich **kein Blocker** für einen
reinen Provisionsmodell-Editor (der ändert nichts an
`DealFinancialSnapshot`), sollte aber als bekannte Einschränkung im
Implementierungsplan benannt werden, falls spätere Phasen (z. B.
Provisions-Auszahlungsreports) darauf aufbauen wollen — siehe offene
Entscheidung 4.

## 7. Geschäftliche Anforderungen aus ChatGPTs Options-Skizze — was heute abgebildet werden kann

Aus ChatGPTs Beispielliste ("O2-Vertrag = X €, DSL = Y €, Gerät = Z €,
Zusatzoption = X €, bestimmte Kombination = Bonus, Mindestmarge
erforderlich, Kampagnenbonus"):

| Anforderung                                             | Heute abbildbar?                                                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixer Betrag je Produkt (einmalig/wiederkehrend)        | Ja — `FLAT`, vollständig implementiert                                                                                                                                                                                            |
| Prozentualer Betrag je Produkt                          | Ja — `PERCENTAGE`, vollständig implementiert                                                                                                                                                                                      |
| Staffelung (z. B. ab Stückzahl/Umsatz höhere Provision) | Nein — `TIERED` nicht implementiert (Abschnitt 3)                                                                                                                                                                                 |
| Gültigkeitszeitraum / Versionierung                     | Ja — `validFrom`/`validTo`/`VersionStatus`, vollständig vorhanden                                                                                                                                                                 |
| Bestimmte Produktkombination = Bonus                    | Nein — `CommissionModel` ist strikt 1:1 an ein einzelnes `Product` gebunden, kein Konzept für Produktkombinationen                                                                                                                |
| Mindestmarge als Voraussetzung                          | Nein — Provisions-Auflösung (`commission.ts`) und Margen-Berechnung (`financial-snapshot.ts`) sind vollständig unabhängige Berechnungen ohne gegenseitige Bedingung                                                               |
| Kampagnenbonus                                          | Nein — `Campaign`/`CampaignVersion` existieren im Schema (Zeile 624ff.), sind aber komplett ungenutzt (0 Treffer in `src/`) — das wäre Gegenstand der später geplanten Phase "Campaign-Management" (Option C), nicht dieser Phase |

Für den Implementierungsplan wichtig: die drei "Nein"-Zeilen
(Staffelung, Produktkombinationen, Mindestmarge-Bedingung,
Kampagnenbonus) sind **deutlich größere fachliche Erweiterungen** als
ein CRUD-Editor über die bestehenden drei `CommissionModelVersion`-
Felder. ChatGPTs eigener Vorschlag betonte "Provisionen/Margen werden
konfigurierbar" — die Discovery empfiehlt, Phase 10 zunächst strikt auf
**Administration der bereits implementierten `FLAT`/`PERCENTAGE`-Felder**
zu begrenzen (analog dem Phase-9-Ansatz, zunächst den vorhandenen
Baum administrierbar zu machen statt einen visuellen Regel-Baukasten
zu bauen) und die "Neins" explizit als Non-Scope zu benennen — siehe
offene Entscheidung 2/5.

## 8. Risikoanalyse

- **Keine Schema-/Migrationsänderung zwingend erforderlich** für einen
  reinen CRUD-Editor über die drei bestehenden `CommissionModelVersion`-
  Felder (`commissionType`, `commissionAmountMinor`,
  `commissionPercentageBasisPoints`, `recurringCommissionAmountMinor`) —
  identisch zur Erkenntnis aus Phase 9 AP0 (RuleSet-Datenmodell war
  bereits vollständig). Eine Migration wird nur nötig, falls
  Entscheidung 3 (Unique-Constraint `CommissionModel`↔`Product`) oder
  Entscheidung 2 (`TIERED`-Implementierung) positiv beschlossen werden.
- **Bestehende Berechnungen (Recommendation Engine, Deal-Erfassung)
  dürfen nicht gefährdet werden** — beide Aufrufer sind bereits
  produktiv und gut getestet (`tests/unit/pricing/commission.test.ts`,
  `tests/unit/deals/financial-snapshot.test.ts`,
  `tests/integration/deals-service.test.ts`,
  `tests/integration/recommendation-engine.test.ts`). Ein neuer
  Publish-Workflow darf deren Zeitbezug (Abschnitt 2) nicht verändern —
  reine Ergänzung eines Schreibpfads, keine Änderung der Leseseite.
- **Parallelität beim Publish**: da der Scope pro `CommissionModel`
  (nicht mandantenweit) ist, ist die in Phase 9 AP9 aufwendig
  bewiesene Tenant-Row-Lock-Notwendigkeit hier vermutlich nicht
  einschlägig — der bestehende EXCLUDE-Constraint sollte (wie beim
  strukturell identischen `ProductVersion`/`ProductCostVersion`) für
  sich genommen ausreichen. Diese Annahme sollte in AP1ff. dennoch mit
  einem gezielten Test bewiesen werden, nicht nur angenommen (Lehre aus
  Phase 9 AP9: "erst beweisen, dann als sicher betrachten").
- **Rückwärtskompatibilität historischer Deals/Recommendations**: Da
  `RecommendationRationale.commissionModelVersionId` bereits ein Snapshot
  ist und `DealFinancialSnapshot` nur aggregierte Beträge speichert
  (Abschnitt 6), sind historische Daten durch neue Publishes nicht
  gefährdet — Publish erzeugt neue Versionen, ändert nie bestehende
  Zeilen (append-only-Prinzip, identisch zu Phase 8/9).
- **Tenant-Isolation**: `CommissionModel`/`CommissionModelVersion` sind
  bereits vollständig tenant-scoped (`tenantId` auf beiden Modellen,
  zusammengesetzte FKs) — kein neues Risiko, reine Fortführung des
  etablierten Musters.

## 9. Vorläufige Einschätzung für die nächste Stufe (nicht bindend)

Der Provisionsmodell-Editor kann strukturell sehr eng am
Phase-8-Muster (nicht Phase-9-Muster) gebaut werden: entity-weiter statt
mandantenweiter ACTIVE-Scope, kein Tenant-Row-Lock zu erwarten, flaches
Formular statt Regelbaum-Editor — vermutlich der bisher einfachste
Admin-Slice. Vier Punkte sollten vor dem Implementierungsplan explizit
mit ChatGPT/Nutzer geklärt werden:

1. **`TIERED`-Scope** (Abschnitt 3): implementieren oder bewusst
   auslassen?
2. **Non-Scope-Bestätigung** (Abschnitt 7): Produktkombinationen,
   Mindestmarge-Bedingung, Kampagnenbonus explizit NICHT Teil von
   Phase 10?
3. **CommissionModel-Kardinalität** (Abschnitt 4): striktes 1:1 zu
   Product erzwingen (ggf. neue Unique-Constraint + Migration), oder
   bestehenden Tie-Breaker unverändert lassen und nur dokumentieren?
4. **Deal-Traceability-Lücke** (Abschnitt 6): für Phase 10 explizit
   Non-Scope, oder soll `DealItem`/`DealFinancialSnapshot` um eine
   `commissionModelVersionId`-Referenz ergänzt werden (wäre eine
   Migration, zusätzlicher Scope über den reinen Editor hinaus)?
5. **RBAC-Namenskonvention** (Abschnitt 5): `config.commissions.*` (an
   Modellnamen orientiert) oder `config.pricing.*` (an fachlichem
   Bereich orientiert, würde später ggf. auch `ProductVersion`/
   `ProductCostVersion`-Administration mit umfassen können)?

Diese Discovery wird ChatGPT zur Prüfung vorgelegt, bevor daraus ein
`PHASE_10_IMPLEMENTATION_PLAN.md` entsteht.
