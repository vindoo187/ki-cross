# Lokale Entwicklung

Diese Anleitung richtet sich an alle, die dieses Projekt lokal aufsetzen
und ausführen wollen (Entwicklung, Abnahme-Tests, CI-Nachvollzug).

## Voraussetzungen

- Node.js `>=20.11 <23` (siehe `package.json` → `engines`, sowie
  `.node-version`)
- Docker (für die lokale Postgres-Instanz, siehe `docker-compose.yml`)
- Internetzugang beim ersten Setup (für `npm install` und
  `npx prisma generate`, siehe unten)

## Setup

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Umgebungsvariablen anlegen
cp .env.example .env
# .env bei Bedarf anpassen (lokale Ports etc.). .env NIE committen.

# 3. Postgres lokal starten
docker compose up -d

# 4. Prisma Client generieren
npx prisma generate

# 5. Migrationen anwenden
npx prisma migrate deploy

# 6. Synthetische Testdaten laden (zwei Mandanten, ausschließlich Fake-Daten)
npm run seed
```

> **Hinweis zu Schritt 1:** npm ist der verbindliche Paketmanager dieses
> Projekts (siehe [DECISION_LOG.md](DECISION_LOG.md)). `package.json`
> deklariert `"packageManager": "npm@10.9.4"`; `npm install` mit dem
> committeten `package-lock.json` ist der einzige unterstützte Weg.

## Anwendung starten

```bash
npm run dev
```

Danach:

- `http://localhost:3000/` – Startseite mit Kurzbeschreibung des
  aktuellen Projektstands
- `http://localhost:3000/review` – interne technische Prüfansicht der
  Seed-Daten (siehe Kopfkommentar in `src/app/review/page.tsx`; kein
  Endnutzer-Feature)
- `http://localhost:3000/api/health` – einfacher Health-Check-Endpunkt

## Prüfungen ausführen

```bash
npm run lint            # ESLint, max-warnings=0
npm run format           # Prettier --check
npm run typecheck        # tsc --noEmit
npm run test:unit        # Vitest, ohne Datenbank
npm run test:integration # Vitest, benötigt laufende Postgres-Instanz + DATABASE_URL
npm run build            # Next.js Produktions-Build
```

Details dazu, welche dieser Prüfungen bereits während der Implementierung
verifiziert wurden und welche der Auftraggeber selbst als ersten Schritt
ausführen sollte, siehe [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
und [TEST_STRATEGY.md](TEST_STRATEGY.md).

## Prisma Studio (Datenbank-Browser)

```bash
npm run db:studio
```

## Bekannte, harmlose Altlasten

Im Projektordner befinden sich aktuell noch drei funktionslose Dateien aus
der Implementierungssitzung (`_tmp_20_...`, `src/newdir/file.txt`), die aus
technischen Gründen nicht automatisch entfernt werden konnten. Sie können
gefahrlos manuell gelöscht werden (siehe
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)).
