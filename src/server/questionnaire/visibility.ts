/**
 * Reine Sichtbarkeits-Engine (kein DB-Zugriff): wertet
 * `VisibilityCondition`-Gruppen gegen bereits bekannte Antworten aus und
 * prueft den Abhaengigkeitsgraphen einer QuestionnaireVersion auf Zyklen.
 *
 * Siehe docs/QUESTION_ENGINE.md, Abschnitt "Sichtbarkeitsmodell" fuer die
 * fachliche Beschreibung; Kommentar an `VisibilityCondition` in
 * prisma/schema.prisma fuer die "eine Ebene AND/OR, kein Nesting"-Einschraenkung.
 */

import { compareDecimalStrings, isValidDecimalString } from "./decimal";
import { MixedCombinatorError, VisibilityCycleError } from "./errors";
import type {
  AnsweredValue,
  AnswerType,
  QuestionNode,
  VisibilityConditionInput,
  VisibilityOperator,
} from "./types";

/**
 * Welche Operatoren fuer welchen Zielfrage-`AnswerType` unterstuetzt sind.
 * Muss deckungsgleich mit den `switch`-Zweigen in `evaluateSingleCondition`
 * gehalten werden - dient `validateQuestionnaireVersion()` (service.ts) als
 * statische Vorab-Pruefung ("unpassender Operator fuer einen Fragetyp wird
 * abgelehnt", PHASE_3A_STARTPROMPT.md Abschnitt 8), ohne dass dafuer bereits
 * eine Antwort vorliegen muss.
 */
export const OPERATORS_BY_ANSWER_TYPE: Readonly<
  Record<AnswerType, ReadonlySet<VisibilityOperator>>
> = {
  BOOLEAN: new Set(["EQUALS", "NOT_EQUALS", "IS_ANSWERED", "IS_NOT_ANSWERED"]),
  SINGLE_CHOICE: new Set([
    "EQUALS",
    "NOT_EQUALS",
    "IN",
    "NOT_IN",
    "IS_ANSWERED",
    "IS_NOT_ANSWERED",
  ]),
  MULTIPLE_CHOICE: new Set([
    "CONTAINS",
    "EQUALS",
    "NOT_EQUALS",
    "IN",
    "NOT_IN",
    "IS_ANSWERED",
    "IS_NOT_ANSWERED",
  ]),
  INTEGER: new Set([
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUAL",
    "LESS_THAN",
    "LESS_THAN_OR_EQUAL",
    "IN",
    "NOT_IN",
    "IS_ANSWERED",
    "IS_NOT_ANSWERED",
  ]),
  DECIMAL: new Set([
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUAL",
    "LESS_THAN",
    "LESS_THAN_OR_EQUAL",
    "IS_ANSWERED",
    "IS_NOT_ANSWERED",
  ]),
  DATE: new Set([
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUAL",
    "LESS_THAN",
    "LESS_THAN_OR_EQUAL",
    "IS_ANSWERED",
    "IS_NOT_ANSWERED",
  ]),
  // SHORT_TEXT darf ueberhaupt nicht als Bedingungsziel dienen (siehe
  // evaluateSingleCondition) - daher eine leere Menge statt einer Teilmenge.
  SHORT_TEXT: new Set([]),
};

/** Reine Hilfsfunktion fuer die statische Vorab-Pruefung, siehe {@link OPERATORS_BY_ANSWER_TYPE}. */
export function isOperatorSupportedForAnswerType(
  operator: VisibilityOperator,
  answerType: AnswerType,
): boolean {
  return OPERATORS_BY_ANSWER_TYPE[answerType].has(operator);
}

export function splitComparisonList(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}

/**
 * Wertet EINE Sichtbarkeitsbedingung gegen die aktuell bekannte Antwort der
 * Zielfrage aus. `answer` ist `undefined`, wenn die Zielfrage noch gar keine
 * (aktive) Antwort hat.
 *
 * Freitext (SHORT_TEXT) darf laut Vorgabe nie fuer Bedingungen verwendet
 * werden - eine Bedingung, deren Zielfrage SHORT_TEXT ist, wird daher als
 * Konfigurationsfehler behandelt (sollte bereits bei der Validierung der
 * QuestionnaireVersion abgefangen werden, siehe `validateVisibilityGraph`).
 */
export function evaluateSingleCondition(
  condition: VisibilityConditionInput,
  answer: AnsweredValue | undefined,
): boolean {
  if (condition.operator === "IS_ANSWERED") {
    return answer?.isAnswered === true;
  }
  if (condition.operator === "IS_NOT_ANSWERED") {
    return !(answer?.isAnswered === true);
  }

  if (!answer || !answer.isAnswered) {
    // Alle anderen Operatoren setzen eine vorhandene Antwort voraus; ohne
    // Antwort ist die Bedingung (noch) nicht erfuellt.
    return false;
  }

  switch (answer.answerType) {
    case "BOOLEAN": {
      const expected = condition.comparisonValue.trim().toLowerCase() === "true";
      const actual = answer.booleanValue === true;
      if (condition.operator === "EQUALS") return actual === expected;
      if (condition.operator === "NOT_EQUALS") return actual !== expected;
      throw new Error(
        `Operator "${condition.operator}" ist fuer BOOLEAN-Zielfragen nicht unterstuetzt.`,
      );
    }

    case "SINGLE_CHOICE": {
      const selected = (answer.choiceValues ?? [])[0];
      const list = splitComparisonList(condition.comparisonValue);
      switch (condition.operator) {
        case "EQUALS":
          return selected === condition.comparisonValue.trim();
        case "NOT_EQUALS":
          return selected !== condition.comparisonValue.trim();
        case "IN":
          return selected !== undefined && list.includes(selected);
        case "NOT_IN":
          return !(selected !== undefined && list.includes(selected));
        default:
          throw new Error(
            `Operator "${condition.operator}" ist fuer SINGLE_CHOICE-Zielfragen nicht unterstuetzt.`,
          );
      }
    }

    case "MULTIPLE_CHOICE": {
      const values = answer.choiceValues ?? [];
      const list = splitComparisonList(condition.comparisonValue);
      switch (condition.operator) {
        case "CONTAINS":
          return values.includes(condition.comparisonValue.trim());
        case "EQUALS":
          return sameSet(values, list);
        case "NOT_EQUALS":
          return !sameSet(values, list);
        case "IN":
          return values.some((v) => list.includes(v));
        case "NOT_IN":
          return !values.some((v) => list.includes(v));
        default:
          throw new Error(
            `Operator "${condition.operator}" ist fuer MULTIPLE_CHOICE-Zielfragen nicht unterstuetzt.`,
          );
      }
    }

    case "INTEGER": {
      if (answer.integerValue === null || answer.integerValue === undefined) return false;
      const actual = answer.integerValue;
      switch (condition.operator) {
        case "EQUALS":
          return actual === Number(condition.comparisonValue);
        case "NOT_EQUALS":
          return actual !== Number(condition.comparisonValue);
        case "GREATER_THAN":
          return actual > Number(condition.comparisonValue);
        case "GREATER_THAN_OR_EQUAL":
          return actual >= Number(condition.comparisonValue);
        case "LESS_THAN":
          return actual < Number(condition.comparisonValue);
        case "LESS_THAN_OR_EQUAL":
          return actual <= Number(condition.comparisonValue);
        case "IN":
          return splitComparisonList(condition.comparisonValue).map(Number).includes(actual);
        case "NOT_IN":
          return !splitComparisonList(condition.comparisonValue).map(Number).includes(actual);
        default:
          throw new Error(
            `Operator "${condition.operator}" ist fuer INTEGER-Zielfragen nicht unterstuetzt.`,
          );
      }
    }

    case "DECIMAL": {
      if (!answer.decimalValue) return false;
      const actual = answer.decimalValue;
      if (!isValidDecimalString(condition.comparisonValue)) {
        throw new Error(
          `Vergleichswert "${condition.comparisonValue}" ist keine gueltige Dezimalzahl.`,
        );
      }
      switch (condition.operator) {
        case "EQUALS":
          return compareDecimalStrings(actual, condition.comparisonValue) === 0;
        case "NOT_EQUALS":
          return compareDecimalStrings(actual, condition.comparisonValue) !== 0;
        case "GREATER_THAN":
          return compareDecimalStrings(actual, condition.comparisonValue) > 0;
        case "GREATER_THAN_OR_EQUAL":
          return compareDecimalStrings(actual, condition.comparisonValue) >= 0;
        case "LESS_THAN":
          return compareDecimalStrings(actual, condition.comparisonValue) < 0;
        case "LESS_THAN_OR_EQUAL":
          return compareDecimalStrings(actual, condition.comparisonValue) <= 0;
        default:
          throw new Error(
            `Operator "${condition.operator}" ist fuer DECIMAL-Zielfragen nicht unterstuetzt.`,
          );
      }
    }

    case "DATE": {
      if (!answer.dateValue) return false;
      const actual = Date.parse(answer.dateValue);
      const target = Date.parse(condition.comparisonValue);
      if (Number.isNaN(actual) || Number.isNaN(target)) {
        throw new Error(
          `Datumsvergleich fehlgeschlagen: ungueltiges ISO-Datum ("${answer.dateValue}" bzw. "${condition.comparisonValue}").`,
        );
      }
      switch (condition.operator) {
        case "EQUALS":
          return actual === target;
        case "NOT_EQUALS":
          return actual !== target;
        case "GREATER_THAN":
          return actual > target;
        case "GREATER_THAN_OR_EQUAL":
          return actual >= target;
        case "LESS_THAN":
          return actual < target;
        case "LESS_THAN_OR_EQUAL":
          return actual <= target;
        default:
          throw new Error(
            `Operator "${condition.operator}" ist fuer DATE-Zielfragen nicht unterstuetzt.`,
          );
      }
    }

    case "SHORT_TEXT":
      throw new Error(
        "Freitext (SHORT_TEXT) darf nicht als Ziel einer Sichtbarkeitsbedingung verwendet werden.",
      );
  }
}

/**
 * Prueft, ob ALLE Bedingungen einer Gruppe denselben Kombinator verwenden
 * ("keine gemischten Gruppen", siehe Modul-Kommentar). Leere Gruppen sind
 * gueltig (Frage ist dann immer sichtbar).
 */
function resolveCombinator(
  questionVersionId: string,
  conditions: VisibilityConditionInput[],
): "AND" | "OR" | null {
  if (conditions.length === 0) return null;
  const combinators = new Set(conditions.map((c) => c.combinator));
  if (combinators.size > 1) {
    throw new MixedCombinatorError(questionVersionId);
  }
  return conditions[0]?.combinator ?? null;
}

/**
 * Bestimmt, ob eine Frage (repraesentiert durch ihre aktive Version und
 * deren Sichtbarkeitsbedingungen) aktuell sichtbar ist, basierend auf den
 * bereits bekannten Antworten anderer Fragen (`answersByQuestionId`).
 */
export function isQuestionVisible(
  node: QuestionNode,
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>,
): boolean {
  const combinator = resolveCombinator(node.activeVersion.id, node.visibilityConditions);
  if (combinator === null) return true;
  const results = node.visibilityConditions.map((c) =>
    evaluateSingleCondition(c, answersByQuestionId.get(c.targetQuestionId)),
  );
  return combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Prueft den Sichtbarkeits-Abhaengigkeitsgraphen einer QuestionnaireVersion:
 * - jede `targetQuestionId` muss eine Frage DERSELBEN QuestionnaireVersion sein,
 * - keine gemischten AND/OR-Kombinatoren pro Frage,
 * - keine Zyklen (sonst waere die Reihenfolge nicht deterministisch aufloesbar).
 *
 * Wirft beim ersten gefundenen strukturellen Problem (Zyklus,
 * gemischte Kombinatoren); gibt sonst nichts zurueck.
 */
export function validateVisibilityGraph(nodes: QuestionNode[]): void {
  const knownQuestionIds = new Set(nodes.map((n) => n.questionId));
  const dependencies = new Map<string, Set<string>>();

  for (const node of nodes) {
    resolveCombinator(node.activeVersion.id, node.visibilityConditions);
    const deps = new Set<string>();
    for (const condition of node.visibilityConditions) {
      if (!knownQuestionIds.has(condition.targetQuestionId)) {
        throw new Error(
          `Sichtbarkeitsbedingung von Frage "${node.questionId}" referenziert eine fragebogen-fremde Zielfrage "${condition.targetQuestionId}".`,
        );
      }
      deps.add(condition.targetQuestionId);
    }
    dependencies.set(node.questionId, deps);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackPath: string[] = [];

  function visit(questionId: string): void {
    if (visited.has(questionId)) return;
    if (inStack.has(questionId)) {
      const cycleStart = stackPath.indexOf(questionId);
      throw new VisibilityCycleError([...stackPath.slice(cycleStart), questionId]);
    }
    inStack.add(questionId);
    stackPath.push(questionId);
    for (const dep of dependencies.get(questionId) ?? []) {
      visit(dep);
    }
    stackPath.pop();
    inStack.delete(questionId);
    visited.add(questionId);
  }

  for (const questionId of dependencies.keys()) {
    visit(questionId);
  }
}
