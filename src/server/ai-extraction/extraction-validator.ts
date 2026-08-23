/**
 * ChatGPT-Schicht 4 "Server Validation" (Phase 12 AP1, siehe
 * PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 3 + Abschnitt 2). Prueft
 * JEDEN von einem `AiExtractionProvider` zurueckgegebenen Kandidaten, BEVOR er
 * dem Mitarbeiter angezeigt wird -- ein Provider ist nicht vertrauenswuerdig
 * (Defense-in-Depth, analog `goal-validator.ts`/`commission-validator.ts`).
 * Ungueltige/unsichere Kandidaten werden VERWORFEN, nicht angezeigt (ChatGPT-
 * Grundsatz: "lieber keinen Vorschlag als einen falschen").
 *
 * Wiederverwendet bewusst `validateAnswerInput()` aus der bestehenden
 * Fragen-Engine (`../questionnaire/answer-validation.ts`) fuer die
 * typ-/bereichsspezifische Pruefung (AnswerType-Konsistenz, min/max,
 * AnswerOption-Gueltigkeit, Auswahlgrenzen) -- KEINE Duplikation dieser
 * bereits vorhandenen, getesteten Logik. Zusaetzlich zur reinen
 * Wertepruefung erzwingt dieser Validator drei extraktionsspezifische
 * Regeln, die `validateAnswerInput()` nicht kennt:
 * 1. `questionId` muss im uebergebenen (bereits serverseitig gefilterten)
 *    sichtbaren Fragenkatalog vorkommen -- ein Provider darf keine
 *    fragebogen-fremde/nicht-sichtbare Frage adressieren (IDOR-aehnlicher
 *    Schutz, analog der harten Sicherheitsgrenze aus
 *    `visible-question-context.ts`).
 * 2. `answerType` im Kandidaten muss exakt zum tatsaechlichen `answerType`
 *    der Zielfrage passen (ein Provider koennte sonst z. B. fuer eine
 *    SINGLE_CHOICE-Frage einen `booleanValue` unterschieben).
 * 3. Mehrdeutigkeit wird konsequent verworfen (ChatGPT-Entscheidung 5): liefert
 *    ein Provider MEHR ALS EINEN Kandidaten fuer dieselbe Frage, werden ALLE
 *    Kandidaten dieser Frage verworfen (keine Ratewahl zwischen ihnen).
 */

import { hasAnswerValue, validateAnswerInput } from "../questionnaire/answer-validation";
import { InvalidAnswerError } from "../questionnaire/errors";
import type { AnswerValueInput, QuestionVersionConstraints } from "../questionnaire/types";
import type { AiExtractionCandidate, AiExtractionVisibleQuestion } from "./types";

export interface RejectedExtractionCandidate {
  questionId: string;
  reasons: string[];
}

export interface ExtractionValidationResult {
  /** Kandidaten, die alle Pruefungen bestanden haben -- diese duerfen dem Mitarbeiter angezeigt werden. */
  accepted: AiExtractionCandidate[];
  /** Verworfene Kandidaten inkl. Begruendung (fuer Tests/Diagnose, NICHT fuer die Mitarbeiteransicht bestimmt). */
  rejected: RejectedExtractionCandidate[];
}

function toQuestionVersionConstraints(
  question: AiExtractionVisibleQuestion,
): QuestionVersionConstraints {
  return {
    id: question.questionId,
    answerType: question.answerType,
    // isRequired fliesst in validateAnswerInput() nicht in die Wertepruefung
    // ein (Pflichtfeld-Pruefung erfolgt an anderer Stelle im normalen
    // Fragen-Flow, siehe answer-validation.ts-Modulkommentar) -- Platzhalter.
    isRequired: false,
    minValue: question.minValue,
    maxValue: question.maxValue,
    maxLength: question.maxLength,
    minSelections: question.minSelections,
    maxSelections: question.maxSelections,
    answerOptions: question.answerOptions,
  };
}

function toAnswerValueInput(candidate: AiExtractionCandidate): AnswerValueInput {
  return {
    integerValue: candidate.integerValue ?? null,
    decimalValue: candidate.decimalValue ?? null,
    booleanValue: candidate.booleanValue ?? null,
    dateValue: candidate.dateValue ?? null,
    choiceValues: candidate.choiceValues ?? [],
  };
}

/**
 * Validiert `rawCandidates` gegen `visibleQuestions` (siehe
 * `visible-question-context.ts` -- MUSS derselbe, serverseitig ermittelte
 * Katalog sein, der auch an den Provider ging). Reine Funktion, kein
 * DB-Zugriff, wirft nichts -- ungueltige Kandidaten landen in `rejected`
 * statt eine Exception auszuloesen (ein einzelner schlechter Kandidat darf
 * die restliche Extraktion nicht abbrechen).
 */
export function validateExtractionCandidates(
  visibleQuestions: AiExtractionVisibleQuestion[],
  rawCandidates: AiExtractionCandidate[],
): ExtractionValidationResult {
  const byQuestionId = new Map(visibleQuestions.map((q) => [q.questionId, q]));

  const countByQuestionId = new Map<string, number>();
  for (const candidate of rawCandidates) {
    countByQuestionId.set(
      candidate.questionId,
      (countByQuestionId.get(candidate.questionId) ?? 0) + 1,
    );
  }

  const accepted: AiExtractionCandidate[] = [];
  const rejected: RejectedExtractionCandidate[] = [];

  for (const candidate of rawCandidates) {
    const reasons: string[] = [];

    if ((countByQuestionId.get(candidate.questionId) ?? 0) > 1) {
      reasons.push(
        `Mehrdeutig: mehrere Kandidaten fuer dieselbe Frage "${candidate.questionId}" -- wird verworfen statt geraten.`,
      );
      rejected.push({ questionId: candidate.questionId, reasons });
      continue;
    }

    const question = byQuestionId.get(candidate.questionId);
    if (!question) {
      reasons.push(
        `Frage "${candidate.questionId}" ist nicht im sichtbaren, unbeantworteten Fragenkatalog dieser Session.`,
      );
      rejected.push({ questionId: candidate.questionId, reasons });
      continue;
    }

    if (candidate.answerType !== question.answerType) {
      reasons.push(
        `answerType "${candidate.answerType}" passt nicht zum tatsaechlichen Typ "${question.answerType}" der Frage.`,
      );
      rejected.push({ questionId: candidate.questionId, reasons });
      continue;
    }

    const valueInput = toAnswerValueInput(candidate);

    if (!hasAnswerValue(valueInput)) {
      reasons.push("Kandidat enthaelt keinen gesetzten Wert.");
      rejected.push({ questionId: candidate.questionId, reasons });
      continue;
    }

    try {
      validateAnswerInput(toQuestionVersionConstraints(question), valueInput);
    } catch (err) {
      reasons.push(err instanceof InvalidAnswerError ? err.issues.join("; ") : String(err));
      rejected.push({ questionId: candidate.questionId, reasons });
      continue;
    }

    accepted.push(candidate);
  }

  return { accepted, rejected };
}
