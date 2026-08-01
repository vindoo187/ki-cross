import { describe, expect, it } from "vitest";
import {
  assertSalesOpportunitySourceConsistency,
  buildSalesOpportunityFromEmployeeMarkedNeed,
  buildSalesOpportunityFromSignal,
  type SalesOpportunityInput,
} from "@/server/recommendation/sales-opportunity";
import { SalesOpportunitySourceMismatchError } from "@/server/recommendation/errors";

describe("assertSalesOpportunitySourceConsistency", () => {
  it("no-op, wenn keine DetectedNeed-Zeile verknuepft ist (detectedNeedId=null)", () => {
    const input: SalesOpportunityInput = {
      detectedNeedId: null,
      detectedNeedSource: null,
      triggerSignalId: "signal-1",
      reasonCode: null,
      justificationParams: null,
      priority: null,
    };
    expect(() => assertSalesOpportunitySourceConsistency(input)).not.toThrow();
  });

  it("RULE_BASED mit gesetzter triggerSignalId ist konsistent", () => {
    const input: SalesOpportunityInput = {
      detectedNeedId: "need-1",
      detectedNeedSource: "RULE_BASED",
      triggerSignalId: "signal-1",
      reasonCode: null,
      justificationParams: null,
      priority: null,
    };
    expect(() => assertSalesOpportunitySourceConsistency(input)).not.toThrow();
  });

  it("RULE_BASED ohne triggerSignalId wirft SalesOpportunitySourceMismatchError", () => {
    const input: SalesOpportunityInput = {
      detectedNeedId: "need-1",
      detectedNeedSource: "RULE_BASED",
      triggerSignalId: null,
      reasonCode: null,
      justificationParams: null,
      priority: null,
    };
    expect(() => assertSalesOpportunitySourceConsistency(input)).toThrow(
      SalesOpportunitySourceMismatchError,
    );
  });

  it("EMPLOYEE_MARKED ohne triggerSignalId ist konsistent", () => {
    const input: SalesOpportunityInput = {
      detectedNeedId: "need-1",
      detectedNeedSource: "EMPLOYEE_MARKED",
      triggerSignalId: null,
      reasonCode: null,
      justificationParams: null,
      priority: null,
    };
    expect(() => assertSalesOpportunitySourceConsistency(input)).not.toThrow();
  });

  it("EMPLOYEE_MARKED mit gesetzter triggerSignalId wirft SalesOpportunitySourceMismatchError", () => {
    const input: SalesOpportunityInput = {
      detectedNeedId: "need-1",
      detectedNeedSource: "EMPLOYEE_MARKED",
      triggerSignalId: "signal-1",
      reasonCode: null,
      justificationParams: null,
      priority: null,
    };
    expect(() => assertSalesOpportunitySourceConsistency(input)).toThrow(
      SalesOpportunitySourceMismatchError,
    );
  });
});

describe("buildSalesOpportunityFromSignal", () => {
  it("baut einen Input OHNE DetectedNeed-Verknuepfung, triggerSignalId direkt gesetzt", () => {
    const input = buildSalesOpportunityFromSignal({
      id: "signal-1",
      reasonCode: "STREAMING_ADDON_SUGGESTED",
      justificationParams: { foo: "bar" },
      priority: 70,
    });
    expect(input).toEqual({
      detectedNeedId: null,
      detectedNeedSource: null,
      triggerSignalId: "signal-1",
      reasonCode: "STREAMING_ADDON_SUGGESTED",
      justificationParams: { foo: "bar" },
      priority: 70,
    });
  });
});

describe("buildSalesOpportunityFromEmployeeMarkedNeed", () => {
  it("baut einen Input mit EMPLOYEE_MARKED source, triggerSignalId=null", () => {
    const input = buildSalesOpportunityFromEmployeeMarkedNeed("need-1", {
      reasonCode: "MANUAL",
      justificationParams: null,
      priority: 10,
    });
    expect(input).toEqual({
      detectedNeedId: "need-1",
      detectedNeedSource: "EMPLOYEE_MARKED",
      triggerSignalId: null,
      reasonCode: "MANUAL",
      justificationParams: null,
      priority: 10,
    });
  });

  it("fehlende optionale Felder werden auf null defaultet", () => {
    const input = buildSalesOpportunityFromEmployeeMarkedNeed("need-1", {});
    expect(input.reasonCode).toBeNull();
    expect(input.justificationParams).toBeNull();
    expect(input.priority).toBeNull();
  });
});
