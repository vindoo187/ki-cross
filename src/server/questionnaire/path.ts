/**
 * Reine Pfad-/Fortschrittsberechnung (kein DB-Zugriff): bestimmt, welche
 * Fragen aktuell sichtbar sind, welche davon noch unbeantwortet sind, und ob
 * der Fragebogen abgeschlossen werden darf.
 *
 * Sichtbarkeit haengt ausschliesslich von bereits bekannten Antworten ab
 * (siehe `isQuestionVisible` in visibility.ts), NICHT von der Sichtbarkeit
 * anderer Fragen - eine topologische Auswertungsreihenfolge ist daher fuer
 * Korrektheit nicht noetig; `sortOrder` steuert nur die Anzeige-/
 * Bearbeitungsreihenfolge.
 */

import { isQuestionVisible } from "./visibility";
import type { AnsweredValue, QuestionNode } from "./types";

export interface VisibleQuestionSummary {
  questionId: string;
  sortOrder: number;
  isRequired: boolean;
  isAnswered: boolean;
}

export interface QuestionnaireProgress {
  totalVisibleQuestions: number;
  answeredVisibleQuestions: number;
  requiredVisibleQuestions: number;
  answeredRequiredVisibleQuestions: number;
  /** 0..100, Anteil beantworteter an allen sichtbaren Fragen (nicht nur Pflichtfragen). */
  percentComplete: number;
  /** Erste unbeantwortete sichtbare Frage in sortOrder-Reihenfolge, oder null. */
  nextQuestionId: string | null;
  /** Sichtbare, unbeantwortete PFLICHTfragen - blockieren den Abschluss. */
  missingRequiredQuestionIds: string[];
  canComplete: boolean;
}

/** Berechnet den aktuell sichtbaren Pfad, sortiert nach `sortOrder`. */
export function computeVisiblePath(
  nodes: QuestionNode[],
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>,
): VisibleQuestionSummary[] {
  return nodes
    .filter((node) => isQuestionVisible(node, answersByQuestionId))
    .map((node) => ({
      questionId: node.questionId,
      sortOrder: node.sortOrder,
      isRequired: node.activeVersion.isRequired,
      isAnswered: answersByQuestionId.get(node.questionId)?.isAnswered === true,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Aggregiert einen bereits berechneten sichtbaren Pfad zu einer Fortschrittsuebersicht. */
export function computeProgress(visiblePath: VisibleQuestionSummary[]): QuestionnaireProgress {
  const total = visiblePath.length;
  const answered = visiblePath.filter((q) => q.isAnswered).length;
  const required = visiblePath.filter((q) => q.isRequired);
  const answeredRequired = required.filter((q) => q.isAnswered).length;
  const missingRequiredQuestionIds = required.filter((q) => !q.isAnswered).map((q) => q.questionId);
  const nextQuestionId = visiblePath.find((q) => !q.isAnswered)?.questionId ?? null;
  const percentComplete = total === 0 ? 100 : Math.round((answered / total) * 100);

  return {
    totalVisibleQuestions: total,
    answeredVisibleQuestions: answered,
    requiredVisibleQuestions: required.length,
    answeredRequiredVisibleQuestions: answeredRequired,
    percentComplete,
    nextQuestionId,
    missingRequiredQuestionIds,
    canComplete: missingRequiredQuestionIds.length === 0,
  };
}

/**
 * Vergleicht den sichtbaren Pfad vor und nach einer Antwortaenderung: Fragen,
 * die vorher sichtbar UND beantwortet waren, jetzt aber nicht mehr sichtbar
 * sind, muessen laut Vorgabe deaktiviert werden (`CustomerAnswer.isActive =
 * false`), damit sie weder in Fortschritt noch spaeteren Auswertungen
 * auftauchen (siehe docs/QUESTION_ENGINE.md, Abschnitt "Umgang mit nicht
 * mehr sichtbaren Antworten").
 */
export function findNewlyHiddenAnsweredQuestionIds(
  pathBefore: VisibleQuestionSummary[],
  pathAfter: VisibleQuestionSummary[],
): string[] {
  const visibleAfter = new Set(pathAfter.map((q) => q.questionId));
  return pathBefore
    .filter((q) => q.isAnswered && !visibleAfter.has(q.questionId))
    .map((q) => q.questionId);
}
