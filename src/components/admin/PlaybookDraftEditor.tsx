"use client";

/**
 * Editor fuer eine DRAFT-`PlaybookVersion` (Phase 14 AP6, siehe
 * project_ki_cross_phase14_ap5_status.md, ChatGPT-GO 2026-08-31). Analog
 * `CampaignDraftEditor.tsx` (Phase 13 AP6) im Grundmuster (EIN gemeinsames
 * Speichern-Formular, `sections` wird als GANZE Liste beim Speichern
 * mitgeschickt -- identisches Delete-All-Then-Recreate-Prinzip wie
 * `CampaignCondition`, siehe `playbook-schemas.ts`-Modulkommentar):
 * (1) Scope (`scopeType`/`scopeId`, ueber `playbook-scope-options.ts`
 * bezogen) + Beschreibung, (2) Sections (`SectionsEditor`, alle 10
 * `PlaybookSectionType`-Werte editierbar, Metadaten `relatedTopics`/
 * `relatedProductKeys`/`relatedSituations`/`tags` klar vom `content`
 * getrennt, sichtbares Zeichen-/Limit-Feedback fuer `content` bis 20000
 * Zeichen -- ChatGPTs ausdruecklicher AP6-Zusatzpunkt).
 *
 * SICHERHEITSHINWEIS (ChatGPT-Vorgabe AP5/AP6, siehe DECISION_LOG.md):
 * `content` wird HIER ausschliesslich als reiner Text behandelt --
 * `<textarea>` rendert Text nie als HTML, es gibt KEINE
 * `dangerouslySetInnerHTML`-Verwendung in dieser Datei. Playbook-Content
 * bleibt untrusted business content, niemals eine Interpretation als
 * Anweisung.
 *
 * Ruft ausschliesslich die bestehende AP3-Route (`PATCH
 * .../versions/[versionId]`) auf -- keine eigene Fachlogik/Validierung
 * ausser der reinen Formular-Struktur (die fachliche Pruefung uebernimmt
 * weiterhin ausschliesslich `validatePlaybookVersion()` ueber
 * `PlaybookVersionActionsBar`).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaybookVersionDetail, PlaybookSectionDetail } from "@/server/admin/playbook-admin";

const SCOPE_TYPES = ["TENANT", "STORE"] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

const SCOPE_TYPE_LABELS: Record<ScopeType, string> = {
  TENANT: "Mandant (gesamter Tenant)",
  STORE: "Filiale",
};

const SECTION_TYPES = [
  "CONVERSATION_GUIDANCE",
  "ARGUMENTATION",
  "OBJECTION_HANDLING",
  "PRODUCT_ARGUMENT",
  "CUSTOMER_SITUATION",
  "CLOSING",
  "UPSELL_CROSS_SELL",
  "NO_GO",
  "TONALITY",
  "GENERAL_PRINCIPLE",
] as const;
type SectionType = (typeof SECTION_TYPES)[number];

const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  CONVERSATION_GUIDANCE: "Gespraechsleitfaden",
  ARGUMENTATION: "Argumentation",
  OBJECTION_HANDLING: "Einwandbehandlung",
  PRODUCT_ARGUMENT: "Produktargument",
  CUSTOMER_SITUATION: "Kundensituation",
  CLOSING: "Abschluss",
  UPSELL_CROSS_SELL: "Up-/Cross-Selling",
  NO_GO: "No-Go",
  TONALITY: "Tonalitaet",
  GENERAL_PRINCIPLE: "Allgemeiner Grundsatz",
};

const CONTENT_MAX_LENGTH = 20000;

// ---------------------------------------------------------------------------
// Sections -- alle 10 PlaybookSectionType-Werte editierbar, Metadaten
// (relatedTopics/relatedProductKeys/relatedSituations/tags) als
// kommagetrennte Freitext-Listen (identisches Eingabemuster wie
// `comparisonValue` bei IN/NOT_IN in CampaignDraftEditor/RuleDraftEditor --
// KEIN neuer Tag-Picker-Komponententyp fuer diesen AP eingefuehrt).
// ---------------------------------------------------------------------------

interface SectionFormRow {
  sectionType: SectionType;
  title: string;
  content: string;
  relatedTopicsText: string;
  relatedProductKeysText: string;
  relatedSituationsText: string;
  tagsText: string;
  priority: string;
  active: boolean;
}

function emptySection(): SectionFormRow {
  return {
    sectionType: "CONVERSATION_GUIDANCE",
    title: "",
    content: "",
    relatedTopicsText: "",
    relatedProductKeysText: "",
    relatedSituationsText: "",
    tagsText: "",
    priority: "",
    active: true,
  };
}

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function textToTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function sectionFromDetail(s: PlaybookSectionDetail): SectionFormRow {
  return {
    sectionType: s.sectionType as SectionType,
    title: s.title,
    content: s.content,
    relatedTopicsText: tagsToText(s.relatedTopics),
    relatedProductKeysText: tagsToText(s.relatedProductKeys),
    relatedSituationsText: tagsToText(s.relatedSituations),
    tagsText: tagsToText(s.tags),
    priority: s.priority === null ? "" : String(s.priority),
    active: s.active,
  };
}

function sectionToPayload(s: SectionFormRow) {
  return {
    sectionType: s.sectionType,
    title: s.title,
    content: s.content,
    relatedTopics: textToTags(s.relatedTopicsText),
    relatedProductKeys: textToTags(s.relatedProductKeysText),
    relatedSituations: textToTags(s.relatedSituationsText),
    tags: textToTags(s.tagsText),
    priority: s.priority.trim() === "" ? null : Number(s.priority),
    active: s.active,
  };
}

interface SectionsEditorProps {
  sections: SectionFormRow[];
  setSections: (updater: (prev: SectionFormRow[]) => SectionFormRow[]) => void;
  readOnly: boolean;
}

function SectionsEditor({ sections, setSections, readOnly }: SectionsEditorProps) {
  return (
    <div className="admin-questions__form-field--wide">
      <p className="admin-questions__subheading">Sections</p>
      {sections.map((s, index) => {
        const contentLength = s.content.length;
        const overLimit = contentLength > CONTENT_MAX_LENGTH;
        return (
          <div key={index} className="admin-playbooks__section-block">
            <div className="admin-playbooks__section-row">
              <select
                value={s.sectionType}
                disabled={readOnly}
                onChange={(e) =>
                  setSections((prev) =>
                    prev.map((row, i) =>
                      i === index ? { ...row, sectionType: e.target.value as SectionType } : row,
                    ),
                  )
                }
              >
                {SECTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SECTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                placeholder="Titel"
                value={s.title}
                disabled={readOnly}
                maxLength={200}
                onChange={(e) =>
                  setSections((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)),
                  )
                }
              />
              <label className="admin-questions__form-checkbox">
                <input
                  type="checkbox"
                  checked={s.active}
                  disabled={readOnly}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, active: e.target.checked } : row,
                      ),
                    )
                  }
                />
                aktiv
              </label>
              <input
                type="number"
                placeholder="Prioritaet (optional)"
                title="Prioritaet -- reine Retrieval-Metadatik, keine Anzeige-Reihenfolge"
                value={s.priority}
                disabled={readOnly}
                min={0}
                max={1000}
                onChange={(e) =>
                  setSections((prev) =>
                    prev.map((row, i) =>
                      i === index ? { ...row, priority: e.target.value } : row,
                    ),
                  )
                }
              />
            </div>

            <label className="admin-playbooks__content-label">
              Inhalt (reiner Text -- wird niemals als HTML interpretiert)
              <textarea
                value={s.content}
                disabled={readOnly}
                rows={6}
                onChange={(e) =>
                  setSections((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, content: e.target.value } : row)),
                  )
                }
              />
              <span
                className={
                  overLimit
                    ? "admin-playbooks__char-counter admin-playbooks__char-counter--over"
                    : "admin-playbooks__char-counter"
                }
              >
                {contentLength} / {CONTENT_MAX_LENGTH} Zeichen
                {overLimit ? " -- Limit ueberschritten" : ""}
              </span>
            </label>

            <div className="admin-playbooks__section-row">
              <label className="admin-playbooks__tag-field">
                Themen (kommagetrennt)
                <input
                  value={s.relatedTopicsText}
                  disabled={readOnly}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, relatedTopicsText: e.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="admin-playbooks__tag-field">
                Produktschluessel (kommagetrennt)
                <input
                  value={s.relatedProductKeysText}
                  disabled={readOnly}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, relatedProductKeysText: e.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="admin-playbooks__tag-field">
                Kundensituationen (kommagetrennt)
                <input
                  value={s.relatedSituationsText}
                  disabled={readOnly}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, relatedSituationsText: e.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="admin-playbooks__tag-field">
                Tags (kommagetrennt)
                <input
                  value={s.tagsText}
                  disabled={readOnly}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, tagsText: e.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
            </div>

            {!readOnly && (
              <button
                type="button"
                onClick={() => setSections((prev) => prev.filter((_, i) => i !== index))}
              >
                Section entfernen
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <button type="button" onClick={() => setSections((prev) => [...prev, emptySection()])}>
          Section hinzufuegen
        </button>
      )}
      {sections.length === 0 && (
        <p className="admin-questions__empty">
          Keine Sections -- dieses Playbook liefert dann keine Inhalte an das Retrieval.
        </p>
      )}
    </div>
  );
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; issues?: unknown };
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      return (body.issues as string[]).join(" ");
    }
    return body.message ?? "Unbekannter Fehler.";
  } catch {
    return "Unbekannter Fehler.";
  }
}

interface ScopeOption {
  id: string;
  name: string;
}

interface PlaybookDraftEditorProps {
  playbookId: string;
  versionId: string;
  version: PlaybookVersionDetail;
  readOnly: boolean;
}

export function PlaybookDraftEditor({
  playbookId,
  versionId,
  version,
  readOnly,
}: PlaybookDraftEditorProps) {
  const router = useRouter();
  const basePath = `/api/admin/playbooks/${playbookId}/versions/${versionId}`;

  const [scopeType, setScopeType] = useState<ScopeType>(version.scopeType as ScopeType);
  const [scopeId, setScopeId] = useState(version.scopeId);
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [scopeOptionsLoading, setScopeOptionsLoading] = useState(false);
  const [description, setDescription] = useState(version.description ?? "");
  const [sections, setSections] = useState<SectionFormRow[]>(
    version.sections.map(sectionFromDetail),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScopeOptionsLoading(true);
    fetch(`/api/admin/playbooks/scope-options?scopeType=${scopeType}`)
      .then((r) => r.json())
      .then((body: { options?: ScopeOption[] }) => {
        if (cancelled) return;
        const options = body.options ?? [];
        setScopeOptions(options);
        if (scopeType === "TENANT" && options[0]) {
          setScopeId(options[0].id);
        }
      })
      .finally(() => {
        if (!cancelled) setScopeOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeType]);

  const hasOverLimitSection = sections.some((s) => s.content.length > CONTENT_MAX_LENGTH);

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch(basePath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeId,
          description: description === "" ? null : description,
          sections: sections.map(sectionToPayload),
        }),
      });
      if (response.ok) {
        setSavedOk(true);
        router.refresh();
        return;
      }
      setError(await parseErrorMessage(response));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-questions__editor admin-playbooks__editor">
      <h2>Playbook-Entwurf</h2>
      {error && <p className="admin-questions__error">{error}</p>}
      {savedOk && <p className="admin-questions__valid-ok">Entwurf gespeichert.</p>}

      <div className="admin-questions__form-grid">
        <label>
          Scope-Typ
          <select
            value={scopeType}
            disabled={readOnly}
            onChange={(e) => setScopeType(e.target.value as ScopeType)}
          >
            {SCOPE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SCOPE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label>
          {SCOPE_TYPE_LABELS[scopeType]}
          {scopeType === "TENANT" ? (
            <input type="text" value={scopeOptions[0]?.name ?? ""} disabled readOnly />
          ) : (
            <select
              value={scopeId}
              disabled={readOnly || scopeOptionsLoading}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">-- bitte waehlen --</option>
              {scopeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="admin-questions__form-field--wide">
          Beschreibung
          <input
            value={description}
            disabled={readOnly}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <SectionsEditor sections={sections} setSections={setSections} readOnly={readOnly} />
      </div>

      {!readOnly && (
        <div className="admin-questions__form-actions">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !scopeId || hasOverLimitSection}
          >
            Entwurf speichern
          </button>
        </div>
      )}
    </section>
  );
}
