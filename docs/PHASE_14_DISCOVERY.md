# Phase 14 AP0 – Discovery: Sales Playbook / Beratungsintelligenz

**Status:** Reine Discovery- und Architekturanalyse. Kein Produktionscode,
keine Migration, keine Provider-Anbindung, kein API-Key, keine
Aktivierung. Ergebnis dieses Dokuments ist ausschliesslich diese Datei.
Grundlage: ChatGPTs vollstaendiger AP0-Discovery-Auftrag (19 Abschnitte,
2026-08-31, siehe `project_ki_cross_phase14_ap0_auftrag`-Memory) nach
Nutzer-GO fuer Phase 14 (2026-08-31). Phase 12 (Freitext-KI-Angebot) und
Phase 13 (Campaign Management) werden als bestehende, durch AP0
UNVERAENDERTE Architektur behandelt.

## 0. Executive Summary

Das Sales Playbook soll die verkaeuferische Denk- und Argumentationsweise
des Unternehmens/Nutzers erfassen (WIE beraten/argumentiert wird) und
diese als Kontext in die bestehende Freitext-KI-Komponente aus Phase 12
einspeisen. Es ersetzt und dupliziert NICHT die Rule Engine (WAS/WANN
empfohlen wird, Phase 3B/9/13) — diese Trennung ist die zentrale
Architekturleitplanke dieses gesamten Dokuments (siehe Abschnitt 19).

Kernempfehlungen dieser Discovery:

- **Datenmodell:** Playbook als eigenstaendige Entitaet mit versionierten
  `PlaybookVersion`-Zeilen (analog `CampaignVersion`/`RuleSetVersion`),
  bestehend aus einzelnen `PlaybookSection`-Zeilen mit Metadaten fuer
  Retrieval (Abschnitt 3).
- **Retrieval:** Zunaechst ausschliesslich deterministisches,
  regelbasiertes Retrieval ueber strukturierte Metadaten (Variante A) —
  KEIN semantisches Retrieval/RAG in Phase 14 (Abschnitt 5).
- **Prompt-Architektur:** Klare Trust-Hierarchie mit dem Playbook UNTERHALB
  von System-/Sicherheitsregeln und fachlicher Geschaeftslogik, ABER
  OBERHALB von Kundenfreitext (Abschnitt 7).
- **Security:** Playbook-Inhalte sind grundsaetzlich untrusted content
  (auch vom Geschaeftsfuehrer selbst) und duerfen niemals
  Eligibility-/Recommendation-Entscheidungen der Rule Engine beeinflussen
  (Abschnitt 8, Pflichtbestandteil).
- **RBAC:** Neue `config.playbooks.view/edit/publish`-Permissions, exakt
  analog dem bestehenden `config.campaigns.*`-Muster (Abschnitt 10).
- **AP5c-Vorbereitung:** Konkrete, messbare Testdimensionen fuer die
  spaetere Provider-PoC, aufbauend auf der bereits bestehenden
  Phase-12-AP5-Discovery (Abschnitt 13).

Diese Discovery trifft bewusst KEINE stillen Entscheidungen — jede
Architekturfrage wird in Abschnitt 16 (Entscheidungstabelle) klassifiziert.

## 1. Ist-Zustand (tatsaechlicher Repository-Stand, 2026-08-31)

### 1.1 Phase 12: Freitext-KI-Extraction-Architektur

Codebasis: `src/server/ai-extraction/` (7 Dateien, 670 Zeilen) +
`src/app/api/consultation/sessions/[id]/ai-extraction/` (2 Routen).

- **`AiExtractionProvider`-Contract** (`contract.ts`): einziges
  Provider-Interface — `extract(request): Promise<AiExtractionCandidate[]>`.
  `AiExtractionRequest` enthaelt AUSSCHLIESSLICH `freeText` (Kundenfreitext
  vom Mitarbeiter eingegeben) und `visibleQuestions`
  (`AiExtractionVisibleQuestion[]`). Der Freitext verlaesst den
  Request-Handler NUR ueber diese Funktion — kein anderer Code-Pfad
  (Validator, Analytics, Audit, Logs) fasst ihn an (harte, bereits
  getestete Datenschutz-Grenze).
- **`MockExtractionProvider`** (`providers/mock-provider.ts`): einzige
  aktuell aktive Implementierung, rein deterministischer
  Substring-/Regex-Mustervergleich, KEIN Sprachmodell. Ein echter externer
  Provider ist AP5 aus Phase 12 (separates GO noetig, noch nicht erteilt —
  siehe `AP5c` unten).
- **`buildVisibleQuestionContext()`** (`visible-question-context.ts`):
  serverseitig berechneter, erlaubter Fragenkatalog aus
  `loadQuestionnaireState()` (Phase 3A) — nur sichtbare, unbeantwortete,
  Nicht-SHORT_TEXT-Fragen. Die KI bestimmt NIEMALS selbst, welche Fragen
  sichtbar sind.
- **`extraction-validator.ts`**: Defense-in-Depth-Validierung jedes
  Provider-Kandidaten (Fragenkatalog-Zugehoerigkeit, Typkonsistenz,
  Wertebereich via `validateAnswerInput()`, Mehrdeutigkeit wird verworfen).
  Ein Provider gilt strukturell als nicht vertrauenswuerdig.
- **`service.ts` (`requestAiExtraction()`)**: Orchestrierung mit fester
  Sicherheitsreihenfolge Auth → Tenant → Session-Ownership → Permission
  (`consultation.ai_extraction.use`) → Tenant-Feature-Flag
  (`Tenant.aiExtractionEnabled`) → sichtbarer Fragenkontext → Extraction →
  Validation → Response. Schreibt `AI_EXTRACTION_REQUESTED`/
  `_COMPLETED`-Analytics-Events (best effort, NIEMALS `freeText` im
  Payload). `recordAiSuggestionOutcome()` zeichnet
  `AI_SUGGESTION_ACCEPTED`/`_REJECTED` als GENUIN SEPARATEN Aufruf auf,
  strukturell getrennt vom bestehenden `saveAnswer()`/`changeAnswer()`-Pfad.
- **Ergebnisverwendung:** `AiExtractionCandidate[]` ist NIEMALS direkt eine
  `CustomerAnswer` — Uebernahme/Aenderung laeuft ausschliesslich ueber den
  unveraenderten, bestehenden `saveAnswer()`-Pfad nach expliziter
  Mitarbeiterbestaetigung (Phase 12 AP3).
- **`schemas.ts`**: `freeText` max. 4000 Zeichen (Eingabe-Hygiene, keine
  Kosten-/Token-Kontrolle).

### 1.2 Rule Engine / Recommendation Engine (Phase 3B/9/13)

Codebasis: `src/server/recommendation/` (15 Dateien, 2908 Zeilen). Volle
fachliche Dokumentation bereits vorhanden in `docs/RECOMMENDATION_ENGINE.md`
(215 Zeilen, AP9-Ergebnis) — diese Discovery dupliziert sie nicht,
sondern fasst die fuer das Playbook relevanten Punkte zusammen:

- **Dreistufig:** Eignung (`EligibilityRule`/`ExclusionRule`, objektiv,
  regelbasiert) → geschaeftliche Priorisierung (`PrioritizationRule`,
  konfigurierbar, regelbasiert, inkl. `CAMPAIGN_ACTIVE`-Bedingungen seit
  Phase 13) → Darstellung/Begruendung (`RecommendationRationale`,
  strukturierte Fakten, aktuell KEINE KI-Generierung der Begruendung
  selbst).
- **`RuleSetVersion`**: genau eine `ACTIVE`-Version je Tenant
  (PostgreSQL-`EXCLUDE`-Constraint), buendelt `EligibilityRule`/
  `ExclusionRule`/`PrioritizationRule`/`CrossSellingRule`. Jede Regel hat
  `RuleCondition`-Zeilen mit `sourceType ∈ {ANSWER, PRODUCT_ATTRIBUTE,
SESSION_ATTRIBUTE, CAMPAIGN_ACTIVE}` — eine geschlossene
  Attribute-Registry (`attribute-registry.ts`) fuer Produkt-/
  Sitzungsattribute.
- **`evaluate()`** (`service.ts`, 976 Zeilen — bereits als
  Architektur-Wachstumssorge dokumentiert, siehe
  `project_ki_cross_evaluate_wachstum_sorge`-Memory, NICHT Teil dieser
  Discovery): laedt Session, prueft Auswertbarkeit, laedt Produktkandidaten,
  berechnet Eignung/`customerFitScore`/Ausschluss/Priorisierung inkl.
  Provisionsaufloesung, vergibt `priorityRank`, wertet Cross-Selling aus,
  bildet Idempotenz-Fingerprint, schreibt transaktional.
- **Idempotenz-Fingerprint** (`fingerprint.ts`): SHA-256 ueber kanonische
  JSON-Repraesentation aller Eingaben (Antworten, Produktattribute,
  Sitzungsattribute, Regelset-/Fragebogenversion, Algorithmusversion,
  Provisionsversionen, aktive `CampaignVersion`-IDs). Identischer
  Fingerprint = keine erneute Auswertung (Fast-Path). **Relevant fuer
  Playbook:** ein spaeterer Playbook-Kontext-Fingerprint muesste demselben
  Muster folgen, falls Playbook-Aenderungen eine Neuauswertung/-generierung
  auf KI-Seite ausloesen sollen (siehe Abschnitt 11).
- **Unveraenderlichkeit:** `Recommendation`/`RecommendationItem`/
  `RecommendationRationale`/`RecommendationCrossSellingSignal` sind
  append-only (DB-Trigger). `SalesOpportunity` bleibt mutable (Workflow).
- **Wo KI laut bestehender Dokumentation zulaessig ist** (Tabelle aus
  `RECOMMENDATION_ENGINE.md`, fuer das Playbook zentral): Tarifauswahl NEIN
  (nur Regeln), Margen-/Provisionsberechnung NEIN, naechste Frage
  vorschlagen JA (Komfort), Gespraechszusammenfassung JA, sprachliche
  Formulierung der Begruendung JA (nur Umformulierung vorhandener Fakten,
  keine neuen Fakten erfinden), Freitext-Erkennung/-Kategorisierung JA
  (als Hinweis, nicht als Entscheidungsgrundlage). Das Sales Playbook
  erweitert GENAU diese bereits erlaubten KI-Zonen (Formulierung,
  Gespraechsfuehrung) — nicht die verbotenen (Tarifauswahl, Margen).

### 1.3 Campaign Management (Phase 13) — Vorbild fuer Versionierung/RBAC

- **`Campaign`/`CampaignVersion`/`CampaignCondition`**
  (`prisma/schema.prisma` Zeilen 752-845): `CampaignVersion.status`
  (`VersionStatus`: `DRAFT`/`ACTIVE`/`EXPIRED`/`ARCHIVED`),
  `scopeType`/`scopeId` (polymorph TENANT/STORE, kein DB-FK, serverseitig
  geprueft), `validFrom`/`validTo`, `createdByUserId` (nullable,
  `onDelete: SetNull` — historische Zeile bleibt bei User-Loeschung
  bestehen). Draft→Publish-Workflow mit Row-Lock
  (`publishCampaignVersion()`, `campaign-admin.ts`) — inkl. des in Phase
  13 AP10 behobenen `now`-vor-Lock-Nebenlaeufigkeitsdefekts (siehe
  `project_ki_cross_phase13_ap10_abschluss`-Memory).
- **RBAC-Muster:** `config.campaigns.view/edit/publish`
  (`src/server/authz/config-permissions.ts`), additiv zu
  `config.questions.*`/`config.rules.*`/`config.commissions.*`/
  `config.goals.*` — Fachadmin editiert, Geschaeftsfuehrung/Publisher gibt
  frei, `sales_employee`-Rolle explizit ausgeschlossen.
- **Audit:** `AuditLog` (`action ∈ {CREATE, UPDATE, ACTIVATE, DEACTIVATE,
ROLLBACK, DELETION_REQUESTED, ...}`, `entityType`/`entityId`, `metadata`
  JSON) — generisches, tenant-/actor-indexiertes Audit-Log fuer
  Konfigurationsaenderungen. Separates `ConfigurationChange`-Modell fuer
  reine Wertaenderungen (z. B. Schwellenwerte).
- **`ConditionSourceType`-Enum** bereits um `CAMPAIGN_ACTIVE` erweitert
  (Phase 13 AP4) — Praezedenzfall fuer eine additive Enum-Erweiterung ohne
  Bruch bestehender Regeln.

### 1.4 PII-/Kontaktdaten-Schutz

`src/server/validation/contact-data-guard.ts`: generischer, modellunabhaengiger
Scanner fuer `AnalyticsEvent.payload`/`AuditLog.metadata` — lehnt JSON mit
verbotenen Schluesselnamen (Namen, E-Mail, Telefon, Adresse,
Zahlungsdaten, Freitext-Schluessel wie `notiz`/`kommentar`) oder
E-Mail-/Telefon-artigen/uebermaessig langen String-Werten ab. **Wichtig
fuer das Playbook** (siehe Phase-12-AP5-Discovery, Abschnitt 2): dieser
Scanner ist fuer STRUKTURIERTE Payloads gebaut, NICHT fuer Fliesstext —
auf Playbook-Freitext direkt angewendet, waere das Fehlalarmrisiko hoch.

### 1.5 Bereits bestehende Provider-Evaluierung (Phase 12 AP5/AP5b)

`docs/PHASE_12_AP5_DISCOVERY.md` (265 Zeilen) und
`docs/PHASE_12_AP5B_PROVIDER_EVALUATION.md` (bereits vorhandene,
detaillierte Recherche zu Anthropic/OpenAI/Mistral: EU-Hosting,
Retention, Kosten, DPA/AVV-Stand) sind vollstaendig wiederverwendbar fuer
Abschnitt 13 dieser Discovery — AP0 muss diese Arbeit NICHT wiederholen.

## 2. Fachliches Ziel des Sales Playbooks

Das Playbook bildet die verkaufsstrategische Denk- und Argumentationsweise
des Unternehmens/Nutzers ab und soll insbesondere festlegen koennen:

- wie Beratungsgespraeche gefuehrt werden sollen,
- welche Argumentationsweisen bevorzugt werden,
- wie bestimmte Kundensituationen angesprochen werden,
- welche Einwaende typisch sind und wie damit umgegangen wird,
- welche Verkaufsargumente zu welchen Situationen passen,
- welche Gespraechsfuehrung bevorzugt wird,
- welche Formulierungs-/Tonprinzipien gelten,
- wie Angebote erklaert werden,
- wie ein Gespraech sinnvoll zum Abschluss gefuehrt wird,
- welche Verkaufsweisen ausdruecklich vermieden werden sollen.

## 3. Nicht-Ziele / Scope-Grenzen

Das Playbook entscheidet **NICHT**:

- ob ein Produkt fachlich zulaessig ist (bleibt `EligibilityRule`),
- ob ein Kunde fuer ein Produkt berechtigt ist (bleibt `EligibilityRule`/
  `ExclusionRule`),
- welche Produkte aufgrund der Business Logic empfohlen werden muessen
  (bleibt `evaluate()`/`PrioritizationRule`),
- welche Preise/Margen/Provisionen gelten (bleibt `CommissionModelVersion`/
  `ProductVersion`),
- welche Campaigns aktiv sind (bleibt `Campaign`/`CampaignVersion`),
- welche Sicherheitsregeln der KI gelten (bleibt System-/Sicherheitsebene,
  siehe Abschnitt 7/8).

Das Playbook beschreibt ausschliesslich **WIE** beraten/verkauft wird,
niemals **WAS** fachlich erlaubt oder empfohlen ist. AP0 aendert an
Phase 12 (Provider-Code, Mock-Provider) und Phase 13 (Campaign-Logik,
Rule Engine, Recommendation Engine, Analytics) NICHTS — jede
Beruehrungsstelle wird ausschliesslich als offener spaeterer
Implementierungspunkt dokumentiert (siehe Abschnitt 15/17).

## 4. Playbook-Datenmodell und Abschnittsstruktur

**Klassifikation: Empfehlung fuer Phase 14 (keine bestehende Festlegung).**

### 4.1 Struktur

Empfehlung: ein Playbook besteht aus versionierbaren, einzelnen
**Abschnitten** (`PlaybookSection`) statt einem monolithischen Freitext —
das ermoegt gezieltes Retrieval (Abschnitt 5) statt Vollkontext-Einspeisung
(Abschnitt 14, Kostenkontrolle) und erlaubt getrennte Aenderung/Freigabe
einzelner Themen ohne das gesamte Playbook neu zu versionieren.

### 4.2 Vorgeschlagene Abschnittstypen (Beispiele, keine Vorentscheidung)

- Gespraechsfuehrung
- Argumentation
- Einwandbehandlung
- Produktargument
- Kundensituation
- Abschluss
- Upsell/Cross-Sell
- No-Go (was ausdruecklich zu vermeiden ist)
- Tonalitaet
- Allgemeine Verkaufsprinzipien

### 4.3 Vorgeschlagene Metadaten je Abschnitt

| Feld                       | Zweck                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                       | eindeutige Identitaet                                                                                        |
| `title`                    | Kurzbezeichnung                                                                                              |
| `content`                  | eigentlicher Text (der spaetere KI-Kontext)                                                                  |
| `sectionType`              | einer der Abschnittstypen oben                                                                               |
| `relatedTopics`/`keywords` | fuer regelbasiertes Retrieval (Abschnitt 5)                                                                  |
| `relatedProductKeys`       | Bezug zu Produktkategorien (Verknuepfung zur bestehenden Produkt-Attribut-Registry, `attribute-registry.ts`) |
| `relatedSituations`        | Bezug zu Kundensituation/Beratungsschritt                                                                    |
| `priority`                 | optional, fuer Konfliktaufloesung bei mehreren passenden Abschnitten                                         |
| `tags`                     | optional, freie Zusatzklassifikation                                                                         |
| `active`                   | Aktivierungsstatus                                                                                           |
| `sectionVersion`           | Versionsnummer (siehe Abschnitt 6)                                                                           |
| `authorUserId`             | analog `createdByUserId`-Muster (Campaign/Goal), nullable + `SetNull`                                        |
| `createdAt`                | Zeitstempel                                                                                                  |
| `validFrom`/`validTo`      | optional, falls zeitlich begrenzte Playbook-Inhalte gewuenscht sind (analog Campaign)                        |

**Empfehlung:** Metadaten pragmatisch halten — nicht unnoetig
normalisieren (z. B. `relatedProductKeys` als String-Array statt eigener
Zwischentabelle, analog wie `CampaignCondition.attributeKey` bereits
String-basiert auf die geschlossene Attribute-Registry verweist statt
eine eigene FK-Tabelle zu benoetigen). Ziel ist ein Modell, das SPAETER
gutes Retrieval ermoeglicht, nicht die vollstaendige Antizipation aller
zukuenftigen Anforderungen.

## 5. Versionierung

**Klassifikation: Empfehlung fuer Phase 14, analog bestehendem
Draft→Publish-Muster (Campaign/RuleSet/CommissionModel).**

Vorgeschlagenes Modell — direkt aus dem bestehenden `CampaignVersion`-Muster
uebernommen:

- `Playbook` (Tenant-Scope, ggf. Store-Scope analog `CampaignScopeType`)
  → `PlaybookVersion` (`status: DRAFT/ACTIVE/EXPIRED/ARCHIVED`, genau eine
  `ACTIVE`-Version je Scope zu jedem Zeitpunkt, analog
  `EXCLUDE`-Constraint-Muster) → `PlaybookSection`-Zeilen je Version.
- Draft-Erstellung, Bearbeitung einzelner Abschnitte, Publish-Workflow mit
  Row-Lock (identisches Muster wie `publishCampaignVersion()` —
  **ausdruecklich inklusive** der in Phase 13 AP10 gelernten Lektion:
  `now = new Date()` MUSS innerhalb der Transaktion, NACH Lock-Erwerb,
  bestimmt werden, nicht davor).
- **Reproduzierbarkeits-Anforderung (zentral):** Eine spaetere Aenderung
  des Playbooks darf NICHT rueckwirkend die Interpretation einer bereits
  durchgefuehrten Beratung veraendern. Eine `Recommendation`/KI-generierte
  Formulierung muss spaeter nachvollziehen koennen, WELCHE
  Playbook-Version und WELCHE Abschnitte tatsaechlich als Kontext
  verwendet wurden — analog dem bestehenden Fingerprint-Prinzip
  (`fingerprint.ts`) und der Campaign-Attribution
  (`RecommendationCampaignSignal`, Phase 13 AP7).
- **Offene technische Entscheidung:** ob eine neue
  `RecommendationPlaybookSignal`-aehnliche Tabelle noetig ist (analog
  `RecommendationCampaignSignal`) oder ob die Zuordnung ueber ein Feld auf
  einer bestehenden/neuen KI-Interaktions-Tabelle genuegt — abhaengig von
  der noch nicht implementierten AP5c-Provider-Anbindung (siehe
  Abschnitt 13). Diese Discovery trifft hierzu keine Vorfestlegung, da vor
  AP5c keine reale KI-Antwort existiert, die referenziert werden muesste.

## 6. Retrieval-Strategie

**Klassifikation: Empfehlung fuer Phase 14 (technische Entscheidung mit
Begruendung).**

### 6.1 Verglichene Varianten

| Kriterium          | A: Regelbasiert                                                                                        | B: Semantisch (Embeddings/RAG)                                            | C: Hybrid                         |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------- |
| Genauigkeit        | hoch bei sauber gepflegten Metadaten, keine Ueberraschungen                                            | potenziell hoeher bei unscharfen Anfragen, aber auch Fehltreffer moeglich | Kombination beider Staerken       |
| Determinismus      | vollstaendig deterministisch                                                                           | nicht deterministisch (Embedding-Modell-abhaengig)                        | teilweise deterministisch         |
| Komplexitaet       | gering (bestehende Filterlogik-Muster wiederverwendbar, analog `CampaignCondition`/Attribute-Registry) | hoch (Vektordatenbank/-index, Embedding-Pipeline, neue Infrastruktur)     | am hoechsten                      |
| Kosten             | keine zusaetzlichen Kosten                                                                             | Embedding-Berechnung + Speicherung + Betrieb eines Vektorindex            | zusaetzliche Kosten fuer B-Anteil |
| Latenz             | sehr gering (In-Memory-/DB-Filter)                                                                     | zusaetzlicher Netzwerk-/Rechenschritt                                     | zwischen A und B                  |
| Wartbarkeit        | gut, solange Playbook-Groesse ueberschaubar bleibt                                                     | erfordert Embedding-Pipeline-Pflege, Reindexierung bei Aenderungen        | am aufwendigsten                  |
| Debuggability      | sehr gut — nachvollziehbar, WARUM ein Abschnitt gewaehlt wurde                                         | schwer nachvollziehbar ("warum genau dieser Abschnitt?")                  | teilweise                         |
| Reproduzierbarkeit | vollstaendig (siehe Abschnitt 5)                                                                       | schwierig (Embedding-Modell-Version muesste mitversioniert werden)        | teilweise                         |
| Skalierbarkeit     | begrenzt bei sehr grossen/unstrukturierten Playbooks                                                   | skaliert besser bei grossen Textmengen                                    | skaliert am besten                |

### 6.2 Empfehlung

**Variante A (regelbasiertes Retrieval)** fuer Phase 14. Begruendung:

- Passt zur bestehenden Systemphilosophie ("Tarife und Produkte werden
  NICHT von einem Sprachmodell frei ausgewaehlt", `RECOMMENDATION_ENGINE.md`)
  — dieselbe Zurueckhaltung gilt fuer die Playbook-Auswahl.
- Volle Reproduzierbarkeit und Debuggability, konsistent mit dem
  bestehenden Fingerprint-/Append-only-Prinzip der Recommendation Engine.
- Keine neue Infrastruktur (Vektordatenbank, Embedding-Pipeline) noetig —
  vermeidet vorzeitige Komplexitaet, bevor die tatsaechliche
  Playbook-Groesse/-Nutzung bekannt ist.
- Auswahl erfolgt ueber die in Abschnitt 4.3 vorgeschlagenen Metadaten
  (Abschnittstyp, Themen/Keywords, Produktbezug, Kundensituation,
  aktuelle Frage/Beratungsschritt) — technisch analog zur bestehenden
  `CampaignCondition`-/Attribute-Registry-Filterlogik, keine neue
  Filter-Grundtechnologie.

**Empfohlene spaetere Evolution:** Semantisches Retrieval (Variante B/C)
erst einfuehren, wenn Playbook-Groesse/-Komplexitaet regelbasierte Auswahl
nachweislich unzureichend macht — als expliziter spaeterer
Implementierungspunkt dokumentiert, nicht in Phase 14 vorweggenommen.

## 7. Zusammenspiel mit Rule Engine und Campaign Management

**Klassifikation: bereits durch bestehende Architektur festgelegte
Leitplanke, hier auf das Playbook angewendet.**

Bestaetigte Systemgrenzen:

- **Rule Engine / Campaigns → WAS/WANN** empfohlen wird (`EligibilityRule`,
  `ExclusionRule`, `PrioritizationRule`, `CrossSellingRule`, `Campaign`).
- **Sales Playbook → WIE** darueber beraten/argumentiert wird.
- **KI → formuliert** die konkrete Sprache innerhalb dieser Grenzen.

Das Playbook darf **niemals** eine zweite Recommendation Engine werden.
Konkret bedeutet das:

- `PrioritizationRule`, `CrossSellingRule`, `CAMPAIGN_ACTIVE`,
  `RecommendationRationale` und `RecommendationCampaignSignal` bleiben
  unveraendert die alleinige Quelle fuer WELCHE Produkte/Kampagnen
  relevant sind.
- Das Playbook DARF diese bereits berechneten, strukturierten Informationen
  (z. B. "Produkt X wird empfohlen", "Kampagne Y ist aktiv") als
  zusaetzlichen Argumentationskontext erhalten — es darf daraus aber
  NIEMALS selbststaendig eine fachliche Empfehlung erzeugen, die der Rule
  Engine widerspricht oder diese umgeht.
- Beispiel (aus dem ChatGPT-Auftrag uebernommen): Wenn die Rule Engine
  Produkt X empfiehlt und Campaign Y aktiv ist, kann die KI daraus
  Argumentationskontext erhalten ("betone die aktuelle Aktion bei Produkt
  X") — sie darf daraus aber keine eigene Empfehlung fuer ein anderes,
  von der Rule Engine nicht empfohlenes Produkt konstruieren.
- **Offene technische Entscheidung:** exakter Datenfluss, WIE
  Recommendation-/Campaign-Kontext technisch an die Playbook-Retrieval-
  /Prompt-Schicht uebergeben wird (z. B. als zusaetzliches Feld in einem
  kuenftigen `AiExtractionRequest`-aehnlichen Contract oder als separater
  Parameter einer neuen Playbook-Kontext-Funktion) — abhaengig von der noch
  nicht spezifizierten Phase-14-Implementierung eines eigenen
  KI-Interaktionspfads (das Playbook ist konzeptionell NICHT Teil des
  bestehenden `AiExtractionProvider`-Contracts, siehe Abschnitt 3 — dieser
  ist fuer Fragebogen-Extraktion gebaut, nicht fuer
  Formulierungs-/Argumentationsunterstuetzung).

## 8. Prompt- und Kontextarchitektur

**Klassifikation: Empfehlung fuer Phase 14 (technische Architekturfrage
mit Sicherheitsbezug).**

### 8.1 Trust Hierarchy (verbindliche Reihenfolge, absteigende Autoritaet)

1. System-/Sicherheitsregeln (nicht durch Nutzerinhalt veraenderbar)
2. Fachliche Systemregeln (Rule-Engine-/Recommendation-Ergebnisse — bereits
   berechnete, strukturierte Fakten, analog dem bestehenden Grounding-Zwang
   aus `RECOMMENDATION_ENGINE.md`: "die KI erhaelt nur bereits berechnete,
   strukturierte Werte als Input")
3. Strukturierte Beratungskontextdaten (aktuelle Session, sichtbare Fragen)
4. Bestehende Recommendation-/Campaign-Informationen
5. Relevantes Sales-Playbook (regelbasiert ausgewaehlte Abschnitte)
6. Kundeneigener Freitext (niedrigste Autoritaet unter den
   "Inhaltsebenen" — wird zwar gelesen/verarbeitet, darf aber nichts
   ueberschreiben)
7. Eigentliche Benutzeranfrage / aktueller Beratungsschritt

**Begruendung der Reihenfolge:** Ebenen 1-4 sind bereits heute technisch
vertrauenswuerdig (Systemcode bzw. serverseitig berechnete Fakten,
analog `buildVisibleQuestionContext()`s Sicherheitsgrenze — "die KI
bestimmt niemals selbst, welche Fragen sichtbar sind"). Ebene 5
(Playbook) ist nutzergeneriert, aber von einer autorisierten,
RBAC-geschuetzten Rolle gepflegt (siehe Abschnitt 10) — dennoch als
untrusted content zu behandeln (Abschnitt 9). Ebene 6 (Kundenfreitext) ist
die am wenigsten vertrauenswuerdige Quelle, da potenziell von einer
dritten, nicht-authentifizierten Partei (dem Kunden im Gespraech)
stammend.

### 8.2 Uebergabeform (offene technische Entscheidung)

Zu klaeren, aber NICHT in AP0 zu implementieren:

- Playbook-Abschnitte als System-Prompt-Erweiterung,
- als separater, klar abgegrenzter Kontextblock,
- als strukturierter Input (analog `AiExtractionVisibleQuestion[]`),
- oder als Tool-/Retrieval-Kontext.

**Keine Provider-spezifische Implementierung in AP0** — die
Uebergabeform darf sich am bestehenden Contract-Muster
(`AiExtractionProvider`) orientieren, ist aber explizit Teil der
spaeteren Implementierung, nicht dieser Discovery.

## 9. Prompt-Injection und Security (Pflichtbestandteil)

**Klassifikation: Empfehlung fuer Phase 14 (Sicherheitsanforderung, bereits
in AP0 zu klaeren, nicht spaeter).**

### 9.1 Grundsatz

Das Playbook ist vom Nutzer/Unternehmen bereitgestellter Freitext und
damit grundsaetzlich als **untrusted content** zu behandeln — auch wenn
es vom Geschaeftsfuehrer selbst stammt. Diese Einordnung ist unabhaengig
von der RBAC-Berechtigung der pflegenden Person (Abschnitt 10): Autorisiert
zu SCHREIBEN bedeutet nicht automatisch vertrauenswuerdig als
SYSTEM-Anweisung.

### 9.2 Zu betrachtende Angriffsszenarien

- Playbook enthaelt Anweisungen wie "ignoriere vorherige Regeln".
- Playbook versucht, Systemregeln zu ueberschreiben.
- Playbook versucht, interne Daten offenzulegen.
- Kundentext versucht, Playbook-Regeln zu veraendern.
- Kundentext versucht, System-/Developer-Anweisungen zu manipulieren.
- Manipulierte Playbook-Tags/Metadaten (z. B. um durch gefaelschte
  Keywords gezielt einen bestimmten Abschnitt in jeden Kontext zu
  erzwingen).
- Retrieval liefert absichtlich schaedlichen Kontext (z. B. wenn ein
  Playbook-Abschnitt durch Metadaten-Manipulation faelschlich als
  hochrelevant fuer jede Anfrage markiert wird).

### 9.3 Trust Boundary — was darf das Playbook beeinflussen, was niemals

**Darf beeinflussen:** Tonalitaet, Formulierung, Argumentationsreihenfolge,
Einwandbehandlungs-Vorschlaege, Gespraechsfuehrungshinweise — ausschliesslich
innerhalb der bereits durch Rule Engine/Recommendation Engine berechneten
Fakten (Abschnitt 7).

**Darf niemals beeinflussen:** welche Produkte als eignungsgeprueft/
priorisiert gelten (`evaluate()`-Ergebnis), welche Daten die KI ausserhalb
des uebergebenen Kontexts erhaelt/preisgibt, System-/Sicherheitsanweisungen
selbst, welche Fragen sichtbar sind (`buildVisibleQuestionContext()`),
welche `CustomerAnswer`-Werte gespeichert werden (bleibt exklusiv der
bestehende `saveAnswer()`-Pfad, Abschnitt 1.1).

### 9.4 Wiederverwendbare bestehende Muster

Der Grundsatz "der Provider ist nicht vertrauenswuerdig" (bereits fuer
KI-ANTWORTEN in `extraction-validator.ts` durchgesetzt: Fragenkatalog-
Zugehoerigkeit, Typkonsistenz, Mehrdeutigkeit) muss fuer das Playbook auf
den EINGANGSKONTEXT gespiegelt werden — nicht ungeprueft kopieren, aber
als Vorbild fuer serverseitige Validierung nutzen (z. B.: darf ein
Playbook-Abschnitt ueberhaupt Freitext enthalten, der wie eine
Systemanweisung aussieht? Eine technische Erkennung ist eine offene
Implementierungsfrage, siehe Abschnitt 16).

## 10. PII und Datenschutz

**Klassifikation: Empfehlung fuer Phase 14, aufbauend auf bestehender
Phase-12-Sorgfalt.**

Zu betrachtende Datenflüsse: Playbook selbst, Kundeneigener Freitext,
strukturierte Kundendaten, Retrieval-Ergebnisse, Provider-Payload,
Analytics, Logs, `AuditLog`.

- **Playbook selbst:** sollte grundsaetzlich KEINE personenbezogenen
  Kundendaten enthalten (es beschreibt Verkaufsstrategie, nicht einzelne
  Kunden) — dies ist primaer eine Prozess-/Schulungsfrage (analog der
  bereits fuer den Freitext-Extraktions-Kundenfreitext getroffenen
  Einordnung in `PHASE_12_AP5_DISCOVERY.md` Abschnitt 2), keine rein
  technische Filterung.
- **Bestehender PII-Scanner nicht direkt uebertragbar:** `contact-data-
guard.ts` (`assertNoContactData()`) ist fuer strukturierte
  `AnalyticsEvent`/`AuditLog`-Payloads gebaut, nicht fuer Fliesstext (siehe
  Abschnitt 1.4/1.5) — auf Playbook-Fliesstext direkt angewendet, hohes
  Fehlalarmrisiko (bereits fuer den Kundenfreitext in Phase 12 AP5
  identisch bewertet und verworfen). Playbook-Metadaten (Abschnitt 4.3,
  strukturierte Felder wie `sectionType`/`tags`) SOLLTEN aber weiterhin
  durch den bestehenden Scanner laufen, falls sie je in
  `AnalyticsEvent`/`AuditLog` landen — das ist strukturell dieselbe
  Situation wie bei jedem anderen Konfigurationsobjekt (Campaign,
  RuleSet).
- **Datenminimierung:** analog Phase 12 AP5 — Provider-Payload sollte nur
  die tatsaechlich fuer die Formulierung noetigen Playbook-Abschnitte +
  Recommendation-/Kontext-Daten enthalten, keine vollstaendige
  Kundenhistorie.
- **Transiente Verarbeitung vs. Persistenz:** Playbook-INHALTE werden
  persistiert (das ist der Zweck, analog Campaign/RuleSet) — die
  Datenschutzfrage betrifft primaer den KUNDENFREITEXT, der weiterhin der
  bestehenden Transienz-Regel aus Phase 12 folgen sollte (keine
  Persistenz ausserhalb des einzelnen Anfrage-Zyklus).
- **Provider-Datenverarbeitung/Retention:** identisch zur bereits in
  Phase 12 AP5/AP5b analysierten Fragestellung (EU-Hosting,
  Zero-Data-Retention, AVV) — wird durch AP5c konkret entschieden, siehe
  Abschnitt 13. AP0 trifft hierzu keine neue Entscheidung.
- **UI-Hinweise:** analog dem in Phase 12 AP5 vorgeschlagenen
  Datenschutzhinweis ("Freitext wird zur Analyse an einen externen
  KI-Dienst uebermittelt") — Umsetzung ist Implementierungsdetail.
- **Logging:** keine Playbook-Inhalte oder Kundenfreitext in Server-Logs
  (bestehende Anforderung, `PRIVACY_AND_SECURITY.md`).

## 11. RBAC

**Klassifikation: Empfehlung fuer Phase 14, exakt analog bestehendem
Muster — NICHT implementieren in AP0.**

Vorschlag, additiv zum bestehenden `config.*`-Permission-Katalog
(`src/server/authz/config-permissions.ts`):

- `config.playbooks.view`
- `config.playbooks.edit`
- `config.playbooks.publish`

Analog dem bestehenden Muster (`config.campaigns.*`/`config.rules.*`/
`config.commissions.*`/`config.goals.*`):

- Tenant-Scope, ggf. Store-Scope (abhaengig von der finalen
  Scope-Entscheidung in Abschnitt 5 — analog `CampaignScopeType`).
- `config_editor`-Rolle erhaelt zusaetzlich `view`+`edit`,
  `config_publisher`-Rolle zusaetzlich `view`+`edit`+`publish` (analog
  `seed-role-permissions.ts`-Muster).
- `sales_employee`-Rolle bleibt explizit AUSGESCHLOSSEN (bestehende
  Ausschlussregel fuer alle bisherigen `config.*.*`-Erweiterungen).
- Klare Trennung von Bearbeitung (`edit`) und Veroeffentlichung
  (`publish`) — ein Draft-Playbook kann bearbeitet werden, ohne sofort
  produktiv zu sein (analog Campaign/RuleSet/CommissionModel).

## 12. Auditierbarkeit und Reproduzierbarkeit

**Klassifikation: Empfehlung fuer Phase 14, aufbauend auf bestehenden
Mechanismen — keine neue Persistenz ohne Pruefung, was bereits existiert.**

Ziel: Eine bereits durchgefuehrte Beratung muss spaeter nachvollziehbar
bleiben, auch wenn sich das Playbook, Campaigns, Regeln oder der
KI-Provider spaeter geaendert haben.

Zu erfassende Informationen (Vorschlag):

- Playbook-Version (`PlaybookVersion.id`/`versionNumber`).
- tatsaechlich verwendete Playbook-Abschnitte (`PlaybookSection.id` +
  `sectionVersion`).
- Provider-Version (analog `MOCK_PROVIDER_VERSION`/`providerVersion`,
  bereits in `AI_EXTRACTION_REQUESTED`/`_COMPLETED`-Payloads vorhanden).
- Prompt-/Kontext-Fingerprint (analog `fingerprint.ts` — ob ein
  gemeinsamer oder ein separater Fingerprint-Mechanismus fuer
  Playbook-Kontext sinnvoll ist, ist eine offene technische Entscheidung,
  siehe Abschnitt 16).
- Zusammenhang mit `Recommendation`/`RecommendationItem` (falls die
  Playbook-gestuetzte Formulierung sich auf eine konkrete Empfehlung
  bezieht — analog `RecommendationCampaignSignal`-Muster, Abschnitt 5/7).

**Bestehende Mechanismen zuerst pruefen, bevor neue Persistenz eingefuehrt
wird:** `AuditLog` deckt bereits Konfigurationsaenderungen (CREATE/UPDATE/
ACTIVATE/...) generisch ab — eine `PlaybookVersion`-Publish-Aktion wuerde
sich dort einreihen, ohne neue Tabellenstruktur. Fuer die Verknuepfung
"welche Playbook-Abschnitte flossen in EINE KONKRETE KI-Antwort ein" ist
hingegen eine neue, KI-Interaktions-bezogene Struktur wahrscheinlich
noetig — analog wie `RecommendationCampaignSignal` fuer Campaigns eine
eigene Attributions-Tabelle war, kein Erweiterungsfeld auf `AuditLog`.
Diese Entscheidung ist an AP5c gekoppelt (Abschnitt 13), da vor einer
echten Provider-Antwort nicht klar ist, WELCHE KI-Interaktions-Entitaet
ueberhaupt referenziert werden muesste.

## 13. Evaluation und Teststrategie

**Klassifikation: Empfehlung fuer Phase 14 — bereits in AP0 zu
definieren, damit AP5c (Phase 12) einen gemeinsamen Testdatensatz nutzen
kann.**

### 13.1 Messbare Testdimensionen

- **Sales-Playbook-Treue:** Befolgt die KI die gewuenschte Verkaufslogik?
- **Fachliche Integritaet:** Ignoriert sie keine Eligibility-/
  Recommendation-Regeln (Abschnitt 7/8, zentrale Architekturgrenze)?
- **Argumentationsqualitaet:** Passen Argumente zur Kundensituation?
- **Einwandbehandlung:** Werden definierte Einwaende sinnvoll behandelt?
- **Prompt-Injection-Resistenz:** Kann Playbook- oder Kundentext hoehere
  Regeln ueberschreiben (Abschnitt 9)?
- **Deutsche Sprachqualitaet:** Natuerlichkeit, Verstaendlichkeit,
  Professionalitaet.
- **Determinismus/Reproduzierbarkeit:** Ist das Verhalten bei gleichem
  Kontext ausreichend stabil?
- **Latenz:** Zeit pro Anfrage.
- **Kosten:** Tokenverbrauch und Kosten pro Beratung.
- **Structured Output:** Validitaet/Robustheit, sofern weiterhin
  strukturierte KI-Ergebnisse verwendet werden (analog
  `AiExtractionCandidate[]`-Muster).

### 13.2 Konkrete Testfaelle (Vorschlag)

1. Kein passender Playbook-Abschnitt vorhanden.
2. Genau ein passender Abschnitt.
3. Mehrere passende Abschnitte (Konfliktaufloesung ueber `priority`,
   Abschnitt 4.3).
4. Widerspruechliche Playbook-Regeln (z. B. zwei Abschnitte mit
   gegensaetzlicher Empfehlung fuer dieselbe Situation).
5. Campaign + Playbook gleichzeitig aktiv (Abschnitt 7).
6. Recommendation + Playbook gleichzeitig vorhanden.
7. Kundentext mit Prompt-Injection-Versuch (Abschnitt 9.2).
8. Playbook-Inhalt mit Prompt-Injection-Versuch (Abschnitt 9.2).
9. Geaenderte Playbook-Version NACH einer bereits erfolgten Beratung
   (Reproduzierbarkeits-Test, Abschnitt 5/12 — analog dem bestehenden
   Reproduzierbarkeitstest aus Phase 13 AP8 fuer Campaign-Fingerprints).

## 14. Vorbereitung fuer AP5c — echter Provider

**Klassifikation: Abhaengigkeit von AP5c. AP0 waehlt KEINEN Provider und
stellt KEINE API-Verbindung her.**

AP5c (Phase 12, weiterhin offen, Nutzer-API-Key-Setup noetig) soll
kuenftig NICHT nur "funktioniert / funktioniert nicht" pruefen, sondern
mindestens folgende, bereits in `PHASE_12_AP5_DISCOVERY.md`/
`PHASE_12_AP5B_PROVIDER_EVALUATION.md` vorbereitete Kriterien plus die in
Abschnitt 13.1 dieser Discovery ergaenzten Playbook-spezifischen Punkte
messen:

- Structured Output (bereits in Phase-12-AP5-Discovery Abschnitt 4
  behandelt).
- Deutsche Sprachqualitaet (Phase-12-AP5b identifizierte hier bereits eine
  Datenluecke — kein Kandidat hatte belastbare Deutsch-Benchmarks).
- **Playbook-Befolgung** (neu, aus Abschnitt 13.1 dieser Discovery).
- **Prompt-Injection-Resistenz** (neu, aus Abschnitt 9/13.1).
- Latenz (Phase-12-AP5-Discovery schlug 5-10s Timeout als
  Diskussionsgrundlage vor).
- Tokenverbrauch/Kosten (Phase-12-AP5b liefert bereits konkrete
  Preisvergleiche Anthropic/OpenAI/Mistral).
- Datenschutz/Retention/EU-Verarbeitung (Phase-12-AP5b liefert bereits die
  vollstaendige Kriterientabelle — kein neuer Rechercheaufwand noetig).
- Zuverlaessigkeit/Timeout-/Fallback-Verhalten (Phase-12-AP5-Discovery
  Abschnitt 5/6 bereits vorbereitet).

**Empfehlung:** Die spaetere Provider-PoC (AP5c) soll denselben
standardisierten Testdatensatz (Abschnitt 13.2) verwenden koennen wie die
Phase-14-Evaluation — das bedeutet, AP5c sollte NICHT vor Phase 14 AP0
stattfinden muessen, kann aber PARALLEL laufen (ChatGPTs bereits erteilte
Priorisierungsentscheidung, siehe `project_ki_cross_sales_playbook_idee`-
Memory, 2026-08-31): AP0 liefert die Testkriterien, AP5c liefert die
Provider-Infrastruktur — beide sind unabhaengig voneinander startbar.

## 15. Kosten- und Tokenkontrolle

**Klassifikation: Empfehlung fuer Phase 14 (Pflicht-Designaspekt, nicht
Implementierungsdetail).**

Wichtigster Grundsatz: Das Playbook darf NICHT dazu fuehren, dass bei
jeder Anfrage das komplette Playbook an den Provider gesendet wird — das
Retrieval-Konzept (Abschnitt 6, regelbasiert) muss daher explizit eine
Kontextbegrenzung vorsehen.

Zu untersuchende/festzulegende Grenzen:

- Maximale Playbook-Kontextgroesse pro Anfrage (Zeichen-/Tokenmenge).
- Maximale Anzahl retrieved Sections pro Anfrage.
- Priorisierung bei zu grossem Kontext (ueber das `priority`-Feld aus
  Abschnitt 4.3 — bei Konflikt gewinnt die hoehere Prioritaet, ueberzaehlige
  Abschnitte werden verworfen statt gekuerzt).
- Duplicate Removal (identische/stark ueberlappende Abschnitte nicht
  mehrfach einspeisen).
- Caching/Prompt-Caching, sofern der spaeter gewaehlte Provider dies
  unterstuetzt (Phase-12-AP5b nennt bereits Prompt-Caching-Rabatte bei
  OpenAI/Anthropic als vorhandenes Feature).
- Kostenmessung/Tokenzaehlung — analog der bereits in
  `PHASE_12_AP5_DISCOVERY.md` Abschnitt 8 vorgeschlagenen additiven
  Erweiterung von `AI_EXTRACTION_REQUESTED`/`_COMPLETED`-Payloads um
  `promptTokenCount`/`completionTokenCount` (rein numerisch, kein PII-
  Risiko, bereits durch `event-payload-schemas.ts`-Muster abgedeckt).
- Rate Limits/Request Limits/Timeout/Fallback — identische Fragestellung
  wie in Phase-12-AP5-Discovery Abschnitt 5/8, direkt uebertragbar.

Diese Grenzen sind Teil des Kontextaufbaus (Abschnitt 6/8), nicht separat
davon zu betrachten — die Retrieval-Strategie MUSS die Kostenkontrolle von
Anfang an einhalten, nicht nachtraeglich begrenzen.

## 16. Risiken

- **Scope-Creep zur "zweiten Recommendation Engine":** groesstes
  identifiziertes Risiko — bereits durch die Trust-Hierarchie (Abschnitt 8) und die harte Nicht-Ziel-Abgrenzung (Abschnitt 3) adressiert, muss
  aber bei JEDER spaeteren AP explizit re-verifiziert werden (analog wie
  die bestehende `evaluate()`-Wachstumssorge bereits fuer die Rule Engine
  dokumentiert ist, siehe `project_ki_cross_evaluate_wachstum_sorge`).
- **Prompt-Injection ueber Playbook-Inhalte** trotz autorisierter
  Pflege-Rolle — adressiert in Abschnitt 9, aber die konkrete technische
  Erkennung/Absicherung ist noch offen (Implementierungsfrage, nicht
  Discovery-Frage).
- **PII-Vermischung im Playbook-Freitext** (z. B. wenn ein Fachadmin
  versehentlich Kundenbeispiele mit echten Namen einfuegt) — adressiert
  als Prozess-/Schulungsfrage (Abschnitt 10), keine verlaessliche
  technische Vollabsicherung geplant.
- **Reproduzierbarkeitsluecke, falls Playbook-Versionierung nicht sauber
  mit KI-Interaktionen verknuepft wird** — bewusst als offene technische
  Entscheidung in Abschnitt 12 markiert, abhaengig von AP5c.
- **Verzoegerung durch fehlende Provider-Anbindung (AP5c):** Phase 14 kann
  strukturell vollstaendig ohne echten Provider entworfen werden (AP0-AP?
  bis zur eigentlichen KI-Anbindung), aber eine ECHTE End-to-End-Validierung
  der Playbook-Wirkung ist erst nach AP5c moeglich — ChatGPTs
  Priorisierungsentscheidung (parallel statt sequenziell) reduziert dieses
  Risiko bereits.
- **Kostenexplosion durch unkontrollierten Kontext:** adressiert in
  Abschnitt 15, aber die konkrete Kontextgroessen-Grenze ist eine
  spaetere, noch zu treffende Zahl (kein Vorschlag in dieser Discovery, da
  abhaengig vom gewaehlten Provider/Modell aus AP5c).

## 17. Offene Entscheidungen (Zusammenfassung)

Diese Discovery trifft folgende Fragen bewusst NICHT final — sie sind
Nutzer-/ChatGPT-Entscheidungen fuer die Implementierungsplanung:

1. Store-Scope fuer Playbooks zulassen (analog `CampaignScopeType`) oder
   ausschliesslich Tenant-Scope?
2. Technischer Uebergabemechanismus des Playbook-Kontexts an die KI
   (System-Prompt-Erweiterung vs. separater Kontextblock vs. strukturierter
   Input vs. Tool-Kontext, Abschnitt 8.2)?
3. Exakte neue Datenstruktur fuer die KI-Interaktions-Attribution
   (Abschnitt 12) — abhaengig von AP5c.
4. Technische Erkennung/Absicherung gegen Prompt-Injection im
   Playbook-Inhalt selbst (Abschnitt 9.4) — reicht redaktionelle
   Sorgfalt + Trust-Hierarchie, oder wird eine zusaetzliche technische
   Pruefung verlangt?
5. Konkrete Kontextgroessen-/Token-Obergrenze (Abschnitt 15) — abhaengig
   vom in AP5c gewaehlten Provider/Modell.
6. Zeitpunkt fuer die Einfuehrung semantischen Retrievals (Abschnitt 6.2),
   falls die Playbook-Groesse dies spaeter erfordert.

## 18. Empfohlene naechste Schritte

1. Dieses Dokument mit ChatGPT abstimmen (Statusbericht, analog dem
   Vorgehen bei allen bisherigen Discovery-Dokumenten dieses Projekts).
2. Bei Bestaetigung: `PHASE_14_IMPLEMENTATION_PLAN.md` entwerfen
   (AP-Gliederung analog Phase 10-13), beginnend mit dem Datenmodell
   (Abschnitt 4/5) als AP1 — konsistent mit dem bisherigen Projektmuster
   ("Datenmodell zuerst, dann Service-Schicht, dann API, dann UI").
3. Nutzer-Implementierungs-GO vor AP1 einholen (Standardregel dieses
   Projekts).
4. AP5c (Phase 12, Provider-PoC) kann parallel zu Phase 14 AP1ff.
   angestossen werden, sobald der Nutzer das noetige API-Key-Setup
   vornimmt — beide Arbeitsstraenge sind laut ChatGPT unabhaengig
   voneinander startbar.

## 19. Entscheidungstabelle (kompakt)

| Thema                                    | Ist-Zustand                                       | Empfehlung                                                      | Entscheidung noetig?                                    | Abhaengigkeit |
| ---------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- | ------------- |
| Playbook = zweite Recommendation Engine? | n/a (neues Feature)                               | Strikt NEIN, nur WIE nicht WAS                                  | Nein (Leitplanke bereits gesetzt)                       | —             |
| Datenmodell-Grundform                    | n/a                                               | `Playbook`/`PlaybookVersion`/`PlaybookSection`, analog Campaign | Ja (Bestaetigung)                                       | —             |
| Abschnittstypen                          | n/a                                               | 10 Beispieltypen (Abschnitt 4.2), keine Vorfestlegung           | Ja (Geschaeftsentscheidung)                             | —             |
| Versionierung                            | Campaign-/RuleSet-Muster existiert                | 1:1 uebernehmen inkl. AP10-Lock-Lektion                         | Nein (bereits etabliertes Muster)                       | —             |
| Retrieval-Strategie                      | n/a                                               | Variante A (regelbasiert), kein RAG in Phase 14                 | Ja (technische Entscheidung)                            | —             |
| Rule-Engine-Integration                  | Rule Engine bereits vollstaendig getrennt         | Playbook erhaelt nur bereits berechnete Fakten                  | Nein (bereits Leitplanke)                               | —             |
| Prompt-/Kontextarchitektur               | n/a                                               | Trust Hierarchy 7-stufig (Abschnitt 8.1)                        | Ja (technische Entscheidung, Uebergabeform offen)       | —             |
| Prompt-Injection-Schutz                  | Muster aus Phase 12 (Provider-Misstrauen)         | Trust Boundary + spaetere technische Pruefung                   | Ja (offene technische Entscheidung)                     | —             |
| PII/Freitext                             | `contact-data-guard.ts` nicht direkt uebertragbar | Prozess-/Schulungsloesung, kein Scanner auf Fliesstext          | Ja (Geschaeftsentscheidung, analog Phase-12-Praezedenz) | —             |
| RBAC                                     | `config.campaigns.*`-Muster existiert             | `config.playbooks.view/edit/publish`, analog                    | Nein (Muster bereits etabliert)                         | —             |
| Audit/Reproduzierbarkeit                 | `AuditLog` deckt Config-Aenderungen ab            | Publish ueber `AuditLog`, KI-Attribution neu                    | Ja (technische Entscheidung, KI-Attribution offen)      | AP5c          |
| Evaluation/Teststrategie                 | n/a                                               | 10 Testdimensionen + 9 Testfaelle (Abschnitt 13)                | Nein (bereits definiert)                                | —             |
| AP5c-Vorbereitung                        | Phase-12-AP5/AP5b bereits vorhanden               | Wiederverwenden, um Playbook-Kriterien ergaenzen                | Nein (bereits vorbereitet)                              | AP5c          |
| Kosten-/Tokenkontrolle                   | n/a                                               | Kontextbegrenzung im Retrieval selbst, keine Zahl vorgeschlagen | Ja (abhaengig vom Provider)                             | AP5c          |
| Priorisierung vs. AP5c                   | AP5c offen, kein Nutzer-Setup erfolgt             | Parallel laufen lassen (ChatGPT-Entscheidung 2026-08-31)        | Nein (bereits entschieden)                              | —             |

## 20. Git-/CI-Leitplanken (eingehalten)

AP0 ist eine reine Discovery: kein Produktionscode, kein Schema, keine
Migration, keine API, keine UI, keine Provider-Anbindung, kein API-Key,
keine Feature-Aktivierung wurden in diesem Arbeitspaket veraendert.
Einziges Ergebnis ist diese Datei. Vor Commit: Prettier-/Markdown-Pruefung
(analog allen bisherigen Discovery-Dokumenten dieses Projekts), CI
verifiziert ausschliesslich den Dokumentations-Commit.

## 21. Wichtigste Architekturleitplanke (Wiederholung zur Betonung)

Rule Engine/Campaign Management = **WAS und WANN**. Sales Playbook =
**WIE**. KI = sprachliche Umsetzung innerhalb dieser Grenzen. Das Sales
Playbook darf niemals zu einer zweiten fachlichen Recommendation Engine
werden. Diese Grenze zieht sich durch Abschnitt 3, 7, 8.1, 9.3 und 16
dieses Dokuments und ist bei jeder kuenftigen Implementierungsentscheidung
erneut zu pruefen.
