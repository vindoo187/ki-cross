"use client";

/**
 * Validieren-/Veroeffentlichen-Aktionen fuer eine DRAFT-
 * `CommissionModelVersion` (Phase 10 AP8, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 * Analog `RuleVersionActionsBar.tsx` (Phase 9 AP8) / `VersionActionsBar.tsx`
 * (Phase 8 AP6), mit EINEM wichtigen Unterschied, den ChatGPT als
 * "wichtigsten Unterschied zu Phase 9" bezeichnet hat (AP8-GO,
 * 2026-08-22): der Veroeffentlichen-Hinweis darf NICHT den mandantenweiten
 * RuleSet-Warnhinweis aus Phase 9 uebernehmen -- `publishCommissionModelVersion()`
 * ist PRO `CommissionModel` gescoped (siehe `commission-admin.ts`
 * Modulkommentar), andere Provisionsmodelle desselben Mandanten bleiben
 * unberuehrt.
 *
 * Ruft ausschliesslich die bestehenden AP4/AP5/AP8-Routen (`POST
 * .../validate`, `POST .../publish`) auf -- keine eigene Validierungs-
 * oder Publish-Logik in der UI. Der Veroeffentlichen-Button wird nur
 * gerendert, wenn die Session `config.commissions.publish` besitzt
 * (`canPublish`-Prop) -- reine UX-Bequemlichkeit, die eigentliche
 * Durchsetzung bleibt serverseitig in der Route
 * (`requireConfigPermission(session, "config.commissions.publish")`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CommissionVersionActionsBarProps {
  commissionModelId: string;
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

export function CommissionVersionActionsBar({
  commissionModelId,
  versionId,
  canPublish,
}: CommissionVersionActionsBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "busy">("idle");
  const [issues, setIssues] = useState<string[] | null>(null);
  const [validOk, setValidOk] = useState(false);

  const basePath = `/api/admin/commission-models/${commissionModelId}/versions/${versionId}`;

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
        "Veroeffentlichen ersetzt die aktuell aktive Version DIESES Provisionsmodells -- " +
          "andere Provisionsmodelle desselben Mandanten bleiben unveraendert. Wirklich " +
          "veroeffentlichen?",
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
      <p className="admin-questions__hint admin-commissions__publish-note">
        Hinweis: Veroeffentlichen betrifft ausschliesslich dieses Provisionsmodell -- andere
        Provisionsmodelle desselben Mandanten bleiben unveraendert.
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
