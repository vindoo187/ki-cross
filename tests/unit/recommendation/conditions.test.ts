import { describe, expect, it } from "vitest";
import {
  assertValidConditionSource,
  evaluateCondition,
  evaluateConditionGroups,
  extractMatchedCampaignActiveKeys,
} from "@/server/recommendation/conditions";
import {
  InvalidConditionSourceError,
  InvalidOperatorForAttributeError,
} from "@/server/recommendation/errors";
import type { ConditionInput } from "@/server/recommendation/types";
import type { AnsweredValue } from "@/server/questionnaire/types";

function condition(overrides: Partial<ConditionInput> = {}): ConditionInput {
  return {
    id: "cond-1",
    groupIndex: 0,
    sourceType: "ANSWER",
    questionId: "q-1",
    attributeKey: null,
    operator: "EQUALS",
    comparisonValue: "true",
    ...overrides,
  };
}

const emptyContext = {
  answersByQuestionId: new Map<string, AnsweredValue>(),
  productAttributes: new Map<string, string>(),
  sessionAttributes: new Map<string, string>(),
};

describe("assertValidConditionSource", () => {
  it("ANSWER: questionId gesetzt, attributeKey leer -> gueltig", () => {
    expect(() =>
      assertValidConditionSource(
        condition({ sourceType: "ANSWER", questionId: "q-1", attributeKey: null }),
      ),
    ).not.toThrow();
  });

  it("ANSWER ohne questionId -> InvalidConditionSourceError", () => {
    expect(() =>
      assertValidConditionSource(condition({ sourceType: "ANSWER", questionId: null })),
    ).toThrow(InvalidConditionSourceError);
  });

  it("ANSWER mit zusaetzlich gesetztem attributeKey -> InvalidConditionSourceError", () => {
    expect(() =>
      assertValidConditionSource(
        condition({ sourceType: "ANSWER", questionId: "q-1", attributeKey: "dataVolumeGb" }),
      ),
    ).toThrow(InvalidConditionSourceError);
  });

  it("PRODUCT_ATTRIBUTE: attributeKey gesetzt, questionId leer -> gueltig", () => {
    expect(() =>
      assertValidConditionSource(
        condition({
          sourceType: "PRODUCT_ATTRIBUTE",
          questionId: null,
          attributeKey: "dataVolumeGb",
        }),
      ),
    ).not.toThrow();
  });

  it("PRODUCT_ATTRIBUTE ohne attributeKey -> InvalidConditionSourceError", () => {
    expect(() =>
      assertValidConditionSource(
        condition({ sourceType: "PRODUCT_ATTRIBUTE", questionId: null, attributeKey: null }),
      ),
    ).toThrow(InvalidConditionSourceError);
  });

  it("SESSION_ATTRIBUTE mit zusaetzlich gesetzter questionId -> InvalidConditionSourceError", () => {
    expect(() =>
      assertValidConditionSource(
        condition({
          sourceType: "SESSION_ATTRIBUTE",
          questionId: "q-1",
          attributeKey: "consultationType",
        }),
      ),
    ).toThrow(InvalidConditionSourceError);
  });

  it("CAMPAIGN_ACTIVE: attributeKey gesetzt, questionId leer -> gueltig", () => {
    expect(() =>
      assertValidConditionSource(
        condition({
          sourceType: "CAMPAIGN_ACTIVE",
          questionId: null,
          attributeKey: "summer-sale",
          operator: "IS_ANSWERED",
        }),
      ),
    ).not.toThrow();
  });

  it("CAMPAIGN_ACTIVE ohne attributeKey -> InvalidConditionSourceError", () => {
    expect(() =>
      assertValidConditionSource(
        condition({ sourceType: "CAMPAIGN_ACTIVE", questionId: null, attributeKey: null }),
      ),
    ).toThrow(InvalidConditionSourceError);
  });
});

describe("evaluateCondition - CAMPAIGN_ACTIVE (Phase 13 AP4)", () => {
  it("IS_ANSWERED liefert true, wenn der Campaign-Key in activeCampaignKeys enthalten ist", () => {
    const activeCampaignKeys = new Set(["summer-sale"]);
    expect(
      evaluateCondition(
        condition({
          sourceType: "CAMPAIGN_ACTIVE",
          questionId: null,
          attributeKey: "summer-sale",
          operator: "IS_ANSWERED",
          comparisonValue: "",
        }),
        { ...emptyContext, activeCampaignKeys },
      ),
    ).toBe(true);
  });

  it("IS_ANSWERED liefert false, wenn der Campaign-Key NICHT aktiv ist", () => {
    expect(
      evaluateCondition(
        condition({
          sourceType: "CAMPAIGN_ACTIVE",
          questionId: null,
          attributeKey: "summer-sale",
          operator: "IS_ANSWERED",
          comparisonValue: "",
        }),
        emptyContext,
      ),
    ).toBe(false);
  });

  it("IS_NOT_ANSWERED liefert true, wenn der Campaign-Key NICHT aktiv ist", () => {
    expect(
      evaluateCondition(
        condition({
          sourceType: "CAMPAIGN_ACTIVE",
          questionId: null,
          attributeKey: "summer-sale",
          operator: "IS_NOT_ANSWERED",
          comparisonValue: "",
        }),
        emptyContext,
      ),
    ).toBe(true);
  });

  it("activeCampaignKeys fehlt im Kontext (optionales Feld) -> gilt wie leere Menge", () => {
    expect(
      evaluateCondition(
        condition({
          sourceType: "CAMPAIGN_ACTIVE",
          questionId: null,
          attributeKey: "summer-sale",
          operator: "IS_NOT_ANSWERED",
          comparisonValue: "",
        }),
        emptyContext,
      ),
    ).toBe(true);
  });

  it("Vergleichsoperator (z.B. EQUALS) ist nicht zulaessig -> InvalidOperatorForAttributeError", () => {
    expect(() =>
      evaluateCondition(
        condition({
          sourceType: "CAMPAIGN_ACTIVE",
          questionId: null,
          attributeKey: "summer-sale",
          operator: "EQUALS",
          comparisonValue: "true",
        }),
        emptyContext,
      ),
    ).toThrow(InvalidOperatorForAttributeError);
  });
});

describe("evaluateCondition - ANSWER (delegiert an evaluateSingleCondition)", () => {
  it("matcht ueber die tatsaechliche Antwort der referenzierten Frage", () => {
    const answersByQuestionId = new Map<string, AnsweredValue>([
      ["q-1", { answerType: "BOOLEAN", isAnswered: true, booleanValue: true }],
    ]);
    expect(
      evaluateCondition(
        condition({ sourceType: "ANSWER", questionId: "q-1", comparisonValue: "true" }),
        {
          ...emptyContext,
          answersByQuestionId,
        },
      ),
    ).toBe(true);
  });

  it("liefert false, wenn die Frage nicht beantwortet ist", () => {
    expect(
      evaluateCondition(condition({ sourceType: "ANSWER", questionId: "q-1" }), emptyContext),
    ).toBe(false);
  });
});

describe("evaluateCondition - PRODUCT_ATTRIBUTE", () => {
  it("matcht ueber einen gesetzten TariffAttribute-Rohwert", () => {
    const productAttributes = new Map([["dataVolumeGb", "20"]]);
    expect(
      evaluateCondition(
        condition({
          sourceType: "PRODUCT_ATTRIBUTE",
          questionId: null,
          attributeKey: "dataVolumeGb",
          operator: "GREATER_THAN_OR_EQUAL",
          comparisonValue: "5",
        }),
        { ...emptyContext, productAttributes },
      ),
    ).toBe(true);
  });

  it("liefert false fuer Vergleichsoperatoren, wenn das Attribut fuer das Produkt fehlt", () => {
    expect(
      evaluateCondition(
        condition({
          sourceType: "PRODUCT_ATTRIBUTE",
          questionId: null,
          attributeKey: "dataVolumeGb",
          operator: "GREATER_THAN_OR_EQUAL",
          comparisonValue: "5",
        }),
        emptyContext,
      ),
    ).toBe(false);
  });

  it("IS_NOT_ANSWERED liefert true, wenn das Attribut fuer das Produkt fehlt", () => {
    expect(
      evaluateCondition(
        condition({
          sourceType: "PRODUCT_ATTRIBUTE",
          questionId: null,
          attributeKey: "dataVolumeGb",
          operator: "IS_NOT_ANSWERED",
          comparisonValue: "",
        }),
        emptyContext,
      ),
    ).toBe(true);
  });

  it("IS_ANSWERED liefert true, wenn das Attribut gesetzt ist", () => {
    const productAttributes = new Map([["dataVolumeGb", "20"]]);
    expect(
      evaluateCondition(
        condition({
          sourceType: "PRODUCT_ATTRIBUTE",
          questionId: null,
          attributeKey: "dataVolumeGb",
          operator: "IS_ANSWERED",
          comparisonValue: "",
        }),
        { ...emptyContext, productAttributes },
      ),
    ).toBe(true);
  });
});

describe("evaluateCondition - SESSION_ATTRIBUTE", () => {
  it("matcht ueber sessionAttributes", () => {
    const sessionAttributes = new Map([["consultationType", "RENEWAL"]]);
    expect(
      evaluateCondition(
        condition({
          sourceType: "SESSION_ATTRIBUTE",
          questionId: null,
          attributeKey: "consultationType",
          operator: "EQUALS",
          comparisonValue: "RENEWAL",
        }),
        { ...emptyContext, sessionAttributes },
      ),
    ).toBe(true);
  });
});

describe("evaluateConditionGroups (DNF)", () => {
  it("leere Liste ist immer erfuellt", () => {
    expect(evaluateConditionGroups([], emptyContext)).toBe(true);
  });

  it("gleicher groupIndex = AND: beide Bedingungen muessen matchen", () => {
    const answersByQuestionId = new Map<string, AnsweredValue>([
      ["q-1", { answerType: "BOOLEAN", isAnswered: true, booleanValue: true }],
    ]);
    const productAttributes = new Map([["hasEuRoaming", "true"]]);
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "ANSWER",
        questionId: "q-1",
        comparisonValue: "true",
      }),
      condition({
        id: "c2",
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        questionId: null,
        attributeKey: "hasEuRoaming",
        comparisonValue: "true",
      }),
    ];
    expect(
      evaluateConditionGroups(conditions, {
        ...emptyContext,
        answersByQuestionId,
        productAttributes,
      }),
    ).toBe(true);

    // Nur eine der beiden AND-Bedingungen erfuellt -> Gruppe insgesamt false.
    expect(evaluateConditionGroups(conditions, { ...emptyContext, answersByQuestionId })).toBe(
      false,
    );
  });

  it("unterschiedlicher groupIndex = OR: eine erfuellte Gruppe reicht", () => {
    const sessionAttributes = new Map([["consultationType", "RENEWAL"]]);
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        questionId: null,
        attributeKey: "consultationType",
        comparisonValue: "NEW_CONTRACT",
      }),
      condition({
        id: "c2",
        groupIndex: 1,
        sourceType: "SESSION_ATTRIBUTE",
        questionId: null,
        attributeKey: "consultationType",
        comparisonValue: "RENEWAL",
      }),
    ];
    expect(evaluateConditionGroups(conditions, { ...emptyContext, sessionAttributes })).toBe(true);
  });

  it("keine Gruppe erfuellt -> false", () => {
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        questionId: null,
        attributeKey: "consultationType",
        comparisonValue: "NEW_CONTRACT",
      }),
    ];
    const sessionAttributes = new Map([["consultationType", "RENEWAL"]]);
    expect(evaluateConditionGroups(conditions, { ...emptyContext, sessionAttributes })).toBe(false);
  });
});

describe("extractMatchedCampaignActiveKeys (Phase 13 AP7)", () => {
  it("liefert den Campaign-Key einer IS_ANSWERED-Bedingung aus einer getroffenen Gruppe", () => {
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "summer-sale",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
    ];
    const activeCampaignKeys = new Set(["summer-sale"]);
    expect(
      extractMatchedCampaignActiveKeys(conditions, { ...emptyContext, activeCampaignKeys }),
    ).toEqual(new Set(["summer-sale"]));
  });

  it("liefert eine leere Menge, wenn die Gruppe NICHT matcht (Campaign nicht aktiv)", () => {
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "summer-sale",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
    ];
    expect(extractMatchedCampaignActiveKeys(conditions, emptyContext)).toEqual(new Set());
  });

  it("IS_NOT_ANSWERED traegt NICHT bei, auch wenn die Gruppe matcht (Campaign-Abwesenheit ist die Matchbedingung, keine Attribution zu dieser Campaign)", () => {
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "inactive-sale",
        operator: "IS_NOT_ANSWERED",
        comparisonValue: "",
      }),
    ];
    expect(extractMatchedCampaignActiveKeys(conditions, emptyContext)).toEqual(new Set());
  });

  it("OR-Gruppen (unterschiedlicher groupIndex): nur die Campaign aus der TATSAECHLICH getroffenen Gruppe wird attribuiert, nicht aus der ungetroffenen", () => {
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "campaign-a",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
      condition({
        id: "c2",
        groupIndex: 1,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "campaign-b",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
    ];
    // Nur campaign-b ist aktiv -> nur Gruppe 1 (campaign-b) matcht, Gruppe 0
    // (campaign-a) bleibt ungetroffen und darf NICHT attribuiert werden.
    const activeCampaignKeys = new Set(["campaign-b"]);
    expect(
      extractMatchedCampaignActiveKeys(conditions, { ...emptyContext, activeCampaignKeys }),
    ).toEqual(new Set(["campaign-b"]));
  });

  it("AND-Gruppe: eine CAMPAIGN_ACTIVE-Bedingung neben einer ANSWER-Bedingung wird nur attribuiert, wenn BEIDE in der Gruppe erfuellt sind", () => {
    const answersByQuestionId = new Map<string, AnsweredValue>([
      ["q-1", { answerType: "BOOLEAN", isAnswered: true, booleanValue: true }],
    ]);
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "ANSWER",
        questionId: "q-1",
        comparisonValue: "true",
      }),
      condition({
        id: "c2",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "summer-sale",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
    ];
    const activeCampaignKeys = new Set(["summer-sale"]);

    // ANSWER-Teil erfuellt + Campaign aktiv -> Gruppe matcht -> Attribution.
    expect(
      extractMatchedCampaignActiveKeys(conditions, {
        ...emptyContext,
        answersByQuestionId,
        activeCampaignKeys,
      }),
    ).toEqual(new Set(["summer-sale"]));

    // ANSWER-Teil NICHT erfuellt -> Gruppe matcht nicht -> KEINE Attribution,
    // obwohl die Campaign selbst aktiv ist.
    expect(
      extractMatchedCampaignActiveKeys(conditions, { ...emptyContext, activeCampaignKeys }),
    ).toEqual(new Set());
  });

  it("mehrere CAMPAIGN_ACTIVE-Bedingungen in derselben getroffenen Gruppe liefern beide Keys", () => {
    const conditions = [
      condition({
        id: "c1",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "campaign-a",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
      condition({
        id: "c2",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE",
        questionId: null,
        attributeKey: "campaign-b",
        operator: "IS_ANSWERED",
        comparisonValue: "",
      }),
    ];
    const activeCampaignKeys = new Set(["campaign-a", "campaign-b"]);
    expect(
      extractMatchedCampaignActiveKeys(conditions, { ...emptyContext, activeCampaignKeys }),
    ).toEqual(new Set(["campaign-a", "campaign-b"]));
  });

  it("leere Bedingungsliste liefert eine leere Menge", () => {
    expect(extractMatchedCampaignActiveKeys([], emptyContext)).toEqual(new Set());
  });
});
