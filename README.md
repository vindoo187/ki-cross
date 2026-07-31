# KI-Verkaufsassistent – technisches Fundament

> **Projektstatus:** Implementierungsphase 2 (technisches Fundament).
> Kein fertiges MVP. Keine Fragen-Engine, keine Empfehlungs-Engine, keine
> fertige Mitarbeiteroberfläche, keine echten Kundendaten. Siehe
> [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) für den
> genauen Stand.

Technisches Fundament für einen KI-gestützten Verkaufsassistenten für ein
Mobilfunk-Einzelhandelsunternehmen mit 5 Filialen (Anbieter: O2/Telefónica,
Telekom, Freenet). Diese Phase umfasst Projektgerüst, vollständiges
Datenmodell, Migrationen, synthetisches Seed-Skript, Mandantentrennung samt
Sicherheitstests, eine interne technische Prüfansicht und eine
CI-Pipeline – **nicht** die eigentlichen Fach-Engines.

## Stack

Next.js (App Router) · TypeScript (strict) · Prisma · PostgreSQL · Zod ·
Vitest · ESLint · Prettier · GitHub Actions

## Schnellstart

```bash
npm install
cp .env.example .env
docker compose up -d
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev
```

Ausführliche Anleitung: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)

## Wichtige Dokumente

| Dokument                                                           | Inhalt                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [docs/ABSCHLUSSBERICHT_PHASE2.md](docs/ABSCHLUSSBERICHT_PHASE2.md) | Abschlussbericht dieser Implementierungsphase (13 Punkte)                           |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)     | Was ist tatsächlich fertig und geprüft, was nicht – inkl. bekannter Einschränkungen |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                       | Zielarchitektur                                                                     |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md)                           | Datenmodell-Konzept                                                                 |
| [docs/DECISION_LOG.md](docs/DECISION_LOG.md)                       | Technische Entscheidungen dieser Implementierungsphase mit Begründung               |
| [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md)                     | Teststrategie, insbesondere Mandantentrennung                                       |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)             | Setup, Befehle, Troubleshooting                                                     |
| [docs/PRIVACY_AND_SECURITY.md](docs/PRIVACY_AND_SECURITY.md)       | Datenschutz- und Sicherheitskonzept                                                 |
| [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)                     | Ist-Zustand-Analyse aus Phase 1 (Dokumentationsphase, vor jeglichem Code)           |
| [docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md)                   | Offene, vom Auftraggeber zu klärende Punkte                                         |

Weitere konzeptionelle Dokumente (Produktvision, MVP-Scope,
Fragen-/Empfehlungs-Engine-Konzept, Rollen/Berechtigungen, Analytics/KPIs,
Risikoregister, Implementierungsplan) liegen ebenfalls unter `docs/`.

## Mandantentrennung

Mandantentrennung ist auf zwei unabhängigen Ebenen abgesichert:
Datenbank-Fremdschlüssel (primär) und ein Prisma Client Extension als
Anwendungsebene (sekundär, "defense in depth"). Details:
[docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md#mandantentrennung-zwei-unabhängige-schutzschichten).

## Wichtige Grundsätze

- Keine echten Kundendaten. Ausschließlich synthetische Testdaten
  (`isSynthetic: true`, "DemoTel"/`@example-synthetic.test`-Konventionen).
- Geldbeträge ausschließlich als Ganzzahl in Minor-Units (Cent), niemals
  als Fließkommazahl.
- Jeder mandantengebundene Datenzugriff in Anwendungscode läuft über `db`
  aus `src/server/db/client.ts` (gescopter Client), nicht über
  `rawPrismaClient`.
