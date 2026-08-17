/**
 * Zod-Validierungsschema fuer die Query-Parameter von
 * `GET /api/analytics/management` (Phase 7 AP3). Anders als in
 * `consultation-ui/schemas.ts` (dort bewusst KEIN storeId/employeeId aus
 * Client-Eingaben) sind `storeId`/`employeeId` hier bewusst Teil des
 * validierten Client-Inputs -- genau das ist der Anwendungsfall, fuer den
 * `resolveAuthorizedStoreFilter()` (`management-authz.ts`) existiert: ein
 * angefragter Filter wird gegen den serverseitigen `managementScope`
 * geprueft, niemals ungeprueft uebernommen.
 */

import { z } from "zod";

export const managementAnalyticsQuerySchema = z.object({
  period: z.enum(["week", "month"]).default("week"),
  storeId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
});
