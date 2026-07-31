/**
 * Float-freie Dezimalwert-Hilfsfunktionen fuer die Fragen-Engine.
 *
 * `QuestionVersion.minValue`/`maxValue` und `CustomerAnswer.decimalValue`
 * sind Prisma-`Decimal`-Felder (SQL `NUMERIC(18,4)`), damit DECIMAL-Antworten
 * nie unter JS-Float-Rundungsfehlern leiden (siehe Modellierungsregel 2 in
 * `prisma/schema.prisma` und docs/DECISION_LOG.md). Diese Datei setzt dieselbe
 * Anforderung auf der reinen TypeScript-Seite um: Vergleiche/Validierung
 * erfolgen als String-Parsing auf einen skalierten `BigInt`, NIE ueber
 * `Number()`/`parseFloat()`.
 */

const SCALE = 4;
const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

/** Wirft, wenn `value` keine gueltige Dezimalzahl im erwarteten Format ist. */
export function isValidDecimalString(value: string): boolean {
  return DECIMAL_STRING_PATTERN.test(value.trim());
}

/**
 * Parst einen Dezimalstring verlustfrei in einen auf `SCALE` Nachkommastellen
 * skalierten `BigInt` (z. B. "12.5" -> 125000n bei SCALE=4). Wirft bei
 * ungueltigem Format oder mehr Nachkommastellen als `SCALE` zulaesst.
 */
export function parseDecimalToScaledBigInt(value: string): bigint {
  const trimmed = value.trim();
  if (!isValidDecimalString(trimmed)) {
    throw new Error(`Ungueltiger Dezimalwert: "${value}"`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split(".");
  const intPart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";
  if (fracPart.length > SCALE) {
    throw new Error(
      `Dezimalwert "${value}" hat mehr als ${SCALE} Nachkommastellen (NUMERIC(18,${SCALE})).`,
    );
  }
  const paddedFrac = fracPart.padEnd(SCALE, "0");
  const scaled = BigInt((intPart || "0") + paddedFrac);
  return negative ? -scaled : scaled;
}

/** Vergleicht zwei Dezimalstrings verlustfrei: -1 (a<b), 0 (a=b), 1 (a>b). */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const scaledA = parseDecimalToScaledBigInt(a);
  const scaledB = parseDecimalToScaledBigInt(b);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}
