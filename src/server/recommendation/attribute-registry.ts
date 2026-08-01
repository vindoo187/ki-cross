/**
 * Geschlossene Attribute-Registry fuer PRODUCT_ATTRIBUTE- und
 * SESSION_ATTRIBUTE-Conditions (siehe PHASE_3B_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.1). Bewusst NICHT laufzeitkonfigurierbar/DB-gestuetzt: neue
 * Attribute erfordern eine Code-Aenderung und Review, analog zur
 * AnswerType-Operator-Matrix in questionnaire/visibility.ts
 * (`OPERATORS_BY_ANSWER_TYPE`). `attributeKey`s ausserhalb dieser Registry
 * werden ueber `UnknownAttributeKeyError` konsequent abgelehnt.
 */

import type { VisibilityOperator } from "../questionnaire/types";
import { compareDecimalStrings } from "../questionnaire/decimal";
import { splitComparisonList } from "../questionnaire/visibility";
import type { ConditionSourceType } from "./types";
import {
  InvalidComparisonValueError,
  InvalidOperatorForAttributeError,
  UnknownAttributeKeyError,
} from "./errors";

export type AttributeValueType = "INTEGER" | "DECIMAL" | "BOOLEAN" | "ENUM" | "STRING";
export type AttributeValue = string | number | boolean;

export interface AttributeDefinition {
  valueType: AttributeValueType;
  allowedOperators: ReadonlySet<VisibilityOperator>;
  enumValues?: readonly string[];
  /** Parst einen TariffAttribute.attributeValue / sessionAttributes-Rohwert (String) in den typisierten Wert. */
  parse: (raw: string) => AttributeValue;
}

const NUMERIC_OPERATORS: ReadonlySet<VisibilityOperator> = new Set([
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
]);

const BOOLEAN_OPERATORS: ReadonlySet<VisibilityOperator> = new Set([
  "EQUALS",
  "NOT_EQUALS",
  "IS_ANSWERED",
  "IS_NOT_ANSWERED",
]);

const ENUM_OPERATORS: ReadonlySet<VisibilityOperator> = new Set([
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "IS_ANSWERED",
  "IS_NOT_ANSWERED",
]);

function parseInteger(attributeKey: string): (raw: string) => number {
  return (raw: string) => {
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new InvalidComparisonValueError(attributeKey, raw, "INTEGER");
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value)) {
      throw new InvalidComparisonValueError(attributeKey, raw, "INTEGER");
    }
    return value;
  };
}

function parseBoolean(attributeKey: string): (raw: string) => boolean {
  return (raw: string) => {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new InvalidComparisonValueError(attributeKey, raw, "BOOLEAN");
  };
}

function parseEnum(attributeKey: string, allowed: readonly string[]): (raw: string) => string {
  return (raw: string) => {
    const trimmed = raw.trim();
    if (!allowed.includes(trimmed)) {
      throw new InvalidComparisonValueError(attributeKey, raw, `ENUM(${allowed.join("|")})`);
    }
    return trimmed;
  };
}

/**
 * Produkt-Attribute (Quelle: `TariffAttribute.attributeKey`/`attributeValue`
 * der jeweiligen ProductVersion). Siehe Implementierungsplan Abschnitt 3.1:
 * Initialbestueckung deckt Datenvolumen, Preis-Tarifstufe, EU-Roaming und
 * Mindestvertragslaufzeit ab.
 */
export const PRODUCT_ATTRIBUTE_DEFINITIONS: Readonly<Record<string, AttributeDefinition>> = {
  dataVolumeGb: {
    valueType: "INTEGER",
    allowedOperators: NUMERIC_OPERATORS,
    parse: parseInteger("dataVolumeGb"),
  },
  pricePlanTier: {
    valueType: "ENUM",
    allowedOperators: ENUM_OPERATORS,
    enumValues: ["BASIC", "STANDARD", "PREMIUM"],
    parse: parseEnum("pricePlanTier", ["BASIC", "STANDARD", "PREMIUM"]),
  },
  hasEuRoaming: {
    valueType: "BOOLEAN",
    allowedOperators: BOOLEAN_OPERATORS,
    parse: parseBoolean("hasEuRoaming"),
  },
  contractCommitmentMonths: {
    valueType: "INTEGER",
    allowedOperators: NUMERIC_OPERATORS,
    parse: parseInteger("contractCommitmentMonths"),
  },
};

/**
 * Session-Attribute (Quelle: EvaluationInputContext.sessionAttributes,
 * abgeleitet aus der ConsultationSession selbst statt aus Antworten). Siehe
 * Implementierungsplan Abschnitt 3.1: initial nur `consultationType`.
 */
export const SESSION_ATTRIBUTE_DEFINITIONS: Readonly<Record<string, AttributeDefinition>> = {
  consultationType: {
    valueType: "ENUM",
    allowedOperators: ENUM_OPERATORS,
    enumValues: ["NEW_CONTRACT", "RENEWAL"],
    parse: parseEnum("consultationType", ["NEW_CONTRACT", "RENEWAL"]),
  },
};

function registryFor(
  sourceType: "PRODUCT_ATTRIBUTE" | "SESSION_ATTRIBUTE",
): Readonly<Record<string, AttributeDefinition>> {
  return sourceType === "PRODUCT_ATTRIBUTE"
    ? PRODUCT_ATTRIBUTE_DEFINITIONS
    : SESSION_ATTRIBUTE_DEFINITIONS;
}

/** Loest `attributeKey` in der geschlossenen Registry auf, wirft `UnknownAttributeKeyError` bei unbekanntem Key. */
export function getAttributeDefinition(
  sourceType: "PRODUCT_ATTRIBUTE" | "SESSION_ATTRIBUTE",
  attributeKey: string,
): AttributeDefinition {
  const definition = registryFor(sourceType)[attributeKey];
  if (!definition) {
    throw new UnknownAttributeKeyError(sourceType, attributeKey);
  }
  return definition;
}

/** Wie {@link getAttributeDefinition}, prueft zusaetzlich, dass `operator` fuer dieses Attribut erlaubt ist. */
export function assertOperatorAllowedForAttribute(
  sourceType: "PRODUCT_ATTRIBUTE" | "SESSION_ATTRIBUTE",
  attributeKey: string,
  operator: VisibilityOperator,
): AttributeDefinition {
  const definition = getAttributeDefinition(sourceType, attributeKey);
  if (!definition.allowedOperators.has(operator)) {
    throw new InvalidOperatorForAttributeError(sourceType, attributeKey, operator);
  }
  return definition;
}

/**
 * Wertet einen Attribut-Vergleich aus. `actual` ist der bereits via
 * `definition.parse()` typisierte Ist-Wert; `comparisonValue` ist der rohe
 * (String-)Vergleichswert aus der Condition.
 */
export function evaluateAttributeComparison(
  definition: AttributeDefinition,
  operator: VisibilityOperator,
  actual: AttributeValue,
  comparisonValue: string,
): boolean {
  // Erwartet, dass der Aufrufer zuvor assertOperatorAllowedForAttribute()
  // aufgerufen hat; die folgenden "unreachable operator"-Faelle sind daher
  // ausschliesslich ein Schutz gegen Programmierfehler, kein Nutzerfehler.
  function unreachableOperator(): never {
    throw new Error(
      `Interner Fehler: Operator "${operator}" fuer valueType "${definition.valueType}" nicht behandelt - assertOperatorAllowedForAttribute() haette dies verhindern muessen.`,
    );
  }

  if (operator === "IS_ANSWERED") return true;
  if (operator === "IS_NOT_ANSWERED") return false;

  switch (definition.valueType) {
    case "BOOLEAN": {
      const expected = definition.parse(comparisonValue) as boolean;
      const value = actual as boolean;
      if (operator === "EQUALS") return value === expected;
      if (operator === "NOT_EQUALS") return value !== expected;
      return unreachableOperator();
    }

    case "INTEGER": {
      const value = actual as number;
      switch (operator) {
        case "EQUALS":
          return value === (definition.parse(comparisonValue) as number);
        case "NOT_EQUALS":
          return value !== (definition.parse(comparisonValue) as number);
        case "GREATER_THAN":
          return value > (definition.parse(comparisonValue) as number);
        case "GREATER_THAN_OR_EQUAL":
          return value >= (definition.parse(comparisonValue) as number);
        case "LESS_THAN":
          return value < (definition.parse(comparisonValue) as number);
        case "LESS_THAN_OR_EQUAL":
          return value <= (definition.parse(comparisonValue) as number);
        case "IN":
          return splitComparisonList(comparisonValue)
            .map((v) => definition.parse(v) as number)
            .includes(value);
        case "NOT_IN":
          return !splitComparisonList(comparisonValue)
            .map((v) => definition.parse(v) as number)
            .includes(value);
        default:
          return unreachableOperator();
      }
    }

    case "DECIMAL": {
      const value = actual as string;
      switch (operator) {
        case "EQUALS":
          return compareDecimalStrings(value, definition.parse(comparisonValue) as string) === 0;
        case "NOT_EQUALS":
          return compareDecimalStrings(value, definition.parse(comparisonValue) as string) !== 0;
        case "GREATER_THAN":
          return compareDecimalStrings(value, definition.parse(comparisonValue) as string) > 0;
        case "GREATER_THAN_OR_EQUAL":
          return compareDecimalStrings(value, definition.parse(comparisonValue) as string) >= 0;
        case "LESS_THAN":
          return compareDecimalStrings(value, definition.parse(comparisonValue) as string) < 0;
        case "LESS_THAN_OR_EQUAL":
          return compareDecimalStrings(value, definition.parse(comparisonValue) as string) <= 0;
        case "IN":
          return splitComparisonList(comparisonValue).some(
            (v) => compareDecimalStrings(value, definition.parse(v) as string) === 0,
          );
        case "NOT_IN":
          return !splitComparisonList(comparisonValue).some(
            (v) => compareDecimalStrings(value, definition.parse(v) as string) === 0,
          );
        default:
          return unreachableOperator();
      }
    }

    case "ENUM":
    case "STRING": {
      const value = actual as string;
      switch (operator) {
        case "EQUALS":
          return value === (definition.parse(comparisonValue) as string);
        case "NOT_EQUALS":
          return value !== (definition.parse(comparisonValue) as string);
        case "IN":
          return splitComparisonList(comparisonValue)
            .map((v) => definition.parse(v) as string)
            .includes(value);
        case "NOT_IN":
          return !splitComparisonList(comparisonValue)
            .map((v) => definition.parse(v) as string)
            .includes(value);
        default:
          return unreachableOperator();
      }
    }

    default: {
      const _exhaustive: never = definition.valueType;
      throw new Error(`Unbekannter AttributeValueType: ${String(_exhaustive)}`);
    }
  }
}

/** Re-Export fuer Aufrufer, die den ConditionSourceType-Typ hier zentral benoetigen. */
export type { ConditionSourceType };
