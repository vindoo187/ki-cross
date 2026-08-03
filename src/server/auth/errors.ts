/**
 * Fehlerklassen fuer den minimalen Dev-/Pilot-Auth-Mechanismus (Phase 5).
 *
 * WICHTIG: Dieser Mechanismus ist ausdruecklich NICHT produktionsreif (siehe
 * .env.example, Kommentar zu DEV_AUTH_SECRET, und
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 15, Stop-Punkt 1). Er ersetzt kein
 * vollstaendiges Authentifizierungssystem (kein Passwort-Hashing, kein IdP,
 * kein Passwort-Reset).
 */

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Wird geworfen, wenn DEV_AUTH_SECRET nicht gesetzt ist. */
export class DevAuthNotConfiguredError extends AuthenticationError {
  constructor() {
    super(
      "DEV_AUTH_SECRET ist nicht gesetzt. Der Dev-Auth-Mechanismus kann ohne dieses Secret nicht betrieben werden (siehe .env.example).",
    );
    this.name = "DevAuthNotConfiguredError";
  }
}

/** Wird geworfen, wenn keine Session vorhanden ist (kein/ungueltiges Cookie). */
export class MissingSessionError extends AuthenticationError {
  constructor() {
    super("Keine gueltige Session gefunden. Bitte erneut anmelden.");
    this.name = "MissingSessionError";
  }
}

/** Wird geworfen, wenn das Session-Cookie vorhanden, aber Signatur/Inhalt ungueltig ist. */
export class InvalidSessionError extends AuthenticationError {
  constructor() {
    super("Session ist ungueltig oder wurde manipuliert.");
    this.name = "InvalidSessionError";
  }
}

/** Wird geworfen, wenn der gewaehlte Login-Kandidat nicht (mehr) gueltig ist. */
export class InvalidDevLoginCandidateError extends AuthenticationError {
  constructor() {
    super(
      "Dieser Mitarbeiter-Datensatz ist nicht (mehr) fuer den Dev-Login gueltig (nicht synthetisch, kein aktiver Mitarbeiter oder keine verknuepfte Nutzer-ID).",
    );
    this.name = "InvalidDevLoginCandidateError";
  }
}
