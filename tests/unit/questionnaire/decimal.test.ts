import { describe, expect, it } from "vitest";
import {
  compareDecimalStrings,
  isValidDecimalString,
  parseDecimalToScaledBigInt,
} from "@/server/questionnaire/decimal";

describe("isValidDecimalString", () => {
  it("akzeptiert ganze Zahlen und Dezimalzahlen, positiv und negativ", () => {
    expect(isValidDecimalString("42")).toBe(true);
    expect(isValidDecimalString("-42")).toBe(true);
    expect(isValidDecimalString("12.5")).toBe(true);
    expect(isValidDecimalString("-12.5000")).toBe(true);
    expect(isValidDecimalString("0")).toBe(true);
  });

  it("lehnt ungueltige Formate ab", () => {
    expect(isValidDecimalString("abc")).toBe(false);
    expect(isValidDecimalString("1.2.3")).toBe(false);
    expect(isValidDecimalString("")).toBe(false);
    expect(isValidDecimalString("1,5")).toBe(false);
    expect(isValidDecimalString("Infinity")).toBe(false);
    expect(isValidDecimalString("NaN")).toBe(false);
  });
});

describe("parseDecimalToScaledBigInt", () => {
  it("parst verlustfrei auf 4 Nachkommastellen", () => {
    expect(parseDecimalToScaledBigInt("12.5")).toBe(125000n);
    expect(parseDecimalToScaledBigInt("-12.5")).toBe(-125000n);
    expect(parseDecimalToScaledBigInt("0")).toBe(0n);
    expect(parseDecimalToScaledBigInt("100.0001")).toBe(1000001n);
  });

  it("wirft bei mehr als 4 Nachkommastellen (NUMERIC(18,4)-Grenze)", () => {
    expect(() => parseDecimalToScaledBigInt("1.23456")).toThrow(/Nachkommastellen/);
  });

  it("wirft bei ungueltigem Format", () => {
    expect(() => parseDecimalToScaledBigInt("abc")).toThrow(/Ungueltiger Dezimalwert/);
  });
});

describe("compareDecimalStrings", () => {
  it("vergleicht korrekt ohne Float-Rundungsfehler", () => {
    // Bekanntes Float-Fallstrick-Beispiel: 0.1 + 0.2 !== 0.3 in JS-Floats.
    expect(compareDecimalStrings("0.1", "0.3")).toBe(-1);
    expect(compareDecimalStrings("0.3", "0.1")).toBe(1);
    expect(compareDecimalStrings("12.5000", "12.5")).toBe(0);
    expect(compareDecimalStrings("-1", "1")).toBe(-1);
    expect(compareDecimalStrings("100", "100")).toBe(0);
  });
});
