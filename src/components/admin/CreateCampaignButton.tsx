"use client";

/**
 * Formular zum Anlegen einer neuen `Campaign` (fachliche Identitaet, nur
 * `key`/`name`, ohne Version -- Phase 13 AP6, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-30).
 * Analog `CreateGoalButton.tsx` (Phase 11 AP6) im UI-Muster (Toggle-
 * Formular), aber ohne Scope-/Metrik-Felder -- `Campaign` selbst hat
 * keinen Scope (der lebt ausschliesslich auf `CampaignVersion`, siehe
 * `campaign-schemas.ts`). Ruft ausschliesslich `POST /api/admin/campaigns`
 * auf (bereits seit AP3 bestehend). Nach Erfolg Aktualisierung der Liste
 * (`router.refresh()`) -- KEINE Weiterleitung auf eine Detailseite, da eine
 * `Campaign` ohne Version keine eigene Detailansicht hat (identisches
 * Prinzip wie `RuleSet`/`CommissionModel`: die Liste zeigt "Keine Versionen
 * vorhanden" + einen "Neuen Entwurf erstellen"-Button).
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CreateCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setKey("");
    setName("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, name }),
      });
      if (response.ok) {
        setOpen(false);
        resetForm();
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        issues?: Array<{ message: string }>;
      };
      setError(
        body.issues?.map((i) => i.message).join("; ") ??
          body.message ??
          "Kampagne konnte nicht angelegt werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="admin-goals__create-button">
        Neue Kampagne anlegen
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="admin-goals__form">
      <h2>Neue Kampagne anlegen</h2>

      <label className="admin-goals__field">
        Schluessel (eindeutig je Mandant)
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
          maxLength={200}
        />
      </label>

      <label className="admin-goals__field">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
        />
      </label>

      {error && <p className="admin-questions__error">{error}</p>}

      <div className="admin-goals__form-actions">
        <button type="submit" disabled={busy}>
          Kampagne anlegen
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
          disabled={busy}
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}
