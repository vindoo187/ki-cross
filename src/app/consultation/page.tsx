/**
 * Einstiegsseite `/consultation` (AP4): neue Beratung starten oder laufende
 * Sitzung fortsetzen (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3 + 5,
 * Schritt 1). Server Component -- laedt Session + Daten serverseitig, keine
 * eigene Fachlogik (nur Aufruf der duennen Adapter-Schicht `view-models.ts`).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  listActiveQuestionnaires,
  listInProgressSessionsForEmployee,
} from "@/server/consultation-ui/view-models";
import { StartConsultationForm } from "@/components/consultation/StartConsultationForm";

export const dynamic = "force-dynamic";

export default async function ConsultationEntryPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const { questionnaires, inProgressSessions } = await withServerSessionTenantContext(async (s) => {
    const [questionnaires, inProgressSessions] = await Promise.all([
      listActiveQuestionnaires(),
      listInProgressSessionsForEmployee(s.employeeId),
    ]);
    return { questionnaires, inProgressSessions };
  });

  return (
    <main className="consultation-entry">
      <h1>Beratung</h1>
      <p className="consultation-entry__hint">Angemeldet als {session.displayName}.</p>

      {inProgressSessions.length > 0 && (
        <section>
          <h2>Laufende Beratungen fortsetzen</h2>
          <ul className="consultation-entry__sessions">
            {inProgressSessions.map((s) => (
              <li key={s.id}>
                <Link href={`/consultation/${s.id}`} className="consultation-entry__session-link">
                  <span>{s.questionnaireLabel}</span>
                  <span className="consultation-entry__session-meta">
                    {s.consultationType === "NEW_CONTRACT" ? "Neuvertrag" : "Vertragsverlaengerung"}{" "}
                    &middot; gestartet am {new Date(s.startedAt).toLocaleString("de-DE")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Neue Beratung starten</h2>
        <StartConsultationForm questionnaires={questionnaires} />
      </section>

      {/* Phase 6 AP8: Einstiegspunkt zum Analytics-Dashboard. */}
      <p className="consultation-entry__analytics-link">
        <Link href="/analytics">Analytics-Dashboard ansehen</Link>
      </p>

      {/* Phase 7 AP4: Einstiegspunkt zum Management-Dashboard -- nur sichtbar,
          wenn die Session ueberhaupt einen managementScope traegt (reine
          UI-Bequemlichkeit, KEINE Sicherheitsgrenze: der eigentliche Zugriff
          wird ausschliesslich serverseitig in buildManagementAnalyticsView()
          durchgesetzt). */}
      {session.managementScope && (
        <p className="consultation-entry__analytics-link">
          <Link href="/analytics/management">Management-Analytics ansehen</Link>
        </p>
      )}

      {/* Phase 8 AP6: Einstiegspunkt zur Fragenverwaltung -- nur sichtbar, wenn
          die Session ueberhaupt config.questions.view traegt (reine
          UI-Bequemlichkeit, KEINE Sicherheitsgrenze: der eigentliche Zugriff
          wird ausschliesslich serverseitig ueber requireConfigPermission()
          durchgesetzt, siehe /admin/questions/page.tsx). */}
      {session.configPermissions.includes("config.questions.view") && (
        <p className="consultation-entry__analytics-link">
          <Link href="/admin/questions">Fragenverwaltung oeffnen</Link>
        </p>
      )}
    </main>
  );
}
