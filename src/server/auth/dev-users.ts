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
import {
  deriveManagementScope,
  type ManagementScope,
  type ManagementScopeCandidate,
  type ManagementScopeLevel,
} from "../authz/management-scope";
import {
  deriveConfigPermissions,
  type ConfigPermissionCandidate,
  type ConfigPermissionKey,
} from "../authz/config-permissions";
import {
  deriveConsultationPermissions,
  type ConsultationPermissionCandidate,
  type ConsultationPermissionKey,
} from "../authz/consultation-permissions";

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
 * Bereits DB-seitig geladene RoleAssignment-Zeile mit den fuer die
 * Management-Scope-Aufloesung noetigen Feldern (Scope-Ebene + gehaltene
 * Permission-Keys der zugehoerigen Rolle). Locker typisiert statt des vollen
 * generierten Prisma-Typs, damit dieses Modul nicht an eine konkrete
 * `include`-Form gebunden ist.
 */
interface RoleAssignmentForScope {
  scopeType: string;
  companyId: string | null;
  storeId: string | null;
  revokedAt: Date | null;
  role: { rolePermissions: { permission: { key: string } }[] };
}

function isManagementScopeLevel(value: string): value is ManagementScopeLevel {
  return value === "STORE" || value === "COMPANY" || value === "TENANT";
}

/**
 * Loest den Management-Analytics-Scope (Phase 7 AP1) fuer einen Nutzer aus
 * dessen bereits geladenen `RoleAssignment`-Zeilen auf. Nimmt bewusst
 * bereits geladene Zuweisungen entgegen (statt selbst zu fetchen), damit
 * `buildSessionPayloadForEmployee()` keinen zweiten Roundtrip fuer dieselben
 * Daten braucht -- fuehrt aber selbst EINEN zusaetzlichen Roundtrip aus, um
 * COMPANY-/TENANT-Zuweisungen auf konkrete Store-IDs aufzuloesen (kleine,
 * synthetische Datenmengen -- siehe PHASE_7_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.2/4).
 *
 * Reine Auswahllogik (deny-by-default, hoechste Stufe gewinnt) liegt in
 * `src/server/authz/management-scope.ts::deriveManagementScope()` und ist
 * dort ohne DB isoliert unit-testbar.
 */
export async function resolveManagementScopeForUser(
  tenantId: string,
  roleAssignments: RoleAssignmentForScope[],
): Promise<ManagementScope | null> {
  const activeAssignments = roleAssignments.filter(
    (assignment) => assignment.revokedAt === null && isManagementScopeLevel(assignment.scopeType),
  );

  if (activeAssignments.length === 0) {
    return null;
  }

  const stores = await rawPrismaClient.store.findMany({
    where: { tenantId },
    select: { id: true, companyId: true },
  });

  const candidates: ManagementScopeCandidate[] = activeAssignments.map((assignment) => {
    const scopeType = assignment.scopeType as ManagementScopeLevel;
    const permissionKeys = assignment.role.rolePermissions.map((rp) => rp.permission.key);

    let storeIds: string[];
    if (scopeType === "STORE") {
      storeIds = assignment.storeId ? [assignment.storeId] : [];
    } else if (scopeType === "COMPANY") {
      storeIds = stores
        .filter((store) => store.companyId === assignment.companyId)
        .map((store) => store.id);
    } else {
      storeIds = stores.map((store) => store.id);
    }

    return { scopeType, permissionKeys, storeIds };
  });

  return deriveManagementScope(candidates);
}

/**
 * Loest die `config.questions.*`-Permissions (Phase 8 AP2) fuer einen
 * Nutzer aus dessen bereits geladenen `RoleAssignment`-Zeilen auf -- ohne
 * zusaetzlichen DB-Roundtrip (anders als `resolveManagementScopeForUser()`
 * braucht diese Aufloesung keine Store-ID-Aufloesung, da Config-Permissions
 * ausschliesslich TENANT-scoped sind, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.2/15 Punkt 5). Reine
 * Auswahllogik liegt in
 * `src/server/authz/config-permissions.ts::deriveConfigPermissions()`.
 */
export function resolveConfigPermissionsForUser(
  roleAssignments: RoleAssignmentForScope[],
): ConfigPermissionKey[] {
  const activeAssignments = roleAssignments.filter((assignment) => assignment.revokedAt === null);

  const candidates: ConfigPermissionCandidate[] = activeAssignments.map((assignment) => ({
    scopeType: assignment.scopeType,
    permissionKeys: assignment.role.rolePermissions.map((rp) => rp.permission.key),
  }));

  return deriveConfigPermissions(candidates);
}

/**
 * Loest die `consultation.*`-Permissions (Phase 12 AP2) fuer einen Nutzer aus
 * dessen bereits geladenen `RoleAssignment`-Zeilen auf -- ohne zusaetzlichen
 * DB-Roundtrip, analog `resolveConfigPermissionsForUser()`. Anders als dort
 * wird `scopeType` bewusst NICHT als Filterkriterium uebergeben (siehe
 * Modulkommentar in `consultation-permissions.ts`) -- jede aktive Zuweisung
 * zaehlt, unabhaengig vom Scope. Reine Auswahllogik liegt in
 * `src/server/authz/consultation-permissions.ts::deriveConsultationPermissions()`.
 */
export function resolveConsultationPermissionsForUser(
  roleAssignments: RoleAssignmentForScope[],
): ConsultationPermissionKey[] {
  const activeAssignments = roleAssignments.filter((assignment) => assignment.revokedAt === null);

  const candidates: ConsultationPermissionCandidate[] = activeAssignments.map((assignment) => ({
    permissionKeys: assignment.role.rolePermissions.map((rp) => rp.permission.key),
  }));

  return deriveConsultationPermissions(candidates);
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
      user: {
        include: {
          roleAssignments: {
            include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
          },
        },
      },
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

  const managementScope = await resolveManagementScopeForUser(
    employee.tenantId,
    employee.user.roleAssignments,
  );
  const configPermissions = resolveConfigPermissionsForUser(employee.user.roleAssignments);
  const consultationPermissions = resolveConsultationPermissionsForUser(
    employee.user.roleAssignments,
  );

  return {
    tenantId: employee.tenantId,
    userId: employee.user.id,
    employeeId: employee.id,
    storeId: employee.storeId,
    displayName: employee.displayName,
    roles: roleKeysFromAssignments(employee.user.roleAssignments),
    managementScope,
    configPermissions,
    consultationPermissions,
  };
}
