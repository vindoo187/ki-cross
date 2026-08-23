# Abschlussbericht Phase 2 (Stand: 2026-07-31)

Dieser Bericht schließt die Implementierungsphase ab, die der Projektleiter
(ChatGPT) mit "Prompt 2" beauftragt und der Auftraggeber mit "mach das
munter" freigegeben hat. Er folgt bewusst derselben Ehrlichkeitsregel wie
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): jede Aussage ist mit
ihrer Prüfmethode belegt, nichts wird als "fertig" behauptet, ohne dass
daneben steht, wie das verifiziert wurde.

## 1. Auftrag und Rahmen

Beauftragt war ausschließlich: Projektgerüst, vollständiges Datenmodell,
Migrationen, Seed-Daten, Mandantenkontext mit Isolationstests, eine minimale
technische Prüfansicht, eine CI-Pipeline sowie diese Dokumentation.
Ausdrücklich **nicht** beauftragt (Stop-Anweisung des Projektleiters):
Fragen-Engine, Empfehlungs-Engine, fertige Mitarbeiteroberfläche. Diese
Abgrenzung wurde während der gesamten Phase eingehalten (siehe Abschnitt 13).

## 2. Architekturentscheidungen

Modularer Monolith mit Next.js (App Router) + TypeScript (strict) +
Prisma/PostgreSQL + Zod + Vitest + ESLint/Prettier + GitHub Actions, wie in
Prompt 2 vorgegeben. Alle Entscheidungen mit Begründung und verworfenen
Alternativen stehen in [DECISION_LOG.md](DECISION_LOG.md) (9 Einträge,
u. a. Geldbeträge als Int-Minor-Units, zweischichtige Mandantentrennung,
Prisma Client Extensions statt veraltetem Middleware-Ansatz, npm statt
pnpm).

## 3. Datenmodell

55 Modelle in `prisma/schema.prisma`, alle in Prompt 2 geforderten Domänen
abgedeckt: Mandant → Firma → Filiale → Mitarbeiter/Rollen/Berechtigungen,
Produkte/Tarife/Kommission/Kampagnen, Beratung (Consultation, Antworten,
erkannte Bedarfe), Empfehlung (inkl. Begründung/Ablehnungsgründen),
Abschluss (Deal, DealItem, unveränderliches DealFinancialSnapshot),
Fragebogen-Konfiguration (Questionnaire/Question/RuleSet/Threshold),
Datenschutz/Kontaktverwaltung (CustomerReference, Consent, Retention,
Deletion), Analytics/KPI/Audit. Details in
[DATA_MODEL.md](DATA_MODEL.md).

## 4. Migration

`prisma/migrations/20260731000000_init/migration.sql` (876 Zeilen) wurde
mangels Sandbox-Zugriff auf `binaries.prisma.sh` nicht per `prisma migrate
dev`, sondern über `scripts/schema_to_sql.py` erzeugt und danach gegen eine
echte, eingebettete Postgres-Instanz (`@electric-sql/pglite`) ausgeführt:
`npm run verify:migration` → 55 Tabellen, 80 Fremdschlüssel, 0 Fehler.
Reproduzierbar, siehe [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## 5. Seed-Daten

`prisma/seed.ts` (560 Zeilen) erzeugt zwei synthetische Mandanten mit
vollständig durchgängigen Beispieldaten über ~30 Tabellen. Ausgeführt und
verifiziert über `npm run verify:seed` gegen dieselbe eingebettete
Postgres-Instanz: alle erwarteten Zeilenzahlen korrekt, keine echten
Kundendaten (durchgängig `isSynthetic: true` / Beispiel-Domains).

## 6. Mandantentrennung (zentrales Sicherheitsziel)

Zwei unabhängige Schichten, beide aktiv geprüft statt nur per Code-Review:

- **Datenbankebene (primär):** zusammengesetzte Fremdschlüssel
  (`@@unique([tenantId, id])` + `fields:[tenantId, childId]`) lehnen
  Tenant/Parent-Mismatches hart ab. Aktiv getestet in
  `scripts/verify_seed_pglite.mjs` (bewusster Fehlversuch, korrekt mit
  `stores_tenant_id_company_id_fkey` abgelehnt).
- **Anwendungsebene (defense in depth):** `withTenantScope()`
  (Prisma Client Extension, `src/server/tenant/scoped-client.ts`) plus
  `AsyncLocalStorage`-Kontext (`src/server/tenant/context.ts`) injizieren
  bzw. validieren `tenantId` bei jeder Operation. 54/54 Unit-Tests grün
  (`tests/unit/tenant-context.test.ts`, `tests/unit/tenant-scope.test.ts`),
  zusätzlich ein Integrationstest gegen echtes Postgres vorbereitet
  (`tests/integration/tenant-isolation.test.ts`, läuft automatisch in CI).

Details und Begründung in [TEST_STRATEGY.md](TEST_STRATEGY.md).

## 7. Technische Prüfansicht

`src/app/review/page.tsx` (`/review`, `force-dynamic`) zeigt Zeilenzahlen je
Mandant über 12 zentrale Tabellen — bewusst über `rawPrismaClient` statt des
mandantengebundenen Clients, da eine mandantenübergreifende Admin-Ansicht
gefordert war (Ausnahme dokumentiert in
[DECISION_LOG.md](DECISION_LOG.md)).

## 8. CI-Pipeline

`.github/workflows/ci.yml`: ein Job mit `postgres:16-alpine`-Service-Container,
der `npm ci`, `prisma generate`, `prisma migrate deploy`, Lint, Format,
Typecheck, Unit-Tests, Integrationstests und den Produktions-Build
ausführt. YAML-Syntax validiert; die Pipeline selbst kann in dieser Sandbox
nicht laufen (siehe Abschnitt 10), ist aber vollständig vorbereitet.

## 9. In dieser Sitzung tatsächlich ausgeführte Prüfungen

Alle Ergebnisse mit Werkzeug und Beleg tabellarisch in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#was-tatsächlich-lokal-in-dieser-sitzung-geprüft-wurde).
Zusammengefasst: Schema→SQL-Transpilation gegen echte Migration abgeglichen,
Migration + Seed gegen eingebettetes Postgres ausgeführt, Cross-Tenant-FK-
Isolation aktiv getestet, Tenant-Scoping-Query liefert nachweislich nur
eigene Zeilen (2/2 je Mandant), 54/54 Unit-Tests grün, ESLint 0
Fehler/Warnungen, Prettier für das gesamte Projekt sauber, beide
Verifikationsskripte reproduzierbar über npm-Skripte lauffähig.

## 10. Grenzen dieser Sitzung (Sandbox)

Kein Zugriff auf `binaries.prisma.sh` → `prisma generate`/`migrate`/
`validate` liefen nicht in dieser Sandbox, dadurch auch nicht:
`tests/integration/tenant-isolation.test.ts` mit echtem `@prisma/client`,
`npm run build`, manueller Start von `/review` im Browser. Alle drei sind
im Code vorbereitet und laufen automatisch beim ersten CI-Durchlauf bzw.
lokal nach `npm install && npx prisma generate && npx prisma migrate
deploy` (siehe [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)). Die
verbleibenden `tsc`-Fehler haben ausschließlich diese eine Ursache
(fehlende generierte Prisma-Typen), keinen echten Logikfehler.

## 11. Abweichung vom Auftrag

`package.json` deklarierte zum Zeitpunkt dieses Berichts (Phase 2)
`pnpm@9.15.9`, verwendet wurde jedoch durchgehend npm (inkl. CI), da pnpm
in dieser Sandbox mit den Datei-/Symlink-Restriktionen des gemounteten
Ordners unzuverlässig war. Damals offen dokumentiert und als "unkritisch,
rückgängig machbar" eingestuft.

**Update Phase 2B:** Diese Abweichung wurde in Phase 2B endgültig
aufgelöst statt zurückgebaut: npm ist jetzt der verbindliche, dauerhafte
Paketmanager dieses Projekts (`package.json` deklariert
`"packageManager": "npm@10.9.4"`), da kein funktionaler Vorteil von pnpm
identifiziert wurde. Details in [DECISION_LOG.md](DECISION_LOG.md).

## 12. Bekannte Altlasten und offene Punkte für den Auftraggeber

Drei funktionslose Dateien konnten wegen einer Sandbox-Restriktion
("Operation not permitted" bei jeder Lösch-/Umbenennungsoperation im
gemounteten Ordner) nicht entfernt werden und sollten manuell gelöscht
werden: `_tmp_20_be2baffc037932ce7dd80d17bf22a85a`,
`_tmp_20_e69110ec3545a176303bbf82f9937574`, `src/newdir/file.txt`. Keine
Sicherheits- oder Datenschutzrelevanz, kein Anwendungscode referenziert
sie. Danach: `npm install && npx prisma generate && npx prisma migrate
deploy` einmalig lokal ausführen, dann ist das Projekt vollständig
lauffähig.

## 13. Nächste Schritte und Stop-Bestätigung

Gemäß der ausdrücklichen Stop-Anweisung des Projektleiters wurde in dieser
Phase **nicht** begonnen mit: Fragen-Engine, Empfehlungs-Engine, fertiger
Mitarbeiteroberfläche. Diese bleiben wie in
[ARCHITECTURE.md](ARCHITECTURE.md) und
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) konzipiert, aber nicht
implementiert. Die Phase gilt hiermit als abgeschlossen; die Umsetzung
stoppt an dieser Stelle, bis der Projektleiter oder der Auftraggeber die
nächste Phase freigibt.
