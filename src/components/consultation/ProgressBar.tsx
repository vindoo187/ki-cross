/**
 * Rein darstellende Fortschrittsanzeige aus `QuestionnaireProgress`
 * (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3). Keine eigene Logik --
 * `percentComplete`/`canComplete` kommen bereits fertig berechnet vom Server
 * (`computeProgress()` in `src/server/questionnaire/path.ts`).
 */

import type { QuestionnaireProgress } from "@/server/questionnaire/path";

interface ProgressBarProps {
  progress: QuestionnaireProgress;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <div className="progress-bar" aria-label="Fortschritt">
      <div className="progress-bar__track">
        <div
          className="progress-bar__fill"
          style={{ width: `${progress.percentComplete}%` }}
          role="progressbar"
          aria-valuenow={progress.percentComplete}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="progress-bar__label">
        {progress.answeredVisibleQuestions} von {progress.totalVisibleQuestions} Fragen beantwortet
        {progress.requiredVisibleQuestions > 0 && (
          <>
            {" "}
            &middot; {progress.answeredRequiredVisibleQuestions} von{" "}
            {progress.requiredVisibleQuestions} Pflichtfragen
          </>
        )}
      </p>
    </div>
  );
}
