import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { aiExtractionBodySchema } from "@/server/ai-extraction/schemas";
import { requestAiExtraction } from "@/server/ai-extraction/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Phase 12 AP2 (ChatGPT-GO 2026-08-23). Duenne API-Schicht -- ausschliesslich
 * Transport/Validierung/Fehler-Mapping, die eigentliche Orchestrierung liegt
 * in `requestAiExtraction()` (`src/server/ai-extraction/service.ts`, siehe
 * dortigen Modulkommentar fuer die vollstaendige Sicherheitsreihenfolge).
 *
 * `id` (Session-ID) kommt AUSSCHLIESSLICH aus dem URL-Parameter,
 * `employeeId`/`tenantId` AUSSCHLIESSLICH aus dem durch
 * `withRequestTenantContext()` verifizierten Session-Payload -- niemals aus
 * dem Request-Body. Der Body enthaelt ausschliesslich `freeText`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = aiExtractionBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const result = await requestAiExtraction({
        consultationSessionId: id,
        employeeId: session.employeeId,
        hasPermission: session.consultationPermissions.includes("consultation.ai_extraction.use"),
        freeText: parsed.data.freeText,
      });
      return NextResponse.json(result);
    }),
  );
}
