# Entscheidungsprotokoll (Implementierungsphase)

Dieses Dokument hält technische Entscheidungen fest, die während der
Implementierung getroffen wurden und die nicht bereits durch die
Phase-1-Dokumente ([ARCHITECTURE.md](ARCHITECTURE.md),
[DATA_MODEL.md](DATA_MODEL.md) etc.) oder die Vorgaben des
ChatGPT-Projektleiters ("Prompt 2") festgelegt waren. Ziel: Nachvollziehbarkeit
für spätere Entwicklerinnen und Entwickler, warum etwas so und nicht anders
gebaut wurde.

## Geld als Integer in Minor-Units, niemals Float

**Entscheidung:** Alle Geldbeträge (`DealFinancialSnapshot`, Kommissionsmodelle,
Produktkosten) werden als `Int` in der kleinsten Währungseinheit (Cent)
gespeichert, begleitet von einem `currency Char(3)`-Feld (ISO 4217). Niemals
als JavaScript-`Float`/`Decimal`-Fließkommazahl.

**Warum:** Fließkommazahlen führen bei Geldbeträgen zu Rundungsfehlern
(z. B. `0.1 + 0.2 !== 0.3` in JavaScript), die sich bei Provisions- und
Preisberechnungen akkumulieren können. Ganzzahlige Minor-Units sind der
in der Branche etablierte Standard (vgl. Stripe, ISO-4217-Praxis).

## Mandantentrennung auf zwei unabhängigen Ebenen

**Entscheidung:** Primär über zusammengesetzte Datenbank-Fremdschlüssel
`(tenant_id, x_id) → (tenant_id, id)`, sekundär (defense in depth) über
einen Prisma Client Extension (`withTenantScope()`), der jede Query eines
mandantengebundenen Modells automatisch um `tenantId` ergänzt/validiert.

**Warum:** Die Datenbankebene ist die einzige Ebene, die nicht durch einen
vergessenen `where`-Filter im Anwendungscode umgangen werden kann – sie ist
daher die primäre Garantie. Die Anwendungsebene fängt zusätzlich Fälle ab,
die keinen Fremdschlüssel-Bezug haben (z. B. ein reiner `findUnique` per ID
ohne Verknüpfung zu einer Elterntabelle) und macht Fehler für
Entwicklerinnen und Entwickler sofort sichtbar (lauter Fehler statt
stillem Cross-Tenant-Leak).

**Alternative verworfen:** Ausschließlich Anwendungsebene (z. B. nur ein
ORM-Mixin/eine Middleware ohne DB-Constraints) – verworfen, weil ein
einzelner vergessener Filter dann direkt zu einem Datenleck zwischen
Mandanten führen würde, ohne dass die Datenbank dies verhindert.

## Prisma Client Extensions statt Middleware

**Entscheidung:** `client.$extends(...)` mit `query.$allModels.$allOperations`
statt des (in Prisma 5+ als deprecated markierten) `client.$use()`-Middleware-
Mechanismus.

**Warum:** Middleware ist in aktuellen Prisma-Versionen der veraltete Pfad;
Extensions sind der empfohlene, langfristig unterstützte Mechanismus für
genau diesen Anwendungsfall (Query-Argumente vor Ausführung modifizieren).

## `buildScopedArgs()` als reine, isolierte Funktion

**Entscheidung:** Die eigentliche Scoping-Logik (`src/server/tenant/scoped-client.ts`)
ist als reine Funktion `buildScopedArgs()` implementiert, die nur Objekte
entgegennimmt und zurückgibt – unabhängig vom eigentlichen Prisma-Client.
Der Client-Extension-Wrapper (`withTenantScope()`) ist nur eine dünne Hülle
darum.

**Warum:** Dadurch ist die sicherheitskritische Logik (welche Query-Form
bekommt welchen Tenant-Filter, welche Schreibversuche werden abgelehnt)
vollständig durch Unit-Tests ohne Datenbank und ohne generierten
Prisma-Client abdeckbar (`tests/unit/tenant-scope.test.ts`, 47 Testfälle).
Das war in der Sandbox dieser Sitzung zusätzlich notwendig, da kein
`prisma generate` möglich war – ist aber unabhängig davon die robustere
Testarchitektur.

## Ausnahmeliste statt Einschlussliste für globale Modelle

**Entscheidung:** `withTenantScope()` pflegt eine explizite Liste von
Modellen OHNE `tenantId` (`Tenant`, `Permission`, `Provider`), für die keine
Filterung stattfindet. Alle anderen Modelle werden automatisch als
mandantengebunden behandelt.

**Warum:** Wird dem Schema künftig ein neues mandantengebundenes Modell
hinzugefügt, greift der Schutz dafür automatisch, ohne dass diese Datei
angepasst werden muss. Ein neues globales Modell (ohne `tenantId`) muss
dagegen bewusst eingetragen werden – andernfalls schlägt jeder Zugriff
darauf sofort und laut fehl (da `tenantId` kein gültiges Feld wäre), statt
still falsch gefiltert zu werden.

## AsyncLocalStorage für Tenant-Kontext

**Entscheidung:** `src/server/tenant/context.ts` nutzt Node.js'
eingebautes `AsyncLocalStorage` statt z. B. eines globalen Singletons oder
manueller Parameterdurchreichung durch jede Funktionssignatur.

**Warum:** Jede Anfrage (und alle davon abgeleiteten asynchronen Aufrufe)
braucht einen isolierten, nicht überschreibbaren Kontext – insbesondere
bei parallel laufenden Requests in Next.js. `AsyncLocalStorage` ist dafür
der Node.js-native Mechanismus und wurde in
`tests/unit/tenant-context.test.ts` explizit gegen parallele/verschachtelte
Nutzung getestet.

## npm als verbindlicher Paketmanager (Phase 2B, endgültig)

**Entscheidung:** npm ist der verbindliche Paketmanager für dieses Projekt –
für lokale Entwicklung, CI und alle Skripte. `package.json` deklariert
`"packageManager": "npm@10.9.4"`, `package-lock.json` ist die einzige
committete Lockdatei. Es gibt kein offenes "Rückumstieg auf pnpm"-Vorhaben
mehr; eine ursprünglich in Phase 2 nur als Sandbox-Workaround dokumentierte
Abweichung wurde in Phase 2B zur endgültigen Festlegung erhoben.

**Warum:** pnpm führte in der Entwicklungs-Sandbox in Kombination mit
Datei-/Symlink-Restriktionen des gemounteten Projektordners zu
Installationsfehlern, während npm durchgängig verifiziert werden konnte
(lokal wie in CI). Da kein funktionaler Vorteil von pnpm für dieses Projekt
identifiziert wurde, der einen Wechsel rechtfertigen würde, wird die
pragmatisch gewählte Lösung zur dauerhaften Festlegung erklärt statt als
technische Schuld offengehalten. Siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) für den historischen
Kontext.

## `/review`-Seite als `force-dynamic`

**Entscheidung:** `src/app/review/page.tsx` setzt
`export const dynamic = "force-dynamic";`.

**Warum:** Die Seite soll immer den aktuellen Stand der Seed-Daten zeigen
(kein gecachtes/statisches Snapshot), und `next build` soll nicht von einer
zur Build-Zeit erreichbaren Datenbank abhängen.

## Fehlende Array-Defaults in zwei Schema-Feldern nachgezogen

**Entscheidung:** `CustomerAnswer.choiceValues` und
`RecommendationItem.exclusionReasonCodes` erhielten nachträglich
`@default([])`.

**Warum:** Beim tatsächlichen Ausführen des Seed-Datenflusses gegen eine
echte (eingebettete) Postgres-Instanz schlug die Insertion fehl
(`null value ... violates not-null constraint`), da das Seed-Skript diese
Felder für bestimmte Antworttypen (boolesch/numerisch) bewusst wegließ. Der
Fehler wurde durch tatsächliche Ausführung gefunden, nicht durch reines
Code-Review – siehe [TEST_STRATEGY.md](TEST_STRATEGY.md) zum Prinzip
"Verifikation statt Behauptung".
