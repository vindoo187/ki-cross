"use client";

/**
 * Aufklappbare Begruendungsansicht pro `RecommendationCard` (AP6, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 7). Bewusst als Accordion (kein
 * Modal/Dialog) umgesetzt: bleibt im Seitenfluss, verdeckt nicht die
 * uebrigen Empfehlungen, ist tastaturbedienbar (`aria-expanded`).
 *
 * Tablet-Portrait-Variante (<768px, AP11, Plan Abschnitt 11/16): dasselbe
 * Markup wird per CSS (`.rationale-drawer__panel` in globals.css) zu einem
 * fixierten Bottom-Sheet -- kein separates Modal/Dialog-Element, damit die
 * uebrigen Empfehlungskarten weiterhin im DOM/Seitenfluss erreichbar bleiben
 * (Plan Abschnitt 4.7). Dazu kommt ein optionales, rein dekoratives Scrim
 * (`.rationale-drawer__backdrop`), das per Klick sowie per Escape-Taste
 * schliesst -- auf Desktop/Tablet-Landscape bleibt es unsichtbar
 * (`display: none` ausserhalb des Bottom-Sheet-Breakpoints), stoert dort
 * also nicht den Accordion-Fluss.
 *
 * Rein clientseitiges Auf-/Zuklappen -- keine neue Server-Anfrage (Plan
 * Abschnitt 5, Schritt 8: die Begruendung ist bereits Teil des beim Laden
 * der Seite uebergebenen `RecommendationResult`/`ConsultationRecommendationView`).
 */

import { useEffect, useId, useState } from "react";

interface RationaleDrawerProps {
  positiveEligibilityReasons: string[];
  unmetSoftEligibilityCriteria: string[];
}

export function RationaleDrawer({
  positiveEligibilityReasons,
  unmetSoftEligibilityCriteria,
}: RationaleDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  // Nur fuer die Bottom-Sheet-Variante relevant (Tablet-Portrait, <768px):
  // Escape schliesst das Sheet, analog zum Klick auf das Scrim. Auf
  // Desktop/Tablet-Landscape ist das Backdrop unsichtbar und der
  // Listener damit folgenlos.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div className="rationale-drawer">
      <button
        type="button"
        className="rationale-drawer__toggle"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? "Begruendung ausblenden" : "Begruendung ansehen"}
      </button>
      {isOpen && (
        <div
          className="rationale-drawer__backdrop"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}
      {isOpen && (
        <div id={panelId} className="rationale-drawer__panel">
          <section className="rationale-drawer__section rationale-drawer__section--positive">
            <h4 className="rationale-drawer__heading">Warum passt dieser Tarif?</h4>
            {positiveEligibilityReasons.length > 0 ? (
              <ul className="rationale-drawer__list">
                {positiveEligibilityReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="rationale-drawer__empty">
                Keine speziellen Eignungsgruende hinterlegt.
              </p>
            )}
          </section>
          {unmetSoftEligibilityCriteria.length > 0 && (
            <section className="rationale-drawer__section rationale-drawer__section--neutral">
              <h4 className="rationale-drawer__heading">Nicht ausschlaggebende, offene Punkte</h4>
              <ul className="rationale-drawer__list">
                {unmetSoftEligibilityCriteria.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
