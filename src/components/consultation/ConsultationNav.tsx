/**
 * Navigation zwischen den drei Consultation-Unterseiten (Phase 15 AP1,
 * siehe PHASE_15_DISCOVERY.md Abschnitt 4). Reine, praesentationale Server
 * Component -- leitet alle Links ausschliesslich aus dem `sessionId`-
 * Routenparameter ab, KEIN Datenbankzugriff, keine Session-/Tenant-Pruefung
 * (siehe Modulkommentar zu `layout.tsx`: ChatGPTs verbindliche Vorgabe,
 * "Weg 1"/Option A -- Auth und fachliche Datenbeschaffung bleiben
 * ausschliesslich in den drei `page.tsx`).
 */

import Link from "next/link";

interface ConsultationNavProps {
  sessionId: string;
}

export function ConsultationNav({ sessionId }: ConsultationNavProps) {
  return (
    <nav className="consultation-nav" aria-label="Beratungsnavigation">
      <Link href="/consultation">Uebersicht</Link>
      <Link href={`/consultation/${sessionId}`}>Fragen</Link>
      <Link href={`/consultation/${sessionId}/recommendation`}>Empfehlung</Link>
      <Link href={`/consultation/${sessionId}/summary`}>Zusammenfassung</Link>
    </nav>
  );
}
