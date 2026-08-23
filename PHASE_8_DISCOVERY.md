# Phase 8 – Discovery: Fachadministration & versionierte Konfiguration

Stand: 2026-08-18. Analysephase, **keine Implementierung** (ChatGPT-Vorgabe,
analog `PHASE_7_DISCOVERY.md`). Ziel: den tatsächlichen Code gegen das
Phase-8-Zielbild abgleichen — der ursprüngliche Phase-1-Plan
(`docs/IMPLEMENTATION_PLAN.md` Abschnitt "Phase 8 – Admin-Oberfläche") ist
mehrere Phasen alt und wird hier nur als Ausgangspunkt behandelt, nicht als
bindender Scope.

## 1. Zielbild laut ChatGPT (2026-08-18)

**Phase 8 – Fachadministration & versionierte Konfiguration:** berechtigte
Nutzer sollen ohne Code-Änderung fachliche Konfiguration anlegen, ändern,
versionieren und zurückrollen können. Kernbereiche laut ChatGPT-Vorgabe:
Fragen, Fragebogen-Versionen, Beratungs-/Empfehlungsregeln, Ziele/
Kampagnen, Audit. Verbindliche Leitplanke: **Draft → Validate → Publish**
— keine direkte Änderung einer bereits produktiv verwendeten Version;
bestehende Beratungen bleiben auf ihrer gepinnten Version.

## 2. Untersuchungsmethode

Für jeden Bereich: (a) Datenmodell vorhanden? (b) Bereits ein
Schreibpfad im Code (Service/Route) vorhanden, oder ausschließlich über
`prisma/seed.ts`? (c) Versionierung/Statusmodell vorhanden? (d) API
vorhanden? (e) UI vorhanden? (f) Auditierung vorhanden?

## 3. Zentrales Ergebnis (Kurzfassung)

**Jede einzige fachliche Konfiguration im gesamten System — Fragen,
Fragebogenversionen, Regeln, Produkte, Provisionsmodelle — existiert
ausschließlich über `prisma/seed.ts` (1.682 Zeilen).** Es gibt **keinen
einzigen** Schreibpfad (Service-Funktion oder API-Route) für irgendeine
dieser Entitäten außerhalb des Seed-Skripts (verifiziert per
`grep -rn "questionnaire.create\|question.create\|ruleSet.create\|
product.create\|productVersion.create\|commissionModel.create" src/` —
0 Treffer). Das Datenmodell selbst ist dabei überraschend weit: Draft/
Active/Expired/Archived-Statusmodell (`VersionStatus`-Enum) existiert
bereits für `QuestionnaireVersion`, `QuestionVersion`, `RuleSetVersion`
und `CampaignVersion` — die Grundlage für "Draft → Validate → Publish" ist
im Schema schon vorhanden, nur nirgends im Code genutzt (ähnliches Muster
wie das ungenutzte `RoleAssignment`-System vor Phase 7).

## 4. Bereich-für-Bereich-Befund

| Bereich                                                                                                                                               | Datenmodell vorhanden?                                                                                                                                                              | editierbar (Code)?                                                                                                                                                                                                                                                        | versioniert?                                                                                        | API?                 | UI?                | Audit?                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------- | ------------------ | -------------------------------------------------- |
| Fragen (Questionnaire/QuestionnaireVersion/Question/QuestionVersion/AnswerOption/VisibilityCondition)                                                 | ✅ vollständig, inkl. Sichtbarkeitsregeln (`VisibilityOperator`/`LogicalCombinator`)                                                                                                | ❌ nur `prisma/seed.ts`                                                                                                                                                                                                                                                   | ✅ `VersionStatus` (DRAFT/ACTIVE/EXPIRED/ARCHIVED) auf `QuestionnaireVersion` UND `QuestionVersion` | ❌ keine             | ❌ keine           | ❌ keine dedizierte                                |
| Beratungs-/Empfehlungsregeln (RuleSet/RuleSetVersion/EligibilityRule/ExclusionRule/PrioritizationRule/CrossSellingRule + je eigene Condition-Tabelle) | ✅ vollständig, strukturiertes Bedingungsmodell (AND-Gruppen/OR zwischen Gruppen, `ConditionSourceType` QUESTION/ATTRIBUTE), 4 Regeltypen mit unterschiedlicher fachlicher Wirkung  | ❌ nur `prisma/seed.ts`                                                                                                                                                                                                                                                   | ✅ `VersionStatus` auf `RuleSetVersion`                                                             | ❌ keine             | ❌ keine           | ❌ keine dedizierte                                |
| Produkte/Tarife (Product/ProductVersion/TariffAttribute/ProductCostVersion)                                                                           | ✅ vollständig                                                                                                                                                                      | ❌ nur `prisma/seed.ts`                                                                                                                                                                                                                                                   | ✅ (Product→ProductVersion mit Gültigkeitszeitraum, EXCLUDE-Constraint gegen Überlappung)           | ❌ keine             | ❌ keine           | ❌ keine dedizierte                                |
| Provisionsmodelle (CommissionModel/CommissionModelVersion)                                                                                            | ✅ vollständig                                                                                                                                                                      | ❌ nur `prisma/seed.ts`                                                                                                                                                                                                                                                   | ✅ (analog ProductVersion)                                                                          | ❌ keine             | ❌ keine           | ❌ keine dedizierte                                |
| Kampagnen (Campaign/CampaignVersion)                                                                                                                  | ✅ Modell existiert bereits vollständig im Schema (`versionNumber`, `VersionStatus`, Gültigkeitszeitraum)                                                                           | ❌ **0 Verwendungen im gesamten `src/`-Verzeichnis** (weder gelesen noch geschrieben)                                                                                                                                                                                     | ✅ `VersionStatus`                                                                                  | ❌ keine             | ❌ keine           | ❌ keine dedizierte                                |
| Ziele                                                                                                                                                 | ❌ **kein Datenmodell vorhanden** — "Ziele" kommt im Schema nirgends vor, nur `Campaign` existiert                                                                                  | –                                                                                                                                                                                                                                                                         | –                                                                                                   | –                    | –                  | –                                                  |
| Audit (allgemein)                                                                                                                                     | ✅ `AuditLog` (generisch, `entityType`/`entityId`/`action`/`metadata`) UND separates `ConfigurationChange`-Modell (`configKey`/`oldValue`/`newValue`) — **beide bereits im Schema** | `AuditLog` wird genau **einmal** geschrieben (`questionnaire/service.ts`, für Antwort-Events, nicht Konfiguration). `ConfigurationChange` wird **nirgends** geschrieben (0 Treffer in `src/`)                                                                             | –                                                                                                   | –                    | –                  | teilweise (Infrastruktur da, für Config ungenutzt) |
| RBAC (Phase 7)                                                                                                                                        | ✅ `Role`/`RoleAssignment`/`Permission`, aktuell 3 Permission-Keys (`analytics.view_store/_company/_tenant`)                                                                        | ✅ serverseitig durchgesetzt (`resolveAuthorizedStoreFilter()`) — aber **keine** `config.*`/`admin.*`-Permission-Keys existieren bisher                                                                                                                                   | ✅ (Scope-Modell aus Phase 7)                                                                       | ✅ (für Analytics)   | ✅ (für Analytics) | n/a                                                |
| Auth                                                                                                                                                  | ✅ `User`/`Employee`, signierte Session (`src/server/auth/session.ts`)                                                                                                              | Dev-/Pilot-Login (`src/app/api/auth/dev-login/route.ts`): **kein Passwort, keine echte Identitätsprüfung**, ausschließlich `isSynthetic=true`-Nutzer wählbar. Explizit dokumentiert als "NICHT produktionsreif" (`docs/PRIVACY_AND_SECURITY.md`, `docs/RISK_REGISTER.md`) | n/a                                                                                                 | ✅ (Dev-Login-Route) | ✅ (`/login`)      | n/a                                                |

## 5. Bestehende UI/Seiten (zur Einordnung, was NICHT admin-bezogen ist)

`src/app/` enthält ausschließlich: `/login` (Dev-Login), `/consultation`
(Fragenfluss/Empfehlung/Zusammenfassung), `/analytics` +
`/analytics/management` (KPI-Dashboards), `/review` (technische
Prüfansicht, dev-only). **Keine einzige Admin-/Konfigurationsseite
existiert.** `src/server/` enthält keinen `admin`- oder `config`-Ordner.

## 6. Kernrisiko: Dev-Auth als Blocker für echte Admin-Funktionen

Der bestehende Dev-/Pilot-Login ist funktional ausreichend, um die
Konsultations-/Analytics-UI durchzutesten, aber strukturell **ungeeignet**
als Zugriffsschutz für eine Fläche, die Fragen/Regeln/Produkte/
Provisionen verändern kann: kein Passwort, keine echte
Identitätsprüfung, jeder Dev-Nutzer kann sich als jeder synthetische
Mitarbeiter jedes Mandanten ausgeben. Eine Admin-Oberfläche auf Basis
dieses Mechanismus würde ein in `docs/RISK_REGISTER.md` bereits
dokumentiertes Risiko ("Dev-Auth wird versehentlich als für den
Produktivbetrieb ausreichend missverstanden") von einer theoretischen zu
einer konkreten Gefahr machen, sobald echte Konfigurationsänderungen über
diese Oberfläche möglich wären.

## 7. Was für "Draft → Validate → Publish" bereits vorhanden ist

- **Statusmodell:** `VersionStatus` (DRAFT/ACTIVE/EXPIRED/ARCHIVED) ist
  bereits auf allen vier relevanten Versions-Tabellen vorhanden
  (`QuestionnaireVersion`, `QuestionVersion`, `RuleSetVersion`,
  `CampaignVersion`) — keine Schema-Änderung für den Statuswechsel selbst
  nötig.
- **Gültigkeitszeiträume:** `validFrom`/`validTo` existieren durchgängig,
  inkl. PostgreSQL-EXCLUDE-Constraints gegen überlappende aktive Versionen
  (bereits in Phase 1/2 gebaut, siehe `docs/DATA_MODEL.md`).
- **Gepinnte Version pro Session:** `ConsultationSession` referenziert
  bereits eine konkrete `QuestionnaireVersion`-ID (nicht "die aktuell
  aktive") — das "bestehende Beratungen bleiben auf ihrer Version"-Prinzip
  ist strukturell bereits erfüllt, nicht neu zu bauen.
- **Fehlend:** jeglicher Schreibpfad, jegliche Validierungslogik für einen
  Statusübergang (z. B. darf eine Version nur veröffentlicht werden, wenn
  alle Pflichtfragen einen Antworttyp haben), jegliche
  Freigabe-/Review-Logik, jegliche `config.*`-Permission, jegliche
  Audit-Anbindung für diese Änderungen.

## 8. Offene, im Code nicht beantwortbare Fragen

Diese Punkte sind reine Produktentscheidungen, keine technischen
Befunde — für den späteren Implementierungsplan relevant, aber nicht Teil
dieser Discovery-Analyse:

1. **Freigabeprozess** (bereits in `docs/OPEN_DECISIONS.md` Punkt 8 offen
   dokumentiert): muss Geschäftsführung Regeländerungen des Fachadmins
   bestätigen, oder reicht die `config.publish`-Permission allein?
2. **Ziele/Campaigns-Scope:** Da kein "Ziele"-Datenmodell existiert und
   `Campaign` im Code komplett ungenutzt ist, muss geklärt werden, ob
   Phase 8 dieses Modell überhaupt in Betrieb nimmt oder bewusst
   zurückstellt (ChatGPT-Vorgabe: "nicht einfach ein neues Modell bauen,
   nur weil es im alten Plan stand").
3. **Regel-Editor-UX:** Die vier Regeltypen mit strukturiertem
   AND-Gruppen/OR-Bedingungsmodell sind fachlich komplex — ein visueller
   Regel-Editor ist ein erheblich größerer Aufwand als ein reiner
   Fragen-Editor. Muss in der Scope-Entscheidung separat bewertet werden.
4. **Auth-Abhängigkeit:** Wird eine produktionsreife Authentifizierung
   Voraussetzung für Phase 8 (Blocker), oder wird die Admin-Oberfläche
   zunächst ebenfalls auf dem Dev-Login betrieben (mit explizitem,
   dokumentiertem Risiko, analog dem bisherigen Vorgehen bei
   `/consultation`/`/analytics`)?

## 9. Empfehlung für die nächste Stufe (nicht bindend, zur Diskussion)

Angesichts des Befunds — vollständiges, aber komplett ungenutztes
Versionierungs-Datenmodell, keinerlei Schreibpfade, keine Admin-
Permissions, produktionsuntaugliche Auth — erscheint ein aufgeteilter
Scope sinnvoller als "die komplette Admin-Oberfläche in einem Zug":
z. B. zuerst Fragen-Verwaltung (kleinster geschlossener Nutzen, klarster
Draft/Publish-Fall), Regeln und Kampagnen/Ziele als spätere Teilschritte.
Diese Einschätzung wird ChatGPT zur Prüfung vorgelegt, bevor daraus ein
`PHASE_8_IMPLEMENTATION_PLAN.md` entsteht.
