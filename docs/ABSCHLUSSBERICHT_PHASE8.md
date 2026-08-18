# Abschlussbericht Phase 8 – Sichere Fachadministration (Teil 1: Fragen & Fragebogenversionen)

Stand: 2026-08-18. Dieses Dokument ist **vollständig eigenständig**: alle
Aussagen sind hier direkt belegt, ohne dass andere Dateien gelesen werden
müssen (gleiches Prinzip wie in den Abschlussberichten der Vorphasen).

Repository: `https://github.com/vindoo187/ki-cross`, Branch `main`.

**Commit-Verlauf dieser Phase** (`git log --oneline 29d8241..c923ff6`,
`29d8241` = Berichts-Commit Phase 7):

| Commit    | Inhalt                                                                     | CI-Lauf |  Ergebnis   |
| --------- | -------------------------------------------------------------------------- | :-----: | :---------: |
| `9e2b887` | AP0 – Discovery (`PHASE_8_DISCOVERY.md`, keine Implementierung)            |         |      –      |
| `fc709b8` | Implementierungsplan (Entwurf)                                             |         |      –      |
| `9660dc5` | Implementierungsplan – ChatGPT-Auflagen eingearbeitet, finales GO          |         |      –      |
| `aa70f95` | AP1 – Admin-/Konfigurations-Login (additiv zu `dev-login`)                 | CI #37  | **Success** |
| `8ebb83a` | AP2 – Configuration-RBAC (`config.questions.view/edit/publish`)            | CI #38  | **Success** |
| `6231ec1` | AP3 – Question Management API (Draft-CRUD)                                 | CI #39  | **Failure** |
| `98771b1` | Fix CI #39 – composite-FK nested-create (AnswerOption/VisibilityCondition) | CI #40  | **Success** |
| `3d39acc` | AP4 – Validate & Publish (atomare Transaktion, Audit, Version-Pinning)     | CI #41  | **Failure** |
| `ef107ca` | Fix CI #41 – unreachable 422-Mapping + AuditLog-FK in Tests                | CI #42  | **Success** |
| `987617d` | AP5 – Versionshistorie & Rollback (Deep-Copy, Pinning-Test)                | CI #43  | **Success** |
| `2efdde7` | AP6 – Admin-UI für Fragenverwaltung                                        | CI #44  | **Success** |
| `a9b2850` | AP7 – Audit-Vollständigkeit für Draft-CRUD (echte Lücke behoben)           | CI #45  | **Failure** |
| `1c535cd` | Fix CI #45 – Audit-Count-Assertion nach AP7                                | CI #46  | **Success** |
| `c923ff6` | AP8 – Hardening: Versionierungs-Invariante dokumentiert + Concurrency-Test | CI #47  | **Success** |

Maßgeblich für den technischen Nachweis dieser Phase ist **CI #47** auf
dem finalen Stand `c923ff6` (AP9) – dieser Lauf deckt den gesamten
kumulierten Codestand von AP1 bis AP8 ab, da CI bei jedem Push auf `main`
die vollständige Suite (inkl. aller vorher gepushten Commits) ausführt.
Drei Zwischenläufe schlugen fehl (CI #39, #41, #45) – alle drei waren
**echte, von CI gefundene Bugs bzw. Testüberholungen**, keine
Sandbox-Artefakte; Root Causes und Fixes siehe Abschnitt 9 und die
Commit-Tabelle oben. `git status` zum Zeitpunkt der Fertigstellung dieses
Berichts: sauber bis auf die für diesen Bericht gehörenden
Dokumentationsänderungen, die bekannte Altdatei
`.gitignore_smoke_tmp_1786993826` (seit Phase 7 bekannt, siehe Abschnitt 11) und ein untracked, nie committetes Migrationsverzeichnis
`_discarded_20260818170000_questionnaire_version_active_unique/` (Rest
einer während AP8 verworfenen Migration, siehe Abschnitt 6/9 – ohne jede
Wirkung auf Repo/CI, da nie `git add`).

## 1. Technische Versionen

Unverändert gegenüber Phase 7 – **keine neuen Abhängigkeiten** in Phase 8
(`git diff --stat 29d8241..c923ff6 -- package.json package-lock.json`
liefert keine Treffer, siehe auch Abschnitt 3):

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

Vor Phase 8 existierte jede fachliche Konfiguration (Fragen,
Fragebogenversionen, Regeln, Produkte, Provisionsmodelle) ausschließlich
über `prisma/seed.ts` — es gab **null Schreibpfade in `src/`** dafür
(Kernbefund AP0, `PHASE_8_DISCOVERY.md`). Das
Versionierungs-Datenmodell (`VersionStatus` DRAFT/ACTIVE/EXPIRED/ARCHIVED,
EXCLUDE-Constraints gegen überlappende Gültigkeitszeiträume) existierte
bereits vollständig im Schema, aber ungenutzt — dasselbe Muster wie
`RoleAssignment` vor Phase 7. Der bestehende `dev-login` (keine
Passwortprüfung, nur `employeeId`) war für eine config-ändernde
Admin-Fläche strukturell ungeeignet.

**ChatGPT-Scope-Entscheidung:** Phase 8 = "Sichere Fachadministration –
Teil 1: Fragen & Fragebogenversionen", zwei eng gekoppelte Teile: (A)
produktionsfähige Auth-Grundlage für Admin-Funktionen, (B) vollständiger
Draft → Validate → Publish-Workflow für Fragen/Fragebogenversionen.
Explizit **nicht** in Phase 8: Regel-Editor, Campaign-Management, Ziele,
Provisionsmodell-Editor, visueller Regel-Builder, Freitext-KI (Abschnitt
13).

## 3. Umfang dieser Phase (AP0–AP10)

- **AP0** – Discovery (`PHASE_8_DISCOVERY.md`, 132 Zeilen): Ist-Analyse
  von Auth-Mechanismus, Schema, Versionierungs-/Audit-Infrastruktur.
- **Implementierungsplan** (`PHASE_8_IMPLEMENTATION_PLAN.md`, 506 Zeilen):
  vollständiges ChatGPT-GO mit fünf verbindlichen Präzisierungen (Admin-Auth
  additiv statt Ersatz, Passwort-Hash statt externem IdP, `AuditLog` statt
  `ConfigurationChange`, Zwei-Rollen-Modell `config_editor`/
  `config_publisher`, TENANT-Scope) plus einer zusätzlichen Auflage
  (Publish-Transaktion als atomare `BEGIN`/`COMMIT`/`ROLLBACK`-Einheit).
- **AP1** – Admin-Auth-Grundlage: `User.passwordHash` additiv/nullable,
  `POST /api/auth/admin-login`, `verifyAdminCredentials()` mit
  Timing-Schutz (identischer 401 für unbekannte E-Mail und falsches
  Passwort, Dummy-Hash-Vergleich bei unbekanntem User gegen
  Nutzer-Enumeration), kein Fallback zu `dev-login`. **Bewusste Abweichung
  vom Plan: Passwort-Hashing mit `node:crypto scrypt` statt `bcrypt`**
  (die Sandbox konnte keine neue npm-Abhängigkeit installieren) — von
  ChatGPT ausdrücklich akzeptiert. `scrypt` ist ein etablierter,
  speicherharter KDF-Algorithmus (Teil des Node.js-Standard-`crypto`-
  Moduls, kein Drittanbieter-Paket), gespeichert als `"<salt-hex>:<hash-
hex>"` (`src/server/auth/password.ts`).
- **AP2** – Configuration-RBAC: `src/server/authz/config-permissions.ts`
  (`deriveConfigPermissions()`, `requireConfigPermission()`/
  `ConfigAccessDeniedError`), Rollen `config_editor` (view+edit) und
  `config_publisher` (view+edit+publish), ausschließlich TENANT-Scope.
  Proaktiv einen Fehlertyp verhindert, der in Phase 7 AP1 real aufgetreten
  war: `sales_employee` schließt die drei neuen `config.questions.*`-Keys
  explizit aus seiner Catch-all-Regel aus.
- **AP3** – Question Management API (Draft-Ebene):
  `src/server/admin/question-admin.ts` (`listQuestionnaires`,
  `getQuestionnaireVersionDetail`, `createDraftVersion` inkl.
  `copyFromVersionId`-Deep-Copy, `addQuestionToDraft`,
  `updateQuestionInDraft`, `removeQuestionFromDraft`), 5 HTTP-Routen unter
  `/api/admin/questionnaires/...`, `requireConfigPermission()` auf jeder
  Route, DRAFT-only-Mutation mit 409 bei Versuch, eine
  ACTIVE/EXPIRED/ARCHIVED-Version zu mutieren.
- **AP4** – Validate & Publish: `validateDraftVersion()` (ruft die
  bestehende `validateQuestionnaireVersion()` seit Phase 3A rein lesend
  auf), `publishDraftVersion()` als atomare Transaktion (alte
  ACTIVE-Version → EXPIRED → neue Version → ACTIVE mit Race-Guard → Audit,
  in dieser Reihenfolge wegen der EXCLUDE-Constraint), zwei getrennte
  Routen (`.../validate` mit `config.questions.edit`, `.../publish` mit
  `config.questions.publish`).
- **AP5** – Versionshistorie & Rollback: `GET .../versions` (vollständige
  Historie), `POST .../rollback` (`rollbackToVersion()`, erzeugt eine neue
  DRAFT-Version als Deep-Copy einer historischen Version, läuft danach
  regulär durch den AP4-Publish-Pfad — keine zweite Publish-Logik). Der von
  ChatGPT wörtlich vorgegebene Pinning-Test bestanden: Beratung A startet
  auf Version 1 → Rollback+Publish erzeugt eine neue ACTIVE-Version, V1
  wird EXPIRED → Beratung A bleibt unverändert auf V1 gepinnt → neue
  Beratung B erhält die neue ACTIVE-Version.
- **AP6** – Admin-UI: `/admin/questions` (Liste mit Status-Badges),
  `/admin/questions/[id]/versions/[versionId]` (bei DRAFT editierbar via
  `QuestionDraftEditor` + `VersionActionsBar`, sonst read-only mit "Neuen
  Entwurf erstellen"), `VersionHistoryPanel` mit Rollback-Aktion. Alle
  Mutationen ausschließlich über `fetch()` gegen die AP3–AP5-Routen — keine
  eigene Fach-/Tenant-/Permission-Logik in der UI.
- **AP7** – Audit-Re-Prüfung gegen die tatsächlichen UI-Mutationspfade:
  echte Lücke gefunden (4 von 6 Admin-Mutationsfunktionen schrieben kein
  `AuditLog`) und behoben, siehe Abschnitt 9.
- **AP8** – Hardening: Sicherheitsreview über Auth, API-Security,
  Versionierungs-/Audit-Invarianten, UI, Regression — inkl. eines
  selbstkorrigierten Race-Condition-Befunds, siehe Abschnitt 7.
- **AP9** – CI/Final Verification: reiner Verifikationsblock (kein neuer
  Scope), CI #47 grün als Nachweis, siehe Abschnitt 10. Von ChatGPT
  abgenommen.
- **AP10** – dieser Abschlussbericht.

## 4. Architektur: Draft → Validate → Publish

**Zustandsmaschine** (`VersionStatus` auf `QuestionnaireVersion`):

```
DRAFT --validate()--> DRAFT (mit Validierungsergebnis, keine Statusänderung)
DRAFT --publish()--> ACTIVE (vorherige ACTIVE-Version -> EXPIRED, validTo gesetzt)
```

**Keine Mutation einer bereits veröffentlichten (ACTIVE) Version** — jede
Änderung erzeugt eine neue DRAFT-Version. `publishDraftVersion()` läuft als
eine einzige `db.$transaction()`, in exakt dieser Reihenfolge: alte
ACTIVE-Version → EXPIRED (`validTo = now`) → neue Version via
`updateMany({where:{status:"DRAFT"}})` → ACTIVE (Race-Guard: `count !== 1`
wirft und rollt die gesamte Transaktion zurück) → zugehörige
`QuestionVersion`-Zeilen DRAFT→ACTIVE geflippt → `AuditLog`
(`action:"ACTIVATE"`) als letzter Schritt derselben Transaktion. Die
Reihenfolge EXPIRE-vor-ACTIVATE ist zwingend, weil sonst die
PostgreSQL-EXCLUDE-Constraint gegen überlappende Gültigkeitszeiträume die
Transaktion ablehnen würde (zwei Zeilen mit offenem Zeitfenster für
dasselbe Questionnaire).

**Rollback** ist kein Statuswechsel einer alten Version, sondern ein neuer
Publish-Vorgang: `rollbackToVersion()` erzeugt eine neue DRAFT-Version als
vollständige Tiefkopie einer historischen (ACTIVE/EXPIRED/ARCHIVED)
Version und durchläuft danach regulär `validateDraftVersion()`/
`publishDraftVersion()`.

**Bestandsschutz laufender Beratungen:** `ConsultationSession` pinnt
bereits seit Phase 3B eine konkrete `questionnaireVersionId`. Ein Publish
ändert keine bestehende `ConsultationSession`-Zeile — bewiesen mit dem
oben beschriebenen AP5-Pinning-Test gegen echte Postgres-Daten.

**Admin-Auth-Architektur:** Zwei parallele, bewusst getrennte
Login-Mechanismen mit identischer Session-Signierung
(`createSessionToken()`/`verifySessionToken()`, HMAC-SHA256,
`timingSafeEqual`): `dev-login` (unverändert, für den Beratungsfluss,
keine Passwortprüfung) und `admin-login` (neu, für `/admin/*` und
`/api/admin/*`, Passwortprüfung via `verifyAdminCredentials()`). Beide
erzeugen dasselbe `SessionPayload`-Format über dieselbe
`buildSessionPayloadForEmployee()`-Funktion — ein Admin-User hat dieselbe
Session-Struktur wie ein per `dev-login` angemeldeter Mitarbeiter, nur mit
zusätzlichen `config.*`-Permissions. Kein Fallback zwischen den beiden
Mechanismen.

## 5. Schema-/Migrationsänderungen

**Zwei neue Migrationen** in Phase 8 (beide rein additiv, keine
Datenänderung, kein Vorab-Datencheck nötig):

- `prisma/migrations/20260818090000_user_password_hash/migration.sql` —
  `ALTER TABLE "users" ADD COLUMN "password_hash" TEXT` (nullable; `NULL`
  für alle bestehenden/zukünftigen `dev-login`-Nutzer, nur die neuen
  synthetischen Admin-Testnutzer erhalten einen Wert).
- `prisma/migrations/20260818140000_audit_action_delete/migration.sql` —
  `ALTER TYPE "AuditAction" ADD VALUE 'DELETE'` (AP7-Fix, siehe Abschnitt
  9: `removeQuestionFromDraft()` hatte keinen passenden `AuditAction`-Wert;
  `DEACTIVATE` und `DELETION_REQUESTED` waren bereits anderweitig reserviert
  — ChatGPT-Entscheidung "Option A", eigener additiver Wert statt
  Zweckentfremdung).

`ls prisma/migrations/` bestätigt 7 aktive Migrationen insgesamt (die
fünf aus Phase 2/3B/6/7 plus diese beiden neuen) plus ein drittes,
**verworfenes und nie committetes** Migrationsverzeichnis
(`_discarded_20260818170000_questionnaire_version_active_unique/`, siehe
Abschnitt 7). Zusätzlich `prisma/schema.prisma`: 37 Zeilen geändert (neues
`passwordHash`-Feld, neuer `DELETE`-Enum-Wert, Dokumentationskommentar zum
bestehenden `questionnaire_versions_no_overlap`-Constraint, keine neuen
Tabellen). **Keine neue Abhängigkeit** in `package.json`/`package-lock.json`
(siehe Abschnitt 1) — insbesondere kein `bcrypt`.

## 6. Bewusste Scope-Entscheidungen (transparent dokumentiert)

- **`node:crypto scrypt` statt `bcrypt`** (AP1) — Sandbox-Grenze
  (keine neue npm-Abhängigkeit installierbar), von ChatGPT akzeptiert.
  Funktional gleichwertig für den Zweck (speicherharter, adaptiver
  Passwort-KDF), aber eine bewusste Abweichung vom ursprünglichen Plan
  (siehe Abschnitt 3, AP1).
- **`AuditLog` statt `ConfigurationChange`** (AP7/Plan Abschnitt 15.3) —
  ChatGPT hat seine eigene ursprüngliche Vorgabe revidiert, da
  `ConfigurationChange` laut Modul-Kommentar für skalare Einzelwerte
  gedacht ist, nicht für strukturierte Mehrfeld-Entitäten wie Fragen.
- **Zwei-Rollen-Modell `config_editor`/`config_publisher`** statt einer
  vereinfachten Ein-Rollen-Alternative — `publish`-Recht entsteht nicht
  implizit aus `edit`-Recht (mit Tests bewiesen, Abschnitt 8).
- **Kein zusätzlicher partieller Unique-Index für "eine ACTIVE-Version pro
  Questionnaire"** (AP8) — bewusst nach Selbstkorrektur verworfen, siehe
  Abschnitt 7.
- **Keine Rate-Begrenzung auf `/api/auth/admin-login`** — als expliziter
  AP8-Prüfpunkt (ChatGPT-Auflage) geprüft und bewusst vertagt, siehe
  Abschnitt 9/11.
- **Kein vollständiger Ersatz von `dev-login`** — der bestehende,
  vielfach getestete Beratungsfluss bleibt unangetastet; zwei parallele
  Login-Mechanismen werden bewusst in Kauf genommen (siehe Abschnitt 4).
- **Kein User-Lifecycle-System** (Deaktivierung/Sperrung) — `model User`
  hat kein `isActive`/`revokedAt`-Feld; ein solches System wäre Scope
  Creep gewesen (ChatGPT-Auflage), als spätere Erweiterung vorgesehen.

## 7. Selbstkorrigierter Race-Condition-Befund (AP8, transparentes Beispiel)

Bei der AP8-Prüfung der Invariante "niemals zwei ACTIVE-Versionen
gleichzeitig für dasselbe Questionnaire" wurde zunächst eine echt
wirkende Race Condition vermutet: bei zwei nahezu gleichzeitigen
`publishDraftVersion()`-Aufrufen für zwei verschiedene DRAFT-Versionen
desselben Questionnaire schien unter READ-COMMITTED-Isolation ein Fenster
zu bestehen, in dem beide Aufrufe die alte ACTIVE-Version erfolgreich auf
EXPIRED setzen und anschließend beide ihre jeweils neue Version auf ACTIVE
setzen könnten. ChatGPT gab GO für einen neuen partiellen Unique-Index als
Fix.

Beim Testen dieses Fixes gegen PGlite stellte sich heraus: die
Fehlermeldung kam nicht vom neuen Index, sondern von einem **bereits seit
der allerersten Init-Migration bestehenden EXCLUDE-Constraint**
(`questionnaire_versions_no_overlap`, GiST über
`tenant_id`/`questionnaire_id`/`tstzrange(valid_from, valid_to)` WHERE
`status IN ('ACTIVE','EXPIRED')`). Da `publishDraftVersion()` eine neu
aktivierte Version immer mit `validTo = NULL` (offenes Zeitfenster)
anlegt, erzeugen zwei nahezu gleichzeitige Publish-Vorgänge für dasselbe
Questionnaire zwangsläufig zwei sich überlappende offene Zeitfenster — die
bestehende Constraint lehnt den zweiten Versuch bereits ab, komplett ohne
den neuen Index.

Dieser Befund wurde proaktiv an ChatGPT zurückgemeldet, statt den
(harmlosen, aber redundanten) Fix stillschweigend zu behalten oder
stillschweigend zu verwerfen. ChatGPT-Entscheidung ("Option B"): neue
Migration verwerfen, stattdessen (a) ein erklärender Kommentar bei
`QuestionnaireVersion` in `prisma/schema.prisma`, (b) ein Kommentar direkt
in `publishDraftVersion()`, (c) ein korrigierter PGlite-Smoke-Test mit
zutreffender Beschreibung, (d) ein echter Concurrency-Integrationstest:
zwei parallele `publishDraftVersion()`-Aufrufe für zwei verschiedene
DRAFT-Versionen desselben Questionnaire via `Promise.allSettled()` gegen
die echte Postgres-Test-Datenbank, anschließend direkt gegen die DB
geprüft — genau eine ACTIVE-Version, `ACTIVATE`-Audit-Einträge nur für den
tatsächlich erfolgreichen Publish (`tests/integration/question-admin.test.ts`,
Abschnitt "5. AP8: Hardening"). Die neue Migration wurde aus der Sandbox
nicht löschbar (FUSE "Operation not permitted"), aber innerhalb desselben
Verzeichnisses umbenannt zu
`_discarded_20260818170000_questionnaire_version_active_unique/` — nie
`git add`ed, ohne jede Wirkung auf Repository, CI oder Produktivschema.

## 8. Anzahl und Art aller Tests

Vier Testebenen, insgesamt **627 Testfälle** (544 aus Phase 7 + 83 neu in
Phase 8), grep-basiert gezählt (`grep -crE '^\s*it\(|^\s*test\('` je Datei,
konsistent mit der Zählmethode der Vorphasen-Berichte):

| Ebene                                    | Phase 7 | Neu in Phase 8 | Gesamt Phase 8 | Neue/geänderte Dateien                                                                                                                                             |
| ---------------------------------------- | ------: | -------------: | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (`npm run test:unit`)               |     303 |             24 |            327 | `tests/unit/auth/password.test.ts` (8, neu), `tests/unit/authz/config-permissions.test.ts` (12, neu), `tests/unit/authz/seed-role-permissions.test.ts` (+4 auf 10) |
| Component (`npm run test:component`)     |     117 |              0 |            117 | keine neuen Component-Tests in Phase 8                                                                                                                             |
| Integration (`npm run test:integration`) |     117 |             59 |            176 | `tests/integration/admin-login.test.ts` (12, neu), `tests/integration/question-admin.test.ts` (47, neu, deckt AP3–AP8 ab)                                          |
| E2E (`npm run test:e2e`)                 |       7 |              0 |              7 | keine neuen E2E-Tests in Phase 8                                                                                                                                   |
| **Gesamt**                               | **544** |         **83** |        **627** |                                                                                                                                                                    |

**Inhalt der zentralen Testdatei** (`question-admin.test.ts`, 1.495
Zeilen, 47 Fälle, ausschließlich echte Postgres-Fixtures), fünf
Abschnitte:

1. **Service-Schicht** — Draft-CRUD (`createDraftVersion`,
   `addQuestionToDraft`, `updateQuestionInDraft`,
   `removeQuestionFromDraft`), inkl. `copyFromVersionId`-Deep-Copy und
   409-Sperre gegen Mutation nicht-DRAFT-Versionen.
2. **HTTP-Kette** — Config-RBAC (`config_editor` vs. `config_publisher`
   vs. keine Permission → 403), 404/409-Mapping über die realen
   Route-Handler.
3. **AP5: Versionshistorie & Rollback** — inkl. dem business-kritischen
   Pinning-Test (Beratung bleibt auf gepinnter Version nach Rollback+
   Publish).
4. **AP7: Audit-Vollständigkeit** — 5 Tests für alle vier
   Admin-Mutationsfunktionen, inkl. Atomaritätstest (FK-Verletzung bei
   `VisibilityCondition` → weder Frage noch Audit-Eintrag entsteht).
5. **AP8: Hardening (Versionierungs-Invarianten)** — der in Abschnitt 7
   beschriebene echte Concurrency-Test gegen die reale Postgres-Datenbank.

`tests/integration/admin-login.test.ts` (247 Zeilen, 12 Fälle) deckt
korrektes/falsches Passwort, unbekannte E-Mail (nicht unterscheidbar von
falschem Passwort), `passwordHash` erscheint in keiner API-Response, kein
Fallback zu/von `dev-login` ab.

## 9. Drei echte CI-Fehler dieser Phase (Root Cause + Fix)

- **CI #39 (AP3):** `AnswerOption`/`VisibilityCondition` hängen über einen
  zusammengesetzten Fremdschlüssel `(tenantId, questionVersionId)` an
  `QuestionVersion` — ein verschachtelter `create()` über das Relationsfeld
  akzeptierte `tenantId` dort nicht als Feld (Prisma "Unknown argument
  tenantId"), lokal nicht sichtbar, weil der tenant-gescopte Client
  (`db`/`tx`) durch `$extends()` lockerer typisiert ist als ein roher
  `PrismaClient`. **Fix (`98771b1`):** flache Top-Level-`createMany()`-
  Aufrufe mit explizitem `tenantId` + `questionVersionId` statt
  verschachteltem `create` — identisches Muster wie `prisma/seed.ts`,
  jetzt verbindlich für künftige composite-FK-Kind-Erstellungen.
- **CI #41 (AP4):** zwei echte Bugs — (1) `http-errors.ts`:
  `QuestionnaireVersionInvalidError`-422-Mapping stand nach dem
  generischen `QuestionEngineError`→400-Fallback und war wegen Vererbung
  unerreichbar; (2) Testfixtures nutzten `randomUUID()` als `userId` ohne
  echte `User`-Zeile — `publishDraftVersion()` schreibt `AuditLog.
actorUserId` mit echter FK auf `User`. **Fix (`ef107ca`):** 422-Block vor
  den Fallback verschoben, neuer `createUser()`-Fixture-Helper.
- **CI #45 (AP7):** ein bestehender Test rief `createDraftVersion()` +
  `publishDraftVersion()` auf derselben Entity auf; die alte ungefilterte
  `toHaveLength(1)`-Assertion war durch das neue CREATE-Audit aus AP7
  überholt (jetzt legitim 2 Einträge). **Fix (`1c535cd`):** Abfrage nach
  `action` gefiltert (ACTIVATE/CREATE separat geprüft). ChatGPT: "Das ist
  genau die Art von Regressionsfund, die wir mit der CI haben wollen [...]
  Produktlogik war korrekt, der alte Test hatte eine inzwischen überholte
  Annahme."

Alle drei waren echte, von CI gefundene Probleme (zwei Produktivcode-Bugs,
ein überholter Test) — kein Sandbox-Artefakt.

## 10. Vollständige Prüfkommandos mit Ergebnissen

| Kommando                                                            | Ergebnis                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status` (Stand `c923ff6`)                                      | sauber bis auf die für diesen Bericht gehörenden Dokumentationsänderungen und die bekannten untracked Altlasten (Abschnitt 11)                                                                                              |
| `npx tsc --noEmit`                                                  | 11 bekannte Sandbox-Fehler (9 `passwordHash`-bezogen, da `npx prisma generate` ohne Netzwerk nicht läuft und die lokalen Client-Typen veraltet sind; 2 `AuditAction.DELETE`-bezogen, gleicher Grund) — keine anderen Fehler |
| `npx eslint .`                                                      | sauber bis auf die bekannte, gitignorete, Next.js-generierte `next-env.d.ts` (kein Codebefund, betrifft CI nicht)                                                                                                           |
| `npx prettier --check .`                                            | sauber                                                                                                                                                                                                                      |
| `node scripts/verify_migration_pglite.mjs`                          | "ALLE MIGRATIONSPRUEFUNGEN (PHASE 3B + PHASE 6 + PHASE 7 AP6 + PHASE 8 AP1 + PHASE 8 AP7 + PHASE 8 AP8) ERFOLGREICH" — inkl. der beiden neuen Migrationen und des in Abschnitt 7 beschriebenen Smoke-Tests                  |
| `npx vitest run` (alle vier Testebenen)                             | in dieser Sandbox nicht ausführbar (bekannte, sandboxweite `@rollup/rollup-linux-arm64-gnu`-Limitierung, unverändert seit Phase 2) — Verifikation ausschließlich über CI                                                    |
| GitHub Actions (`vindoo187/ki-cross/actions`, via Claude-in-Chrome) | CI #37–#47 (Details Commit-Tabelle, Abschnitt 0); **CI #47 (`c923ff6`): Success, 3m 52s** — maßgeblicher Nachweis für diese Phase                                                                                           |

**CI #47 im Detail:** vollständiger Lauf über den kumulierten Codestand
AP1–AP8, deckt ab: Lint/Prettier/`tsc` sauber, Migrationen gegen echte
Postgres-Test-DB angewendet (inkl. der beiden neuen Migrationen), alle 627
Test-Fälle grün (Unit/Component/Integration inkl. des neuen
AP8-Concurrency-Tests aus Abschnitt 7), Produktions-Build (`next build`)
erfolgreich, Playwright-E2E-Tests (Desktop+Tablet) grün, keine Regression
in Phase 6/7. ChatGPT-Bestätigung (AP9): "komplette Kette von Auth → RBAC
→ API → Versionierung → Publish → Rollback → Audit → Concurrency → UI →
E2E bestätigt."

**Sandbox-Einschränkung dieser Sitzung (unverändert seit Phase 2):** `npx
vitest run` konnte in dieser Sandbox nicht direkt ausgeführt werden. Die
tatsächliche Ausführung aller 627 Testfälle ist ausschließlich über die
CI-Läufe #37–#47 belegt, deren Status über Claude-in-Chrome-Browserzugriff
auf die GitHub-Actions-Oberfläche ausgelesen wurde (clientseitig
gerenderte Seite, daher kein statischer `WebFetch`-Abruf). `tsc`/
`eslint`/`prettier`/die PGlite-Migrationsprüfung wurden in dieser Sitzung
tatsächlich lokal ausgeführt.

## 11. Vollständige Liste erstellter und geänderter Dateien

`git diff --stat 29d8241..c923ff6` (`29d8241` = Berichts-Commit Phase 7,
`c923ff6` = letzter Implementierungs-Commit dieser Phase, AP8):
**41 Dateien geändert, 6.487 Zeilen hinzugefügt, 15 Zeilen entfernt.**

```
PHASE_8_DISCOVERY.md                                              | 132 + (neu)
PHASE_8_IMPLEMENTATION_PLAN.md                                    | 506 + (neu)
docs/DATA_MODEL.md                                                 |   2 +-
prisma/migrations/20260818090000_user_password_hash/
  migration.sql                                                    |  13 + (neu)
prisma/migrations/20260818140000_audit_action_delete/
  migration.sql                                                    |  10 + (neu)
prisma/schema.prisma                                                |  37 +
prisma/seed.ts                                                      | 150 +
scripts/verify_migration_pglite.mjs                                 | 106 +-
src/app/admin/questions/[id]/versions/[versionId]/page.tsx          | 175 + (neu)
src/app/admin/questions/page.tsx                                    | 112 + (neu)
src/app/api/admin/questionnaires/[id]/versions/[versionId]/publish/route.ts   |  33 + (neu)
src/app/api/admin/questionnaires/[id]/versions/[versionId]/questions/[questionId]/route.ts | 51 + (neu)
src/app/api/admin/questionnaires/[id]/versions/[versionId]/questions/route.ts |  40 + (neu)
src/app/api/admin/questionnaires/[id]/versions/[versionId]/rollback/route.ts  |  44 + (neu)
src/app/api/admin/questionnaires/[id]/versions/[versionId]/route.ts           |  28 + (neu)
src/app/api/admin/questionnaires/[id]/versions/[versionId]/validate/route.ts  |  34 + (neu)
src/app/api/admin/questionnaires/[id]/versions/route.ts             |  56 + (neu)
src/app/api/admin/questionnaires/route.ts                           |  26 + (neu)
src/app/api/auth/admin-login/route.ts                               |  78 + (neu)
src/app/consultation/page.tsx                                       |  11 +
src/app/globals.css                                                 | 321 +
src/components/admin/CreateDraftVersionButton.tsx                   |  60 + (neu)
src/components/admin/QuestionDraftEditor.tsx                        | 628 + (neu)
src/components/admin/VersionActionsBar.tsx                          | 123 + (neu)
src/components/admin/VersionHistoryPanel.tsx                        | 109 + (neu)
src/server/admin/question-admin-errors.ts                           |  80 + (neu)
src/server/admin/question-admin.ts                                  | 1036 + (neu)
src/server/admin/schemas.ts                                         |  97 + (neu)
src/server/auth/admin-login.ts                                      |  79 + (neu)
src/server/auth/dev-users.ts                                        |  30 +
src/server/auth/errors.ts                                           |  29 +-
src/server/auth/password.ts                                         |  80 + (neu)
src/server/auth/session.ts                                          |  27 +
src/server/authz/config-permissions.ts                              | 100 + (neu)
src/server/authz/seed-role-permissions.ts                           |  31 +-
src/server/consultation-ui/http-errors.ts                           |  62 +
tests/integration/admin-login.test.ts                               | 247 + (neu)
tests/integration/question-admin.test.ts                            | 1495 + (neu)
tests/unit/auth/password.test.ts                                    |  52 + (neu)
tests/unit/authz/config-permissions.test.ts                         | 126 + (neu)
tests/unit/authz/seed-role-permissions.test.ts                      |  46 +-
41 files changed, 6487 insertions(+), 15 deletions(-)
```

Zusätzlich mit diesem Berichts-Commit: `docs/ABSCHLUSSBERICHT_PHASE8.md`
(neu, dieses Dokument).

## 12. Vollständige bekannte Einschränkungen

- **Zentrale Sandbox-Einschränkung (unverändert seit Phase 2):**
  `@rollup/rollup-linux-arm64-gnu`-Problem weiterhin ungelöst — `npx
vitest run` lief in dieser Sitzung nicht direkt, Verifikation
  ausschließlich über CI #37–#47.
- **`npx prisma generate` ohne Netzwerkzugriff nicht ausführbar** — führt
  zu 11 bekannten `tsc`-Fehlern gegen veraltete lokale Client-Typen (9
  `passwordHash`-, 2 `AuditAction.DELETE`-bezogen), siehe Abschnitt 10;
  kein Produktivcode-Problem, CI führt `prisma generate` mit Netzwerkzugriff
  aus.
- **FUSE-Mount-Eigenheit dieser Sandbox** (wiederholt aufgetreten, jedes
  Mal folgenlos gelöst): Git-Befehle können phantomhafte
  `index.lock`/`HEAD.lock`-Dateien hinterlassen; zusätzlich in dieser
  Phase neu beobachtet: `rm`/geräteübergreifendes `mv` auf nie committete
  Dateien/Verzeichnisse schlägt mit "Operation not permitted" fehl —
  Umbenennen innerhalb desselben Verzeichnisses funktioniert (genutzt für
  die in Abschnitt 7 beschriebene verworfene Migration).
- **Keine Rate-Begrenzung auf `/api/auth/admin-login`** — als expliziter
  AP8-Prüfpunkt geprüft (ChatGPT-Auflage) und bewusst vertagt: für ein
  synthetisches Pilotsystem ohne öffentliches Internet-Exposure akzeptiert,
  aber ein echter Brute-Force-Schutz (z. B. IP-/Account-basiertes
  Rate-Limiting) wäre vor einem produktiven Einsatz mit echten Endnutzern
  erforderlich.
- **Admin-Passwortvergabe bleibt Seed-basiert** — kein
  Passwort-Reset-/Einladungsflow in dieser Phase; für echten
  Produktivbetrieb mit echten (nicht-synthetischen) Admin-Nutzern ein
  Folge-Thema.
- **Kein User-Lifecycle-System** (Deaktivierung/Sperrung von Admin-Nutzern)
  — `model User` hat kein `isActive`/`revokedAt`-Feld, bewusst nicht Teil
  dieser Phase (Abschnitt 6).
- **Zwei parallele Login-Mechanismen** (`dev-login` für Beratung,
  `admin-login` für Konfiguration) — bewusst in Kauf genommen, um den
  bestehenden, gut getesteten Beratungsfluss nicht anzufassen. Eine
  spätere Vereinheitlichung ist ein eigenes Thema.
- **Bekannte Altlast** (unverändert seit Phase 7): die Datei
  `.gitignore_smoke_tmp_1786993826` ließ sich aus der Sandbox heraus nicht
  löschen (FUSE "Operation not permitted") — untracked, nicht committet.
- **Neue Altlast dieser Phase:** das verworfene Migrationsverzeichnis
  `_discarded_20260818170000_questionnaire_version_active_unique/` (siehe
  Abschnitt 7) — ebenfalls untracked, nicht committet, ohne Wirkung auf
  Repository/CI. Beide Altlasten kann der Nutzer bei Gelegenheit manuell
  per Finder entfernen; keine Dringlichkeit.
- **Testzahlen in Abschnitt 8 sind grep-basiert gezählt**, nicht aus einem
  in dieser Sitzung tatsächlich ausgeführten Testlauf — die tatsächliche
  Ausführung ist ausschließlich über die CI-Läufe #37–#47 belegt.

## 13. Explizit nicht implementierte, für spätere Phasen vorgesehene Funktionen

- **Regel-Editor** (`RuleSet`/`EligibilityRule`/etc.) — ChatGPT-Scope-
  Entscheidung AP0, explizit außerhalb Phase 8.
- **Campaign-Management** — ebenso explizit außerhalb Phase 8.
- **Ziele-Modell** — ebenso explizit außerhalb Phase 8.
- **Provisionsmodell-Editor** — ebenso explizit außerhalb Phase 8.
- **Visueller Regel-Builder** — ebenso explizit außerhalb Phase 8.
- **Freitext-KI-Angebotsfeature** — bereits in Phase 5 als Backlog-Item
  nach MVP-Abnahme freigegeben, weiterhin nicht begonnen.
- **Vollständiger Ersatz von `dev-login`** für den Beratungsfluss durch
  echtes Auth für alle Nutzer — bewusst außerhalb dieser Phase (Abschnitt
  4/6).
- **Rate-Limiting/Brute-Force-Schutz** auf `/api/auth/admin-login`
  (Abschnitt 12).
- **Passwort-Reset-/Einladungsflow** für Admin-Nutzer (Abschnitt 12).
- **User-Lifecycle-System** (Deaktivierung/Sperrung, Abschnitt 12).
- **Sidebar-Feature** (AP-Navigation) — bereits vor Phase 8 zurückgestellt,
  weiterhin offen.

## 14. Fazit

Phase 8 hat die erste echte Schreibfläche für fachliche Konfiguration in
ki-cross eingeführt: ein zuvor rein seed-basierter Bereich (Fragen/
Fragebogenversionen) hat jetzt einen vollständigen, produktionsnah
abgesicherten Draft → Validate → Publish-Workflow mit echter
Passwort-Authentifizierung, granularem RBAC (view/edit/publish getrennt),
lückenlosem Audit-Trail und Bestandsschutz für laufende Beratungen — alles
mit echten Postgres-Integrationstests bewiesen, nicht nur mit Unit-Tests.

Besonders hervorzuheben ist der AP8-Verlauf (Abschnitt 7) als Beispiel für
den in diesem Projekt etablierten Konsultationsprozess: ein zunächst
plausibel wirkender Sicherheitsbefund wurde nicht unreflektiert
umgesetzt, sondern beim Testen selbst hinterfragt, korrigiert und
transparent an ChatGPT zurückgemeldet — mit dem Ergebnis, dass unnötige
Schema-Komplexität vermieden und stattdessen die tatsächlich wirksame,
bereits bestehende Absicherung explizit dokumentiert und durch einen
echten Concurrency-Test bewiesen wurde.

Der technische Nachweis für die gesamte Phase ist CI #47 (Commit
`c923ff6`, grün, 3m 52s), der neben Build/TypeScript und allen
bestehenden Regressionstests aus Phase 3–7 auch die 83 neuen Phase-8-Tests
(inkl. des echten AP8-Concurrency-Tests) gegen eine echte
Postgres-Datenbank erfolgreich ausführt. AP9 wurde von ChatGPT auf dieser
Basis abgenommen; damit ist Phase 8 (AP0–AP9) technisch abgeschlossen,
dieser Bericht (AP10) schließt die Phase formal ab.

**Bewusste, im Plan bereits angelegte Abweichung, hier nochmals explizit
benannt (AP1):** Passwort-Hashing erfolgt mit `node:crypto scrypt`, nicht
mit `bcrypt` wie ursprünglich im Implementierungsplan vorgesehen.
