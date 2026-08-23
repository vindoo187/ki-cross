/**
 * Komponententests fuer die Freitext-KI-Bestaetigungs-UX (Phase 12 AP3,
 * ChatGPT-GO 2026-08-23). Prueft ausschliesslich das UI-Verhalten der
 * KI-Vorschlags-Karte (`AiSuggestionCard`/`AiExtractionForm` in
 * `QuestionFlow.tsx`) -- die serverseitige Extraktions-/Validierungslogik ist
 * bereits in AP1/AP2 getestet (`tests/unit/extraction-validator.test.ts`,
 * `tests/integration/ai-extraction-route.test.ts`) und wird hier nicht
 * erneut geprueft.
 *
 * Kern-Invarianten laut ChatGPTs AP3-Leitplanken (siehe Modulkommentar in
 * `QuestionFlow.tsx`): kein automatisches Ausfuellen beim Eintreffen eines
 * Vorschlags, Uebernehmen/Aendern laufen ueber denselben `saveAnswer()`-
 * Request wie eine normale manuelle Eingabe, Verwerfen loest KEINEN
 * Answer-Request aus, ein Vorschlag bleibt bei einem Speicherfehler
 * bestehen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionFlow } from "@/components/consultation/QuestionFlow";
import {
  buildAiExtractionCandidate,
  buildProgress,
  buildQuestion,
  buildQuestionnaireState,
} from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Baut eine `fetch`-Mock-Implementierung, die anhand der URL unterscheidet. */
function mockFetchByUrl(handlers: {
  extraction?: (init?: RequestInit) => Response | Promise<Response>;
  answers?: (init?: RequestInit) => Response | Promise<Response>;
}) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/ai-extraction") && handlers.extraction) {
      return Promise.resolve(handlers.extraction(init));
    }
    if (url.includes("/answers") && handlers.answers) {
      return Promise.resolve(handlers.answers(init));
    }
    throw new Error(`Unerwarteter fetch-Aufruf: ${url}`);
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("QuestionFlow -- Freitext-KI-Panel (Phase 12 AP3)", () => {
  it("rendert das Panel NICHT, wenn aiExtractionAvailable nicht gesetzt ist (Default false)", () => {
    render(
      <QuestionFlow
        initialState={buildQuestionnaireState({
          visibleQuestions: [buildQuestion()],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    expect(screen.queryByLabelText("Freitext-KI-Angebot")).not.toBeInTheDocument();
  });

  it("rendert das Panel, wenn aiExtractionAvailable=true, und generiert Vorschlaege per Freitext", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    const candidate = buildAiExtractionCandidate({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      mockFetchByUrl({ extraction: () => jsonResponse({ candidates: [candidate] }) }),
    );
    render(
      <QuestionFlow
        aiExtractionAvailable
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    expect(screen.getByLabelText("Freitext-KI-Angebot")).toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText(/Der Kunde moechte/),
      "Der Kunde moechte Familientarif.",
    );
    await user.click(screen.getByRole("button", { name: "Vorschläge generieren" }));
    expect(await screen.findByText(/KI-Vorschlag:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ändern" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verwerfen" })).toBeInTheDocument();
  });

  it("'Übernehmen' speichert ueber den bestehenden saveAnswer()-Pfad, der Vorschlag verschwindet danach", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({
      questionId: "question-1",
      currentAnswer: null,
      currentAnswerVersion: null,
    });
    const candidate = buildAiExtractionCandidate({
      questionId: "question-1",
      choiceValues: ["family"],
    });
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      mockFetchByUrl({
        extraction: () => jsonResponse({ candidates: [candidate] }),
        answers: () =>
          jsonResponse({
            writeResult: {},
            state: buildQuestionnaireState({
              visibleQuestions: [
                buildQuestion({
                  questionId: "question-1",
                  currentAnswer: { choiceValues: ["family"] },
                  currentAnswerVersion: 1,
                }),
              ],
              progress: buildProgress({ nextQuestionId: null }),
            }),
          }),
      }),
    );
    render(
      <QuestionFlow
        aiExtractionAvailable
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Der Kunde moechte/), "Freitext");
    await user.click(screen.getByRole("button", { name: "Vorschläge generieren" }));
    await screen.findByText(/KI-Vorschlag:/);

    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/consultation/sessions/session-1/answers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ questionId: "question-1", value: { choiceValues: ["family"] } }),
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByText(/KI-Vorschlag:/)).not.toBeInTheDocument());
  });

  it("'Verwerfen' loest KEINEN Answer-Request aus und entfernt den Vorschlag lokal", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    const candidate = buildAiExtractionCandidate({ questionId: "question-1" });
    const extractionMock = vi.fn(() => jsonResponse({ candidates: [candidate] }));
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      mockFetchByUrl({ extraction: extractionMock }),
    );
    render(
      <QuestionFlow
        aiExtractionAvailable
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Der Kunde moechte/), "Freitext");
    await user.click(screen.getByRole("button", { name: "Vorschläge generieren" }));
    await screen.findByText(/KI-Vorschlag:/);

    await user.click(screen.getByRole("button", { name: "Verwerfen" }));

    expect(screen.queryByText(/KI-Vorschlag:/)).not.toBeInTheDocument();
    // Es duerfen ausschliesslich die Extraction-Aufrufe erfolgt sein --
    // insbesondere KEIN Aufruf gegen den `/answers`-Endpunkt.
    for (const call of (fetch as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toContain("/answers");
    }
  });

  it("ein Vorschlag bleibt bei einem Speicherfehler (422) sichtbar und wird NICHT stillschweigend als bestaetigt behandelt", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({ questionId: "question-1" });
    const candidate = buildAiExtractionCandidate({ questionId: "question-1" });
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      mockFetchByUrl({
        extraction: () => jsonResponse({ candidates: [candidate] }),
        answers: () =>
          jsonResponse({ issues: ["Wert liegt ausserhalb des zulaessigen Bereichs."] }, 422),
      }),
    );
    render(
      <QuestionFlow
        aiExtractionAvailable
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Der Kunde moechte/), "Freitext");
    await user.click(screen.getByRole("button", { name: "Vorschläge generieren" }));
    await screen.findByText(/KI-Vorschlag:/);

    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    await screen.findByRole("alert");
    expect(screen.getByText(/KI-Vorschlag:/)).toBeInTheDocument();
  });

  it("'Ändern' befuellt das Fragefeld mit dem Vorschlagswert, ohne selbst zu speichern -- erst die eigene Interaktion loest den bestehenden saveAnswer()-Pfad aus", async () => {
    const user = userEvent.setup();
    const question = buildQuestion({
      questionId: "question-1",
      currentAnswer: null,
      currentAnswerVersion: null,
    });
    const candidate = buildAiExtractionCandidate({
      questionId: "question-1",
      choiceValues: ["family"],
    });
    const extractionMock = vi.fn(() => jsonResponse({ candidates: [candidate] }));
    const answersMock = vi.fn(() =>
      jsonResponse({
        writeResult: {},
        state: buildQuestionnaireState({
          visibleQuestions: [
            buildQuestion({
              questionId: "question-1",
              currentAnswer: { choiceValues: ["one"] },
              currentAnswerVersion: 1,
            }),
          ],
          progress: buildProgress({ nextQuestionId: null }),
        }),
      }),
    );
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      mockFetchByUrl({ extraction: extractionMock, answers: answersMock }),
    );
    render(
      <QuestionFlow
        aiExtractionAvailable
        initialState={buildQuestionnaireState({
          visibleQuestions: [question],
          progress: buildProgress({ nextQuestionId: "question-1" }),
        })}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Der Kunde moechte/), "Freitext");
    await user.click(screen.getByRole("button", { name: "Vorschläge generieren" }));
    await screen.findByText(/KI-Vorschlag:/);

    await user.click(screen.getByRole("button", { name: "Ändern" }));

    // Kein Answer-Request nur durch den Klick auf "Aendern" selbst.
    expect(answersMock).not.toHaveBeenCalled();
    // Das Fragefeld zeigt jetzt den Vorschlagswert vorausgefuellt an.
    expect(screen.getByLabelText("Familie")).toBeChecked();

    // Der Mitarbeiter waehlt bewusst einen ANDEREN Wert -- das ist die
    // eigentliche, explizite Speicheraktion ueber den normalen Fragefeld-Pfad.
    await user.click(screen.getByLabelText("Eine Person"));

    await waitFor(() => expect(answersMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/KI-Vorschlag:/)).not.toBeInTheDocument());
  });
});
