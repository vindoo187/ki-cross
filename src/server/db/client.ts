/**
 * Zentraler Prisma-Client-Singleton.
 *
 * In der Next.js-Entwicklung wird das Modulsystem bei jedem Hot-Reload neu
 * ausgefuehrt; ohne dieses Singleton-Muster wuerden bei jedem Reload neue
 * Datenbankverbindungen aufgebaut, bis das Verbindungslimit von Postgres
 * erreicht ist. Der Client wird daher auf `globalThis` zwischengespeichert
 * (nur ausserhalb von production).
 *
 * WICHTIG: Dieser Roh-Client darf in Anwendungscode, der mandantengebundene
 * Modelle liest/schreibt, NICHT direkt verwendet werden. Dafuer ist
 * `withTenantScope()` aus `src/server/tenant/scoped-client.ts` zu verwenden
 * (siehe docs/PRIVACY_AND_SECURITY.md, Abschnitt Mandantentrennung).
 */

import { PrismaClient } from "@prisma/client";
import { withTenantScope } from "../tenant/scoped-client";

declare global {
  var __prismaClient__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const rawPrismaClient: PrismaClient = globalThis.__prismaClient__ ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prismaClient__ = rawPrismaClient;
}

/**
 * Mandantengescopter Prisma-Client fuer Anwendungscode.
 *
 * Dies ist der Standard-Client, den Anwendungscode fuer mandantengebundene
 * Modelle verwenden MUSS (siehe `src/server/tenant/scoped-client.ts`).
 * Erfordert einen aktiven `TenantContext` (`runWithTenantContext()`), sonst
 * wirft jeder Zugriff `MissingTenantContextError`.
 */
export const db = withTenantScope(rawPrismaClient);
