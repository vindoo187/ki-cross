"use client";

/**
 * Erstellt eine neue DRAFT-`PlaybookVersion` (Phase 14 AP6, siehe
 * project_ki_cross_phase14_ap5_status.md, ChatGPT-GO 2026-08-31). Analog
 * `CreateDraftCampaignVersionButton.tsx` (Phase 13 AP6) im Grundmuster
 * ("kein Modal-Formular, sondern Ein-Klick-Aktion mit sinnvollen Default-/
 * Kopierwerten, editierbar danach im Draft-Editor"), an
 * `createDraftPlaybookVersionSchema` angepasst (`scopeType`/`scopeId` sind
 * PFLICHTFELDER, siehe `playbook-schemas.ts`):
 *
 * - MIT `copyFromVersionId`: laedt zunaechst die Quellversion
 *   (`GET .../versions/{copyFromVersionId}`) und uebernimmt deren
 *   `scopeType`/`scopeId`/`description` 1:1 -- `sections` wird bewusst
 *   NICHT im Payload mitgeschickt (siehe `createDraftPlaybookVersionSchema`-
 *   Modulkommentar: fehlt `sections`, aber `copyFromVersionId` ist gesetzt,
 *   kopiert der Server die Sections selbst serverseitig als Deep-Copy --
 *   kein doppeltes Kopieren in der UI). Deckt sowohl "neuer Entwurf aus
 *   dieser Version" als auch Rollback ab (identischer Aufruf, siehe
 *   Modulkommentar `createDraftPlaybookVersionSchema`).
 * - OHNE `copyFromVersionId` (erste Version eines `Playbook`): Default
 *   `scopeType: "TENANT"`, `scopeId: defaultTenantId` (vom Server als Prop
 *   uebergeben, siehe `/admin/playbooks/page.tsx` -- Session kennt die
 *   `tenantId`) -- der Admin kann Scope/Sections danach im
 *   `PlaybookDraftEditor` anpassen, bevor er veroeffentlicht.
 *
 * Ruft ausschliesslich die bestehende AP3-Route
 * (`POST /api/admin/playbooks/:id/versions`) auf. Nach Erfolg Weiterleitung
 * auf die neue DRAFT-Version.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaybookVersionDetail } from "@/server/admin/playbook-admin";

interface CreateDraftPlaybookVersionButtonProps {
  playbookId: string;
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

export function CreateDraftPlaybookVersionButton({
  playbookId,
  copyFromVersionId,
  defaultTenantId,
  label,
}: CreateDraftPlaybookVersionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const basePath = `/api/admin/playbooks/${playbookId}/versions`;

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
        const sourceBody = (await sourceResponse.json()) as { version: PlaybookVersionDetail };
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
      const createBody = (await createResponse.json()) as { version: PlaybookVersionDetail };
      router.push(`/admin/playbooks/${playbookId}/versions/${createBody.version.id}`);
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
