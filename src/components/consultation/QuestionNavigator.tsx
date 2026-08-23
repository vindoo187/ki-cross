/**
 * Liste aller sichtbaren Fragen mit Beantwortungsstatus, erlaubt Sprung zu
 * einer beliebigen Frage (auch bereits beantworteten -- Aenderung erfolgt
 * dann ueber `changeAnswer()`, siehe `QuestionFlow`). Siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3.
 */

import type { QuestionForAnswering } from "@/server/questionnaire/service";

interface QuestionNavigatorProps {
  questions: QuestionForAnswering[];
  activeQuestionId: string | null;
  onSelect: (questionId: string) => void;
}

export function QuestionNavigator({
  questions,
  activeQuestionId,
  onSelect,
}: QuestionNavigatorProps) {
  return (
    <nav className="question-navigator" aria-label="Fragen-Navigation">
      <ol className="question-navigator__list">
        {questions.map((question, index) => {
          const answered = question.currentAnswer !== null;
          const isActive = question.questionId === activeQuestionId;
          return (
            <li key={question.questionId}>
              <button
                type="button"
                className={[
                  "question-navigator__item",
                  answered ? "question-navigator__item--answered" : "",
                  isActive ? "question-navigator__item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={isActive ? "step" : undefined}
                onClick={() => onSelect(question.questionId)}
              >
                <span className="question-navigator__index">{index + 1}</span>
                <span className="question-navigator__label">{question.label}</span>
                {question.isRequired && !answered && (
                  <span
                    className="question-navigator__required"
                    aria-label="Pflichtfrage, unbeantwortet"
                  >
                    *
                  </span>
                )}
                {answered && (
                  <span className="question-navigator__check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
