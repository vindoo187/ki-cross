/**
 * Komponententests fuer alle 7 Antworttyp-Eingaben aus `QuestionInputs.tsx`
 * (AP12, ChatGPT-Vorgabe Punkt 2: "alle 7 Antworttypen" muessen abgedeckt
 * sein). Getestet wird ausschliesslich das Interaktionsverhalten
 * (Auswahl/Eingabe -> `onCommit`) sowie einfache Bedienbarkeits-Constraints
 * (`type="number"`, `maxLength`) -- KEINE fachliche Validierung (liegt laut
 * Modulkommentar bewusst beim Server, siehe `answer-validation.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BooleanInput,
  DateInput,
  DecimalInput,
  IntegerInput,
  MultipleChoiceInput,
  ShortTextInput,
  SingleChoiceInput,
} from "@/components/consultation/QuestionInputs";
import { buildQuestion } from "./fixtures";

/**
 * Debounce-Tests (Integer/Decimal/ShortText) nutzen bewusst ECHTE Timer statt
 * `vi.useFakeTimers()`: Die Kombination aus fake timers und
 * `@testing-library/user-event`s internem Event-Scheduling fuehrt in dieser
 * Konstellation (Vitest 3.2.7 / user-event 14.6.1 / React 19) zu haengenden
 * Tests (`await user.type()` loest nie auf). `waitFor` mit erhoehtem Timeout
 * ist die robustere Variante fuer den Debounce (Fix 8, ChatGPT-Konsultation
 * 2026-08-11: DEBOUNCE_MS 500 -> 1000ms, Timeouts hier entsprechend erhoeht).
 */

describe("SingleChoiceInput", () => {
  it("committet sofort bei Auswahl (kein Debounce)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <SingleChoiceInput
        question={buildQuestion({ answerType: "SINGLE_CHOICE" })}
        value={null}
        onCommit={onCommit}
        disabled={false}
      />,
    );
    await user.click(screen.getByLabelText("Familie"));
    expect(onCommit).toHaveBeenCalledWith({ choiceValues: ["family"] });
  });

  it("zeigt die bereits gewaehlte Option als checked", () => {
    render(
      <SingleChoiceInput
        question={buildQuestion()}
        value={{ choiceValues: ["one"] }}
        onCommit={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByLabelText("Eine Person")).toBeChecked();
  });

  it("deaktiviert alle Optionen im disabled-Zustand (In-Flight-Lock)", () => {
    render(
      <SingleChoiceInput
        question={buildQuestion()}
        value={null}
        onCommit={vi.fn()}
        disabled={true}
      />,
    );
    expect(screen.getByLabelText("Eine Person")).toBeDisabled();
    expect(screen.getByLabelText("Familie")).toBeDisabled();
  });
});

describe("MultipleChoiceInput", () => {
  it("fuegt eine Option hinzu und entfernt sie bei erneutem Klick wieder", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const question = buildQuestion({ answerType: "MULTIPLE_CHOICE" });
    const { rerender } = render(
      <MultipleChoiceInput question={question} value={null} onCommit={onCommit} disabled={false} />,
    );
    await user.click(screen.getByLabelText("Eine Person"));
    expect(onCommit).toHaveBeenLastCalledWith({ choiceValues: ["one"] });

    rerender(
      <MultipleChoiceInput
        question={question}
        value={{ choiceValues: ["one"] }}
        onCommit={onCommit}
        disabled={false}
      />,
    );
    await user.click(screen.getByLabelText("Eine Person"));
    expect(onCommit).toHaveBeenLastCalledWith({ choiceValues: [] });
  });
});

describe("BooleanInput", () => {
  it("committet 'Ja'/'Nein' als booleanValue", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <BooleanInput
        question={buildQuestion({ answerType: "BOOLEAN" })}
        value={null}
        onCommit={onCommit}
        disabled={false}
      />,
    );
    await user.click(screen.getByLabelText("Nein"));
    expect(onCommit).toHaveBeenCalledWith({ booleanValue: false });
  });

  it("zeigt den aktuellen booleanValue als checked", () => {
    render(
      <BooleanInput
        question={buildQuestion({ answerType: "BOOLEAN" })}
        value={{ booleanValue: true }}
        onCommit={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByLabelText("Ja")).toBeChecked();
  });
});

describe("IntegerInput", () => {
  it("hat type=number, min/max aus der Frage, und debouncet den Commit (~1000ms)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onLocalEdit = vi.fn();
    const question = buildQuestion({ answerType: "INTEGER", minValue: "0", maxValue: "10" });
    render(
      <IntegerInput
        question={question}
        value={null}
        onCommit={onCommit}
        onLocalEdit={onLocalEdit}
        disabled={false}
      />,
    );
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "10");

    await user.type(input, "4");
    expect(onLocalEdit).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ integerValue: 4 }), {
      timeout: 3000,
    });
  }, 15000);
});

describe("DecimalInput", () => {
  it("committet einen Dezimalwert als String nach Debounce", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <DecimalInput
        question={buildQuestion({ answerType: "DECIMAL" })}
        value={null}
        onCommit={onCommit}
        onLocalEdit={vi.fn()}
        disabled={false}
      />,
    );
    const input = screen.getByRole("spinbutton");
    await user.type(input, "12.5");
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ decimalValue: "12.5" }), {
      timeout: 3000,
    });
  }, 15000);
});

describe("ShortTextInput", () => {
  it("respektiert maxLength und committet Freitext nach Debounce", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ShortTextInput
        question={buildQuestion({ answerType: "SHORT_TEXT", maxLength: 5 })}
        value={null}
        onCommit={onCommit}
        onLocalEdit={vi.fn()}
        disabled={false}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("maxLength", "5");
    await user.type(input, "Hallo");
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ freeTextValue: "Hallo" }), {
      timeout: 3000,
    });
  }, 15000);
});

describe("DateInput", () => {
  it("committet sofort bei Datumsauswahl (kein Debounce)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <DateInput
        question={buildQuestion({ answerType: "DATE" })}
        value={null}
        onCommit={onCommit}
        disabled={false}
      />,
    );
    const input = screen.getByDisplayValue("");
    await user.type(input, "2026-08-01");
    expect(onCommit).toHaveBeenLastCalledWith({ dateValue: "2026-08-01" });
  });
});
