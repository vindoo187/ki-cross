import { NextResponse, type NextRequest } from "next/server";
import { InvalidSessionError } from "@/server/auth/errors";
import { readSessionFromRequest } from "@/server/auth/request-context";

/** Liefert die aktuelle Dev-Session (falls vorhanden) fuer clientseitige Anzeige. */
export async function GET(request: NextRequest) {
  try {
    const session = readSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }
    return NextResponse.json({
      authenticated: true,
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      displayName: session.displayName,
      roles: session.roles,
    });
  } catch (error) {
    if (error instanceof InvalidSessionError) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }
    throw error;
  }
}
