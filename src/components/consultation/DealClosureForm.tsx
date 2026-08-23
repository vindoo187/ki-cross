"use client";

/**
 * Deal-Erfassungsmaske auf der Zusammenfassungsseite (Phase 6 AP5, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.1). Bewusst KEIN neuer,
 * eigenstaendiger CRM-Bildschirm, sondern eine Erweiterung der bestehenden
 * Zusammenfassungsseite -- der Mitarbeiter bestaetigt hier, welche der
 * ANGENOMMENEN Empfehlungen (`dealClosureCandidates`, siehe `view-models.ts`)
 * tatsaechlich zum Abschluss gefuehrt haben, passt bei Bedarf die Menge an
 * und schliesst den Deal ueber `POST /api/consultation/sessions/[id]/deals`
 * ab (`closeDeal()`).
 *
 * Ein Deal ist ein Einmalvorgang pro Sitzung (`DealAlreadyExistsForSessionError`,
 * 409) -- diese Komponente wird von der aufrufenden Seite (`summary/page.tsx`)
 * nur gerendert, solange noch kein Deal existiert (`summary.deal === null`);
 * ein 409 kann dennoch auftreten (Doppel-Request/zweiter Tab) und wird analog
 * zu `OutcomeDialog`/`OpportunityCard` mit `router.refresh()` behandelt --
 * die Seite zeigt danach den bereits gespeicherten `DealSummary` an, kein
 * technischer Fehler.
 *
 * Zeigt bewusst KEINE Provisions-/Margendaten in der Auswahlmaske -- nur
 * Produktname und Kunden-Preise (analog `RecommendationCard`), konsistent
 * mit der Regel "Provisions-/Margendaten werden nicht in der Mitarbeiter-UI
 * angezeigt" (siehe `view-models.ts`, Modulkommentar zu `DealSummary`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DealClosureCandidateItem } from "@/server/consultation-ui/view-models";

interface DealClosureFormProps {
  consultationSessionId: string;
  candidates: DealClosureCandidateItem[];
}

interface SelectionState {
  selected: boolean;
  quantity: number;
}

function formatMinorAmount(amountMinor: number | null, currency: string): string {
  if (amountMinor == null) {
    return "--";
  }
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountMinor / 100);
}

async function parseErrorBody(response: Response): Promise<{ message: string }> {
  try {
    const body = (await response.json()) as { message?: string };
    return { message: body.message ?? "Unbekannter Fehler." };
  } catch {
    return { message: "Unbekannter Fehler." };
  }
}

export function DealClosureForm({ consultationSessionId, candidates }: DealClosureFormProps) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, SelectionState>>(() =>
    Object.fromEntries(
      candidates.map((candidate) => [candidate.productVersionId, { selected: true, quantity: 1 }]),
    ),
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (candidates.length === 0) {
    return null;
  }

  const selectedItems = candidates
    .filter((candidate) => selections[candidate.productVersionId]?.selected)
    .map((candidate) => ({
      productVersionId: candidate.productVersionId,
      quantity: selections[candidate.productVersionId]?.quantity ?? 1,
    }));

  function toggleSelected(productVersionId: string) {
    setSelections((prev) => ({
      ...prev,
      [productVersionId]: {
        selected: !prev[productVersionId]?.selected,
        quantity: prev[productVersionId]?.quantity ?? 1,
      },
    }));
  }

  function setQuantity(productVersionId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return;
    }
    setSelections((prev) => ({
      ...prev,
      [productVersionId]: { selected: prev[productVersionId]?.selected ?? true, quantity },
    }));
  }

  async function handleSubmit() {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/consultation/sessions/${consultationSessionId}/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: selectedItems }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      if (response.status === 409) {
        // Bereits abgeschlossen (Doppel-Request/zweiter Tab) -- kanonischen Stand nachladen.
        router.refresh();
        return;
      }
      const body = await parseErrorBody(response);
      setStatus("error");
      setErrorMessage(body.message);
    } catch {
      setStatus("error");
      setErrorMessage("Verbindung zum Server fehlgeschlagen.");
    }
  }

  return (
    <div className="deal-closure">
      <p className="deal-closure__intro">
        Welche der angenommenen Empfehlungen haben tatsaechlich zu einem Abschluss gefuehrt?
      </p>
      <ul className="deal-closure__items">
        {candidates.map((candidate) => {
          const selection = selections[candidate.productVersionId] ?? {
            selected: true,
            quantity: 1,
          };
          return (
            <li key={candidate.productVersionId} className="deal-closure__item">
              <label className="deal-closure__item-select">
                <input
                  type="checkbox"
                  checked={selection.selected}
                  onChange={() => toggleSelected(candidate.productVersionId)}
                  disabled={status === "submitting"}
                />
                {candidate.productName}
              </label>
              <span className="deal-closure__item-price">
                {formatMinorAmount(candidate.monthlyPriceMinor, candidate.currency)} / Monat
                {candidate.oneTimePriceMinor != null && (
                  <>
                    {" "}
                    + {formatMinorAmount(candidate.oneTimePriceMinor, candidate.currency)} einmalig
                  </>
                )}
              </span>
              <label className="deal-closure__item-quantity">
                Menge
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={selection.quantity}
                  onChange={(event) =>
                    setQuantity(candidate.productVersionId, Number(event.target.value))
                  }
                  disabled={!selection.selected || status === "submitting"}
                />
              </label>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={status === "submitting" || selectedItems.length === 0}
      >
        {status === "submitting" ? "Wird abgeschlossen…" : "Abschluss erfassen"}
      </button>

      {status === "error" && errorMessage && (
        <p role="alert" className="deal-closure__error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
