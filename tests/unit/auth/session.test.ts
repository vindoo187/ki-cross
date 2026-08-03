import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resolveSecureCookieFlag } from "@/server/auth/session";

/**
 * Regressionstests fuer Fix 4 (CI #23, Root Cause 4, mit ChatGPT abgestimmt
 * am 2026-08-03): das Session-Cookie darf das `Secure`-Attribut nicht anhand
 * von `NODE_ENV` erhalten, sondern ausschliesslich anhand des tatsaechlichen
 * Transportprotokolls der Anfrage (inkl. `x-forwarded-proto` hinter einem
 * TLS-terminierenden Reverse-Proxy).
 */
describe("resolveSecureCookieFlag", () => {
  it("liefert false fuer eine reine HTTP-Anfrage ohne x-forwarded-proto", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/dev-login");
    expect(resolveSecureCookieFlag(request)).toBe(false);
  });

  it("liefert true fuer eine direkte HTTPS-Anfrage", () => {
    const request = new NextRequest("https://127.0.0.1:3000/api/auth/dev-login");
    expect(resolveSecureCookieFlag(request)).toBe(true);
  });

  it("liefert true fuer HTTP mit x-forwarded-proto: https (Reverse-Proxy-Fall)", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/dev-login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(resolveSecureCookieFlag(request)).toBe(true);
  });

  it("liefert false fuer HTTP mit x-forwarded-proto: http", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/dev-login", {
      headers: { "x-forwarded-proto": "http" },
    });
    expect(resolveSecureCookieFlag(request)).toBe(false);
  });

  it("wertet einen kommaseparierten x-forwarded-proto-Header korrekt aus (erster Eintrag zaehlt)", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/dev-login", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(resolveSecureCookieFlag(request)).toBe(true);
  });

  it("ist tolerant gegenueber Gross-/Kleinschreibung und Leerzeichen im Header", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/dev-login", {
      headers: { "x-forwarded-proto": "  HTTPS  " },
    });
    expect(resolveSecureCookieFlag(request)).toBe(true);
  });

  it("liefert false, wenn der Header fehlt und das Protokoll http ist -- unabhaengig von NODE_ENV", () => {
    // Bewusst KEIN Bezug zu process.env.NODE_ENV: das ist genau der Fehler
    // aus CI #23 (Secure-Cookie ueber HTTP, weil NODE_ENV=production in
    // `next start` gesetzt wird). Dieser Test stellt sicher, dass die
    // Entscheidung ausschliesslich am Request haengt.
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/dev-login");
    expect(resolveSecureCookieFlag(request)).toBe(false);
  });
});
