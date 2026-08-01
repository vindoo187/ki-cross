import { describe, expect, it } from "vitest";
import {
  assertOperatorAllowedForAttribute,
  evaluateAttributeComparison,
  getAttributeDefinition,
} from "@/server/recommendation/attribute-registry";
import {
  InvalidComparisonValueError,
  InvalidOperatorForAttributeError,
  UnknownAttributeKeyError,
} from "@/server/recommendation/errors";

describe("getAttributeDefinition", () => {
  it("liefert die Definition fuer bekannte PRODUCT_ATTRIBUTE-Keys", () => {
    const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "dataVolumeGb");
    expect(definition.valueType).toBe("INTEGER");
  });

  it("liefert die Definition fuer bekannte SESSION_ATTRIBUTE-Keys", () => {
    const definition = getAttributeDefinition("SESSION_ATTRIBUTE", "consultationType");
    expect(definition.valueType).toBe("ENUM");
  });

  it("wirft UnknownAttributeKeyError fuer unbekannte Keys", () => {
    expect(() => getAttributeDefinition("PRODUCT_ATTRIBUTE", "doesNotExist")).toThrow(
      UnknownAttributeKeyError,
    );
    expect(() => getAttributeDefinition("SESSION_ATTRIBUTE", "doesNotExist")).toThrow(
      UnknownAttributeKeyError,
    );
  });
});

describe("assertOperatorAllowedForAttribute", () => {
  it("erlaubt einen zulaessigen Operator und gibt die Definition zurueck", () => {
    const definition = assertOperatorAllowedForAttribute(
      "PRODUCT_ATTRIBUTE",
      "dataVolumeGb",
      "GREATER_THAN_OR_EQUAL",
    );
    expect(definition.valueType).toBe("INTEGER");
  });

  it("wirft InvalidOperatorForAttributeError fuer einen unzulaessigen Operator", () => {
    // hasEuRoaming ist BOOLEAN -> GREATER_THAN ist nicht erlaubt.
    expect(() =>
      assertOperatorAllowedForAttribute("PRODUCT_ATTRIBUTE", "hasEuRoaming", "GREATER_THAN"),
    ).toThrow(InvalidOperatorForAttributeError);
  });

  it("wirft UnknownAttributeKeyError vor der Operator-Pruefung bei unbekanntem Key", () => {
    expect(() =>
      assertOperatorAllowedForAttribute("PRODUCT_ATTRIBUTE", "unknownKey", "EQUALS"),
    ).toThrow(UnknownAttributeKeyError);
  });
});

describe("PRODUCT_ATTRIBUTE_DEFINITIONS.dataVolumeGb (INTEGER)", () => {
  const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "dataVolumeGb");

  it("parst gueltige Integer-Strings", () => {
    expect(definition.parse("20")).toBe(20);
    expect(definition.parse(" -5 ")).toBe(-5);
  });

  it("wirft InvalidComparisonValueError bei nicht-integer Strings", () => {
    expect(() => definition.parse("20.5")).toThrow(InvalidComparisonValueError);
    expect(() => definition.parse("abc")).toThrow(InvalidComparisonValueError);
  });

  it("wirft InvalidComparisonValueError bei nicht-sicheren Integers", () => {
    expect(() => definition.parse("99999999999999999999")).toThrow(InvalidComparisonValueError);
  });
});

describe("PRODUCT_ATTRIBUTE_DEFINITIONS.pricePlanTier (ENUM)", () => {
  const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "pricePlanTier");

  it("parst gueltige Enum-Werte", () => {
    expect(definition.parse("PREMIUM")).toBe("PREMIUM");
  });

  it("wirft InvalidComparisonValueError bei ungueltigen Enum-Werten", () => {
    expect(() => definition.parse("ULTRA")).toThrow(InvalidComparisonValueError);
  });
});

describe("PRODUCT_ATTRIBUTE_DEFINITIONS.hasEuRoaming (BOOLEAN)", () => {
  const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "hasEuRoaming");

  it("parst 'true'/'false' case-insensitiv", () => {
    expect(definition.parse("true")).toBe(true);
    expect(definition.parse("FALSE")).toBe(false);
  });

  it("wirft InvalidComparisonValueError bei anderen Werten", () => {
    expect(() => definition.parse("yes")).toThrow(InvalidComparisonValueError);
  });
});

describe("PRODUCT_ATTRIBUTE_DEFINITIONS.contractCommitmentMonths (INTEGER)", () => {
  it("ist im Schema registriert", () => {
    expect(getAttributeDefinition("PRODUCT_ATTRIBUTE", "contractCommitmentMonths").valueType).toBe(
      "INTEGER",
    );
  });
});

describe("SESSION_ATTRIBUTE_DEFINITIONS.consultationType (ENUM)", () => {
  const definition = getAttributeDefinition("SESSION_ATTRIBUTE", "consultationType");

  it("parst NEW_CONTRACT/RENEWAL", () => {
    expect(definition.parse("NEW_CONTRACT")).toBe("NEW_CONTRACT");
    expect(definition.parse("RENEWAL")).toBe("RENEWAL");
  });

  it("wirft InvalidComparisonValueError bei ungueltigen Werten", () => {
    expect(() => definition.parse("UPGRADE")).toThrow(InvalidComparisonValueError);
  });
});

describe("evaluateAttributeComparison", () => {
  it("IS_ANSWERED/IS_NOT_ANSWERED liefern immer true/false unabhaengig vom Wert", () => {
    const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "dataVolumeGb");
    expect(evaluateAttributeComparison(definition, "IS_ANSWERED", 5, "irrelevant")).toBe(true);
    expect(evaluateAttributeComparison(definition, "IS_NOT_ANSWERED", 5, "irrelevant")).toBe(false);
  });

  describe("BOOLEAN", () => {
    const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "hasEuRoaming");

    it("EQUALS/NOT_EQUALS", () => {
      expect(evaluateAttributeComparison(definition, "EQUALS", true, "true")).toBe(true);
      expect(evaluateAttributeComparison(definition, "EQUALS", true, "false")).toBe(false);
      expect(evaluateAttributeComparison(definition, "NOT_EQUALS", true, "false")).toBe(true);
    });

    it("wirft bei nicht unterstuetzten Operatoren (unreachableOperator)", () => {
      expect(() => evaluateAttributeComparison(definition, "GREATER_THAN", true, "true")).toThrow();
    });
  });

  describe("INTEGER", () => {
    const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "dataVolumeGb");

    it("alle Vergleichsoperatoren", () => {
      expect(evaluateAttributeComparison(definition, "EQUALS", 10, "10")).toBe(true);
      expect(evaluateAttributeComparison(definition, "NOT_EQUALS", 10, "5")).toBe(true);
      expect(evaluateAttributeComparison(definition, "GREATER_THAN", 10, "5")).toBe(true);
      expect(evaluateAttributeComparison(definition, "GREATER_THAN_OR_EQUAL", 10, "10")).toBe(true);
      expect(evaluateAttributeComparison(definition, "LESS_THAN", 5, "10")).toBe(true);
      expect(evaluateAttributeComparison(definition, "LESS_THAN_OR_EQUAL", 10, "10")).toBe(true);
    });

    it("IN/NOT_IN ueber eine kommaseparierte Liste", () => {
      expect(evaluateAttributeComparison(definition, "IN", 10, "5, 10, 20")).toBe(true);
      expect(evaluateAttributeComparison(definition, "IN", 15, "5, 10, 20")).toBe(false);
      expect(evaluateAttributeComparison(definition, "NOT_IN", 15, "5, 10, 20")).toBe(true);
    });
  });

  describe("DECIMAL", () => {
    // Kein Attribut nutzt aktuell DECIMAL, daher ein direkt konstruiertes Fixture.
    const definition = {
      valueType: "DECIMAL" as const,
      allowedOperators: new Set([
        "EQUALS",
        "NOT_EQUALS",
        "GREATER_THAN",
        "GREATER_THAN_OR_EQUAL",
        "LESS_THAN",
        "LESS_THAN_OR_EQUAL",
        "IN",
        "NOT_IN",
      ] as const),
      parse: (raw: string) => raw.trim(),
    };

    it("alle Vergleichsoperatoren nutzen compareDecimalStrings (float-frei)", () => {
      expect(evaluateAttributeComparison(definition, "EQUALS", "12.5000", "12.5")).toBe(true);
      expect(evaluateAttributeComparison(definition, "NOT_EQUALS", "12.5", "12.6")).toBe(true);
      expect(evaluateAttributeComparison(definition, "GREATER_THAN", "12.6", "12.5")).toBe(true);
      expect(evaluateAttributeComparison(definition, "GREATER_THAN_OR_EQUAL", "12.5", "12.5")).toBe(
        true,
      );
      expect(evaluateAttributeComparison(definition, "LESS_THAN", "12.4", "12.5")).toBe(true);
      expect(evaluateAttributeComparison(definition, "LESS_THAN_OR_EQUAL", "12.5", "12.5")).toBe(
        true,
      );
    });

    it("IN/NOT_IN ueber eine kommaseparierte Liste", () => {
      expect(evaluateAttributeComparison(definition, "IN", "12.5", "1, 12.5, 20")).toBe(true);
      expect(evaluateAttributeComparison(definition, "NOT_IN", "99", "1, 12.5, 20")).toBe(true);
    });
  });

  describe("ENUM/STRING", () => {
    const definition = getAttributeDefinition("PRODUCT_ATTRIBUTE", "pricePlanTier");

    it("EQUALS/NOT_EQUALS/IN/NOT_IN", () => {
      expect(evaluateAttributeComparison(definition, "EQUALS", "PREMIUM", "PREMIUM")).toBe(true);
      expect(evaluateAttributeComparison(definition, "NOT_EQUALS", "PREMIUM", "BASIC")).toBe(true);
      expect(evaluateAttributeComparison(definition, "IN", "PREMIUM", "BASIC, PREMIUM")).toBe(true);
      expect(evaluateAttributeComparison(definition, "NOT_IN", "STANDARD", "BASIC, PREMIUM")).toBe(
        true,
      );
    });
  });
});
