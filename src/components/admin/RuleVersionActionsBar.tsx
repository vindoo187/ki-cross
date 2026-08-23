"use client";

/**
 * Validieren-/Veroeffentlichen-Aktionen fuer eine DRAFT-`RuleSetVersion`
 * (Phase 9 AP8, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 9). Analog
 * `VersionActionsBar.tsx` (Phase 8 AP6), mit EINEM wichtigen Unterschied,
 * den ChatGPT als "wichtigsten UX-Punkt" von AP8 bezeichnet hat
 * (2026-08-18): der Veroeffentlichen-Hinweis/Bestaetigungsdialog macht
 * EXPLIZIT klar, dass Publish die aktive Regelkonfiguration des GESAMTEN
 * Mandanten ersetzt -- nicht nur die dieses `RuleSet`s (mandantenweiter statt
 * pro-RuleSet-Scope, siehe `publishRuleSetVersion()` in `rule-admin.ts`).
 *
 * Ruft ausschliesslich die bestehenden AP4/AP5-Routen (`POST .../validate`,
 * `POST .../publish`) auf -- keine eigene Validierungs- oder Publish-Logik
 * in der UI. Der Veroeffentlichen-Button wird nur gerendert, wenn die
 * Session `config.rules.publish` besitzt (`canPublish`-Prop) -- reine
 * UX-Bequemlichkeit, die eigentliche Durchsetzung bleibt serverseitig in der
 * Route (`requireConfigPermission(session, "config.rules.publish")`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RuleVersionActionsBarProps {
  ruleSetId: string;
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

export function RuleVersionActionsBar({
  ruleSetId,
  versionId,
  canPublish,
}: RuleVersionActionsBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "busy">("idle");
  const [issues, setIssues] = useState<string[] | null>(null);
  const [validOk, setValidOk] = useState(false);

  const basePath = `/api/admin/rule-sets/${ruleSetId}/versions/${versionId}`;

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
        "Achtung: Veroeffentlichen ersetzt die aktuell aktive Regelkonfiguration " +
          "des GESAMTEN Mandanten -- auch wenn diese Version zu einem anderen " +
          "RuleSet gehoert als das aktuell aktive. Wirklich veroeffentlichen?",
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
      <p className="admin-questions__hint admin-rules__publish-warning">
        Hinweis: Veroeffentlichen ersetzt die aktive Regelkonfiguration des gesamten Mandanten --
        unabhaengig davon, zu welchem RuleSet die aktuell aktive Version gehoert.
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
