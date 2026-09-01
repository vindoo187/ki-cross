/**
 * Gemeinsamer UI-Rahmen `ConsultationWorkspace` fuer `/consultation/[sessionId]`
 * und seine drei Unterseiten (Phase 15 AP1, seit Phase 5/2026-08-03 mehrfach
 * zurueckgestelltes Feature, siehe PHASE_15_DISCOVERY.md +
 * project_ki_cross_phase15_ap1_bestandspruefung.md).
 *
 * WICHTIG -- verbindliche ChatGPT-Entscheidung (2026-09-01, "Option A"/
 * "Weg 1", siehe Bestandspruefung): dieses Layout ist ABSICHTLICH rein
 * praesentational. Next.js haelt geteilte Layout-Segmente bei Client-
 * seitiger Navigation zwischen Geschwister-Seiten NICHT zwingend frisch
 * (anders als Page-Segmente, die standardmaessig `staleTime=0` haben --
 * siehe offizielle Next.js-15-Doku: "Shared layout data won't be refetched
 * from the server to continue to support partial rendering"). Deshalb NIE:
 * - `getOptionalServerSession()`/`redirect("/login")` HIER aufrufen --
 *   bleibt bewusst dupliziert in allen drei `page.tsx` (akzeptable
 *   Duplikation fuer eine Page-Level-Sicherheitsgrenze, kein Cache-Trick als
 *   Security-Mechanismus).
 * - `getConsultationSidebarData()`/`withServerSessionTenantContext()` HIER
 *   aufrufen -- gleiches Frische-Problem. Jede Page ruft das Sidebar-Read-
 *   Model selbst auf und rendert `<ConsultationSidebar>` selbst.
 * - Keine DB-Zugriffe, keine fachliche Datenbeschaffung in dieser Datei.
 *
 * Uebernimmt ausschliesslich: gemeinsamen `<div className="consultation-workspace">`-Rahmen,
 * `ConsultationNav` (Navigation zwischen den drei Unterseiten, rein aus dem
 * `sessionId`-Routenparameter abgeleitet) und `children`.
 */

import type { ReactNode } from "react";
import { ConsultationNav } from "@/components/consultation/ConsultationNav";

interface ConsultationLayoutProps {
  children: ReactNode;
  params: Promise<{ sessionId: string }>;
}

export default async function ConsultationWorkspace({ children, params }: ConsultationLayoutProps) {
  const { sessionId } = await params;

  return (
    <div className="consultation-workspace">
      <ConsultationNav sessionId={sessionId} />
      {children}
    </div>
  );
}
