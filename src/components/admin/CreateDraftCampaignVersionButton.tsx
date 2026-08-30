"use client";

/**
 * Erstellt eine neue DRAFT-`CampaignVersion` (Phase 13 AP6, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-30).
 * Analog `CreateDraftCommissionModelVersionButton.tsx` (Phase 10 AP8) im
 * Grundmuster ("kein Modal-Formular, sondern Ein-Klick-Aktion mit
 * sinnvollen Default-/Kopierwerten, editierbar danach im Draft-Editor"),
 * aber an `createDraftCampaignVersionSchema` angepasst
 * (`scopeType`/`scopeId` sind PFLICHTFELDER, siehe `campaign-schemas.ts`):
 *
 * - MIT `copyFromVersionId`: laedt zunaechst die Quellversion
 *   (`GET .../versions/{copyFromVersionId}`) und uebernimmt deren
 *   `scopeType`/`scopeId`/`description` 1:1 -- `conditions` wird bewusst
 *   NICHT im Payload mitgeschickt (siehe `createDraftCampaignVersionSchema`-
 *   Modulkommentar: fehlt `conditions`, aber `copyFromVersionId` ist
 *   gesetzt, kopiert der Server die Bedingungen selbst serverseitig als
 *   Deep-Copy -- kein doppeltes Kopieren in der UI). Deckt sowohl "neuer
 *   Entwurf aus dieser Version" als auch Rollback ab (identischer Aufruf,
 *   siehe Modulkommentar `createDraftCampaignVersionSchema`).
 * - OHNE `copyFromVersionId` (erste Version einer `Campaign`): Default
 *   `scopeType: "TENANT"`, `scopeId: defaultTenantId` (vom Server als Prop
 *   uebergeben, siehe `/admin/campaigns/page.tsx` -- Session kennt die
 *   `tenantId`) -- der Admin kann Scope/Bedingungen danach im
 *   `CampaignDraftEditor` anpassen, bevor er veroeffentlicht.
 *
 * Ruft ausschliesslich die bestehende AP3-Route
 * (`POST /api/admin/campaigns/:id/versions`) auf. Nach Erfolg Weiterleitung
 * auf die neue DRAFT-Version.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignVersionDetail } from "@/server/admin/campaign-admin";

interface CreateDraftCampaignVersionButtonProps {
  campaignId: string;
  copyFromVersionId?: string;
  defaultTenantId: string;
  label: string;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? "Entwurf konnte nicht erstellt werden.";
  } catch {
    return "Entwurf konnte nicht erstellt werden.";
  }
}

export function CreateDraftCampaignVersionButton({
  campaignId,
  copyFromVersionId,
  defaultTenantId,
  label,
}: CreateDraftCampaignVersionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const basePath = `/api/admin/campaigns/${campaignId}/versions`;

      let createInput: {
        scopeType: string;
        scopeId: string;
        description: string | null;
        copyFromVersionId?: string;
      };

      if (copyFromVersionId) {
        const sourceResponse = await fetch(`${basePath}/${copyFromVersionId}`);
        if (!sourceResponse.ok) {
          setError(await parseErrorMessage(sourceResponse));
          return;
        }
        const sourceBody = (await sourceResponse.json()) as { version: CampaignVersionDetail };
        createInput = {
          scopeType: sourceBody.version.scopeType,
          scopeId: sourceBody.version.scopeId,
          description: sourceBody.version.description,
          copyFromVersionId,
        };
      } else {
        createInput = {
          scopeType: "TENANT",
          scopeId: defaultTenantId,
          description: null,
        };
      }

      const createResponse = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createInput),
      });
      if (!createResponse.ok) {
        setError(await parseErrorMessage(createResponse));
        return;
      }
      const createBody = (await createResponse.json()) as { version: CampaignVersionDetail };
      router.push(`/admin/campaigns/${campaignId}/versions/${createBody.version.id}`);
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
