"use client";

/**
 * Einfacher React-Error-Boundary-Wrapper um den Fragebogen-Arbeitsplatz
 * (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3). Faengt nur
 * unerwartete Rendering-/Laufzeitfehler in Client-Komponenten ab -- KEIN
 * Ersatz fuer die serverseitige Fehlerbehandlung (`http-errors.ts`), die
 * bereits bekannte Fachfehler vor dem Rendern abfaengt. Muss als Klassen-
 * komponente implementiert werden, da React Error Boundaries aktuell keine
 * Hook-Variante unterstuetzen.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Bewusst nur console.error (kein Analytics-Kernereignis, siehe Plan
    // Abschnitt 10) -- rein technisches Monitoring eines unerwarteten
    // Rendering-Fehlers.
    console.error("Unerwarteter Fehler im Fragebogen-Arbeitsplatz:", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="status-banner status-banner--offline" role="alert">
          <p>
            Es ist ein unerwarteter Fehler aufgetreten. Bitte laden Sie die Seite neu. Bereits
            gespeicherte Antworten gehen dabei nicht verloren.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Seite neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
