/**
 * Komponententests fuer `QuestionRenderer.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "alle 7 Antworttypen"). Reiner Dispatch nach `answerType` (siehe
 * Modulkommentar) -- die eigentliche Eingabelogik pro Typ ist bereits in
 * `QuestionInputs.test.tsx` abgedeckt, hier wird nur geprueft, dass jeder
 * Typ auf die richtige Unterkomponente (anhand ihres charakteristischen
 * DOM-Elements) gemappt wird.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionRenderer } from "@/components/consultation/QuestionRenderer";
import { buildQuestion } from "./fixtures";
import type { QuestionForAnswering } from "@/server/questionnaire/service";

function renderQuestion(overrides: Partial<QuestionForAnswering>) {
  render(
    <QuestionRenderer
      question={buildQuestion(overrides)}
      value={null}
      onCommit={vi.fn()}
      onLocalEdit={vi.fn()}
      disabled={false}
    />,
  );
}

describe("QuestionRenderer", () => {
  it("rendert SingleChoiceInput (Radiobuttons) bei SINGLE_CHOICE", () => {
    renderQuestion({
      answerType: "SINGLE_CHOICE",
      answerOptions: [{ key: "one", label: "Eine Person" }],
    });
    expect(screen.getByRole("radio", { name: "Eine Person" })).toBeInTheDocument();
  });

  it("rendert MultipleChoiceInput (Checkboxen) bei MULTIPLE_CHOICE", () => {
    renderQuestion({
      answerType: "MULTIPLE_CHOICE",
      answerOptions: [{ key: "one", label: "Eine Person" }],
    });
    expect(screen.getByRole("checkbox", { name: "Eine Person" })).toBeInTheDocument();
  });

  it("rendert BooleanInput (Ja/Nein) bei BOOLEAN", () => {
    renderQuestion({ answerType: "BOOLEAN", answerOptions: [] });
    expect(screen.getByRole("radio", { name: "Ja" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Nein" })).toBeInTheDocument();
  });

  it("rendert IntegerInput (type=number, inputmode=numeric) bei INTEGER", () => {
    renderQuestion({ answerType: "INTEGER", answerOptions: [] });
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("rendert DecimalInput (type=number, inputmode=decimal) bei DECIMAL", () => {
    renderQuestion({ answerType: "DECIMAL", answerOptions: [] });
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("rendert ShortTextInput (type=text) bei SHORT_TEXT", () => {
    renderQuestion({ answerType: "SHORT_TEXT", answerOptions: [] });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("rendert DateInput (type=date) bei DATE", () => {
    renderQuestion({ answerType: "DATE", answerOptions: [] });
    expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
  });
});
