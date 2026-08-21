/**
 * Gemeinsame Provisions-/Commission-Aufloesungslogik (Phase 6 AP3, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 8.1 Punkt 2).
 *
 * `loadActiveCommissionModelVersions()` und `buildResolveCommission()` waren
 * urspruenglich private Funktionen in `recommendation/service.ts` (Phase 3B).
 * Sie wurden HIERHIN VERSCHOBEN (nicht kopiert-und-geaendert), damit sowohl
 * die Empfehlungs-Engine als auch die neue Deal-Erfassung (Phase 6) dieselbe
 * Aufloesungsquelle nutzen, statt sie zu duplizieren (ChatGPT-Vorgabe im
 * Phase-6-Plan-Review). Verhalten dieser beiden Funktionen ist unveraendert
 * gegenueber der urspruenglichen Fassung in `recommendation/service.ts`.
 *
 * NEU fuer Phase 6: `commissionPercentageBasisPoints` wird zusaetzlich
 * geladen (die Empfehlungs-Engine benoetigte dieses Feld nicht, da sie zum
 * Empfehlungszeitpunkt noch keinen finalen Verkaufspreis kennt und bei
 * PERCENTAGE-Provisionsmodellen bewusst `commissionValueMinor = null`
 * zurueckgibt, siehe `buildResolveCommission`). Die Deal-Erfassung kennt zum
 * Abschlusszeitpunkt den tatsaechlichen Preis und kann daher ueber
 * `computeCommissionAmountMinor()` auch PERCENTAGE-Provisionen in einen
 * konkreten Minor-Betrag umrechnen.
 */

// CommissionResolution bleibt in recommendation/types.ts definiert (dort
// Teil der breiteren Domain-Typen der Empfehlungs-Engine); hier nur
// importiert + re-exportiert, um einen einzigen Typ ohne Duplikat/Drift zu
// behalten.
import type { CommissionResolution } from "../recommendation/types";
export type { CommissionResolution } from "../recommendation/types";
import type { ScopedPrismaClient } from "../tenant/scoped-client";

// Identisches Herleitungsmuster wie in recommendation/service.ts und
// questionnaire/service.ts (siehe dortige Modulkommentare zu CI #5): NICHT
// als eigenstaendiger/hand-typisierter Client-Typ, sondern aus dem echten
// ScopedPrismaClient abgeleitet, damit sowohl der volle ScopedPrismaClient
// (`db`) als auch ein Transaktions-Client (`tx` in `db.$transaction(...)`)
// unveraendert uebergeben werden koennen.
export type QueryClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];

export interface CommissionModelVersionRow {
  id: string;
  productId: string;
  /**
   * Phase 10 AP2 (ChatGPT-GO 2026-08-21, siehe PHASE_10_IMPLEMENTATION_PLAN.md
   * Abschnitt 4/14): Grundlage des neuen, fachlich begruendeten Tie-Breakers
   * `ORDER BY validFrom DESC, id DESC` in `buildResolveCommission()` --
   * ersetzt den bisherigen rein technischen "kleinste id gewinnt"-Tie-Breaker.
   */
  validFrom: Date;
  commissionType: string;
  commissionAmountMinor: number | null;
  /** NEU fuer Phase 6 (siehe Modulkommentar) -- von der Empfehlungs-Engine ungenutzt. */
  commissionPercentageBasisPoints: number | null;
  recurringCommissionAmountMinor: number | null;
}

export async function loadActiveCommissionModelVersions(
  client: QueryClient,
  atTime: Date,
): Promise<CommissionModelVersionRow[]> {
  const rows = await client.commissionModelVersion.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: atTime },
      OR: [{ validTo: null }, { validTo: { gt: atTime } }],
    },
    include: { commissionModel: { select: { productId: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    productId: r.commissionModel.productId,
    validFrom: r.validFrom,
    commissionType: r.commissionType as string,
    commissionAmountMinor: r.commissionAmountMinor,
    commissionPercentageBasisPoints: r.commissionPercentageBasisPoints,
    recurringCommissionAmountMinor: r.recurringCommissionAmountMinor,
  }));
}

/**
 * Baut die Provisions-Aufloesungsfunktion fuer prioritization.ts. Existieren
 * fuer ein Produkt mehrere gleichzeitig gueltige CommissionModelVersion-Zeilen
 * (schema-seitig nicht ausgeschlossen, da CommissionModel keinen
 * Unique-Constraint auf productId hat -- ChatGPT-Entscheidung Phase 10 AP0/AP2:
 * bewusst KEIN erzwungener Unique-Constraint, mehrere CommissionModels pro
 * Produkt bleiben fachlich zulaessig), wird deterministisch die Version mit
 * der JUENGSTEN `validFrom` gewaehlt; bei exakter Zeitgleichheit entscheidet
 * zusaetzlich die groesste `id` (Phase 10 AP2, ChatGPT-GO 2026-08-21:
 * "ORDER BY validFrom DESC, id DESC" -- ersetzt den vormaligen rein
 * technischen "kleinste id gewinnt"-Tie-Breaker aus Phase 3B/6, der KEINE
 * fachliche Bedeutung hatte).
 */
export function buildResolveCommission(
  rows: CommissionModelVersionRow[],
): (productId: string) => CommissionResolution | null {
  const byProduct = new Map<string, CommissionModelVersionRow>();
  for (const row of rows) {
    const existing = byProduct.get(row.productId);
    if (!existing) {
      byProduct.set(row.productId, row);
      continue;
    }
    const validFromDiff = row.validFrom.getTime() - existing.validFrom.getTime();
    if (validFromDiff > 0 || (validFromDiff === 0 && row.id.localeCompare(existing.id) > 0)) {
      byProduct.set(row.productId, row);
    }
  }

  return (productId: string): CommissionResolution | null => {
    const row = byProduct.get(productId);
    if (!row) return null;
    const commissionValueMinor =
      row.commissionType === "PERCENTAGE"
        ? null
        : (row.commissionAmountMinor ?? row.recurringCommissionAmountMinor ?? null);
    return { commissionModelVersionId: row.id, commissionValueMinor };
  };
}

/**
 * NEU fuer Phase 6: berechnet den konkreten Provisions-Minor-Betrag fuer
 * einen bekannten Basisbetrag (z. B. den tatsaechlichen einmaligen oder
 * monatlichen Deal-Preis eines DealItem). Im Unterschied zu
 * `buildResolveCommission()` (das bei PERCENTAGE bewusst `null` liefert,
 * weil der Empfehlungs-Engine der finale Preis noch fehlt) kennt die
 * Deal-Erfassung den Preis bereits.
 *
 * Bewusst OHNE Fallback zwischen `commissionAmountMinor` (einmalig) und
 * `recurringCommissionAmountMinor` (wiederkehrend) -- anders als das
 * einzelne `commissionValueMinor` aus `buildResolveCommission()` (dort fuer
 * die Empfehlungs-Engine ausreichend, da nur EIN Skalarwert benoetigt wird),
 * braucht die Deal-Erfassung BEIDE Betraege GLEICHZEITIG und UNABHAENGIG
 * voneinander (`DealFinancialSnapshot.commissionAmountMinor` UND
 * `.expectedRecurringCommissionMinor`). Der Aufrufer waehlt daher explizit,
 * welches FIXED-Feld fuer diesen Aufruf gilt; bei PERCENTAGE gilt in jedem
 * Fall derselbe Basis-Points-Satz, angewendet auf den jeweils uebergebenen
 * `baseAmountMinor` (einmalig ODER monatlich, je nach Aufruf).
 *
 * @param row Aufgeloeste CommissionModelVersion-Zeile fuer das Produkt.
 * @param baseAmountMinor Betrag, auf den sich `commissionType` bei
 *   PERCENTAGE bezieht (z. B. `oneTimePriceMinor` oder `monthlyPriceMinor`).
 * @param fixedAmountMinor Bei FIXED zu verwendender Betrag -- vom Aufrufer
 *   explizit `row.commissionAmountMinor` (einmalig) oder
 *   `row.recurringCommissionAmountMinor` (wiederkehrend) uebergeben.
 * @returns Provisions-Minor-Betrag, oder `null` falls sich mangels
 *   Basisdaten kein Betrag berechnen laesst (z. B. PERCENTAGE ohne
 *   `commissionPercentageBasisPoints`, oder FIXED ohne den uebergebenen Wert).
 */
export function computeCommissionAmountMinor(
  row: CommissionModelVersionRow,
  baseAmountMinor: number,
  fixedAmountMinor: number | null,
): number | null {
  if (row.commissionType === "PERCENTAGE") {
    if (row.commissionPercentageBasisPoints == null) return null;
    // Basis Points: 10000 = 100.00%. Kaufmaennische Rundung auf ganze Minor-Einheiten.
    return Math.round((baseAmountMinor * row.commissionPercentageBasisPoints) / 10000);
  }
  return fixedAmountMinor;
}
