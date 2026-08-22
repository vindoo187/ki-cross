# Phase 11 – Discovery: Ziele-Modell (AP0)

Stand: 2026-08-22. Vierte von ChatGPT vorgeschlagene, vom Nutzer bestätigte
Fachadministrations-/Steuerungsphase nach Provisionsmodell-Editor (Phase 10).
Bestätigte Gesamt-Reihenfolge: Provisionsmodell-Editor → **Ziele-Modell** →
Freitext-KI-Angebot → Campaign-Management.

Dieses Dokument fasst den Ist-Zustand zusammen und listet die zentralen,
noch offenen Architekturfragen, die vor einem Implementierungsplan mit
ChatGPT geklärt werden müssen (identisches Vorgehen wie AP0 in Phase 6–10).

## 1. Was "Ziele" im Projekt bisher bedeutet (nur Konzept, keine Implementierung)

Der Begriff taucht an drei Stellen in der bestehenden Dokumentation auf,
aber es existiert **keine einzige Codezeile und kein Datenbankmodell**
dazu:

1. `docs/DATA_MODEL.md` (Zeile 13, 189): `Goal` (Ziel-Objekt) wird explizit
   als "Phase-1-Konzept" geführt, das **bewusst noch nicht** Teil des
   implementierten Schemas ist ("ihr Bau ist ausdrücklich für eine spätere
   Phase vorgesehen").
2. `docs/RECOMMENDATION_ENGINE.md` (Zeile 30): in der ursprünglichen
   Konzeption sollten "unternehmensweite `Goal`-Vorgaben (z. B.
   Cross-Selling-Schwerpunkt DSL im Quartal)" als dritter Faktor (neben
   Marge und `Campaign`) in die geschäftliche Priorisierung
   (`PrioritizationRule` → `priority_score`) einfließen.
3. `docs/ANALYTICS_AND_KPIS.md`: keine explizite Erwähnung von Zielwerten,
   aber das Dashboard-Darstellungsprinzip ("Wert, Zeitraum,
   Vergleichswert (Vorperiode)") zeigt schon eine Lücke: es gibt aktuell
   nur einen Vorperiodenvergleich, keinen Vergleich gegen eine **Vorgabe**.

**Fazit:** Es gibt keine vorgegebene Datenstruktur, an der sich Phase 11
1:1 orientieren könnte (anders als z. B. Phase 10, wo `CommissionModel`
seit Phase 3B vollständig im Schema stand). Phase 11 startet strukturell
näher an Phase 6 (Analytics-Grundlage) als an Phase 8–10.

## 2. Bestehende, wiederverwendbare Infrastruktur

### 2.1 Organisationshierarchie (Tenant → Company → Store → Employee)

Vollständig vorhanden, inkl. `RoleScopeType` (`TENANT`/`COMPANY`/`STORE`)
auf `RoleAssignment`. Zwei bereits etablierte, laut Code-Kommentar
**bewusst getrennte** Autorisierungsarchitekturen bauen darauf auf:

- **Config-Permissions** (`src/server/authz/config-permissions.ts`):
  `config.questions.*` / `config.rules.*` / `config.commissions.*` –
  ausschließlich TENANT-scoped, weil die zugrunde liegenden fachlichen
  Objekte (Fragebögen, Regelwerke, Provisionsmodelle) mandantenweit
  modelliert sind. Deny-by-default, additiv zu den bestehenden
  `config_editor`/`config_publisher`-Rollen.
- **Management-Scope** (`src/server/authz/management-scope.ts` +
  `src/server/analytics/management-authz.ts`, Phase 7): löst auf, welche
  `storeId`-Menge eine Rolle mit `COMPANY`-/`TENANT`-Scope einsehen darf
  (`resolveAuthorizedStoreFilter()`), mit striktem IDOR-Schutz (ein
  angefragter Filter darf den Scope nur einschränken, nie erweitern).

Ein Modul-Kommentar in `config-permissions.ts` hält ausdrücklich fest:
_"Getrennt von der Management-Analytics-Scope-Architektur aus Phase 7 –
ChatGPT wörtlich: Die bestehende Phase-7-Management-Scope-Architektur
bleibt davon getrennt."_ Diese Trennung ist für Phase 11 zentral (siehe
Abschnitt 4.2).

### 2.2 Live-KPI-Aggregation (`src/server/analytics/kpis.ts`, Phase 6/7)

Reine, ungespeicherte Aggregationsfunktionen gegen `ConsultationSession`,
`Recommendation`/`RecommendationOutcome`, `Deal`/`DealFinancialSnapshot` –
**kein** `KpiSnapshot`-Mechanismus (explizite ChatGPT-Vorgabe in Phase 6:
"kein Snapshot-Mechanismus"). Zentrale Typen: `KpiPeriodFilter` (`from`,
`to`, optional `storeId`/`storeIds`/`employeeId`) und die Ergebnistypen
`ConsultationVolumeKpi`, `RecommendationOutcomeKpi`, `DealKpiByCurrency[]`
(Deal-KPIs sind **pro Währung** aufgeschlüsselt, keine blinde Summe).

Wichtig: `from`/`to` sind aktuell **freie, vom Dashboard gewählte
Datumsgrenzen** – es gibt noch **kein Konzept eines festen Kalender-
Zeitraums** (Monat/Quartal/Jahr) im System. Für ein Ziele-Modell ("Ziel
Q3 2026") ist das eine echte Lücke, keine Wiederverwendung.

### 2.3 Versionierungsmuster Draft → Validate → Publish (Phase 8/9/10)

Etabliertes, dreifach bewährtes Muster für **mandantenweit gültige
Einzelkonfigurationen mit genau einer aktiven Version** (Fragebogen,
RuleSet, CommissionModel): `DRAFT → validate() → publish() → ACTIVE`
(vorherige Version → `EXPIRED`), Row-Lock gegen Concurrency, Audit atomar
in derselben Transaktion, Versionshistorie mit Rollback/"neuer Entwurf
aus historischer Version".

**Zentrale strukturelle Frage für Phase 11 (siehe Abschnitt 4.1):** Ziele
sind ihrer Natur nach **periodisch und parallel koexistierend** (ein Ziel
für Q3 ersetzt nicht das Ziel für Q2 – beide bleiben als Historie
gültig), nicht **eine einzige aktuell gültige Version, die die vorherige
ablöst**. Das Draft→Publish→ACTIVE/EXPIRED-Muster passt strukturell
NICHT 1:1, anders als bei den drei Vorgängerphasen.

### 2.4 Sonstige wiederverwendbare Bausteine

- `AuditLog` (append-only, `CREATE`/`UPDATE`/`ACTIVATE`/`DEACTIVATE`/
  `ROLLBACK`) – gleiches Prinzip wie Phase 8–10.
- `/analytics` (Mitarbeitersicht) und `/analytics/management`
  (rollen-/scope-geschützte Führungssicht, Phase 7) als bestehende
  Dashboard-Oberflächen, in die ein Ziel-vs.-Ist-Vergleich eingebettet
  werden könnte.
- Die bestehende Regel "Provisions-/Margendaten nicht in der
  Mitarbeiter-UI, nur in der Management-Sicht" (Phase 6/7) – falls Ziele
  umsatz-/provisionsbasiert sind, stellt sich dieselbe Sichtbarkeitsfrage
  erneut für Zielwerte.
- `PrioritizationRule.weight` (Phase 3B/9): aktuell ein **statischer,
  admin-gepflegter Integer** – keine Laufzeit-Anbindung an KPI-Ist-Werte
  oder Zielerreichung. Die ursprüngliche Phase-1-Vision (Ziele
  beeinflussen `priority_score`) ist im tatsächlichen Regel-Editor
  (Phase 9) nicht umgesetzt und auch nicht vorbereitet.

## 3. Datenlücken, die ein Ziele-Modell zwingend braucht

1. **Kalenderperioden-Konzept.** Weder `schema.prisma` noch
   `kpis.ts` kennen "Monat"/"Quartal"/"Jahr" als Entität – nur freie
   `from`/`to`-Zeitstempel. Ein Ziel braucht einen klar definierten,
   wiederholbaren Zeitraum.
2. **Ziel-Scope.** Auf welcher Ebene werden Ziele gesetzt – Tenant,
   Company, Store, Employee, oder mehrere gleichzeitig (z. B.
   Filialziel UND individuelles Mitarbeiterziel im selben Zeitraum)?
   Falls mehrere Ebenen gleichzeitig existieren: müssen sie konsistent
   sein (Summe der Filialziele = Unternehmensziel) oder unabhängig?
3. **Ziel-Metrik(en).** Welche der in `ANALYTICS_AND_KPIS.md` /
   `kpis.ts` bereits existierenden Größen bekommen ein Ziel? Kandidaten:
   Umsatz (`monthlyRecurringRevenueMinor`/`oneTimeRevenueMinor`),
   Abschlüsse (`dealsClosed`), Abschlussquote, Provision/Marge
   (management-only!). Reine Zähl-KPIs (Cross-Selling-Quote etc.) sind
   laut `ANALYTICS_AND_KPIS.md` "bewusst zurückgestellt" und noch nicht
   live implementiert – Ziele könnten nur auf tatsächlich implementierten
   KPIs aufsetzen.
4. **Mehrwährungsfrage.** `DealKpiByCurrency[]` ist bereits
   währungsgetrennt; ein monetäres Ziel muss dieselbe Vorsicht walten
   lassen (kein blindes Summieren verschiedener Währungen).
5. **Sichtbarkeitsfrage.** Darf ein Mitarbeiter sein eigenes Ziel + Ist
   sehen? Darf er das Store-Ziel sehen? Umsatzbasierte Ziele kollidieren
   potenziell mit der bestehenden Mitarbeiter-Sichtbarkeitsregel für
   Provisions-/Margendaten.
6. **Rückkopplung in die Recommendation-Engine (offen seit Phase 1).**
   Ist eine tatsächliche Kopplung "Ziel nicht erreicht → Produkt X wird
   priorisiert empfohlen" für Phase 11 überhaupt vorgesehen, oder bleibt
   das Ziele-Modell zunächst ein reines Reporting-/Vergleichsfeature
   (Ziel vs. Ist im Dashboard), ohne Rückwirkung auf Schritt 2 der
   Empfehlungslogik? Das ist die größte Scope-Entscheidung dieser Phase.

## 4. Zentrale Architekturfragen für ChatGPT (vor Implementation Plan)

### 4.1 Datenmodell-Muster: Versionierte Einzelkonfiguration vs. periodische Zielwerte

Vorschlag (zur Diskussion, keine Vorentscheidung): **kein**
Draft→Publish→ACTIVE/EXPIRED-Einzelversion wie Phase 8–10, sondern ein
`Goal`-Modell mit `scopeType` (TENANT/COMPANY/STORE/EMPLOYEE analog
`RoleScopeType`), `scopeId`, `metricKey`, `periodType`
(MONTH/QUARTER/YEAR), `periodStart`/`periodEnd`, `targetValueMinor` (oder
`targetCount`, je nach Metrik), plus optional einem einfachen
Draft/Active-Status **pro Zielinstanz** (damit ein Ziel vor
Veröffentlichung korrigiert werden kann, aber OHNE dass eine neue Periode
eine alte Periode "ablöst" – beide bleiben nebeneinander gültig, nur
`AuditLog`/Historie regeln nachträgliche Korrekturen derselben Periode).

### 4.2 RBAC: eigener `config.goals.*`-Namensraum vs. Wiederverwendung der Management-Scope-Architektur

Wer darf Ziele **setzen** (vermutlich `config.goals.view/edit/publish`,
tenant-scoped, analog Phase 8–10) vs. wer darf welche Ziele **sehen**
(vermutlich die bestehende Management-Scope-Architektur aus Phase 7,
weil Sichtbarkeit hier organisatorisch/hierarchisch ist, nicht
fachadministrativ)? Diese Zweiteilung entspricht exakt der bereits im
Code dokumentierten, bewussten Trennung der beiden Architekturen – muss
aber für Ziele erstmals explizit verzahnt werden (Setzen ist
Config-scoped, Sehen ist Management-Scope-scoped).

### 4.3 Reichweite: reines Reporting oder Rückkopplung in die Empfehlungslogik?

Siehe Punkt 6 in Abschnitt 3 – die größte Scope-Frage. Empfehlung dieser
Discovery: Phase 11 auf reines Ziel-vs.-Ist-Reporting begrenzen
(Dashboard-Erweiterung), keine Rückkopplung in `PrioritizationRule`/
Recommendation Engine – letzteres wäre ein eigener, deutlich größerer
Schnitt und vermischt zwei unabhängig testbare Fachdomänen.

### 4.4 Welche Metrik(en) zuerst?

Empfehlung dieser Discovery: mit den bereits produktiv live berechneten
Kern-KPIs starten (Umsatz, Abschlüsse, Abschlussquote), keine neuen
KPI-Berechnungen einführen – Ziele sind zunächst ein Vergleichswert zu
bereits existierenden Zahlen, keine neue Analytics-Baustelle.

### 4.5 Admin-UI-Umfang

Falls RBAC + Datenmodell wie oben, wäre die Admin-UI strukturell näher an
Phase 6 AP8 (Analytics-Dashboard, Read-lastig mit Formularen) als an den
schweren Draft-Editoren aus Phase 8–10 – guter Hinweis, dass diese Phase
nicht automatisch dieselbe AP-Struktur wie Phase 8/9/10 kopieren sollte.

## 5. Risiken

- **Konzeptionelle Neuheit:** anders als Phase 8–10 gibt es kein
  bestehendes Schema, an dem sich die Implementierung orientieren kann –
  höheres Risiko einer falschen Grundannahme, wenn AP0 zu knapp geklärt
  wird (Lehre aus Phase 3B: lieber mehrere Abstimmungsrunden mit ChatGPT
  vor Code als eine zu früh fixierte Struktur).
- **Fehlendes Periodenkonzept** ist eine echte neue Bau-Aufgabe (Abschnitt
  3.1), kein triviales Feld.
- **Sichtbarkeitskonflikt** zwischen Ziel-Reporting und der bestehenden
  Mitarbeiter-Datenschutzregel für Provisions-/Umsatzdaten muss vor der
  UI geklärt werden, nicht danach.
- **Scope-Kreuzung Tenant/Company/Store/Employee gleichzeitig** kann zu
  inkonsistenten oder widersprüchlichen Zielwerten führen, wenn nicht
  früh entschieden wird, ob Ziele unabhängig pro Ebene sind oder sich
  gegenseitig referenzieren müssen.

## 6. Vorschlag für die weitere Vorgehensweise

Wie in Phase 6–10: dieses Discovery-Dokument zuerst an ChatGPT zur
Klärung der in Abschnitt 4 aufgeführten Architekturfragen, erst danach
`PHASE_11_IMPLEMENTATION_PLAN.md` mit konkreter AP-Struktur, erst danach
Nutzer-Implementierungs-GO vor AP1-Code (analog dem in allen
Vorgängerphasen etablierten Muster).
