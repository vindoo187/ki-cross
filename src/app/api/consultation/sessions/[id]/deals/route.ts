/**
 * `POST /api/consultation/sessions/[id]/deals` (Phase 6 AP4, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.1). Duenne Transport-Schicht --
 * `id` ist die `ConsultationSession.id`, Fachlogik liegt ausschliesslich in
 * `closeDeal()` (`src/server/deals/service.ts`). Bewusst nur `POST`: ein
 * Deal ist ein Einmalvorgang pro Session (siehe
 * `DealAlreadyExistsForSessionError`), kein Nachtragen/Aendern in Phase 6.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { closeDealBodySchema } from "@/server/consultation-ui/schemas";
import { closeDeal } from "@/server/deals/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = closeDealBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const result = await closeDeal({
        consultationSessionId: id,
        items: parsed.data.items,
        customerReferenceId: parsed.data.customerReferenceId,
      });
      return NextResponse.json({ deal: result }, { status: 201 });
    }),
  );
}
