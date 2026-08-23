"use client";

/**
 * Validieren-/Veroeffentlichen-Aktionen fuer eine DRAFT-`QuestionnaireVersion`
 * (Phase 8 AP6, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9). Ruft
 * ausschliesslich die bestehenden AP4-Routen
 * (`POST .../validate`, `POST .../publish`) auf -- keine eigene
 * Validierungs- oder Publish-Logik in der UI.
 *
 * Der Veroeffentlichen-Button wird nur gerendert, wenn die Session
 * `config.questions.publish` besitzt (`canPublish`-Prop, vom Server aus
 * `session.configPermissions` abgeleitet) -- kein sichtbarer, aber
 * fehlschlagender Button (ChatGPT-Auflage AP6). Die eigentliche
 * Durchsetzung bleibt dennoch serverseitig in der Route
 * (`requireConfigPermission(session, "config.questions.publish")`); dieses
 * Prop ist reine UX-Bequemlichkeit, keine Sicherheitsgrenze.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface VersionActionsBarProps {
  questionnaireId: string;
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

export function VersionActionsBar({
  questionnaireId,
  versionId,
  canPublish,
}: VersionActionsBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "busy">("idle");
  const [issues, setIssues] = useState<string[] | null>(null);
  const [validOk, setValidOk] = useState(false);

  const basePath = `/api/admin/questionnaires/${questionnaireId}/versions/${versionId}`;

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
        "Diese Version wirklich veroeffentlichen? Die bisherige aktive Version wird abgeloest.",
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
