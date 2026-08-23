/**
 * Mandantenscoping auf Anwendungsebene ("Defense in Depth").
 *
 * Die PRIMAERE Sicherheitsgrenze fuer Mandantentrennung ist die Datenbank
 * selbst: praktisch alle mandantengebundenen Tabellen referenzieren ihre
 * Elterntabelle ueber einen zusammengesetzten Fremdschluessel
 * `(tenant_id, x_id) -> (tenant_id, id)` (siehe `prisma/schema.prisma`,
 * Kopfkommentar, und docs/PRIVACY_AND_SECURITY.md). Ein Datensatz kann
 * dadurch gar nicht erst mit einer falschen Tenant/Parent-Kombination
 * gespeichert werden.
 *
 * Dieses Modul ergaenzt eine ZWEITE, unabhaengige Schutzschicht auf
 * Anwendungsebene: Ein Prisma Client Extension, das JEDE Query auf einem
 * mandantengebundenen Modell automatisch um `tenantId` ergaenzt bzw.
 * validiert - bevor die Anfrage ueberhaupt an die Datenbank geht. Dadurch
 * werden z. B. vergessene `where`-Klauseln oder IDOR-artige
 * Cross-Tenant-Zugriffe ueber erratbare IDs abgefangen, selbst wenn ein
 * Entwickler versehentlich `rawPrismaClient` statt eines gescopten Clients
 * fuer ein mandantengebundenes Modell verwendet UND die betroffene Query
 * (zufaellig oder absichtlich) keinen Fremdschluessel-Verstoss ausloest
 * (z. B. ein reiner Lesezugriff per `findUnique`/`findMany`).
 *
 * WICHTIG: Rohe SQL-Zugriffe (`$queryRaw`, `$executeRaw`, ...) werden von
 * diesem Extension NICHT erfasst, da es sich dabei um Client-Operationen
 * und nicht um Modell-Operationen handelt. Fuer mandantengebundene Modelle
 * duerfen daher ausschliesslich die generierten Prisma-Modell-Methoden
 * (`findMany`, `create`, ...) ueber diesen gescopten Client verwendet
 * werden - niemals `$queryRaw`/`$executeRaw` mit manuell zusammengebauten
 * Bedingungen.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { getTenantId } from "./context";
import {
  parseAnalyticsEventPayload,
  parseAuditLogMetadata,
} from "../validation/event-payload-schemas";

/**
 * Modelle ohne `tenantId`-Spalte - globale Kataloge bzw. der Mandant selbst.
 * Fuer diese Modelle findet KEINE automatische Tenant-Filterung statt.
 *
 * Bewusste Design-Entscheidung: Diese Liste ist eine EXPLIZITE
 * Ausnahmeliste (statt einer Einschlussliste aller mandantengebundenen
 * Modelle). Wird dem Schema in Zukunft ein neues Modell mit `tenantId`
 * hinzugefuegt, greift die automatische Tenant-Filterung dafuer sofort -
 * ohne dass diese Datei angepasst werden muss. Ein neues Modell OHNE
 * `tenantId` muss dagegen bewusst hier eingetragen werden, sonst schlaegt
 * jeder Zugriff darauf mit einem Prisma-Fehler fehl (da `tenantId` kein
 * gueltiges Feld dieses Modells waere) - ein bewusst "fail-loud"-Verhalten.
 */
const GLOBAL_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  "Tenant",
  "Permission",
  "Provider",
]);

/** Wird geworfen, wenn eine Schreiboperation versucht, `tenantId` auf einen anderen Mandanten zu setzen. */
export class TenantMismatchError extends Error {
  constructor(model: string, expectedTenantId: string, actualTenantId: unknown) {
    super(
      `Mandanten-Verstoss beim Zugriff auf Modell "${model}": erwartete tenantId "${expectedTenantId}", ` +
        `erhalten "${String(actualTenantId)}". Der aktuelle Tenant-Kontext darf niemals ueberschrieben werden.`,
    );
    this.name = "TenantMismatchError";
  }
}

/** Operationen, bei denen `tenantId` in eine bestehende `where`-Klausel eingemischt wird. */
const WHERE_SCOPED_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "aggregate",
  "count",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

function mergeWhereWithTenant(
  where: Record<string, unknown> | undefined,
  tenantId: string,
): Record<string, unknown> {
  // Top-level-Zusammenfuehrung: Prisma verknuepft alle Top-Level-Schluessel
  // eines `where`-Objekts implizit per UND, unabhaengig von eventuell
  // enthaltenen verschachtelten `OR`/`NOT`-Bedingungen. Ein bereits
  // vorhandenes `tenantId`-Feld im `where` wird bewusst ueberschrieben,
  // damit ein Aufrufer den Tenant-Scope nicht durch Angabe einer
  // abweichenden `tenantId` im `where` umgehen kann.
  return { ...(where ?? {}), tenantId };
}

function assertOrInjectTenantId<T extends Record<string, unknown>>(
  data: T,
  tenantId: string,
  model: string,
): T {
  if (Object.prototype.hasOwnProperty.call(data, "tenantId")) {
    if (data.tenantId !== tenantId) {
      throw new TenantMismatchError(model, tenantId, data.tenantId);
    }
    return data;
  }
  return { ...data, tenantId };
}

function assertNoTenantIdChange<T extends Record<string, unknown>>(
  data: T,
  tenantId: string,
  model: string,
): T {
  if (Object.prototype.hasOwnProperty.call(data, "tenantId") && data.tenantId !== tenantId) {
    throw new TenantMismatchError(model, tenantId, data.tenantId);
  }
  return data;
}

export interface ScopedOperationInput {
  model: string;
  operation: string;
  args: Record<string, unknown>;
}

/**
 * Modelle mit einem JSON-Feld, das ueber `event-payload-schemas.ts` gegen
 * Kontaktdaten/Freitext geprueft werden muss (Phase 2B, Korrekturpunkt
 * "Zod-Validierung fuer JSON-Felder").
 */
const JSON_PAYLOAD_FIELDS: Readonly<
  Record<
    string,
    { field: string; discriminant: string; parse: (key: string, value: unknown) => unknown }
  >
> = {
  AnalyticsEvent: {
    field: "payload",
    discriminant: "eventType",
    parse: parseAnalyticsEventPayload,
  },
  AuditLog: { field: "metadata", discriminant: "action", parse: parseAuditLogMetadata },
};

function validatePayloadField(model: string, data: Record<string, unknown>): void {
  const config = JSON_PAYLOAD_FIELDS[model];
  if (!config || !Object.prototype.hasOwnProperty.call(data, config.field)) {
    return;
  }
  const discriminantValue = String(data[config.discriminant] ?? "unbekannt");
  config.parse(discriminantValue, data[config.field]);
}

/**
 * Prueft (und wirft ggf.) `AnalyticsEvent.payload`/`AuditLog.metadata` in den
 * Schreib-Argumenten einer Operation gegen das jeweilige Zod-Schema. Reine,
 * ohne Prisma-Client testbare Funktion - analog zu {@link buildScopedArgs}.
 *
 * @throws wenn ein JSON-Feld Kontaktdaten/Freitext enthaelt oder die
 *   Struktur-/Groessenbegrenzung verletzt (siehe `event-payload-schemas.ts`).
 */
export function validateScopedArgsPayload({ model, operation, args }: ScopedOperationInput): void {
  if (!(model in JSON_PAYLOAD_FIELDS)) {
    return;
  }
  if (operation === "create") {
    if (args.data && typeof args.data === "object") {
      validatePayloadField(model, args.data as Record<string, unknown>);
    }
    return;
  }
  if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
    if (args.data && typeof args.data === "object") {
      validatePayloadField(model, args.data as Record<string, unknown>);
    }
    return;
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(args.data) ? (args.data as Record<string, unknown>[]) : [];
    rows.forEach((row) => validatePayloadField(model, row));
    return;
  }
  if (operation === "upsert") {
    if (args.create && typeof args.create === "object") {
      validatePayloadField(model, args.create as Record<string, unknown>);
    }
    if (args.update && typeof args.update === "object") {
      validatePayloadField(model, args.update as Record<string, unknown>);
    }
  }
}

/**
 * Reine, ohne Prisma-Client testbare Funktion: baut aus den urspruenglichen
 * Query-Argumenten neue Argumente, die um den Tenant-Scope ergaenzt bzw.
 * dagegen validiert wurden.
 *
 * @throws {TenantMismatchError} wenn Aufrufer-Daten einen abweichenden Mandanten adressieren.
 */
export function buildScopedArgs(
  { model, operation, args }: ScopedOperationInput,
  tenantId: string,
): Record<string, unknown> {
  const scoped: Record<string, unknown> = { ...args };

  if (WHERE_SCOPED_OPERATIONS.has(operation)) {
    scoped.where = mergeWhereWithTenant(
      args.where as Record<string, unknown> | undefined,
      tenantId,
    );
  }

  if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
    if (args.data && typeof args.data === "object") {
      scoped.data = assertNoTenantIdChange(args.data as Record<string, unknown>, tenantId, model);
    }
  }

  if (operation === "create") {
    scoped.data = assertOrInjectTenantId(
      (args.data as Record<string, unknown>) ?? {},
      tenantId,
      model,
    );
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(args.data) ? (args.data as Record<string, unknown>[]) : [];
    scoped.data = rows.map((row) => assertOrInjectTenantId(row, tenantId, model));
  }

  if (operation === "upsert") {
    scoped.where = mergeWhereWithTenant(
      args.where as Record<string, unknown> | undefined,
      tenantId,
    );
    if (args.create && typeof args.create === "object") {
      scoped.create = assertOrInjectTenantId(
        args.create as Record<string, unknown>,
        tenantId,
        model,
      );
    }
    if (args.update && typeof args.update === "object") {
      scoped.update = assertNoTenantIdChange(
        args.update as Record<string, unknown>,
        tenantId,
        model,
      );
    }
  }

  return scoped;
}

/**
 * Umschliesst einen rohen Prisma-Client mit dem Tenant-Scoping-Extension.
 *
 * Der zurueckgegebene Client liest bei JEDEM Aufruf eines mandantengebundenen
 * Modells die `tenantId` aus dem aktuell aktiven `TenantContext`
 * (`src/server/tenant/context.ts`). Ist kein Kontext aktiv, wird
 * `MissingTenantContextError` geworfen - der Aufruf schlaegt fehl, statt
 * ungescopt auf die Datenbank zuzugreifen ("fail closed").
 */
export function withTenantScope(client: PrismaClient) {
  return client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (GLOBAL_MODELS.has(model as Prisma.ModelName)) {
            validateScopedArgsPayload({ model, operation, args });
            return query(args);
          }
          const tenantId = getTenantId();
          const scopedArgs = buildScopedArgs({ model, operation, args }, tenantId);
          validateScopedArgsPayload({ model, operation, args: scopedArgs });
          return query(scopedArgs);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof withTenantScope>;
