import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildSessionPayloadForEmployee } from "@/server/auth/dev-users";
import { InvalidDevLoginCandidateError } from "@/server/auth/errors";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/auth/session";

const requestSchema = z.object({
  employeeId: z.string().uuid(),
});

/**
 * Minimaler Dev-/Pilot-Login: kein Passwort, Auswahl aus vorab seeded,
 * synthetischen Mitarbeiter-Datensaetzen. NICHT produktionsreif -- siehe
 * src/server/auth/errors.ts und PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 15,
 * Stop-Punkt 1 (von ChatGPT bestaetigt, 2026-08-02).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "InvalidRequest", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const payload = await buildSessionPayloadForEmployee(parsed.data.employeeId);
    const token = createSessionToken(payload);

    const response = NextResponse.json({
      tenantId: payload.tenantId,
      employeeId: payload.employeeId,
      displayName: payload.displayName,
      roles: payload.roles,
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof InvalidDevLoginCandidateError) {
      return NextResponse.json({ error: "InvalidDevLoginCandidate" }, { status: 401 });
    }
    throw error;
  }
}
