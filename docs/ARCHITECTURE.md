# Systemarchitektur

## Ausgangslage

Greenfield-Projekt (siehe [CURRENT_STATE.md](CURRENT_STATE.md)). Es gibt keinen bestehenden Stack, der berücksichtigt werden müsste. Die folgenden Entscheidungen sind daher Vorschläge zur Bestätigung durch den Auftraggeber, keine erzwungenen Migrationen.

## Architekturstil: Modularer Monolith, kein Microservice-Schnitt

**Entscheidung:** Ein deploybares Backend (modular strukturiert) statt verteilter Microservices.

**Begründung:** Fünf Filialen, ein Unternehmen in der Pilotphase, überschaubares Datenvolumen. Microservices würden Betriebsaufwand (Deployment, Monitoring, Netzwerk, Konsistenz) erzeugen, ohne einen Skalierungsvorteil zu bringen, den ein Monolith nicht auch böte. Die Mandantenfähigkeit wird **im Datenmodell** (siehe [DATA_MODEL.md](DATA_MODEL.md)) gelöst, nicht durch getrennte Deployments pro Mandant. Ein späterer Schnitt (z. B. Analytics-Auswertung als eigener Dienst) bleibt möglich, ist aber keine Voraussetzung für MVP oder Pilot.

## Vorgeschlagener Stack

| Baustein     | Vorschlag                                                                                                           | Begründung / Alternative                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend     | Next.js (TypeScript), React, PWA-fähig                                                                              | Ein Framework für Mitarbeiter-UI und ggf. spätere Admin-Oberfläche; SSR erleichtert schnelle Ladezeiten auf Tablet im Verkaufsraum                                  |
| Backend-API  | Next.js Route Handlers oder eigenständiges Node/TypeScript-API-Layer                                                | Ein Sprachraum (TypeScript) über Frontend/Backend reduziert Kontextwechsel und Fehlerquellen bei einem kleinen Team                                                 |
| Datenbank    | PostgreSQL                                                                                                          | Relationale Integrität ist hier wichtig (Tarifversionen, Provisionen, Audit) – dokumentenorientierte DB würde referenzielle Konsistenz erschweren                   |
| Datenzugriff | Prisma (oder vergleichbarer typsicherer ORM)                                                                        | Typsicherheit zwischen DB-Schema und Anwendungscode, Migrationswerkzeug eingebaut                                                                                   |
| Validierung  | Zod (oder vergleichbar)                                                                                             | Einheitliche Validierung von Formulareingaben und API-Payloads aus einer Schemaquelle                                                                               |
| Auth/Rollen  | eigenes RBAC auf Anwendungsebene, Session- oder Token-basiert                                                       | siehe [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md); **Annahme:** kein SSO-Zwang in Phase 1                                                                  |
| Tests        | Vitest/Jest (Unit), Playwright (E2E) für kritische Pfade                                                            | Regel-Engine und Empfehlungslogik sind die höchste Testpriorität, nicht UI-Pixel-Tests                                                                              |
| Container    | Docker + docker-compose für lokale Entwicklung                                                                      | reproduzierbare Entwicklungsumgebung, kein Zwang zu einer bestimmten Cloud                                                                                          |
| Hosting      | EU-Region bei einem DSGVO-konformen Anbieter (z. B. EU-Rechenzentrum eines Hyperscalers oder europäischer Anbieter) | Pflichtanforderung aus [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md); konkreter Anbieter ist offene Entscheidung, siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md) |

**Abweichungen von der Vorgabe:** Keine. Der in der Aufgabenstellung vorgeschlagene Stack wird übernommen, da kein Bestandssystem dagegenspricht und die Anforderungen (Typsicherheit, relationale Integrität, EU-Hosting-Fähigkeit) gut abgedeckt werden.

## Logische Bausteine

```
┌───────────────────────────────────────────────────────────┐
│  Mitarbeiter-UI (Next.js/PWA)                              │
│  – Gesprächsführung, Fortschrittsanzeige, Zusammenfassung   │
└───────────────────────────────────────────────────────────┘
                │  HTTPS/JSON (typsicher, Zod-validiert)
┌───────────────────────────────────────────────────────────┐
│  API-Schicht                                                │
│  – Auth/RBAC-Middleware (mandanten-/filialscoped)          │
│  – Session-/Beratungs-API                                   │
│  – Konfigurations-API (Fragen, Regeln, Ziele, Kampagnen)    │
│  – Analytics-Event-API                                      │
└───────────────────────────────────────────────────────────┘
        │                    │                    │
┌───────────────┐  ┌───────────────────┐  ┌──────────────────┐
│ Fragen-/Regel- │  │ Empfehlungs-Engine │  │ Analytics-/KPI-   │
│ Engine         │  │ (regelbasiert,      │  │ Aggregation        │
│ (Konfig-       │  │  KI nur assistiv)   │  │ (siehe             │
│  getrieben)    │  │                     │  │ ANALYTICS_AND_KPIS)│
└───────────────┘  └───────────────────┘  └──────────────────┘
        │                    │                    │
┌───────────────────────────────────────────────────────────┐
│  PostgreSQL (mandantenfähiges Schema, versioniert)          │
└───────────────────────────────────────────────────────────┘
                │
┌───────────────────────────────────────────────────────────┐
│  Optionaler KI-Dienst (extern, z. B. Claude API)            │
│  – Gesprächszusammenfassung, Formulierungsvorschläge,       │
│    Vorschlag sinnvoller Folgefragen                         │
│  – KEIN Zugriff auf Tarif-Endentscheidung                   │
└───────────────────────────────────────────────────────────┘
```

## Warum die KI-Komponente separiert ist

Die Empfehlungs-Engine (Tarif-/Produktvorschlag) ist **regelbasiert und deterministisch** (siehe [RECOMMENDATION_ENGINE.md](RECOMMENDATION_ENGINE.md)). Die KI-Komponente ist bewusst als optionaler, austauschbarer Dienst am Rand der Architektur gezeichnet: Sie bekommt strukturierte Daten (Antworten, Regel-Ergebnisse) als Eingabe und liefert Text (Zusammenfassung, Formulierung) oder eine Rangfolge möglicher nächster Fragen zurück – niemals einen erfundenen Tarif oder Preis. Fällt der KI-Dienst aus, funktioniert das System weiter (nur ohne Komfortfunktionen).

## Mandantenfähigkeit

Jede Entität ist einem `tenant_id` zugeordnet (siehe [DATA_MODEL.md](DATA_MODEL.md)). In der Pilotphase existiert genau ein Mandant (das eigene Unternehmen mit fünf Filialen). Die Trennung ist von Anfang an im Schema vorhanden, damit ein späterer Verkauf an Telekom/O2/Freenet/Handelspartner keine Datenmodell-Migration, sondern nur einen neuen Mandanten-Datensatz erfordert. **Annahme:** In Phase 1 kein Bedarf an physischer Datenbanktrennung pro Mandant (Schema-Trennung genügt); bei späterem Fremdverkauf an Wettbewerber der Provider ist eine strengere Isolation (eigene DB pro Mandant) zu prüfen – siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

## Nicht-funktionale Anforderungen

| Anforderung                               | Umsetzung                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tablet + Desktop                          | responsives UI, Touch-optimierte Eingaben, keine Maus-only-Interaktionen                                                                                                                                                      |
| Reaktionsgeschwindigkeit während Gespräch | Fragen-Engine läuft serverseitig (siehe [QUESTION_ENGINE.md](QUESTION_ENGINE.md)); Versionsauflösung und Sichtbarkeitsauswertung sind einfache, indexierte Datenbankzugriffe pro Antwortschritt, keine aufwendige Serverlogik |
| Ausfallsicherheit KI-Dienst               | Kernfunktion (Fragen, Regeln, Empfehlung) hat keine Laufzeitabhängigkeit von externer KI                                                                                                                                      |
| Nachvollziehbarkeit                       | jede Empfehlung referenziert die genutzte Regel-/Tarifversion (Audit-fähig)                                                                                                                                                   |
| EU-Hosting                                | Pflichtkriterium bei Anbieterauswahl, siehe [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md)                                                                                                                                |
