import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { abandonConsultationBodySchema } from "@/server/consultation-ui/schemas";
import { abandonConsultation } from "@/server/consultation-ui/abandonment";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Markiert eine Beratungssitzung als manuell abgebrochen
 * (`CONSULTATION_ABANDONED`, AP10, siehe Projektleiter-Entscheidung zum
 * manuellen Abbruchflow). Ausgeloest durch den bestaetigten "Beratung
 * abbrechen"-Button (`AbandonConsultationButton.tsx`) -- kein automatischer
 * Ausloeser (kein Timeout/Cron), siehe Modulkommentar in `abandonment.ts`.
 * Liefert 409 (`ConsultationAlreadyCompletedError`), falls die Sitzung
 * bereits per `completeConsultation()` abgeschlossen wurde.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = abandonConsultationBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const result = await abandonConsultation(id, parsed.data?.reasonCode);
      return NextResponse.json(result);
    }),
  );
}
