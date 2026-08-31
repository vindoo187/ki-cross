# Phase 14 – Implementierungsplan: Sales Playbook / Beratungsintelligenz

Stand: 2026-08-31. Basiert auf `PHASE_14_DISCOVERY.md` (AP0, ChatGPT-Abnahme
"AP0: ABGENOMMEN" 2026-08-31) sowie ChatGPTs Rueckmeldung zu diesem
Discovery-Dokument (keine Korrekturen verlangt, alle Kernempfehlungen
bestaetigt). Analog Phase 9–13: dieser Plan geht vor jedem AP1-Code an
ChatGPT zur Pruefung, danach an den Nutzer fuer das explizite
Implementierungs-GO. ChatGPTs ausdruecklicher Auftrag fuer diesen Plan:
"gegen den tatsaechlich fertiggestellten AP0-Stand und die reale Codebase
pruefen, nicht einfach ein generisches CRUD-Playbook planen."

## 1. Verbindliche Architekturentscheidungen (aus AP0-Discovery + ChatGPT-Abnahme)

1. **Rule Engine/Campaigns = WAS/WANN, Playbook = WIE, KI = sprachliche
   Umsetzung (zentrale, nicht verhandelbare Leitplanke).** Das Playbook
   erhaelt in keiner AP dieses Plans Schreibzugriff auf `Recommendation`/
   `RecommendationItem`/`RecommendationRationale` oder Einfluss auf
   `evaluate()` (`src/server/recommendation/service.ts`). Es bleibt ein
   reiner Kontext-Lieferant fuer eine spaetere sprachliche Formulierung.
2. **Datenmodell analog `Campaign`/`CampaignVersion`/`CampaignCondition`
   (Phase 13), nicht neu erfunden.** `Playbook` (fachliche Identitaet,
   `key`/`name`) → `PlaybookVersion` (Draft→Publish, `VersionStatus`
   wiederverwendet: `DRAFT`/`ACTIVE`/`EXPIRED`/`ARCHIVED`, genau eine
   `ACTIVE`-Version je Playbook, `EXCLUDE`-Constraint **innerhalb**
   derselben `playbookId`, analog Campaign) → `PlaybookSection`
   (fachlicher Inhalt, an eine konkrete `PlaybookVersion` gebunden, siehe
   Abschnitt 2).
3. **Kein RAG/semantisches Retrieval (AP0-Abschnitt 6, von ChatGPT
   ausdruecklich als "gute Entscheidung" bestaetigt).** Die
   Retrieval-Selektion (AP4) ist eine reine, deterministische Funktion
   ueber strukturierte Metadaten — keine Vektordatenbank, kein
   Embedding-Schritt, keine neue Infrastruktur in Phase 14.
4. **7-stufige Trust Hierarchy (AP0-Abschnitt 8.1) ist bindend fuer jede
   spaetere Prompt-Konstruktion.** Playbook-Inhalte werden durchgaengig
   als untrusted content behandelt (AP0-Abschnitt 9) — unabhaengig von
   der RBAC-Berechtigung der pflegenden Person.
5. **RBAC additiv, analog `config.campaigns.*` (AP0-Abschnitt 11).**
   `config.playbooks.view/edit/publish`, TENANT-scoped
   Permission-Vergabe, `sales_employee`-Rolle bleibt ausgeschlossen
   (identisches Muster wie bei jeder bisherigen `config.*`-Erweiterung).
6. **Scope: nur `TENANT` und `STORE`, kein `EMPLOYEE`/`COMPANY`
   (Entscheidung fuer diesen Plan, analog Campaign-Entscheidung C aus
   Phase 13, nicht Goal-Entscheidung).** Begruendung: ein Sales Playbook
   ist eine Unternehmens-/Filial-Verkaufsstrategie, keine individuelle
   Mitarbeitervorgabe — konsistent mit der AP0-Einordnung "Denk- und
   Argumentationsweise des Unternehmens/Nutzers". **Zur Bestaetigung an
   ChatGPT, siehe Abschnitt 4 Punkt 1** (Campaign hatte denselben
   Scope-Zuschnitt, aber explizit als eigene Entscheidung getroffen, nicht
   automatisch uebertragen).
7. **Phase-14-Scope-Grenze: KEINE Live-KI-Integration in diesem Plan.**
   Phase 14 baut das vollstaendige Playbook-Subsystem (Datenmodell,
   Service, API, Admin-UI, Retrieval-Selektionsfunktion, Security-
   Grundgeruest, Audit) **bis einschliesslich einer reinen, testbaren
   Selektionsfunktion** — nicht die tatsaechliche Einspeisung in einen
   echten KI-Prompt/-Call. Begruendung: Phase 12 AP5 (echter Provider)
   ist weiterhin offen (AP5c braucht Nutzer-API-Key-Setup, siehe
   `project_ki_cross_phase13_ap8_status`-Memory-Historie); ohne echten
   Provider gibt es keinen sinnvollen Ort, an dem Playbook-Kontext
   tatsaechlich "ankommen" wuerde — der bestehende `MockExtractionProvider`
   ist ein reiner Struktur-Extraktor ohne Freiformulierung und daher kein
   sinnvoller Integrationspunkt fuer Playbook-Kontext. **Diese
   Scope-Grenze ist eine neue Entscheidung dieses Plans (nicht bereits in
   AP0 festgelegt) und wird ChatGPT explizit zur Bestaetigung vorgelegt
   (Abschnitt 4 Punkt 2).**
8. **Reproduzierbarkeit (AP0-Abschnitt 5/12).** Jede `PlaybookVersion` ist
   nach Publish unveraenderlich (append-only Sections analog
   `CampaignCondition`/`RecommendationItem`-Prinzip — eine Aenderung
   erzeugt immer eine neue Draft-Version, nie ein Update bestehender
   `PlaybookSection`-Zeilen einer bereits veroeffentlichten Version).
   Damit ist die Frage "welche Version/welche Abschnitte waren zu
   Zeitpunkt X aktiv" bereits durch die Versionierung selbst beantwortet,
   ohne dass es (in Phase 14, vor einer echten KI-Anbindung) bereits eine
   konkrete Beratung gibt, die eine Section "verwendet" haben koennte.
9. **`now`-vor-Lock-Lektion aus Phase 13 AP10 ist verbindlich fuer den
   Publish-Workflow (`publishPlaybookVersion()`).** `now = new Date()`
   wird ausschliesslich INNERHALB der Transaktion, NACH Erwerb des
   Row-Locks, bestimmt — identisches Muster wie
   `publishCampaignVersion()`/`publishCommissionModelVersion()`/
   `publishRuleSetVersion()` nach deren Fix.

10. **Retrieval darf keine versteckte Business-Logik werden (ChatGPT,
    2026-08-31, zusaetzliche Leitplanke).** Die AP4-Selektionsfunktion
    darf ausschliesslich entscheiden "welche Playbook-Information ist
    fuer diesen Kontext relevant" — niemals "dieses Produkt sollte
    deshalb verkauft werden". Letzteres bleibt vollstaendig bei
    Recommendation Engine/Rule Engine/Campaign (Verstaerkung von
    Abschnitt 1.1, explizit als eigener Pruefpunkt fuer AP4/AP8
    festgehalten).

**Explizit ausgeschlossen in Phase 14** (analog dem Scope-Schutz-Muster
aus Phase 11/13): Aenderung an Phase-12-Provider-Code oder
`MockExtractionProvider`, Aenderung an Rule Engine/Recommendation Engine/
Campaign-Logik, semantisches Retrieval/Embeddings/Vektordatenbank, echte
KI-Provider-Anbindung (bleibt AP5c, Phase 12), automatisierte
Prompt-Injection-Erkennung mittels eines Klassifikationsmodells (nur
strukturelle/redaktionelle Absicherung, siehe AP5 unten), Aenderung an
`AiExtractionProvider`-Contract.

## 2. Schema (Skizze, verbindliche Feldliste folgt in AP1)

```prisma
enum PlaybookScopeType { TENANT STORE } // eigenes Enum, analog
  // CampaignScopeType -- bewusst kein EMPLOYEE/COMPANY (s. Abschnitt 1.6)

enum PlaybookSectionType {
  CONVERSATION_GUIDANCE   // Gespraechsfuehrung
  ARGUMENTATION           // Argumentation
  OBJECTION_HANDLING      // Einwandbehandlung
  PRODUCT_ARGUMENT        // Produktargument
  CUSTOMER_SITUATION      // Kundensituation
  CLOSING                 // Abschluss
  UPSELL_CROSS_SELL       // Upsell/Cross-Sell
  NO_GO                   // No-Go
  TONALITY                // Tonalitaet
  GENERAL_PRINCIPLE       // Allgemeine Verkaufsprinzipien
}

model Playbook {
  id        String
  tenantId  String
  key       String
  name      String
  createdAt DateTime

  versions PlaybookVersion[]

  @@unique([tenantId, id])
  @@unique([tenantId, key])
}

model PlaybookVersion {
  id              String
  tenantId        String
  playbookId      String
  versionNumber   Int
  status          VersionStatus     // wiederverwendet: DRAFT/ACTIVE/EXPIRED/ARCHIVED
  scopeType       PlaybookScopeType
  scopeId         String            // TENANT -> tenantId, STORE -> Store.id
  validFrom       DateTime
  validTo         DateTime?
  description     String?
  createdAt       DateTime
  createdByUserId String?           // nullable + onDelete SetNull, analog CampaignVersion

  playbook Playbook @relation(fields: [tenantId, playbookId], references: [tenantId, id], onDelete: Restrict)
  sections PlaybookSection[]

  @@unique([tenantId, playbookId, versionNumber])
}

// Analog CampaignCondition strukturell an eine Version gebunden, aber
// inhaltlich anders: keine Bedingung, sondern der eigentliche
// Verkaufsinhalt + Retrieval-Metadaten (AP0-Abschnitt 4.3).
model PlaybookSection {
  id                  String
  tenantId            String
  playbookVersionId   String
  sectionType         PlaybookSectionType
  title               String
  content             String              // eigentlicher Verkaufsinhalt (untrusted, s. Abschnitt 1.4)
  relatedTopics       String[]            // Retrieval-Keywords
  relatedProductKeys  String[]            // Bezug zur bestehenden Produkt-Attribute-Registry
  relatedSituations   String[]            // Beratungsschritt/Kundensituation
  priority            Int?                // Konfliktaufloesung bei mehreren Treffern
  tags                String[]
  active              Boolean  @default(true)
  createdAt           DateTime

  playbookVersion PlaybookVersion @relation(fields: [tenantId, playbookVersionId], references: [tenantId, id], onDelete: Restrict)

  @@unique([tenantId, id])
  @@index([tenantId, playbookVersionId])
}
```

Nur EINE `ACTIVE`-Version je `Playbook` gleichzeitig (Exklusivitaet
**innerhalb** des Playbooks, per `EXCLUDE`-Constraint auf
`(playbookId, tstzrange(validFrom, validTo))` WHERE `status = 'ACTIVE'`,
analog Campaign — keine globale Exklusivitaet ueber alle Playbooks
hinweg, mehrere Playbooks mit unterschiedlichem Scope duerfen parallel
aktiv sein).

**Bewusst NICHT Teil dieses Schemas** (Abgrenzung zu Abschnitt 1.7): keine
`RecommendationPlaybookSignal`-Tabelle in Phase 14 — diese wuerde eine
tatsaechliche KI-Interaktion referenzieren, die es vor AP5c nicht gibt
(AP0-Abschnitt 12 hatte dies bereits als "Abhaengigkeit von AP5c"
klassifiziert). Wird als eigenes, spaeteres AP nachgezogen, sobald ein
echter Provider existiert.

## 3. Arbeitspakete

- **AP0** — Discovery (bereits erledigt, `PHASE_14_DISCOVERY.md`,
  ChatGPT-Abnahme 2026-08-31).
- **AP1** — Datenmodell & Versionierung: `Playbook`, `PlaybookVersion`,
  `PlaybookSection`, `PlaybookScopeType`-/`PlaybookSectionType`-Enums,
  Migration, `EXCLUDE`-Constraint innerhalb eines Playbooks (analog
  Campaign), PGlite-Verifikation, RBAC-Grundgeruest
  `config.playbooks.view/edit/publish` additiv zu
  `ALL_CONFIG_PERMISSION_KEYS`. Vor Code: die in Abschnitt 4 offenen
  Fragen mit ChatGPT klaeren (analog dem Phase-13-Vorgehen, wo AP1 erst
  nach drei geklaerten Detailfragen freigegeben wurde).
- **AP2** — Service-Schicht `playbook-admin.ts`: CRUD fuer `Playbook`
  (fachliche Identitaet) + `PlaybookVersion` (Draft-Erstellung,
  Bearbeitung, Publish mit Row-Lock nach der AP10-Lektion, Historie/
  Rollback analog Phase 9/10/13) + `PlaybookSection`-CRUD innerhalb
  eines Drafts (nur DRAFT-Versionen editierbar, veroeffentlichte
  Versionen unveraenderlich, analog `CampaignVersion`), `scopeId`-
  Validierung gegen die reale Organisationsstruktur (analog Campaign/
  Goal-Lehre aus Phase 11/13), concurrency-sichere `versionNumber`-
  Vergabe.
- **AP3** — API-Routen `/api/admin/playbooks`,
  `/api/admin/playbooks/[id]/versions`,
  `/api/admin/playbooks/[id]/versions/[versionId]/sections`,
  `requireConfigPermission()` gegen `config.playbooks.*`, Tenant-
  Isolation/IDOR-Tests (kein Zugriff auf `Playbook`/`PlaybookVersion`
  anderer Tenants, kein `STORE`-scopeId anderer Tenants) — strukturell
  identisch zu Phase 13 AP3.
- **AP4** — Retrieval-Selektionsfunktion (`playbook-retrieval.ts`, reine
  Funktion, kein DB-Zugriff, analog `extraction-validator.ts`/
  `conditions.ts` als Vorbild fuer reine, testbare Kernlogik): Eingabe
  ein strukturierter `PlaybookRetrievalContext`
  (Produktschluessel/-kategorie, Kundensituation/Beratungsschritt,
  aktuelle Frage, optional aktive Recommendation-/Campaign-Keys),
  Ausgabe eine nach `priority` sortierte, budgetbegrenzte Liste
  passender `PlaybookSection`-IDs der aktuell aktiven
  `PlaybookVersion` des relevanten Scopes (Kostenkontrolle direkt hier
  verankert, AP0-Abschnitt 15 — max. Zeichen-/Abschnittsanzahl als
  Funktionsparameter, kein globaler Versand des kompletten Playbooks).
  Deterministisch, vollstaendig unit-testbar OHNE jeden Provider — die
  in AP0-Abschnitt 13.2 vorgeschlagenen 9 Testfaelle (kein Treffer, ein
  Treffer, mehrere Treffer, Konflikt, Campaign+Playbook, Recommendation+
  Playbook, Injection-Versuche, Versionswechsel-Reproduzierbarkeit)
  sind hier die Kern-Testsuite.
- **AP5** — Security-Grundgeruest (ChatGPT-Entscheidung 2026-08-31,
  siehe Abschnitt 4): **KEINE** regex-/heuristikbasierte
  "Prompt-Injection-Filterung" beim Speichern (ausdruecklich verworfen —
  zu schwach gegen echte Angriffe, zu falsch-positiv-anfaellig gegen
  legitime Inhalte). Stattdessen strukturelle Absicherung: Trust
  Boundary technisch sauber abbilden (Playbook-Content wird durchgaengig
  als Daten, nicht als Systeminstruktion behandelt), strukturierte
  Felder validieren (Zod-Schema fuer `PlaybookSection`, analog
  `commission-schemas.ts`/`rule-schemas.ts`), maximale Content-Groesse
  (Kostenkontrolle, AP0-Abschnitt 15), saubere Trennung von Metadaten
  (`sectionType`/`relatedTopics`/... ) und `content`-Feld, keine
  Moeglichkeit fuer den `content`-Wert, System-/Sicherheitsregeln zu
  veraendern (strukturell durch die Trust Hierarchy erzwungen, nicht
  durch Content-Scanning), Security-Verhalten explizit getestet (AP8).
  Die eigentliche Prompt-Injection-Abwehr wird dort verifiziert, wo
  tatsaechlich ein LLM-Prompt gebaut wird (spaeteres, an AP5c
  gekoppeltes AP) — Phase 14 liefert die Trust-Boundary-Grundlage, nicht
  die Content-Filterung.
- **AP6** — Admin-UI `/admin/playbooks` (Liste, Detail, Draft-Editor mit
  Section-CRUD, Validate/Publish, Versionshistorie/Rollback, Scope-
  Auswahl TENANT/STORE) — strukturell analog Phase 9 (Regel-Editor)/
  Phase 10 (Provisionsmodell-Editor)/Phase 13 (Campaign-Editor).
- **AP7** — Audit/Reproduzierbarkeit (ChatGPT-Praezisierung 2026-08-31,
  siehe Abschnitt 4): `PlaybookVersion`-Publish ueber bestehendes
  `AuditLog` (analog Campaign/RuleSet/CommissionModel, kein neues
  Audit-Modell); ein stabiles, providerunabhaengiges Ergebnisformat der
  AP4-Selektionsfunktion ("diese `PlaybookSection`-IDs wurden fuer
  diesen Beratungskontext ausgewaehlt") als saubere spaetere
  Integrationsschnittstelle vorbereiten — **ohne** einen Provider zu
  simulieren oder eine KI-Interaktions-/Attributionstabelle zu bauen
  (ausdruecklich verworfen, bleibt Abhaengigkeit von AP5c). Echter
  Integrationstest statt Platzhalter: (1) gleicher Beratungskontext +
  gleiche `PlaybookVersion` ⇒ identische Auswahl; (2) neue
  veroeffentlichte `PlaybookVersion` ⇒ neue Auswahl/neuer
  Kontext-Fingerprint, waehrend die historische Auswahl der alten
  Version unveraendert reproduzierbar bleibt (analog dem
  Phase-13-AP8-Reproduzierbarkeitstest, hier auf der reinen
  AP4-Selektionsfunktion, da noch keine echte KI-Interaktion existiert,
  siehe Abschnitt 1.7).
- **AP8** — Security/Regression/E2E (Desktop+Tablet, gleiche Haerte wie
  Phase 8–13): RBAC, Tenant-Isolation/IDOR, Scope-Grenzen (TENANT vs.
  STORE), Playbook-Draft-Editier-/Publish-Workflow, Retrieval-Funktion
  gegen die AP0-Testfaelle (Abschnitt 13.2), Row-Lock-Konkurrenztest fuer
  `publishPlaybookVersion()` (analog Phase-10-AP9-Fix/Phase-13-AP10-Fund
  — bewusst von Anfang an korrekt implementiert statt nachtraeglich
  gefunden).
- **AP9** — Dokumentation (`SALES_PLAYBOOK.md` analog
  `RECOMMENDATION_ENGINE.md`/`CAMPAIGN_MANAGEMENT.md`-Praezedenzfall aus
  Phase 13 AP9, `DATA_MODEL.md`-Ergaenzung).
- **AP10** — Abschlussbericht Phase 14.

**Bewusst nicht Teil dieses Plans** (spaeteres, separates AP/Feature nach
AP5c): tatsaechliche Einspeisung des AP4-Retrieval-Ergebnisses in einen
echten KI-Prompt, `RecommendationPlaybookSignal`-Attributionstabelle,
semantisches Retrieval/RAG, automatisierte Prompt-Injection-Erkennung
per Klassifikationsmodell, Token-/Kostenmessung in Analytics (haengt vom
gewaehlten Provider aus AP5c ab, AP0-Abschnitt 15).

## 4. Von ChatGPT geklaerte Detailfragen (2026-08-31)

Die vier urspruenglich offenen Detailfragen sind mit ChatGPTs
Entscheidungen vom 2026-08-31 beantwortet und oben (Abschnitt 1 Punkt
6/7/10, AP5/AP7 in Abschnitt 3) eingearbeitet:

1. **Scope: `TENANT` + `STORE` — GO.** Genau wie bei Campaigns, kein
   `EMPLOYEE`-/`COMPANY`-Scope. Begruendung (ChatGPT): "Das Playbook ist
   zunaechst eine organisatorische Verkaufslogik. Mitarbeiter-spezifische
   Playbooks wuerden zusaetzliche Priorisierungs-, RBAC- und
   Konfliktlogik erzeugen, die wir aktuell nicht brauchen."
2. **Keine echte Prompt-Einspeisung in Phase 14 — GO, als wichtige
   Scope-Grenze bestaetigt.** Phase 14 baut Playbook → Versionierung →
   Verwaltung → Retrieval → Auswahl des relevanten Kontextes, aber noch
   nicht Retrieval → LLM-Prompt → Provider → generierte Verkaufssprache.
   Praezisierung: AP7 bereitet die spaetere Integrationsschnittstelle
   sauber vor (stabiles, providerunabhaengiges Ergebnis "diese
   Playbook-Sections wurden fuer diesen Beratungskontext ausgewaehlt"),
   OHNE einen Provider zu simulieren.
3. **Security (AP5): KEINE heuristische Ablehnung von Playbook-Content
   — GO fuer strukturelle Security stattdessen.** ChatGPT verwirft die
   urspruenglich vorgeschlagene Regex-/Muster-Erkennung ausdruecklich
   als "sehr schwachen und potenziell stoerenden Schutz: legitime
   Inhalte koennten solche Formulierungen enthalten, waehrend echte
   Injection auch voellig anders formuliert werden kann." Stattdessen:
   Trust Boundary technisch sauber abbilden, Content als Daten statt
   Systeminstruktion behandeln, strukturierte Feldvalidierung, maximale
   Content-Groessen, saubere Metadaten-/Content-Trennung, keine
   Moeglichkeit fuer Content, System-/Sicherheitsregeln zu veraendern,
   Security-Verhalten explizit testen. Die eigentliche
   Prompt-Injection-Abwehr wird dort verifiziert, wo tatsaechlich ein
   LLM-Prompt gebaut wird (spaeteres AP).
4. **AP7-Reproduzierbarkeit: echter Integrationstest, kein
   KI-Platzhalter — GO mit Praezisierung.** Kein kuenstlicher
   KI-Interaktions-/Attributions-Platzhalter. Stattdessen: (1) gleicher
   Beratungskontext + gleiche `PlaybookVersion` ⇒ identische Auswahl,
   (2) neue veroeffentlichte `PlaybookVersion` ⇒ neue Auswahl/neuer
   Kontext-Fingerprint, historische Auswahl der alten Version bleibt
   unveraendert reproduzierbar. Die Frage "welche Sections wurden
   tatsaechlich an Provider X geschickt" gehoert in die echte
   Provider-/LLM-Integrationsphase.

Zusaetzliche Leitplanke (ChatGPT, nicht urspruenglich abgefragt, aber
verbindlich ergaenzt): "Retrieval darf keine versteckte Business-Logik
werden" — siehe Abschnitt 1 Punkt 10.

ChatGPT (verbatim, 2026-08-31): "Damit: GO fuer AP1 des Implementation
Plans. AP1 sollte jetzt Playbook-Datenmodell + Versionierung + Migration

- RBAC umfassen und sich sehr eng an dem bewaehrten Campaign-Muster
  orientieren — inklusive der in Phase 13 gefundenen Lock-/Zeitstempel-
  Nebenlaeufigkeitslektion."

## 5. Naechster Schritt

ChatGPT hat den Plan mit diesen vier Klarstellungen final freigegeben
und GO fuer AP1 erteilt. Ausstehend: explizites Nutzer-Implementierungs-
GO vor AP1-Code (analog dem in allen Vorgaengerphasen etablierten
Muster).
