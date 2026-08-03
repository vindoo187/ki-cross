"use client";

/**
 * Dispatcht eine `QuestionForAnswering` anhand ihres `answerType` auf die
 * passende Unterkomponente aus `QuestionInputs.tsx` (siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3). Enthaelt selbst keine
 * Eingabelogik.
 */

import type { QuestionForAnswering } from "@/server/questionnaire/service";
import type { AnswerValueInput } from "@/server/questionnaire/types";
import {
  BooleanInput,
  DateInput,
  DecimalInput,
  IntegerInput,
  MultipleChoiceInput,
  ShortTextInput,
  SingleChoiceInput,
} from "./QuestionInputs";

interface QuestionRendererProps {
  question: QuestionForAnswering;
  value: AnswerValueInput | null;
  onCommit: (value: AnswerValueInput) => void;
  onLocalEdit: () => void;
  disabled: boolean;
}

export function QuestionRenderer({
  question,
  value,
  onCommit,
  onLocalEdit,
  disabled,
}: QuestionRendererProps) {
  switch (question.answerType) {
    case "SINGLE_CHOICE":
      return (
        <SingleChoiceInput
          question={question}
          value={value}
          onCommit={onCommit}
          disabled={disabled}
        />
      );
    case "MULTIPLE_CHOICE":
      return (
        <MultipleChoiceInput
          question={question}
          value={value}
          onCommit={onCommit}
          disabled={disabled}
        />
      );
    case "BOOLEAN":
      return (
        <BooleanInput question={question} value={value} onCommit={onCommit} disabled={disabled} />
      );
    case "INTEGER":
      return (
        <IntegerInput
          question={question}
          value={value}
          onCommit={onCommit}
          onLocalEdit={onLocalEdit}
          disabled={disabled}
        />
      );
    case "DECIMAL":
      return (
        <DecimalInput
          question={question}
          value={value}
          onCommit={onCommit}
          onLocalEdit={onLocalEdit}
          disabled={disabled}
        />
      );
    case "SHORT_TEXT":
      return (
        <ShortTextInput
          question={question}
          value={value}
          onCommit={onCommit}
          onLocalEdit={onLocalEdit}
          disabled={disabled}
        />
      );
    case "DATE":
      return (
        <DateInput question={question} value={value} onCommit={onCommit} disabled={disabled} />
      );
    default: {
      // Erschoepfende switch-Pruefung: bei neuem AnswerType faellt dies zur
      // Compile-Zeit auf, falls ein Fall vergessen wurde.
      const exhaustiveCheck: never = question.answerType;
      throw new Error(`Unbekannter AnswerType: ${String(exhaustiveCheck)}`);
    }
  }
}
