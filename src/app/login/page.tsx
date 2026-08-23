import { listDevLoginCandidates } from "@/server/auth/dev-users";
import { DevLoginButton } from "@/components/auth/DevLoginButton";

export const dynamic = "force-dynamic";

/**
 * Minimaler Dev-/Pilot-Login. Kein Passwort -- Auswahl aus vorab seeded,
 * synthetischen Mitarbeiter-Datensaetzen. NICHT produktionsreif und nicht
 * fuer ein oeffentliches Deployment gedacht (siehe .env.example, Kommentar
 * zu DEV_AUTH_SECRET, sowie PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 15,
 * Stop-Punkt 1, von ChatGPT bestaetigt am 2026-08-02).
 */
export default async function LoginPage() {
  const candidates = await listDevLoginCandidates();

  return (
    <main className="login-page">
      <h1>Anmeldung (Entwicklungsmodus)</h1>
      <p className="login-page__hint">
        Dies ist ein vereinfachter Anmeldemechanismus ohne Passwort fuer synthetische Testdaten.
        Kein produktiver Login.
      </p>
      {candidates.length === 0 ? (
        <p>Keine anmeldbaren Mitarbeiter-Datensaetze gefunden. Bitte Seed-Daten pruefen.</p>
      ) : (
        <ul className="login-page__candidates">
          {candidates.map((candidate) => (
            <li key={candidate.employeeId}>
              <DevLoginButton
                employeeId={candidate.employeeId}
                displayName={candidate.displayName}
                storeName={candidate.storeName}
                tenantName={candidate.tenantName}
                roles={candidate.roles}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
