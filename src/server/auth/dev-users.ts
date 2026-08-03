/**
 * Lesezugriffe fuer den minimalen Dev-/Pilot-Auth-Mechanismus.
 *
 * Verwendet bewusst `rawPrismaClient` (nicht `db`/`withTenantScope`), weil
 * die Login-Kandidatenliste per Definition VOR dem Bestehen eines
 * `TenantContext` gelesen werden muss -- an dieser Stelle wird der
 * Tenant-Kontext ja erst hergestellt. Das ist die einzige bewusste
 * Ausnahme von der sonst verbindlichen `db`-Nutzung (siehe
 * src/server/db/client.ts, Modul-Kommentar) und ausschliesslich auf den
 * Auth-Bootstrapping-Pfad beschraenkt.
 *
 * NICHT produktionsreif -- siehe src/server/auth/errors.ts.
 */

import { rawPrismaClient } from "../db/client";
import { InvalidDevLoginCandidateError } from "./errors";
import type { SessionPayload } from "./session";

export interface DevLoginCandidate {
  tenantId: string;
  tenantName: string;
  userId: string;
  employeeId: string;
  displayName: string;
  storeId: string;
  storeName: string;
  roles: string[];
}

function roleKeysFromAssignments(assignments: { role: { key: string } }[]): string[] {
  return Array.from(new Set(assignments.map((a) => a.role.key)));
}

/**
 * Listet alle fuer den Dev-Login waehlbaren Mitarbeiter ueber alle Mandanten
 * hinweg -- ausschliesslich synthetische Nutzer (`isSynthetic = true`) mit
 * aktivem Mitarbeiter-Datensatz. Nie fuer echte Kundendaten/Produktivbetrieb
 * gedacht (siehe docs/PRIVACY_AND_SECURITY.md).
 */
export async function listDevLoginCandidates(): Promise<DevLoginCandidate[]> {
  const employees = await rawPrismaClient.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      userId: { not: null },
      user: { isSynthetic: true },
    },
    include: {
      user: {
        include: {
          roleAssignments: { include: { role: true } },
          tenant: true,
        },
      },
      store: true,
    },
    orderBy: [{ tenantId: "asc" }, { displayName: "asc" }],
  });

  return employees
    .filter((employee) => employee.user !== null)
    .map((employee) => {
      const user = employee.user!;
      return {
        tenantId: employee.tenantId,
        tenantName: user.tenant.name,
        userId: user.id,
        employeeId: employee.id,
        displayName: employee.displayName,
        storeId: employee.storeId,
        storeName: employee.store.name,
        roles: roleKeysFromAssignments(user.roleAssignments),
      };
    });
}

/**
 * Prueft einen gewaehlten Login-Kandidaten (per `employeeId`) erneut gegen
 * die DB (nie ungeprueft dem Client vertrauen) und baut daraus den
 * Session-Payload.
 *
 * @throws {InvalidDevLoginCandidateError} falls der Datensatz nicht (mehr)
 *   gueltig ist.
 */
export async function buildSessionPayloadForEmployee(
  employeeId: string,
): Promise<Omit<SessionPayload, "issuedAt">> {
  const employee = await rawPrismaClient.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: { include: { roleAssignments: { include: { role: true } } } },
    },
  });

  if (
    !employee ||
    employee.employmentStatus !== "ACTIVE" ||
    !employee.user ||
    !employee.user.isSynthetic
  ) {
    throw new InvalidDevLoginCandidateError();
  }

  return {
    tenantId: employee.tenantId,
    userId: employee.user.id,
    employeeId: employee.id,
    storeId: employee.storeId,
    displayName: employee.displayName,
    roles: roleKeysFromAssignments(employee.user.roleAssignments),
  };
}
