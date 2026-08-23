"use client";

/**
 * Erstellt eine neue DRAFT-`CommissionModelVersion` (Phase 10 AP8, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 * Analog `CreateDraftRuleSetVersionButton.tsx` (Phase 9 AP8) /
 * `CreateDraftVersionButton.tsx` (Phase 8 AP6), mit EINEM wichtigen
 * strukturellen Unterschied (siehe `commission-schemas.ts`
 * Modulkommentar zu `createDraftCommissionModelVersionSchema`):
 * `createDraftCommissionModelVersion()` kopiert die Skalarfelder/Stufen
 * einer `copyFromVersionId` NICHT automatisch -- `copyFromVersionId`
 * dient dort ausschliesslich der Audit-Nachvollziehbarkeit und der
 * Zugehoerigkeitspruefung (muss zum selben `CommissionModel` gehoeren).
 * Dieser Button uebernimmt daher selbst -- rein als UI-Orchestrierung,
 * OHNE neue Fachlogik -- die "Kopieren"-Sequenz aus bereits bestehenden
 * API-Aufrufen:
 *
 * 1. Falls `copyFromVersionId` gesetzt ist: `GET .../versions/{copyFromVersionId}`
 *    laedt die vollstaendige Quellversion (Skalarfelder + `tiers[]`).
 * 2. `POST .../versions` mit den (ggf. kopierten) Skalarfeldern +
 *    `copyFromVersionId` (fuer die Audit-Nachvollziehbarkeit) legt die
 *    neue DRAFT-Version an.
 * 3. Falls die Quellversion TIERED war: sequentielle `POST .../tiers`-
 *    Aufrufe replizieren jede Stufe 1:1 auf die neue Version.
 * 4. Weiterleitung auf die neue DRAFT-Version.
 *
 * Ohne `copyFromVersionId` (z. B. ein `CommissionModel` ganz ohne
 * Versionen) wird direkt ein leerer FLAT-Entwurf mit Platzhalterwerten
 * angelegt (`commissionType: "FLAT", currency: "EUR",
 * commissionAmountMinor: 0`) -- der Nutzer bearbeitet diese Werte
 * anschliessend im `CommissionDraftEditor`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CommissionModelVersionDetail } from "@/server/admin/commission-admin";

interface CreateDraftCommissionModelVersionButtonProps {
  commissionModelId: string;
  copyFromVersionId?: string;
  label: string;
}

interface CreateVersionInput {
  commissionType: string;
  currency: string;
  commissionAmountMinor: number | null;
  commissionPercentageBasisPoints: number | null;
  recurringCommissionAmountMinor: number | null;
  copyFromVersionId?: string;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? "Entwurf konnte nicht erstellt werden.";
  } catch {
    return "Entwurf konnte nicht erstellt werden.";
  }
}

export function CreateDraftCommissionModelVersionButton({
  commissionModelId,
  copyFromVersionId,
  label,
}: CreateDraftCommissionModelVersionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const basePath = `/api/admin/commission-models/${commissionModelId}/versions`;

      let source: CommissionModelVersionDetail | null = null;
      if (copyFromVersionId) {
        const sourceResponse = await fetch(`${basePath}/${copyFromVersionId}`);
        if (!sourceResponse.ok) {
          setError(await parseErrorMessage(sourceResponse));
          return;
        }
        const sourceBody = (await sourceResponse.json()) as {
          version: CommissionModelVersionDetail;
        };
        source = sourceBody.version;
      }

      const createInput: CreateVersionInput = source
        ? {
            commissionType: source.commissionType,
            currency: source.currency,
            commissionAmountMinor: source.commissionAmountMinor,
            commissionPercentageBasisPoints: source.commissionPercentageBasisPoints,
            recurringCommissionAmountMinor: source.recurringCommissionAmountMinor,
            copyFromVersionId,
          }
        : {
            commissionType: "FLAT",
            currency: "EUR",
            commissionAmountMinor: 0,
            commissionPercentageBasisPoints: null,
            recurringCommissionAmountMinor: null,
          };

      const createResponse = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createInput),
      });
      if (!createResponse.ok) {
        setError(await parseErrorMessage(createResponse));
        return;
      }
      const createBody = (await createResponse.json()) as {
        version: CommissionModelVersionDetail;
      };
      const newVersionId = createBody.version.id;

      if (source && source.commissionType === "TIERED" && source.tiers.length > 0) {
        for (const tier of source.tiers) {
          const tierResponse = await fetch(`${basePath}/${newVersionId}/tiers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              thresholdMinor: tier.thresholdMinor,
              tierAmountMinor: tier.tierAmountMinor,
              tierPercentageBasisPoints: tier.tierPercentageBasisPoints,
              sortOrder: tier.sortOrder,
            }),
          });
          if (!tierResponse.ok) {
            setError(
              "Entwurf wurde angelegt, aber nicht alle Stufen konnten kopiert werden: " +
                (await parseErrorMessage(tierResponse)),
            );
            router.push(`/admin/commissions/${commissionModelId}/versions/${newVersionId}`);
            return;
          }
        }
      }

      router.push(`/admin/commissions/${commissionModelId}/versions/${newVersionId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={busy}>
        {label}
      </button>
      {error && <p className="admin-questions__error">{error}</p>}
    </div>
  );
}
