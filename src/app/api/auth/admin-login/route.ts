import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyAdminCredentials } from "@/server/auth/admin-login";
import { InvalidAdminCredentialsError } from "@/server/auth/errors";
import {
  createSessionToken,
  resolveSecureCookieFlag,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/auth/session";

/**
 * Admin-/Konfigurations-Login (Phase 8 AP1). Additiv zum bestehenden
 * `dev-login` (Beratungsfluss, kein Passwort) -- siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1/1.3. `tenantId` wird
 * explizit mitgegeben (nicht aus der E-Mail erschlossen), weil `email` nur
 * pro Mandant eindeutig ist (`@@unique([tenantId, email])` auf `User`).
 *
 * NICHT produktionsreif fuer die Passwortvergabe selbst -- Admin-Testnutzer
 * werden ausschliesslich ueber prisma/seed.ts angelegt, kein Self-Service-
 * Registrierungs-/Passwort-Reset-Flow (siehe PHASE_8_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.1). Kein Fallback auf `dev-login` bei Fehlschlag
 * (ChatGPT-Auflage).
 */
const requestSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(1),
});

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
    const payload = await verifyAdminCredentials(
      parsed.data.tenantId,
      parsed.data.email,
      parsed.data.password,
    );
    if (!payload) {
      throw new InvalidAdminCredentialsError();
    }

    const token = createSessionToken(payload);

    // Bewusst dieselbe, knappe Response-Form wie dev-login -- NIEMALS
    // passwordHash oder sonstige Credential-Daten in der Antwort (ChatGPT-
    // Auflage, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 15, Punkt 2).
    const response = NextResponse.json({
      tenantId: payload.tenantId,
      employeeId: payload.employeeId,
      displayName: payload.displayName,
      roles: payload.roles,
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: resolveSecureCookieFlag(request),
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof InvalidAdminCredentialsError) {
      // Bewusst 401 ohne weitere Differenzierung -- siehe
      // InvalidAdminCredentialsError-Kommentar (keine Nutzer-Enumeration).
      return NextResponse.json({ error: "InvalidAdminCredentials" }, { status: 401 });
    }
    throw error;
  }
}
