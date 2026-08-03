/**
 * Komponententests fuer `QuestionNavigator.tsx` (AP12, ChatGPT-Vorgabe
 * Punkt 2: Basis-Tastatur-/Fokus-Bedienbarkeit -- Navigation besteht aus
 * echten `<button>`-Elementen und ist damit per Tastatur erreichbar;
 * getestet wird hier das Auswahlverhalten und die Status-Darstellung
 * (beantwortet/aktiv/Pflichtfrage).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionNavigator } from "@/components/consultation/QuestionNavigator";
import { buildQuestion } from "./fixtures";

describe("QuestionNavigator", () => {
  const questions = [
    buildQuestion({ questionId: "q1", label: "Frage 1", isRequired: true, currentAnswer: null }),
    buildQuestion({
      questionId: "q2",
      label: "Frage 2",
      isRequired: false,
      currentAnswer: { choiceValues: ["one"] },
    }),
  ];

  it("ruft onSelect mit der questionId der angeklickten Frage auf", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<QuestionNavigator questions={questions} activeQuestionId="q1" onSelect={onSelect} />);
    await user.click(screen.getByText("Frage 2"));
    expect(onSelect).toHaveBeenCalledWith("q2");
  });

  it("markiert die aktive Frage per aria-current", () => {
    render(<QuestionNavigator questions={questions} activeQuestionId="q1" onSelect={vi.fn()} />);
    expect(screen.getByText("Frage 1").closest("button")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Frage 2").closest("button")).not.toHaveAttribute("aria-current");
  });

  it("zeigt das Pflichtfrage-Sternchen nur bei unbeantworteten Pflichtfragen", () => {
    render(<QuestionNavigator questions={questions} activeQuestionId="q1" onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Pflichtfrage, unbeantwortet")).toBeInTheDocument();
  });

  it("zeigt ein Haekchen bei beantworteten Fragen", () => {
    render(<QuestionNavigator questions={questions} activeQuestionId="q1" onSelect={vi.fn()} />);
    const answeredButton = screen.getByText("Frage 2").closest("button");
    expect(answeredButton).toHaveTextContent("✓");
  });
});
