# Abschlussbericht Phase 10 – Provisionsmodell-Editor (CommissionModel/CommissionModelVersion)

Stand: 2026-08-22. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (gleiches Prinzip wie in den Abschlussberichten der Vorphasen).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Commit-Verlauf dieser Phase** (`git log --oneline c0814d7..4ac16f9`,
`c0814d7` = Berichts-Commit Phase 9):

| Commit    | Inhalt                                                                        |  CI-Lauf   |    Ergebnis     |
| --------- | ------------------------------------------------------------------------------ | :--------: | :--------------: |
| `e71c20b` | AP0 – Discovery (`PHASE_10_DISCOVERY.md`, keine Implementierung)              |   CI #63   |   **Success**    |
| `042450b` | Implementierungsplan (Entwurf)                                                |  gebündelt¹ |         –         |
| `0be45af` | Implementierungsplan mit ChatGPT-Präzisierungen finalisiert                   |  gebündelt¹ |         –         |
| `c4612b3` | AP1 – RBAC (`config.commissions.view/edit/publish`) + Admin-Grundgerüst       |   CI #64   |   **Success**    |
| `3ba2958` | AP2 – CommissionModel-/Version-Management + Kardinalitäts-Tie-Breaker         |   CI #65   |   **Failure**    |
| `103c982` | Fix CI #65 – `Provider.key`-Kollision in `commission-admin.test.ts`           |   CI #66   |   **Success**    |
| `31cd9d9` | AP3 – Commission-Feld-CRUD (FLAT/PERCENTAGE)                                  |   CI #67   |   **Failure**    |
| `072dc72` | Fix CI #67 – fehlender echter User in AP3-Feld-CRUD-Tests (Audit-FK)          |   CI #68   |   **Success**    |
| `3917de6` | AP4 – TIERED-Provisionsstaffeln vollständig implementiert                     |   CI #69   |   **Failure**    |
| `9391c99` | Fix CI #69 – Test-Helper überschrieb explizites `commissionAmountMinor:null`  |   CI #70   |   **Success**    |
| `a300d2c` | AP5 – Publish-Workflow (model-scoped) für `CommissionModelVersion`            |   CI #71   |   **Success**    |
| `78ce007` | AP6 – Deal-Historisierung (`DealItem.commissionModelVersionId`)               |   CI #72   |   **Success**    |
| `14a3b82` | AP7 – Audit/Reproduzierbarkeit – zielgerichtete Beweisführung                 |   CI #73   |   **Success**    |
| `31f52d8` | AP8 – Admin-UI für Provisionsmodelle                                          |   CI #74   |   **Success**    |
| `e302d07` | AP9 – E2E Desktop+Tablet für Provisionsmodelle                                |   CI #75   |   **Failure**    |
| `4ac16f9` | AP9-Fix – Row-Lock in `createDraftCommissionModelVersion()` gegen Race        | **CI #76** | **Success**       |

¹ `042450b`/`0be45af` (reine Dokumentationscommits, keine Code-Änderung)
wurden zusammen mit `c4612b3` in einem Push übertragen – CI lief einmal auf
dem damaligen `HEAD` (`c4612b3` = CI #64), nicht separat je Commit
(Trigger `on: push`, nicht `on: commit`).

Maßgeblich für den technischen Nachweis dieser Phase ist **CI #76** auf
dem finalen Stand `4ac16f9` – dieser Lauf deckt den gesamten kumulierten
Codestand von AP0 bis AP9 ab (837 Tests über vier Ebenen, davon 38/38
E2E-Tests Desktop+Tablet, siehe Abschnitt 10/11). Vier Zwischenläufe (CI
#65, #67, #69, #75) schlugen fehl – **alle waren echte, von CI gefundene
Bugs, keine Sandbox-Artefakte**; Root Causes und Fixes siehe Abschnitt 7/8.
`git status` zum Zeitpunkt der Fertigstellung dieses Berichts: sauber bis
auf die für diesen Bericht gehörenden Dokumentationsänderungen und die
seit Phase 7/8/9 bekannten untracked Altlasten (Abschnitt 13).

## 1. Technische Versionen

Unverändert gegenüber Phase 9 – **keine neuen Abhängigkeiten** in Phase 10
(`git diff --stat c0814d7..4ac16f9 -- package.json package-lock.json`
liefert keine Treffer):

- Node.js: `>=20.11 <23` (`package.json` `engines.node`)
- Paketmanager: npm (`packageManager: "npm@10.9.4"`)
- Next.js: `^15.5.22`
- React / React-DOM: `^19.2.8`
- Prisma / `@prisma/client`: `^6.19.3`
- Zod: `^3.25.76`
- TypeScript: `^5.9.3`
- Vitest: `^3.2.7`, `@playwright/test`: `^1.62.1`
- ESLint: `^9.19.0`, Prettier: `^3.4.2`

## 2. Ausgangslage und Ziel der Phase

Phase 10 = Provisionsmodell-Editor (`CommissionModel`/
`CommissionModelVersion`), die erste von vier vom Nutzer bestätigten
Folgephasen (Reihenfolge: **Provisionsmodell-Editor → Ziele-Modell →
Freitext-KI-Angebot → Campaign-Management**, jeweils eigene, saubere
Phase, nicht parallel).

**AP0-Kernbefunde** (`PHASE_10_DISCOVERY.md`, 280 Zeilen):

1. `CommissionModel`/`CommissionModelVersion`-Schema seit Phase 3B
   vollständig, kein Schreibpfad im Code – identische Ausgangslage wie
   Phase 8/9.
2. Publish-Scope ist **pro `CommissionModel`** (EXCLUDE-Constraint über
   `tenant_id`+`commission_model_id`) – Phase-8-Muster, ausdrücklich
   NICHT mandantenweit wie `RuleSetVersion` in Phase 9. Dies ist der
   zentrale strukturelle Unterschied zu Phase 9 (Abschnitt 4).
3. Zwei bestehende Konsumenten mit bewusst unterschiedlichem Zeitbezug
   bleiben unverändert: Recommendation Engine pinnt Provisionsauflösung
   auf `session.startedAt`, Deal-Erfassung nutzt `closedAt = new Date()`.
4. Vier Lücken identifiziert und in dieser Phase geschlossen:
   `CommissionType.TIERED` im Enum definiert, aber unimplementiert (AP4);
   keine deterministische Auflösung bei mehreren `CommissionModel`s pro
   Produkt (AP2); `DealFinancialSnapshot`/`DealItem` ohne Referenz auf die
   tatsächlich verwendete `CommissionModelVersion` (AP6); RBAC-Namen noch
   offen (AP1).

**ChatGPTs GO + 5 Architekturentscheidungen (2026-08-21, verbindlich für
den Implementation Plan):**

1. **TIERED wird vollständig implementiert** (nicht verschoben) – klar
   definierte, serverseitig validierte, deterministische Staffel-Logik.
2. **Mehrere `CommissionModel`s pro Produkt bleiben zulässig**, aber der
   bisherige rein technische Tie-Breaker musste durch eine fachlich
   saubere, deterministische Regel ersetzt werden (`ORDER BY validFrom
   DESC, id DESC`) – keine erzwungene 1:1-Beziehung zu `Product`.
3. **`DealItem` wird um eine Referenz auf die tatsächlich verwendete
   `CommissionModelVersion` erweitert** – Begründung: Revisions-/
   Controlling-/Debugging-Fähigkeit für abgeschlossene Deals. Eigene,
   aktiv mit ChatGPT abgestimmte Korrektur: die Traceability gehört auf
   `DealItem` (nicht auf `DealFinancialSnapshot`, wie ChatGPT ursprünglich
   formuliert hatte) – ein Deal kann mehrere Produkte mit
   unterschiedlichen `CommissionModelVersion`-Zeilen haben, ein skalares
   FK-Feld auf dem Aggregat kann das nicht abbilden. **ChatGPT: GO,
   Korrektur bestätigt.**
4. **RBAC-Namenskonvention: `config.commissions.*`** (view/edit/publish),
   nicht `config.pricing.*`.
5. **Publish-Scope bestätigt: pro `CommissionModel`, nicht mandantenweit**
   – Phase-9-Tenant-Row-Lock-Muster wird NICHT 1:1 übernommen, nur bei
   Bedarf durch einen gezielten Concurrency-Test bewiesen (Lehre aus
   Phase 9 AP9: "erst beweisen, dann als sicher betrachten").

**Zusätzliche Leitplanke:** die beiden unterschiedlichen Zeitsemantiken
(Recommendation = `session.startedAt`, Deal = `closedAt`) durften durch
Phase 10 nicht angeglichen/verändert werden – bewusst bestehende,
fachlich korrekte Asymmetrie.

## 3. Umfang dieser Phase (AP0–AP9)

- **AP0** – Discovery (`PHASE_10_DISCOVERY.md`).
- **Implementierungsplan** (`PHASE_10_IMPLEMENTATION_PLAN.md`, 294
  Zeilen): ChatGPT-GO mit drei eigenen, aktiv abgestimmten
  Korrekturen/Präzisierungen (Regel: "nur bei nachweislich besserer
  eigener Einschätzung aktiv abstimmen, nie einseitig abweichen") – siehe
  Abschnitt 2, Punkt 3; konkretes `CommissionTier`-Tabellendesign
  (ChatGPT: GO, mit Präzisierung – exklusiv `tierAmountMinor` ODER
  `tierPercentageBasisPoints`, erste Stufe zwingend `thresholdMinor=0`,
  nur DRAFT mutierbar); Tie-Breaker verschärft zu `ORDER BY validFrom
  DESC, id DESC` (statt reiner `validFrom`-Sortierung, wegen möglicher
  exakter Zeitgleichheit).
- **AP1** – RBAC `config.commissions.*` additiv zu den bestehenden
  `config_editor`/`config_publisher`-Rollen, `commission-admin.ts`-
  Grundgerüst.
- **AP2** – CommissionModel-/Version-Management: Liste, Detail,
  Draft-Erstellung, Kardinalitäts-Tie-Breaker. `copyFromVersionId` ist
  **per-Entity-Scope** (muss zum selben `CommissionModel` gehören, das
  Gegenteil von Phase 9s `RuleSetVersion`).
- **AP3** – Commission-Feld-CRUD (FLAT/PERCENTAGE), DRAFT-only, Audit
  atomar in derselben Transaktion.
- **AP4** – Serverseitiger Validator + vollständiges TIERED-Design
  (`CommissionTier`-Tabelle, Tier-CRUD, nicht-progressive
  Staffelberechnung).
- **AP5** – Publish-Workflow (model-scoped), inkl. `CommissionModel`-
  Row-Lock (ChatGPTs explizite AP5-Vorgabe, siehe Abschnitt 4).
- **AP6** – Deal-Historisierung: `DealItem.commissionModelVersionId`.
- **AP7** – Audit-/Reproduzierbarkeitsnachweis der gesamten
  Mutationskette AP1–AP6, gezielte Beweisführung ohne neuen
  Feature-Scope.
- **AP8** – Admin-UI für Provisionsmodelle (`/admin/commissions`,
  `CommissionDraftEditor`, `CommissionVersionActionsBar` mit
  MODELL-gescoptem Publish-Hinweis, `CommissionVersionHistoryPanel`,
  `CreateDraftCommissionModelVersionButton`).
- **AP9** – E2E/Security/Regression (Desktop+Tablet), inkl. des in
  Abschnitt 7 beschriebenen echten Concurrency-Bugs und dessen Fix.

Von ChatGPT final abgenommen am 2026-08-22 auf Basis von CI #76 ("AP9
final abgenommen — GO. ✅ [...] Damit ist die Implementierung des
Provisionsmodell-Editors als vertikaler Slice vollständig abgeschlossen.").

## 4. Architektur: model-scoped Draft → Validate → Publish

**Zustandsmaschine** (`VersionStatus` auf `CommissionModelVersion`,
identisch zum Phase-8/9-Enum):

```
DRAFT --validate()--> DRAFT (mit Validierungsergebnis, keine Statusänderung)
DRAFT --publish()--> ACTIVE (vorherige Version DESSELBEN CommissionModel -> EXPIRED)
```

**Kernunterschied zu Phase 9 (RuleSetVersion):** `publishCommissionModelVersion()`
sucht die vorherige ACTIVE-Version **MIT** `commissionModelId`-Filter –
bewusst, weil der DB-EXCLUDE-Constraint
`commission_model_versions_no_overlap` über `tenant_id`+
`commission_model_id` definiert ist (Phase-8-Muster). Ein Draft eines
`CommissionModel` zu veröffentlichen beendet ausschließlich die aktuell
aktive Version DESSELBEN `CommissionModel` – ein zweites `CommissionModel`
desselben Mandanten bleibt unangetastet. Diese Semantik war die zentrale,
bereits in AP0 identifizierte Anforderung und wurde in AP9 durch einen
dedizierten Cross-Model-E2E-Test bewiesen (Abschnitt 8).

**Transaktionsreihenfolge** in `publishCommissionModelVersion()` (AP5):

```
0. CommissionModel-Row-Lock:
   SELECT id FROM commission_models WHERE id = $1 AND tenant_id = $2 FOR UPDATE
a. vorherige ACTIVE-Version DESSELBEN CommissionModel (falls vorhanden) -> EXPIRED (validTo = now)
b. Ziel-Draft per updateMany({where:{id,status:"DRAFT"}}) -> ACTIVE
   (Race-Guard: count !== 1 wirft, gesamte Transaktion rollt zurück)
c. AuditLog (action:"ACTIVATE", commissionModelId+previousActiveVersionId in metadata)
```

Der `CommissionModel`-Row-Lock war von Anfang an (AP5, ChatGPTs explizite
Vorgabe) Teil des Publish-Workflows, mit zwei Regressionstests bewiesen
(Cross-Model-Unabhängigkeit + echter paralleler Publish desselben
Models). **Genau dieses Muster fehlte ursprünglich bei der
Draft-Erstellung** (`createDraftCommissionModelVersion()`) – der in AP9
gefundene Concurrency-Bug (Abschnitt 7).

**Publish-Konflikt-Mapping:** `translatePublishError()` (in
`commission-admin.ts`, exportiert für Tests) erkennt ausschließlich den
bekannten Constraint-Namen `commission_model_versions_no_overlap` in der
rohen Prisma-Fehlermeldung und übersetzt nur diesen einen Fall in
`CommissionModelVersionPublishConflictError` (HTTP 409); jeder andere
Fehler wird unverändert weitergeworfen – identisches Prinzip wie Phase 9.

**Bewusste Abweichung vom ursprünglichen Plan-Vorschlag:** FK
`CommissionTier → CommissionModelVersion` nutzt `onDelete: Restrict`
statt `Cascade` (schemaweite Konvention, die übrigen FKs nutzen
überwiegend Restrict; Tiers existieren nur unter mutabler DRAFT-Version,
`deleteCommissionTier()` ist echtes Hard-Delete). ChatGPT wurde explizit
informiert und hat mit vollem "GO für AP5" ohne Einwand reagiert.

## 5. Schema-/Migrationsänderungen

Zwei neue Migrationen in Phase 10 (`git diff --stat c0814d7..4ac16f9 --
'prisma/migrations/*'`: 2 Dateien, 59 Zeilen):

- `20260821190000_commission_tiers` (AP4): neue Tabelle `CommissionTier`
  (FK auf `CommissionModelVersion`, `onDelete: Restrict`,
  `thresholdMinor >= 0`-Check, UNIQUE `(commissionModelVersionId,
  thresholdMinor)` + `(commissionModelVersionId, sortOrder)`, XOR-Check
  `tierAmountMinor`/`tierPercentageBasisPoints`).
- `20260822000000_deal_item_commission_model_version` (AP6):
  `DealItem.commissionModelVersionId` (nullable, FK `(tenant_id,
  commission_model_version_id) → commission_model_versions (tenant_id,
  id) ON DELETE RESTRICT`).

`scripts/verify_migration_pglite.mjs` wurde um 129 Zeilen erweitert:
neue PGlite-Verifikationsfälle für beide Migrationen (u. a. FK-Ablehnung
bei nicht existierender `CommissionModelVersion`, NULL-Fall für
`DealItem` ohne Provisionsmodell, XOR-Check/UNIQUE-Constraints der
`CommissionTier`-Tabelle).

## 6. TIERED-Design (AP4)

`commissionTypeSchema` um `TIERED` erweitert. Berechnungslogik
(`computeCommissionAmountMinor()`, `src/server/pricing/commission.ts`)
ist **nicht-progressiv**: die Stufe mit dem höchsten `thresholdMinor <=
baseAmountMinor` gewinnt, ihr Satz gilt für den GESAMTEN Betrag (keine
gestaffelte Teilberechnung wie bei progressiven Steuersätzen). Mindestens
eine Stufe mit `thresholdMinor = 0` ist zwingend (deckt jeden Betrag ab).
`validateCommissionModelVersion()` (`commission-validator.ts`) prüft den
vollständigen zusammengeführten Zustand inkl. aller `CommissionTier`-
Kindzeilen: keine doppelten Schwellen, eindeutiger `sortOrder`, genau
eines von `tierAmountMinor`/`tierPercentageBasisPoints` pro Stufe, TIERED-
Version darf keine Skalarfelder (Amount/Percentage) gleichzeitig gesetzt
haben. Kern-Test-Matrix mit 3 Stufen (0/1.000/2.500 Minor-Einheiten) und
allen Grenzfällen (exakt auf Schwelle, zwischen Schwellen, unter erster
Schwelle) verifiziert in `tests/unit/pricing/commission.test.ts`.

## 7. Der Concurrency-Bug in createDraftCommissionModelVersion() (AP9, CI #75/#76)

**Ausgangspunkt:** die neue E2E-Testsuite (`tests/e2e/admin-commissions.spec.ts`)
enthielt u. a. einen Test "paralleles Publish zweier Entwürfe DESSELBEN
CommissionModel: genau eine Version endet ACTIVE" – zwei **echt**
parallele Draft-Erstellungen (`POST .../versions`, `Promise.all()`, kein
sequentielles `await`) für DASSELBE `CommissionModel`, gefolgt von zwei
parallelen Publishes.

**CI #75 – Befund:** 36/38 Tests grün, 1 Test dauerhaft fehlgeschlagen
(beide Playwright-Versuche), 1 weiterer Test flaky (1. Versuch Timeout,
Retry grün). Fehlerhafter Test: `expect(createB.ok()).toBe(true)` erhielt
`false`. WebServer-Log zeigte den eigentlichen Fehler:

```
Error [PrismaClientKnownRequestError]: Invalid `commissionModel.findUnique()` invocation
Unique constraint failed on the fields: (tenant_id, commission_model_id, version_number)
code: 'P2002'
```

Der flaky zweite Test (TIERED-Hauptfluss) lief im selben "2 workers"-Lauf
zufällig zeitgleich mit dem Concurrency-Test auf demselben
`commissionModelId` – sein eigener Draft-Create-Request geriet dadurch in
denselben Race und einen hängenden Zustand; ohne den parallelen
Concurrency-Test lief er beim Retry sauber in 1,6s durch.

**Root-Cause-Beweisführung (ChatGPT-Konsultation, "erst beweisen, dann
fixen", identisches Vorgehen wie Phase 9 AP9):** ChatGPT forderte
zunächst den vollständigen Fehlerblock aus CI #75 statt nur einer
Zusammenfassung, um selbst zwischen Produktbug, Testbug und
Testisolationsproblem zu unterscheiden. Nach Vorlage des vollständigen
Logs bestätigte ChatGPT die Diagnose: `createDraftCommissionModelVersion()`
ermittelt die nächste `versionNumber` per `tx.commissionModelVersion.
findFirst({orderBy: {versionNumber: "desc"}})` + 1 **innerhalb** der
Transaktion, aber **ohne** vorherigen Row-Lock auf das `CommissionModel`
– im Unterschied zu `publishCommissionModelVersion()` (AP5), das exakt
diesen Lock bereits als ersten Transaktionsschritt hat. Unter READ
COMMITTED lesen zwei parallele Aufrufe für dasselbe `CommissionModel`
denselben `MAX(versionNumber)`, bevor einer committet – beide versuchen
dieselbe nächste Nummer zu vergeben, die zweite Transaktion scheitert am
UNIQUE-Constraint statt sauber die nächste freie Nummer zu erhalten.

**ChatGPTs GO für den Fix (2026-08-22):** "Freigegebener Fix [...] `SELECT
id FROM commission_models WHERE id = ? AND tenant_id = ? FOR UPDATE` [...]
Damit wird nur das betreffende CommissionModel serialisiert." Explizite
Auflage: der bestehende E2E-Test darf NICHT gelockert oder seriell
geschaltet werden ("Er hat genau den richtigen Fehler gefunden"). Der Lock
darf ausdrücklich NICHT auf Tenant-Ebene erfolgen (anders als Phase 9s
`createDraftRuleSetVersion()` – die analoge Frage, ob dort dieselbe
Lücke besteht, bleibt ausdrücklich außerhalb dieses Phase-10-Slices,
nur als möglicher späterer Hardening-Punkt vorgemerkt, Phase 9 wird
jetzt NICHT rückwirkend verändert).

**Fix (`4ac16f9`):** identisches Row-Lock-Muster wie AP5, als erste
Operation der bestehenden `$transaction` in
`createDraftCommissionModelVersion()`, vor der `versionNumber`-Ermittlung:

```ts
await tx.$queryRaw`SELECT id FROM commission_models WHERE id = ${commissionModelId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
```

Zwei neue Integrationstests in `tests/integration/commission-admin.test.ts`:
(1) Regressionstest – zwei echt parallele Draft-Erstellungen DESSELBEN
`CommissionModel` sind BEIDE erfolgreich, erhalten unterschiedliche
`versionNumber` (2 und 3), genau 2 DRAFT-Zeilen, genau 2 Audit-Einträge;
(2) Gegenprobe – zwei echt parallele Draft-Erstellungen für
VERSCHIEDENE `CommissionModel`s sind BEIDE erfolgreich und blockieren
sich nicht gegenseitig (jeweils `versionNumber` 2, kein unnötiger
tenant-weiter Lock).

**Ergebnis:** CI #76 (`4ac16f9`) – 38/38 E2E-Tests grün (Desktop +
Tablet), vollständige Pipeline grün, 3m55s. ChatGPTs finale Bewertung:
"Der in CI #75 gefundene Fehler war tatsächlich ein Produktionsrace bei
der Versionnummernvergabe und wurde mit dem korrekten model-scoped Row
Lock behoben. Damit ist die technische Ursache beseitigt, nicht nur das
Symptom."

## 8. E2E-Testsuite AP9 (Desktop+Tablet)

`tests/e2e/admin-commissions.spec.ts` (422 Zeilen, 7 Testfälle, analog
Phase 9s `admin-rules.spec.ts`), gegen beide Playwright-Projekte
(`desktop-chromium`, `tablet-ipad-landscape`) ausgeführt:

1. **RBAC:** `config.commissions.view` gewährt Zugriff auf Liste +
   modellgescopten Hinweistext (explizit geprüft: Hinweis enthält NICHT
   "GESAMTEN Mandanten" – der wichtigste Unterschied zu Phase 9).
2. **Kein Zugriff ohne `config.commissions.view`** (normaler Mitarbeiter)
   – "Kein Zugriff"-Seite.
3. **Publish ohne `config.commissions.publish`** nicht möglich, aber der
   modellgescopte Publish-Hinweis bleibt sichtbar.
4. **Tenant-Isolation/IDOR:** kein Zugriff auf einen fremden Tenant über
   manipulierte `CommissionModel`-/Versions-IDs.
5. **Vollständiger Happy Path:** DRAFT bearbeiten (TIERED, inkl.
   Stufenverwaltung) → Validate → Publish → alte Version read-only →
   Historie → "Neuen Entwurf aus dieser Version erstellen" aus der
   historischen Version → Validate → Publish. Href-basierte
   Versions-Referenzierung von Anfang an (proaktive Anwendung der
   Phase-9-Lehre, keine Text-/Label-Matching-Fehler wie in Phase 9 AP9
   nötig).
6. **Model-scoped-Publish-Regressionstest:** Publish ersetzt NUR dieses
   `CommissionModel` – ein zweites `CommissionModel` desselben Mandanten
   bleibt während des gesamten Ablaufs unverändert (ACTIVE-Anzahl bleibt
   exakt 1).
7. **Concurrency-Test:** paralleles Publish zweier Entwürfe DESSELBEN
   `CommissionModel` – genau eine Version endet ACTIVE (dieser Test
   deckte in AP9 den in Abschnitt 7 beschriebenen Draft-Creation-Bug auf,
   nicht den Publish selbst).

`prisma/seed-e2e.ts` wurde entsprechend erweitert: neue
`config.commissions.*`-Permission-Keys im globalen Katalog, ein zweites
`CommissionModel` für Tenant A (für den model-scoped-Test), ein
`CommissionModel` für Tenant B (für den negativen Tenant-Isolationstest).

Bewusst NICHT auf E2E-Ebene dupliziert: Deal-Reproduzierbarkeit (bereits
auf Integrationsebene in AP6/AP7 mit direktem DB-Zugriff bewiesen; keine
Admin-UI exponiert `DealFinancialSnapshot`-Werte, ein UI-Only-Nachweis
wäre auf dieser Ebene nicht möglich – `deal-closure.spec.ts` deckt den
Deal-Abschluss-UI-Flow bereits ab).

## 9. Audit/Reproduzierbarkeit (AP7)

Gezielte Beweisführung ohne neuen Feature-Scope, analog Phase 9 AP7:
Audit-Re-Prüfung aller Mutationspfade (CREATE/UPDATE/DELETE/ACTIVATE in
`commission-admin.ts`) bestätigt, dass jede Mutation Audit atomar in
derselben Transaktion schreibt und `tenantId`/`actorUserId`
ausschließlich aus Server-Kontext stammen. Zentraler
Reproduzierbarkeitstest (in `tests/integration/deals-service.test.ts`):
Version 1 (FLAT) → Deal schließen → Version 2 desselben `CommissionModel`
publishen (Version 1 dadurch EXPIRED) → Version 1 AUSSCHLIESSLICH über
die auf dem `DealItem` gespeicherte `commissionModelVersionId`
rekonstruiert → `computeCommissionAmountMinor()` liefert exakt den bei
Deal-Abschluss persistierten `DealFinancialSnapshot`-Betrag. Multi-Item-
Deals mit unterschiedlichen `CommissionModelVersion`s pro `DealItem`
(FLAT/PERCENTAGE/TIERED) sowie der Beweis, dass ein späteres Publish die
historische Zuordnung eines bereits geschlossenen Deals NICHT verändert,
sind ebenfalls über `deals-service.test.ts` abgedeckt (AP6).

## 10. Anzahl und Art aller Tests

Vier Testebenen, insgesamt **837 Testfälle** (721 aus Phase 9 + 116 neu
in Phase 10), grep-basiert gezählt (`grep -crE '^\s*it\(|^\s*test\('` je
Datei, konsistent mit der Zählmethode der Vorphasen-Berichte):

| Ebene                                    | Phase 9 | Neu in Phase 10 | Gesamt Phase 10 | Neue Dateien                                                                                                                                                          |
| ----------------------------------------- | ------: | ---------------: | ----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`npm run test:unit`)                |     341 |               27 |               368 | `tests/unit/admin/commission-admin-publish-error-mapping.test.ts` (6, neu); erweitert: `pricing/commission.test.ts` (+16, TIERED-Matrix), `authz/config-permissions.test.ts` (+5), `authz/seed-role-permissions.test.ts` (+3) |
| Component (`npm run test:component`)      |     117 |                0 |               117 | keine neuen Component-Tests in Phase 10                                                                                                                                |
| Integration (`npm run test:integration`)  |     251 |               82 |               333 | `tests/integration/commission-admin.test.ts` (73, neu), `commission-admin-validate-route.test.ts` (4, neu); erweitert: `deals-service.test.ts` (+5, Deal-Historisierung/Reproduzierbarkeit) |
| E2E (`npm run test:e2e`)                  |      12 |                7 |                19 | `tests/e2e/admin-commissions.spec.ts` (7, neu)                                                                                                                          |
| **Gesamt**                                | **721** |          **116** |           **837** |                                                                                                                                                                          |

**Inhalt der zentralen neuen Testdateien** (ausschließlich echte
Postgres-/Playwright-Fixtures, kein Mocking der DB-Schicht):

- `commission-admin.test.ts` (2.277 Zeilen, 73 Testfälle) – der
  vollständige Lebenszyklus: RBAC, CommissionModel-/Version-CRUD,
  Feld-CRUD, Tier-CRUD, Validator, Publish-Workflow (inkl. der beiden
  in Abschnitt 7 beschriebenen Concurrency-Regressionstests + der
  Cross-Model-Regressionstests aus AP5), Audit-Atomarität,
  Tenant-Isolation.
- `commission-admin-validate-route.test.ts` (218 Zeilen, 4 Testfälle) –
  HTTP-Route-Ebene für `POST .../validate` (AP8).
- `deals-service.test.ts` (erweitert um 377 Zeilen, +5 neue Testfälle) –
  Deal-Historisierung, Multi-Item-Unabhängigkeit, Reproduzierbarkeit
  über EXPIRED-Versionen (AP6/AP7).
- `commission-admin-publish-error-mapping.test.ts` (104 Zeilen, 6
  Testfälle) – deterministischer `translatePublishError()`-Unit-Test.
- `pricing/commission.test.ts` (erweitert um 176 Zeilen, +16 neue
  Testfälle) – TIERED-Berechnungslogik, 3-Stufen-Grenzfallmatrix.
- `tests/e2e/admin-commissions.spec.ts` (422 Zeilen, 7 Testfälle) – siehe
  Abschnitt 8.

## 11. Vollständige Prüfkommandos mit Ergebnissen

| Kommando                                                            | Ergebnis                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` (Stand `4ac16f9`)                                       | sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen und die bekannten untracked Altlasten (Abschnitt 13)                                                                                     |
| `npx tsc --noEmit`                                                    | 45 Fehler, durchgängig identisch zur bekannten stale-Prisma-Client-Baseline (fehlende `commissionTier`/`commissionModelVersionId`/`passwordHash`-Felder + `AuditAction.DELETE`, unverändert seit Phase 8/9 durch `prisma generate` ohne Netzwerkzugriff) – keine neuen Fehlerkategorien, nach jedem Fix in dieser Phase gegen die gespeicherte Baseline diffgeprüft |
| `npx eslint <geänderte Dateien>`                                      | durchgängig sauber                                                                                                                                                                                                    |
| `npx prettier --check <geänderte Dateien>`                            | durchgängig sauber                                                                                                                                                                                                    |
| `npx vitest run` (alle vier Testebenen)                               | in dieser Sandbox nicht ausführbar (bekannte, sandboxweite `@rollup/rollup-linux-arm64-gnu`-Limitierung, unverändert seit Phase 2) – Verifikation ausschließlich über CI                                            |
| GitHub Actions (`vindoo187/ki-cross/actions`, via Claude-in-Chrome)   | CI #63–#76 (Details Commit-Tabelle, Kopf des Berichts); **CI #76 (`4ac16f9`): Success, 3m 55s** – maßgeblicher Nachweis für diese Phase                                                                            |

**CI #76 im Detail:** vollständiger Lauf über den kumulierten Codestand
AP0–AP9, deckt ab: Lint/Prettier/`tsc` sauber, Migrationen gegen echte
Postgres-Test-DB angewendet, alle 818 Unit-/Component-/Integrationstests
grün, Produktions-Build (`next build`) erfolgreich, Playwright-E2E-Tests
**38/38 grün auf beiden Projekten** (Desktop + Tablet), keine Regression
in Phase 2–9.

**Sandbox-Einschränkung dieser Sitzung (unverändert seit Phase 2):** `npx
vitest run` konnte in dieser Sandbox nicht direkt ausgeführt werden. Die
tatsächliche Ausführung aller 837 Testfälle ist ausschließlich über die
CI-Läufe #63–#76 belegt, deren Status über Claude-in-Chrome-Browserzugriff
auf die GitHub-Actions-Oberfläche ausgelesen wurde (clientseitig
gerenderte Seite, daher kein statischer `WebFetch`-Abruf). `tsc`/
`eslint`/`prettier` wurden in dieser Sitzung nach jedem einzelnen Fix
tatsächlich lokal ausgeführt. Zusätzlich neu in dieser Sitzung
festgestellt: `npx vitest run` schlägt in dieser Sandbox nicht nur mit
403 fehl (bereits aus Phase 2 bekannt für `prisma generate`), sondern mit
`Error: Cannot find module '@rollup/rollup-linux-arm64-gnu'` – ein
separates, npm-Optional-Dependency-bedingtes Problem auf arm64-Linux,
ebenfalls ohne Auswirkung auf CI (x86-Runner).

## 12. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat c0814d7..4ac16f9` (`c0814d7` = Berichts-Commit Phase 9,
`4ac16f9` = letzter Commit dieser Phase): **42 Dateien geändert, 7.732
Zeilen hinzugefügt, 71 Zeilen entfernt.**

```
PHASE_10_DISCOVERY.md                                                     |  280 + (neu)
PHASE_10_IMPLEMENTATION_PLAN.md                                           |  294 + (neu)
prisma/migrations/20260821190000_commission_tiers/migration.sql          |   41 + (neu)
prisma/migrations/20260822000000_deal_item_commission_model_version/
  migration.sql                                                            |   18 + (neu)
prisma/schema.prisma                                                      |   93 +-
prisma/seed-e2e.ts                                                        |   87 +-
prisma/seed.ts                                                            |    8 +
scripts/verify_migration_pglite.mjs                                       |  129 +-
src/app/admin/commissions/[id]/versions/[versionId]/page.tsx              |  169 + (neu)
src/app/admin/commissions/page.tsx                                       |  137 + (neu)
src/app/api/admin/commission-models/[id]/versions/[versionId]/publish/
  route.ts                                                                 |   47 + (neu)
src/app/api/admin/commission-models/[id]/versions/[versionId]/route.ts   |   62 + (neu)
src/app/api/admin/commission-models/[id]/versions/[versionId]/tiers/
  [tierId]/route.ts                                                        |   59 + (neu)
src/app/api/admin/commission-models/[id]/versions/[versionId]/tiers/
  route.ts                                                                 |   44 + (neu)
src/app/api/admin/commission-models/[id]/versions/[versionId]/validate/
  route.ts                                                                 |   39 + (neu)
src/app/api/admin/commission-models/[id]/versions/route.ts               |   59 + (neu)
src/app/api/admin/commission-models/route.ts                              |   26 + (neu)
src/app/globals.css                                                       |   18 +
src/components/admin/CommissionDraftEditor.tsx                           |  522 + (neu)
src/components/admin/CommissionVersionActionsBar.tsx                     |  135 + (neu)
src/components/admin/CommissionVersionHistoryPanel.tsx                   |   63 + (neu)
src/components/admin/CreateDraftCommissionModelVersionButton.tsx         |  158 + (neu)
src/server/admin/commission-admin-errors.ts                              |  128 + (neu)
src/server/admin/commission-admin.ts                                     |  948 + (neu)
src/server/admin/commission-schemas.ts                                   |  124 + (neu)
src/server/admin/commission-validator.ts                                 |  158 + (neu)
src/server/authz/config-permissions.ts                                   |   49 +-
src/server/authz/seed-role-permissions.ts                                |   22 +-
src/server/consultation-ui/http-errors.ts                                |   54 +
src/server/deals/service.ts                                              |   43 +-
src/server/pricing/commission.ts                                         |  100 +-
src/server/recommendation/service.ts                                     |    7 +-
tests/e2e/admin-commissions.spec.ts                                      |  422 + (neu)
tests/e2e/seed-output.ts                                                 |   19 +-
tests/integration/commission-admin-validate-route.test.ts                |  218 + (neu)
tests/integration/commission-admin.test.ts                               | 2277 + (neu)
tests/integration/deals-service.test.ts                                  |  377 +-
tests/unit/admin/commission-admin-publish-error-mapping.test.ts          |  104 + (neu)
tests/unit/authz/config-permissions.test.ts                              |   58 +-
tests/unit/authz/seed-role-permissions.test.ts                           |   29 +-
tests/unit/deals/financial-snapshot.test.ts                              |    2 +
tests/unit/pricing/commission.test.ts                                    |  176 +-
42 files changed, 7732 insertions(+), 71 deletions(-)
```

Zusätzlich mit diesem Berichts-Commit: `docs/ABSCHLUSSBERICHT_PHASE10.md`
(neu, dieses Dokument).

## 13. Vollständige bekannte Einschränkungen

- **Zentrale Sandbox-Einschränkung (unverändert seit Phase 2):**
  `@rollup/rollup-linux-arm64-gnu`-Problem weiterhin ungelöst – `npx
vitest run` lief in dieser Sitzung nicht direkt, Verifikation
  ausschließlich über CI #63–#76.
- **`npx prisma generate` ohne Netzwerkzugriff nicht ausführbar** – führt
  zu der bekannten 45-Fehler-`tsc`-Baseline gegen veraltete lokale
  Client-Typen (deutlich größer als Phase 9s 17-Fehler-Baseline, weil
  `commissionTier`/`commissionModelVersionId` als komplett neue Felder
  hinzukamen), kein Produktivcode-Problem.
- **FUSE-Mount-Eigenheit dieser Sandbox** (wiederholt aufgetreten, jedes
  Mal folgenlos gelöst): Git-Befehle hinterließen mehrfach phantomhafte
  `index.lock`/`HEAD.lock`-Dateien – gelöst durch Umbenennen (nicht
  Löschen) der Lock-Datei und Wiederholung des Git-Befehls.
- **Ein echter, in AP9 gefundener und in AP9-Fix behobener
  Concurrency-Bug** (CI #75, Abschnitt 7) – die Draft-Erstellung für
  `CommissionModelVersion` war bis zu diesem Fix nicht
  nebenläufigkeitssicher; behoben durch dasselbe Row-Lock-Muster wie der
  bereits seit AP5 korrekte Publish-Workflow.
- **Offene, bewusst nicht in dieser Phase untersuchte Frage:** ob
  `rule-admin.ts`'s `createDraftRuleSetVersion()` (Phase 9) dieselbe
  Klasse von Lücke hat (dort tenant-weiter statt modell-weiter Scope) –
  von ChatGPT ausdrücklich außerhalb des Phase-10-Slices belassen, als
  möglicher späterer Hardening-Punkt vorgemerkt.
- **Keine Rate-Begrenzung, kein User-Lifecycle-System, zwei parallele
  Login-Mechanismen** – alle unverändert aus Phase 8/9 übernommene,
  bewusste Einschränkungen, siehe `docs/ABSCHLUSSBERICHT_PHASE9.md`
  Abschnitt 13.
- **Bekannte Altlasten** (unverändert seit Phase 7/8/9): die Dateien
  `.gitignore_smoke_tmp_1786993826` und
  `prisma/migrations/_discarded_20260818170000_questionnaire_version_active_unique/`
  ließen sich aus der Sandbox heraus nicht löschen (FUSE "Operation not
  permitted") – beide untracked, nicht committet, ohne jede Wirkung auf
  Repository/CI.
- **Testzahlen in Abschnitt 10 sind grep-basiert gezählt**, nicht aus
  einem in dieser Sitzung tatsächlich ausgeführten Testlauf – die
  tatsächliche Ausführung ist ausschließlich über die CI-Läufe #63–#76
  belegt.

## 14. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **Ziele-Modell, Freitext-KI-Angebotsfeature, Campaign-Management** –
  bereits vor Phase 10 als nächste Phasen vorgesehen, weiterhin nicht
  begonnen.
- **Analoge Row-Lock-Prüfung für `rule-admin.ts`'s
  `createDraftRuleSetVersion()`** (Phase 9) – als möglicher
  Hardening-Punkt vorgemerkt (Abschnitt 13), kein Bestandteil von
  Phase 10.
- **Rate-Limiting/Brute-Force-Schutz, Passwort-Reset-/Einladungsflow,
  User-Lifecycle-System** – unverändert aus Phase 8/9 offen.
- **Sidebar-Feature** (AP-Navigation) – bereits vor Phase 8 zurückgestellt,
  weiterhin offen.

## 15. Fazit

Phase 10 hat den Provisionsmodell-Editor als dritte Fachadministrations-
Fläche in ki-cross eingeführt – strukturell eng am Phase-8/9-Muster
(Draft → Validate → Publish → Historie → Audit), aber mit dem model-
statt tenant-scoped Publish als zentralem, bereits in AP0 korrekt
antizipiertem Unterschied zu Phase 9, sowie einer vollständig neuen
TIERED-Provisionslogik und einer erstmaligen Deal-zu-Provisionsversion-
Historisierung (`DealItem.commissionModelVersionId`).

Besonders hervorzuheben ist der Verlauf aus Abschnitt 7: der neue
E2E-Concurrency-Test deckte einen echten, bis dahin unentdeckten
Produktionsrace in der Draft-Erstellung auf – exakt die Art von Fehler,
die bei rein sequenzieller Nutzung unsichtbar geblieben wäre. Der Prozess
folgte durchgängig dem in Phase 9 etablierten Muster "erst beweisen, dann
fixen": vollständiger CI-Fehlerblock statt Zusammenfassung, ChatGPT-
Bestätigung des Root Cause vor jeder Code-Änderung, ein exakt auf den
bereits bewährten AP5-Row-Lock gespiegelter Fix, zwei neue gezielte
Concurrency-Regressionstests.

Der technische Nachweis für die gesamte Phase ist CI #76 (Commit
`4ac16f9`, grün, 3m55s), der neben Build/TypeScript und allen bestehenden
Regressionstests aus Phase 2–9 auch die 116 neuen Phase-10-Tests (inkl.
des Row-Lock-Regressionstests und der vollständigen Playwright-E2E-Suite
auf Desktop + Tablet) gegen eine echte Postgres-Datenbank erfolgreich
ausführt. AP9 wurde von ChatGPT auf dieser Basis final abgenommen ("Damit
ist die Implementierung des Provisionsmodell-Editors als vertikaler
Slice vollständig abgeschlossen."); dieser Bericht (AP10) schließt die
Phase formal ab.
