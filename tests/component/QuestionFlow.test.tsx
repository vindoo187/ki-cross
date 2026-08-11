/**
 * Komponententests fuer `QuestionFlow.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "Progress-Anzeige, Lade-/Speicher-/Fehlerzustaende, Versionskonflikt,
 * Empfehlungsdarstellungs-Platzhalter, einfaches Tastatur-/Fokus-Handling").
 * Der Reducer selbst (siehe Modulkommentar in `QuestionFlow.tsx`) wird nur
 * indirekt ueber sichtbares Verhalten geprueft -- die fachliche
 * Antwortvalidierung/Versionspruefung bleibt serverseitig
 * (`answer-validation.ts`) und wird hier nicht erneut getestet; es wird nur
 * geprueft, dass die Komponente auf 422/409/Netzwerkfehler-Antworten korrekt
 * reagiert. `useRouter` gemockt, `fetch` global gemockt (siehe uebrige
 * Komponententests fuer das Muster).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionFlow } from "@/components/consultation/QuestionFlow";
import { buildProgress, buildQuestion, buildQuestionnaireState } from "./fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuestionFlow", () => {
  it("zeigt initial die naechste offene Frage (progress.nextQuestionId) mit Pflichtfrage-Markierung", () => {
    const question1 = buildQuestion({ questionId: "question-1", label: "Frage eins" });
    const question2 = buildQuestion({
      questionId: "question-2",
      label: "Frage zwei",
      isRequired: true,
    });
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: /Frage zwei/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Pflichtfrage")).toBeInTheDocument();
  });

  it("zeigt 'Keine weiteren sichtbaren Fragen.', wenn keine aktive Frage vorhanden ist", () => {
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [],
          progress: buildProgress({ nextQuestionId: null, totalVisibleQuestions: 0 }),
        })}
      />,
    );
    expect(screen.getByText("Keine weiteren sichtbaren Fragen.")).toBeInTheDocument();
  });

  it("wechselt per Klick in der Navigation die aktive Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({ questionId: "question-1", label: "Frage eins" });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: /Frage zwei/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Frage eins/ }));
    expect(screen.getByRole("heading", { name: /Frage eins/ })).toBeInTheDocument();
  });

  it("sendet POST ohne currentAnswerVersion und uebernimmt den Server-Zustand nach Erfolg", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({
      questionId: "question-1",
      currentAnswer: null,
      currentAnswerVersion: null,
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question],
          // Fix 7: nextQuestionId bewusst null (keine weitere sichtbare Frage
          // in diesem Ein-Fragen-Fixture), damit dieser Test weiterhin die
          // unveraenderte activeQuestionId prueft statt Auto-Advance.
          progress: buildProgress({ nextQuestionId: null }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/consultation/sessions/session-1/answers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ questionId: "question-1", value: { choiceValues: ["family"] } }),
        }),
      ),
    );
    expect(await screen.findByText("Gespeichert")).toBeInTheDocument();
  });

  it("sendet PATCH mit expectedAnswerVersion, wenn bereits eine Antwort existiert", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({
      questionId: "question-1",
      currentAnswer: { choiceValues: ["one"] },
      currentAnswerVersion: 1,
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: null }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/consultation/sessions/session-1/answers",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            questionId: "question-1",
            value: { choiceValues: ["family"] },
            expectedAnswerVersion: 1,
          }),
        }),
      ),
    );
  });

  it("zeigt Validierungsfehler (422) als role=alert Liste", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ issues: ["Wert liegt ausserhalb des zulaessigen Bereichs."] }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wert liegt ausserhalb des zulaessigen Bereichs.",
    );
  });

  it("zeigt ConflictBanner bei 409 und laedt den aktuellen Stand bei Klick auf 'Aktuellen Stand neu laden'", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: "Antwort wurde zwischenzeitlich geaendert." }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildQuestionnaireState({ visibleQuestions: [question], progress: buildProgress() }),
      } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diese Antwort wurde zwischenzeitlich anderswo geaendert",
    );
    await user.click(screen.getByRole("button", { name: "Aktuellen Stand neu laden" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith("/api/consultation/sessions/session-1"),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("zeigt OfflineBanner bei Netzwerkfehler und wiederholt den Request bei Klick auf 'Erneut speichern'", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          writeResult: {},
          state: buildQuestionnaireState({
            visibleQuestions: [question],
            // Fix 7: nextQuestionId bewusst null (keine weitere sichtbare Frage in diesem Ein-Fragen-Fixture), damit dieser Test weiterhin die unveraenderte activeQuestionId prueft statt Auto-Advance.
            progress: buildProgress({ nextQuestionId: null }),
          }),
        }),
      } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    expect(await screen.findByText(/Speichern fehlgeschlagen/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Erneut speichern" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Gespeichert")).toBeInTheDocument());
  });

  it("zeigt den Abschluss-Button nur, wenn canComplete=true, und wechselt bei Erfolg in den Abschluss-Zustand", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ endedAt: "2026-08-03T10:00:00.000Z" }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1", canComplete: true }),
        })}
      />,
    );
    const completeButton = screen.getByRole("button", { name: "Fragebogen abschliessen" });
    await user.click(completeButton);
    expect(
      await screen.findByRole("heading", { name: "Fragebogen abgeschlossen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zur Zusammenfassung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zur Empfehlung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zurueck zur Uebersicht" })).toBeInTheDocument();
  });

  it("versteckt den Abschluss-Button, wenn canComplete=false", () => {
    const question = buildQuestion({ questionId: "question-1" });
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1", canComplete: false }),
        })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Fragebogen abschliessen" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt eine Fehlermeldung, wenn der Abschluss fehlschlaegt, ohne den Zustand zu wechseln", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Es sind noch Pflichtfragen offen." }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1", canComplete: true }),
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Fragebogen abschliessen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Es sind noch Pflichtfragen offen.");
    expect(screen.getByRole("button", { name: "Fragebogen abschliessen" })).toBeInTheDocument();
  });

  it("navigiert aus dem Abschluss-Zustand ueber die drei Buttons", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ endedAt: "2026-08-03T10:00:00.000Z" }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1", canComplete: true }),
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Fragebogen abschliessen" }));
    await user.click(await screen.findByRole("button", { name: "Zur Zusammenfassung" }));
    expect(push).toHaveBeenCalledWith("/consultation/session-1/summary");
  });

  it("bewegt den Fokus nach erfolgreichem Speichern zur Frageueberschrift (Fokus-Management)", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question],
          // Fix 7: nextQuestionId bewusst null (keine weitere sichtbare Frage in diesem Ein-Fragen-Fixture), damit dieser Test weiterhin die unveraenderte activeQuestionId prueft statt Auto-Advance.
          progress: buildProgress({ nextQuestionId: null }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Wie viele Personen/ })).toHaveFocus(),
    );
  });
});

/**
 * Fix 7 (ChatGPT-Konsultation 2026-08-11): Auto-Weiterspringen zur naechsten
 * Frage nach erfolgreichem Speichern. Testmatrix laut ChatGPT-GO: BOOLEAN/
 * SINGLE_CHOICE/DATE springen automatisch weiter (nutzen dazu bewusst das
 * bereits vom Server berechnete `progress.nextQuestionId`, siehe
 * Modulkommentar in `QuestionFlow.tsx`); MULTIPLE_CHOICE und die debounceten
 * Freitext-/Zahlenfelder springen NICHT automatisch weiter, da ein einzelner
 * Commit dort keine abgeschlossene Entscheidung darstellt; die letzte Frage
 * (kein `nextQuestionId`) bleibt unveraendert aktiv; wird durch die gerade
 * gespeicherte Antwort eine Folgefrage unsichtbar, springt Auto-Advance zur
 * tatsaechlich naechsten sichtbaren Frage laut Server, nicht zu einer
 * inzwischen unsichtbaren.
 */
describe("QuestionFlow -- Fix 7 Auto-Advance", () => {
  it("BOOLEAN: springt nach erfolgreichem Speichern automatisch zur naechsten Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({
      questionId: "question-1",
      label: "Frage eins",
      answerType: "BOOLEAN",
    });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Ja"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Frage zwei/ })).toBeInTheDocument(),
    );
  });

  it("SINGLE_CHOICE: springt nach erfolgreichem Speichern automatisch zur naechsten Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({ questionId: "question-1", label: "Frage eins" });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Frage zwei/ })).toBeInTheDocument(),
    );
  });

  it("DATE: springt nach erfolgreichem Speichern automatisch zur naechsten Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({
      questionId: "question-1",
      label: "Frage eins",
      answerType: "DATE",
    });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.type(screen.getByDisplayValue(""), "2026-08-01");
    await waitFor(
      () => expect(screen.getByRole("heading", { name: /Frage zwei/ })).toBeInTheDocument(),
      { timeout: 2000 },
    );
  });

  it("MULTIPLE_CHOICE: bleibt nach der ersten Checkbox-Auswahl auf derselben Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({
      questionId: "question-1",
      label: "Frage eins",
      answerType: "MULTIPLE_CHOICE",
      minSelections: 1,
      maxSelections: 3,
    });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Eine Person"));
    await waitFor(() => expect(screen.getByText("Gespeichert")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Frage eins/ })).toBeInTheDocument();
  });

  it("MULTIPLE_CHOICE: bleibt auch nach der zweiten Checkbox-Auswahl auf derselben Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({
      questionId: "question-1",
      label: "Frage eins",
      answerType: "MULTIPLE_CHOICE",
      minSelections: 1,
      maxSelections: 3,
      currentAnswer: { choiceValues: ["one"] },
      currentAnswerVersion: 1,
    });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() => expect(screen.getByText("Gespeichert")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Frage eins/ })).toBeInTheDocument();
  });

  it("SHORT_TEXT: bleibt nach dem debounceten Speichern auf derselben Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({
      questionId: "question-1",
      label: "Frage eins",
      answerType: "SHORT_TEXT",
      answerOptions: [],
    });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-2" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.type(screen.getByLabelText("Frage eins"), "Notiz");
    await waitFor(() => expect(screen.getByText("Gespeichert")).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByRole("heading", { name: /Frage eins/ })).toBeInTheDocument();
  });

  it("letzte Frage (kein nextQuestionId): bleibt nach dem Speichern unveraendert aktiv", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1", label: "Frage eins" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: null }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() => expect(screen.getByText("Gespeichert")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Frage eins/ })).toBeInTheDocument();
  });

  it("springt bei einer durch die Antwort unsichtbar gewordenen Folgefrage zur tatsaechlich naechsten sichtbaren Frage", async () => {
    const user = userEvent.setup();
    const question1 = buildQuestion({ questionId: "question-1", label: "Frage eins" });
    const question2 = buildQuestion({ questionId: "question-2", label: "Frage zwei" });
    const question3 = buildQuestion({ questionId: "question-3", label: "Frage drei" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        writeResult: {},
        // question-2 ist nach der gerade gespeicherten Antwort nicht mehr
        // sichtbar (z. B. durch eine Sichtbarkeitsbedingung deaktiviert) --
        // question-3 ist die tatsaechlich naechste sichtbare Frage.
        state: buildQuestionnaireState({
          visibleQuestions: [question1, question3],
          progress: buildProgress({ nextQuestionId: "question-3" }),
        }),
      }),
    } as Response);
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [question1, question2, question3],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Frage drei/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: /Frage zwei/ })).not.toBeInTheDocument();
  });
});
