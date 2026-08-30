"use client";

/**
 * Validieren-/Veroeffentlichen-Aktionen fuer eine DRAFT-`CampaignVersion`
 * (Phase 13 AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3,
 * ChatGPT-GO 2026-08-30). Analog `CommissionVersionActionsBar.tsx`
 * (Phase 10 AP8) -- `publishCampaignVersion()` ist wie
 * `publishCommissionModelVersion()` PRO Entitaet (hier: PRO `Campaign`)
 * gescoped, NICHT mandantenweit wie `RuleSetVersion` (Phase 9). Der
 * Veroeffentlichen-Hinweis uebernimmt daher bewusst die kalme,
 * per-Entitaet-Formulierung, NICHT den mandantenweiten Warnhinweis aus
 * der Regelverwaltung.
 *
 * Ruft ausschliesslich die bestehenden AP6-Routen (`POST .../validate`,
 * `POST .../publish`) auf -- keine eigene Validierungs- oder Publish-
 * Logik in der UI. Der Veroeffentlichen-Button wird nur gerendert, wenn
 * die Session `config.campaigns.publish` besitzt (`canPublish`-Prop) --
 * reine UX-Bequemlichkeit, die eigentliche Durchsetzung bleibt
 * serverseitig in der Route.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CampaignVersionActionsBarProps {
  campaignId: string;
  versionId: string;
  canPublish: boolean;
}

interface IssuesBody {
  issues?: string[];
  message?: string;
}

async function parseIssues(response: Response): Promise<string[]> {
  try {
    const body = (await response.json()) as IssuesBody;
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      return body.issues;
    }
    return body.message ? [body.message] : ["Unbekannter Fehler."];
  } catch {
    return ["Unbekannter Fehler."];
  }
}

export function CampaignVersionActionsBar({
  campaignId,
  versionId,
  canPublish,
}: CampaignVersionActionsBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "busy">("idle");
  const [issues, setIssues] = useState<string[] | null>(null);
  const [validOk, setValidOk] = useState(false);

  const basePath = `/api/admin/campaigns/${campaignId}/versions/${versionId}`;

  async function handleValidate() {
    setStatus("busy");
    setIssues(null);
    setValidOk(false);
    try {
      const response = await fetch(`${basePath}/validate`, { method: "POST" });
      if (response.ok) {
        setValidOk(true);
      } else {
        setIssues(await parseIssues(response));
      }
    } finally {
      setStatus("idle");
    }
  }

  async function handlePublish() {
    if (
      !window.confirm(
        "Veroeffentlichen ersetzt die aktuell aktive Version DIESER Kampagne -- andere " +
          "Kampagnen desselben Mandanten bleiben unveraendert. Wirklich veroeffentlichen?",
      )
    ) {
      return;
    }
    setStatus("busy");
    setIssues(null);
    try {
      const response = await fetch(`${basePath}/publish`, { method: "POST" });
      if (response.ok) {
        router.refresh();
        return;
      }
      setIssues(await parseIssues(response));
    } finally {
      setStatus("idle");
    }
  }

  return (
    <section className="admin-questions__actions">
      <p className="admin-questions__hint admin-campaigns__publish-note">
        Hinweis: Veroeffentlichen betrifft ausschliesslich diese Kampagne -- andere Kampagnen
        desselben Mandanten bleiben unveraendert.
      </p>
      <button type="button" onClick={handleValidate} disabled={status === "busy"}>
        Validieren
      </button>
      {canPublish && (
        <button
          type="button"
          onClick={handlePublish}
          disabled={status === "busy"}
          className="admin-questions__publish-button"
        >
          Veroeffentlichen
        </button>
      )}

      {validOk && (
        <p className="admin-questions__valid-ok">Entwurf ist vollstaendig und gueltig.</p>
      )}
      {issues && issues.length > 0 && (
        <ul className="admin-questions__issues">
          {issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
