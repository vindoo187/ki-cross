# IMPLEMENTIERUNGSPLAN – PHASE 8: SICHERE FACHADMINISTRATION (TEIL 1: FRAGEN & FRAGEBOGENVERSIONEN)

## 0. Bestätigter Ausgangsstand

Phase 7 (Management Analytics & Vertriebssteuerung) ist offiziell abgeschlossen:
finaler Commit `29d8241`, CI #37 grün, ChatGPT-GO vom 2026-08-18.

Phase 8 AP0 (Discovery, keine Implementierung) ist abgeschlossen:
`PHASE_8_DISCOVERY.md`, Commit `9e2b887`. ChatGPT hat den Befund akzeptiert
und eine verbindliche Scope-Entscheidung getroffen:

**Phase 8 = Sichere Fachadministration – Teil 1: Fragen & Fragebogenversionen**,
bestehend aus zwei eng gekoppelten Teilen:

- **Teil A** – produktionsfähige Identitäts-/Auth-Grundlage für schreibende
  Admin-Funktionen (Voraussetzung, kein separates späteres Nachziehen).
- **Teil B** – vollständiger Draft → Validate → Publish-Workflow für Fragen
  und Fragebogenversionen.

**Explizit NICHT in Phase 8** (ChatGPT, wörtlich): Regel-Editor,
Campaign-Management, Ziele, Provisionsmodell-Editor, visueller
Regel-Builder, Freitext-KI. Diese werden erst nach einem erfolgreichen
ersten vertikalen Slice angegangen.

**Zentrale Leitplanke (ChatGPT, wörtlich verbindlich):** "Draft → Validate →
Publish" — keine direkte Mutation einer bereits veröffentlichten
(`ACTIVE`) Version. Bestehende Beratungen bleiben auf ihrer ursprünglich
gepinnten `QuestionnaireVersion`.

**Verbindliche Vorgabe für AP1 (ChatGPT, wörtlich):** AP1 muss zuerst die
konkrete aktuelle Auth-Architektur code-verifizieren, bevor irgendeine
Auth-Technologie festgelegt wird — kein vorschneller externer Identity
Provider, falls der bestehende Stack bereits eine sinnvolle Basis bietet.
Dieser Plan enthält diese Code-Verifikation bereits (Abschnitt 1), da sie
für eine sinnvolle Aufwandsschätzung nötig war; AP1 selbst vertieft und
verifiziert sie erneut vor der eigentlichen Umsetzung.

**Status dieses Plans:** Entworfen auf Basis von `PHASE_8_DISCOVERY.md` und
zusätzlicher Code-Verifikation der Auth-/Schema-Grundlage (Abschnitt 1).
Geht als Nächstes an ChatGPT zur Prüfung (wie in jeder Vorphase), danach an
den Nutzer zum expliziten Implementierungs-GO — dies ist der erste
Entscheidungspunkt seit dem Nutzer-Auftrag, eigenständig weiterzuarbeiten,
weil Phase 8 erstmals produktionsnahen Auth-Code betrifft.

## 1. Zusätzliche Ist-Analyse (über AP0 hinaus, für Aufwandsschätzung nötig)

### 1.1 Bestehender Auth-Mechanismus im Detail

`src/server/auth/session.ts`: Session-Tokens sind bereits
**HMAC-SHA256-signiert** (`base64url(JSON-Payload) + "." + hex(HMAC)`,
Secret aus `DEV_AUTH_SECRET`), mit `timingSafeEqual`-Signaturprüfung,
Ablaufzeit (8 Stunden) und korrekter `Secure`-Cookie-Logik basierend auf
dem tatsächlichen Transportprotokoll (nicht `NODE_ENV`). Das
**Signierungs-/Session-Cookie-Fundament ist bereits solide** und muss nicht
neu gebaut werden.

**Die eigentliche Lücke:** `src/app/api/auth/dev-login/route.ts` verlangt
ausschließlich eine `employeeId` (UUID) — **kein Passwort, kein sonstiger
Nachweis**. Jeder mit Kenntnis einer beliebigen `employeeId` kann sich als
dieser Mitarbeiter jedes Mandanten anmelden (`buildSessionPayloadForEmployee()`
in `src/server/auth/dev-users.ts`, arbeitet bewusst mit `rawPrismaClient`
außerhalb der sonst erzwungenen Tenant-Isolation). Explizit als "NICHT
produktionsreif" dokumentiert.

**Schema-Befund:** `model User` (`prisma/schema.prisma` Zeilen 307–325) hat
**kein Credential-Feld** (kein `passwordHash`, keine vergleichbare Spalte) —
grep über `prisma/schema.prisma` und `src/server` nach `password` ergibt 0
Treffer. Ein echter Login erfordert also zwingend eine Schema-Erweiterung.

### 1.2 Bewertung: Ausbau des bestehenden Stacks vs. externer IdP

Gegen einen externen Identity Provider (z. B. Auth0, Clerk, Keycloak) in
dieser Phase:

- Zusätzliche externe Abhängigkeit/Netzwerk-Zugriff für ein
  synthetisch-getriebenes Pilotsystem ohne echte Endnutzer-Registrierung.
- Das bestehende `User`/`RoleAssignment`/`Role`/`Permission`-Modell ist
  bereits vollständig vorhanden und aus Phase 7 bekannt korrekt verdrahtet
  — ein externer IdP würde eine parallele Identitätsquelle einführen, die
  gegen dieses Modell synchronisiert werden müsste.
- Die Session-/Cookie-Schicht ist bereits produktionsnah (HMAC, Secure-Flag,
  Ablaufzeit) — nur der **Anmeldenachweis** fehlt, nicht die Session an
  sich.

**Vorschlag (zur Bestätigung an ChatGPT, siehe Abschnitt 15):** Minimaler
Ausbau des bestehenden Stacks statt externem IdP — Passwort-Hash-Feld auf
`User`, echte Credential-Prüfung, bestehende `createSessionToken()`/
`verifySessionToken()`-Mechanik unverändert weiterverwenden. Kein Enterprise-
IdP, kein OAuth/SSO in dieser Phase.

### 1.3 Abgrenzung zum bestehenden Mitarbeiter-Login (Konsultationsfluss)

Der bestehende `dev-login`-Fluss (Mitarbeiter wählt sich ohne Passwort für
die Kundenberatung ein) ist Teil des seit Phase 5 stabilen,
vielfach getesteten Beratungs-Flows und **ausdrücklich nicht Gegenstand
dieser Phase** (ChatGPT: "nicht als Phase 8 komplett dazwischenwerfen").

**Vorschlag (zur Bestätigung an ChatGPT, siehe Abschnitt 15):** Der neue
Credential-Login schützt **ausschließlich** die neuen Admin-/Konfigurations-
Routen (`/admin/*`, `config.*`-APIs). Der bestehende `dev-login` bleibt für
den Beratungsfluss unverändert bestehen und wird in Phase 8 nicht
angetastet. Beide Mechanismen erzeugen dasselbe `SessionPayload`-Format
(gleiche Signierung, gleiches Cookie) — ein Admin-User hat zusätzlich zur
Passwort-Prüfung dieselbe Session-Struktur wie ein per `dev-login`
angemeldeter Mitarbeiter, nur mit zusätzlichen `config.*`-Permissions. Ein
vollständiger Ersatz von `dev-login` durch echtes Auth für **alle** Nutzer
wäre ein eigenes, größeres Vorhaben (siehe Abschnitt 14, Risiken) und bleibt
außerhalb dieser Phase.

### 1.4 Bestehende Versionierungs-/Audit-Infrastruktur (Wiederverwendung)

- `VersionStatus` (DRAFT/ACTIVE/EXPIRED/ARCHIVED) existiert bereits auf
  `QuestionnaireVersion` und `QuestionVersion` inkl. `validFrom`/`validTo`.
- `ConsultationSession` pinnt bereits eine konkrete
  `questionnaireVersionId` — der Bestandsschutz für laufende Beratungen ist
  strukturell bereits erfüllt, sobald neue Versionen sauber über
  `VersionStatus` verwaltet werden.
- Zwei Audit-Tabellen existieren: `AuditLog` (generisch, `entityType`/
  `entityId`/`action`/`metadata: Json`, bereits produktiv für
  Antwort-Events genutzt) und `ConfigurationChange` (spezifisch
  `configKey`/`oldValue: String?`/`newValue: String`, für **skalare**
  Konfigurationswerte gedacht, laut Modul-Kommentar z. B. "ConfigurableThreshold
  oder RetentionPolicy"). **Offener Punkt:** `ConfigurationChange` passt vom
  Datenmodell her gut zu einzelnen Skalarwerten, aber Fragen/Versionen sind
  strukturierte Mehrfeld-Entitäten (Label, Antworttyp, Optionen,
  Sichtbarkeitsregeln). Vorschlag siehe Abschnitt 15, Klärungspunkt 3.

## 2. Scope-Rahmen (aus AP0-Review + ChatGPT-Scope-Entscheidung, verbindlich)

**In Scope:**

- Passwort-Hash-Feld + echte Credential-Prüfung für Admin-Zugänge
  (additiv zum bestehenden `User`-Modell, bestehender `dev-login`
  unverändert).
- Neue `config.*`-Permissions (deny-by-default, analog Phase-7-Muster) und
  mindestens eine synthetische Admin-Rolle je Tenant.
- Draft → Validate → Publish-Workflow für `Question`/`QuestionVersion`/
  `QuestionnaireVersion` (Erstellen, Bearbeiten im Entwurf, Validieren,
  Veröffentlichen, Versionshistorie, Rollback als neue Publish-Aktion nicht
  als Mutation).
- Admin-UI für Fragen-/Fragebogenverwaltung (Liste, Editor, Publish-Flow).
- Audit-Trail für alle Config-Änderungen.
- Vollständige Security-/Regressionstests analog Phase-7-Muster
  (Tenant-Isolation, Permission-Grenzen, IDOR, Bestandsschutz laufender
  Beratungen).

**Out of Scope (ChatGPT, wörtlich):** Regel-Editor (`RuleSet`/
`EligibilityRule`/etc.), Campaign-Management, Ziele-Modell,
Provisionsmodell-Editor, visueller Regel-Builder, Freitext-KI,
vollständiger Ersatz von `dev-login` für den Beratungsfluss, externer
Identity Provider/SSO.

## 3. Architektur-Entscheidungen dieses Plans

### 3.1 Admin-Auth als additive Erweiterung (nicht Ersatz)

- `User` erhält ein neues Feld `passwordHash: String?` (nullable, da nur
  Admin-User ein Passwort erhalten — synthetische Beratungs-Mitarbeiter
  bleiben auf `dev-login` und brauchen kein Passwort).
- Neue Route `POST /api/auth/admin-login`: `email` + `password` →
  `bcrypt.compare()` gegen `passwordHash` → bei Erfolg dieselbe
  `createSessionToken()`-Funktion wie `dev-login`, nur mit den
  `config.*`-Permissions/RoleAssignment-Daten des Admin-Users im Payload.
- Admin-Routen (`/admin/*`, `/api/admin/*`) prüfen serverseitig zwingend
  eine gültige Session **mit** mindestens einer `config.*`-Permission —
  identisches Muster zu `withServerSessionTenantContext()` aus Phase 7,
  keine neue Middleware-Architektur.
- Kein Self-Service-Registrierungsflow — Admin-User werden (wie bisher
  jede fachliche Konfiguration) über `prisma/seed.ts` angelegt, mit einem
  synthetischen, klar gekennzeichneten Test-Passwort ausschließlich für
  Entwicklung/Pilot (dokumentiert als NICHT produktionsreif für die
  Passwortvergabe selbst — ein echter Passwort-Reset-/Einladungsflow ist
  außerhalb dieser Phase).

### 3.2 Configuration-RBAC (ChatGPT-Vorgabe: kein pauschales `admin.*`)

Neue Permission-Keys, analog zum bestehenden `analytics.view_*`-Muster:

- `config.questions.view`
- `config.questions.edit` (Entwürfe erstellen/ändern)
- `config.questions.publish` (validieren/veröffentlichen)

**Default-Rollenmodell (Vorschlag, siehe Abschnitt 15):** Eine Rolle
`config_editor` (view + edit) und eine Rolle `config_publisher` (view +
edit + publish) je Tenant, mit je einem synthetischen Test-Admin-User.
Deny-by-default bleibt Leitlinie — ein User ohne diese Permissions bekommt
auf `/admin/*` eine generische Zugriffsverweigerung, keine Fehlermeldung,
die Rückschlüsse auf Struktur/Existenz zulässt (gleiches Muster wie
`/analytics/management` in Phase 7).

### 3.3 Draft → Validate → Publish – konkrete Zustandsmaschine

Nutzt die bereits vorhandene `VersionStatus`-Spalte, führt aber erstmals
**Schreibpfade** dafür ein:

```
DRAFT --validate()--> DRAFT (mit Validierungsergebnis)
DRAFT --publish()--> ACTIVE (vorherige ACTIVE-Version -> EXPIRED, validTo gesetzt)
ACTIVE --archive()--> ARCHIVED (nur wenn keine offene Beratung mehr referenziert
                                  bzw. rein additiv, siehe unten)
```

- **Keine Mutation einer `ACTIVE`-Version.** Jede Änderung an einer bereits
  veröffentlichten Frage erzeugt eine **neue** `QuestionVersion`/
  `QuestionnaireVersion` im Status `DRAFT`.
- `publish()` einer `QuestionnaireVersion` setzt die bisherige
  `ACTIVE`-Version desselben `Questionnaire` auf `EXPIRED`
  (`validTo = now()`), die neue Version auf `ACTIVE`
  (`validFrom = now()`) — **in einer DB-Transaktion**, um die bestehende
  PostgreSQL-EXCLUDE-Constraint gegen überlappende Gültigkeitszeiträume
  nicht zu verletzen.
- **Rollback** = Veröffentlichen einer vorherigen (bereits existierenden,
  jetzt `EXPIRED`/`ARCHIVED`) Version als neue `ACTIVE`-Version — keine
  Mutation der Historie, sondern ein neuer Publish-Vorgang mit einer
  Kopie/Referenz der alten Version. Details in AP5.
- Validierung (AP4) läuft **vor** jedem `publish()` und prüft mindestens:
  vollständige Pflichtfelder, gültiger `AnswerType`, gültige
  `AnswerOption`-Menge (bei `MULTIPLE_CHOICE`/`SINGLE_CHOICE`), gültige
  `VisibilityCondition`-Referenzen (Zielfrage existiert in derselben
  `QuestionnaireVersion`), keine widersprüchlichen `minValue`/`maxValue`
  bzw. `minSelections`/`maxSelections`, keine Zeitraumüberschneidung
  (letzte Sicherheitslinie bleibt die bestehende DB-EXCLUDE-Constraint).

### 3.4 Bestandsschutz laufender Beratungen (bereits strukturell vorhanden)

`ConsultationSession.questionnaireVersionId` pinnt bereits eine konkrete
Version. `publish()` einer neuen `QuestionnaireVersion` ändert **keine**
bestehende `ConsultationSession`-Zeile. Neue Beratungen lesen die aktuell
`ACTIVE`-Version zum Startzeitpunkt (bestehende Logik, unverändert). AP6
liefert hierfür einen expliziten Regressionstest statt neuer Logik.

## 4. AP1 – Auth-Grundlage für Admin-Zugänge

- Migration: `passwordHash: String?` auf `User` (siehe 3.1).
- `bcrypt`-Abhängigkeit prüfen/ergänzen (Hashing serverseitig, kein
  Klartext-Passwort jemals persistiert oder geloggt).
- Neues Modul `src/server/auth/admin-login.ts`:
  `verifyAdminCredentials(tenantId, email, password): Promise<User | null>`
  — konstante Zeitkomplexität unabhängig davon, ob der User existiert
  (`bcrypt.compare()` auch bei nicht existierendem User gegen einen
  Dummy-Hash, Timing-Angriffe auf Nutzer-Enumeration erschweren).
- Route `POST /api/auth/admin-login`: Zod-validiert `email`+`password`,
  ruft `verifyAdminCredentials()`, baut bei Erfolg ein `SessionPayload`
  (gleiche Struktur wie `dev-login`, inkl. `roles`/`managementScope`) und
  setzt dasselbe signierte Cookie.
- Seed: mindestens ein synthetischer Admin-User je Tenant mit
  Test-Passwort (klar als synthetisch/Test gekennzeichnet, wie alle
  bisherigen Seed-Daten).
- Tests: korrektes Passwort → Session, falsches Passwort → 401,
  unbekannte E-Mail → 401 (nicht unterscheidbar von falschem Passwort,
  keine Nutzer-Enumeration), Rate-Begrenzung **explizit außerhalb dieses
  APs** (siehe Abschnitt 14, Risiken).

## 5. AP2 – Configuration-RBAC

- Vier neue `Permission`-Zeilen (`config.questions.view/edit/publish`,
  siehe 3.2) im Seed.
- Zwei neue Rollen `config_editor`/`config_publisher` je Tenant + je ein
  synthetischer Admin-User mit passender `RoleAssignment`
  (`scopeType: TENANT` — Fragen/Fragebögen sind mandantenweit, nicht
  filialgebunden, analog bestehendem `Questionnaire.tenantId`-Modell ohne
  `storeId`-Bezug).
- Middleware-Helfer `requireConfigPermission(permission)` analog
  `resolveAuthorizedStoreFilter()`-Architekturmuster aus Phase 7: prüft
  **vor** jeder Admin-Route-Logik, wirft bei fehlender Berechtigung einen
  eigenen `ConfigAccessDeniedError` → HTTP 403.
- Tests: alle drei Permission-Stufen (view/edit/publish), Editor ohne
  Publish-Recht darf `publish()` nicht aufrufen, User ganz ohne
  `config.*`-Permission → 403 auf jeder Admin-Route (deny-by-default).

## 6. AP3 – Question Management API (Draft-Ebene)

- `GET /api/admin/questionnaires` — Liste aller `Questionnaire`s mit ihren
  Versionen + Status.
- `GET /api/admin/questionnaires/:id/versions/:versionId` — Detailansicht
  einer Version inkl. aller `Question`/`QuestionVersion`/`AnswerOption`/
  `VisibilityCondition`.
- `POST /api/admin/questionnaires/:id/versions` — neue `DRAFT`-Version
  anlegen (leer oder als Kopie der aktuellen `ACTIVE`-Version — Kopie ist
  der praktisch relevante Fall, "leer" nur für komplett neue Fragebögen).
- `PATCH /api/admin/questionnaires/:id/versions/:versionId/questions/:questionId`
  — Frage in einer `DRAFT`-Version bearbeiten. **Serverseitige Sperre:**
  Versuch, eine `ACTIVE`/`EXPIRED`/`ARCHIVED`-Version zu mutieren → 409
  Conflict (nicht stillschweigend ignorieren).
- `POST .../questions` / `DELETE .../questions/:id` — Frage in einer
  `DRAFT`-Version hinzufügen/entfernen (inkl. `AnswerOption`s,
  `VisibilityCondition`s als verschachtelte Payload, analog bestehendem
  Muster aus der Fragen-Engine-Service-Schicht).
- Alle Mutationen ausschließlich über `requireConfigPermission("config.questions.edit")`.

## 7. AP4 – Validate & Publish

- `POST /api/admin/questionnaires/:id/versions/:versionId/validate` —
  führt die in 3.3 beschriebenen Prüfungen aus, liefert strukturierte
  Fehlerliste (kein Boolean, sondern nachvollziehbare Einzelbefunde für
  die UI).
- `POST /api/admin/questionnaires/:id/versions/:versionId/publish` —
  validiert erneut serverseitig (niemals nur auf Client-Validierung
  vertrauen), führt bei Erfolg die Transaktion aus 3.3 aus
  (`ACTIVE`-Wechsel + `EXPIRED`-Setzen der Vorgängerversion).
  `requireConfigPermission("config.questions.publish")` — **getrennt** von
  `edit`, damit ein Editor ohne Publish-Recht Entwürfe bauen, aber nicht
  live schalten kann (Rollenmodell aus 3.2).
- Fehler-Mapping: Validierungsfehler → 422 mit Fehlerliste,
  Publish-Versuch einer bereits nicht mehr `DRAFT`-Version → 409.

## 8. AP5 – Questionnaire-Version-Historie & Rollback

- `GET /api/admin/questionnaires/:id/versions` — vollständige Historie mit
  Status/Zeitraum je Version.
- `POST /api/admin/questionnaires/:id/versions/:versionId/rollback` — wie
  in 3.3 beschrieben: erzeugt eine neue `DRAFT`-Version als Kopie der
  gewählten historischen Version, die dann regulär durch Validate/Publish
  läuft (kein direkter Statuswechsel einer alten Version zurück auf
  `ACTIVE`, um die Append-only-/Nicht-Mutations-Leitplanke nicht zu
  durchbrechen).
- Test (business-kritisch, ChatGPT-Beispiel wörtlich übernommen): Beratung
  A startet auf Version 3 → Admin veröffentlicht Version 4 → Beratung A
  bleibt auf Version 3, eine neue Beratung B verwendet Version 4.

## 9. AP6 – Admin UI

- Neue Route `/admin/questions` (analog `/analytics/management`-Struktur
  aus Phase 7: Server Component, `requireConfigPermission("config.questions.view")`,
  generische "Kein Zugriff"-Seite bei fehlender Berechtigung).
- Fragenliste mit Such-/Filterfunktion, Status-Badges (DRAFT/ACTIVE/
  EXPIRED/ARCHIVED).
- Fragen-Editor: Antworttyp, Optionen, Sichtbarkeitsregeln, Reihenfolge —
  nur innerhalb einer `DRAFT`-Version editierbar, UI zeigt read-only-Status
  für nicht-Draft-Versionen deutlich an (kein still deaktivierter Button
  ohne Erklärung).
- Validieren-Button (zeigt Fehlerliste aus AP4 strukturiert an),
  Veröffentlichen-Button (nur sichtbar/aktiv mit `publish`-Permission,
  sonst ausgeblendet — kein "Button da, aber Klick schlägt fehl").
- Versionshistorie-Ansicht mit Rollback-Aktion.
- Bewusst **kein** Drag&Drop-Page-Builder, kein WYSIWYG — einfache
  Formularfelder analog dem bisherigen Phase-6-Prinzip ("schlicht gehalten,
  kein Overengineering").

## 10. AP7 – Audit

- Jede Mutation (CREATE/UPDATE einer Draft-Frage, PUBLISH, ROLLBACK)
  schreibt einen `AuditLog`-Eintrag (`entityType: "Question"` bzw.
  `"QuestionnaireVersion"`, `action`, `actorUserId`, `metadata: Json` mit
  Vorher-/Nachher-Diff) — konsistent mit dem bereits produktiv genutzten
  `AuditLog`-Muster aus `questionnaire/service.ts`.
- `ConfigurationChange`-Nutzung: siehe offener Klärungspunkt Abschnitt 15.3
  — Vorschlag, `ConfigurationChange` in dieser Phase **nicht** für
  strukturierte Fragen-/Versions-Änderungen zu verwenden (Datenmodell passt
  nicht gut), sondern `AuditLog` als alleinigen Audit-Mechanismus für Phase
  8 zu nutzen. Zur Bestätigung an ChatGPT.
- Keine frei editierbaren Audit-Daten — `AuditLog` bleibt append-only wie
  bisher (bestehende DB-Absicherung, keine neue nötig).

## 11. AP8 – Security & Regression

- Tenant-Isolation: Admin-User von Tenant A kann keine `Questionnaire`s von
  Tenant B sehen/ändern (bestehendes Tenant-Isolationstest-Muster).
- Permission-Grenzen: `config_editor` kann nicht `publish()` aufrufen (403),
  User ohne `config.*` kann keine Admin-Route erreichen (403).
- Mutations-Sperre: Versuch, eine `ACTIVE`/`EXPIRED`/`ARCHIVED`-Version zu
  mutieren → 409, nicht stillschweigend erfolgreich.
- IDOR: manipulierte `questionnaireId`/`versionId`/`questionId` außerhalb
  des eigenen Tenants → 403/404, nicht "leeres Ergebnis".
- Bestandsschutz-Test aus AP5 (Beratung bleibt auf gepinnter Version).
- Admin-Login: falsches Passwort, unbekannte E-Mail, abgelaufene Session
  — alle bestehenden Session-Tests aus Phase 5/7 als Regressionsbasis.
- Component-Tests für Admin-UI (Editor, Validate/Publish-Flow,
  "Kein Zugriff"-Fall, read-only-Darstellung nicht-Draft-Versionen).

## 12. AP9 – Hardening/CI

Lokale Vollverifikation (Lint, Format, `tsc --noEmit`, Unit-/
Integrationstests, `verify_migration_pglite.mjs` für die neue
`passwordHash`-Migration), Commit, Push durch Nutzer, CI-Prüfung — wie in
jeder Vorphase.

## 13. AP10 – Abschlussbericht Phase 8

Analog `docs/ABSCHLUSSBERICHT_PHASE7.md`: Commit-Tabelle, Testzahlen,
Scope-Entscheidungen, Umsetzungsstand je AP, GO/NO-GO-Abschnitt, explizite
Auflistung dessen, was bewusst nicht implementiert wurde (Regeln,
Kampagnen, Ziele, Provisionsmodelle, Freitext-KI, vollständiger
`dev-login`-Ersatz).

## 14. Risiken

- **Admin-Passwortvergabe bleibt Seed-basiert (3.1):** kein
  Passwort-Reset-/Einladungsflow in dieser Phase — für einen echten
  Produktivbetrieb mit echten (nicht-synthetischen) Admin-Nutzern wäre das
  ein Folge-Thema, hier explizit ausgeklammert und dokumentiert.
- **Keine Rate-Begrenzung auf `/api/auth/admin-login` in AP1** — für ein
  synthetisches Pilotsystem ohne öffentliches Internet-Exposure akzeptiert,
  aber explizit als bekannte Einschränkung im Abschlussbericht zu nennen
  (Brute-Force-Schutz wäre ein Produktionshärtungs-Thema).
- **Zwei parallele Login-Mechanismen** (`dev-login` für Beratung,
  `admin-login` für Konfiguration) erhöhen die Komplexität der
  Auth-Landschaft geringfügig — bewusst in Kauf genommen, um den
  bestehenden, gut getesteten Beratungsfluss nicht anzufassen (siehe 1.3).
  Eine spätere Vereinheitlichung ist ein eigenes Thema, kein Teil von
  Phase 8.
- **EXCLUDE-Constraint-Konflikt bei `publish()`:** Die bestehende
  PostgreSQL-EXCLUDE-Constraint gegen überlappende Gültigkeitszeiträume
  greift erst bei tatsächlichem `INSERT`/`UPDATE` — die Publish-Transaktion
  aus 3.3 muss so konstruiert sein, dass die alte Version **zuerst** auf
  `EXPIRED`/`validTo` gesetzt wird, bevor die neue Version aktiv wird,
  sonst schlägt die Transaktion an der Constraint fehl (guter Fehlerfall,
  aber die Reihenfolge muss in AP4 bewusst getestet werden).
- **Validierungslücke Visibility-Conditions über Versionsgrenzen:** Eine
  `VisibilityCondition` referenziert eine `Question` (stabil über
  Versionen) und eine `QuestionVersion` (konkrete Version) — der
  AP4-Validator muss sicherstellen, dass beide zur selben
  `QuestionnaireVersion` gehören, sonst könnten in einer neuen Version
  Sichtbarkeitsregeln auf nicht mehr existierende Fragen zeigen.

## 15. Klärungspunkte für ChatGPT (vor Umsetzungsstart)

1. **Admin-Auth als additive Erweiterung statt Ersatz (3.1, 1.3):** Stimmt
   ChatGPT zu, dass der neue Credential-Login ausschließlich die
   Admin-/Konfigurationsflächen schützt, während der bestehende
   `dev-login` für den Beratungsfluss unverändert bleibt? Alternative wäre
   ein vollständiger Auth-Ersatz für alle Nutzer, was aber deutlich größer
   und laut ChatGPTs eigener Vorgabe ("nicht als Phase 8 komplett
   dazwischenwerfen") vermutlich nicht gewollt ist.
2. **Passwort-Hash statt externem IdP (1.2):** Bestätigung, dass ein
   minimaler Ausbau (bcrypt-Hash auf `User`, Seed-basierte
   Admin-Test-User) für Phase 8 ausreicht und kein externer Identity
   Provider/SSO angebunden werden soll.
3. **`ConfigurationChange` vs. `AuditLog` für Fragen-Audit (1.4, AP7):**
   Vorschlag, `AuditLog` (bereits produktiv, passt strukturell besser zu
   Mehrfeld-Entitäten) als alleinigen Audit-Mechanismus für Phase 8 zu
   nutzen und `ConfigurationChange` unangetastet zu lassen (späterer Fokus:
   echte Skalar-Konfigurationswerte wie Schwellenwerte). Abweichung von
   "ConfigurationChange endlich produktiv verwenden" — bitte explizit
   bestätigen oder korrigieren.
4. **Rollenmodell `config_editor`/`config_publisher` (3.2):** Passt die
   Zwei-Rollen-Trennung, oder soll es für den synthetischen Pilotbetrieb
   zunächst nur eine kombinierte Rolle geben (ChatGPT hatte beide Optionen
   als akzeptabel genannt: "Falls das für das tatsächliche Betriebsmodell
   zu komplex ist, können beide zunächst dieselbe Rolle bekommen")?
5. **Scope-Ebene der neuen Rollen:** Bestätigung `TENANT`-Scope für
   `config.*`-Permissions (Fragen/Fragebögen sind mandantenweit modelliert,
   kein `storeId`-Bezug im Schema) — analog zur höchsten Stufe aus Phase 7,
   aber ein eigenständiges Konzept, kein Wiederverwenden von
   `managementScope`.

Nach Klärung dieser fünf Punkte: Plan geht zur finalen Abnahme an ChatGPT,
danach explizites Nutzer-Implementierungs-GO (wie in allen Vorphasen) —
dies ist der im Nutzer-Auftrag vorgesehene erste "wichtige Entscheidung"-
Haltepunkt.
