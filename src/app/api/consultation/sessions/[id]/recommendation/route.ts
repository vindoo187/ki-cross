import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { evaluate, getLatestRecommendation } from "@/server/recommendation/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Liest die zuletzt erzeugte Empfehlung einer Session (reiner Lesezugriff,
 * jeder Session-Status, siehe `getLatestRecommendation()`-Modulkommentar).
 * Liefert `null` im Body, falls noch keine Auswertung stattgefunden hat --
 * kein 404, da das Fehlen einer Empfehlung ein regulaerer Zustand ist.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const recommendation = await getLatestRecommendation(id);
      return NextResponse.json({ recommendation });
    }),
  );
}

/**
 * Loest eine NEUE Auswertung aus (`evaluate()`, nur fuer Sessions mit Status
 * IN_PROGRESS, idempotent ueber `evaluationFingerprint` -- siehe
 * `evaluate()`-Modulkommentar in `src/server/recommendation/service.ts`).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const recommendation = await evaluate(id);
      return NextResponse.json({ recommendation }, { status: 201 });
    }),
  );
}
