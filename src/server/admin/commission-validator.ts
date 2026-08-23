/**
 * Serverseitiger Validator fuer `CommissionModelVersion` (Phase 10 AP4,
 * siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 6, ChatGPT-GO
 * 2026-08-21). Analog `validateDraftRuleSetVersion()` (Phase 9 AP4,
 * `rule-admin.ts`) -- prueft den ZUSAMMENGEFUEHRTEN Zustand EINER Version
 * (Skalarfelder + `CommissionTier`-Kind-Zeilen) auf fachliche Vollstaendigkeit
 * und Konsistenz, unabhaengig davon, ob die einzelnen Feld-/Tier-Mutationen
 * (`updateCommissionModelVersionFields()`/`createCommissionTier()` in
 * `commission-admin.ts`) das jeweils schon zum Mutationszeitpunkt geprueft
 * haben. Wird VOR jedem Publish (AP5) aufgerufen -- die eigentliche
 * DRAFT-Statuspruefung erfolgt dort separat (dieser Validator selbst laedt
 * ueber `requireCommissionModelVersion()`, NICHT
 * `requireDraftCommissionModelVersion()`, analog dem Rule-Pendant, das
 * ebenfalls keine eigene Statuspruefung durchfuehrt).
 *
 * Einige Pruefungen sind BEWUSST redundant zu bereits bestehenden DB-CHECK-/
 * UNIQUE-Constraints (z. B. `commission_tiers_amount_xor_percentage_check`,
 * die Threshold-/SortOrder-UNIQUE-Indizes) -- verstaendlicher
 * Validierungsfehler mit klarer `issues`-Liste statt eines rohen DB-Fehlers,
 * falls ein Constraint jemals entfaellt oder umgangen wird (identisches
 * Prinzip wie bei `ExclusionRule.reasonCode`-Eindeutigkeit in
 * `validateDraftRuleSetVersion()`).
 *
 * DIE EINE Pruefung, die NICHT redundant, sondern die einzige Stelle im
 * gesamten System ist: die Mengen-Invariante "mindestens eine
 * `CommissionTier`-Zeile mit `thresholdMinor = 0`" -- bezieht sich auf die
 * Menge ALLER Stufen einer Version und ist strukturell NICHT als
 * einzeiliger DB-CHECK abbildbar (siehe Migrationskommentar
 * `20260821190000_commission_tiers`).
 */

import { db } from "../db/client";
import { commissionAdminInternal } from "./commission-admin";
import { CommissionModelVersionInvalidError } from "./commission-admin-errors";

/**
 * Prueft eine `CommissionModelVersion` vollstaendig (Skalarfelder + Tiers)
 * und wirft `CommissionModelVersionInvalidError` mit ALLEN gefundenen
 * Verstoessen (nicht nur dem ersten), falls die Version nicht gueltig ist.
 * Bei Erfolg `{ valid: true }` (identische Rueckgabeform wie
 * `validateDraftRuleSetVersion()`).
 */
export async function validateCommissionModelVersion(
  commissionModelId: string,
  versionId: string,
): Promise<{ valid: true }> {
  await commissionAdminInternal.requireCommissionModel(db, commissionModelId);
  const version = await commissionAdminInternal.requireCommissionModelVersion(
    db,
    commissionModelId,
    versionId,
  );
  const tiers = await commissionAdminInternal.loadCommissionTiers(db, versionId);

  const issues: string[] = [];

  if (!version.currency || version.currency.length !== 3) {
    issues.push(
      `currency "${version.currency}" ist ungueltig (muss ein 3-stelliger Waehrungscode sein).`,
    );
  }

  if (version.commissionType === "FLAT") {
    if (version.commissionPercentageBasisPoints != null) {
      issues.push("commissionPercentageBasisPoints muss bei commissionType FLAT null sein.");
    }
    if (version.commissionAmountMinor == null && version.recurringCommissionAmountMinor == null) {
      issues.push(
        "FLAT-Version ohne commissionAmountMinor und ohne recurringCommissionAmountMinor " +
          "(kein Provisionswert konfiguriert).",
      );
    }
    if (tiers.length > 0) {
      issues.push(
        `CommissionModelVersion mit commissionType FLAT darf keine CommissionTier-Zeilen ` +
          `besitzen (${tiers.length} gefunden).`,
      );
    }
  } else if (version.commissionType === "PERCENTAGE") {
    if (version.commissionAmountMinor != null || version.recurringCommissionAmountMinor != null) {
      issues.push(
        "commissionAmountMinor und recurringCommissionAmountMinor muessen bei commissionType " +
          "PERCENTAGE null sein.",
      );
    }
    if (version.commissionPercentageBasisPoints == null) {
      issues.push("PERCENTAGE-Version ohne commissionPercentageBasisPoints.");
    }
    if (tiers.length > 0) {
      issues.push(
        `CommissionModelVersion mit commissionType PERCENTAGE darf keine CommissionTier-Zeilen ` +
          `besitzen (${tiers.length} gefunden).`,
      );
    }
  } else if (version.commissionType === "TIERED") {
    if (
      version.commissionAmountMinor != null ||
      version.commissionPercentageBasisPoints != null ||
      version.recurringCommissionAmountMinor != null
    ) {
      issues.push(
        "commissionAmountMinor, commissionPercentageBasisPoints und " +
          "recurringCommissionAmountMinor muessen bei commissionType TIERED alle null sein.",
      );
    }

    if (tiers.length === 0) {
      issues.push("TIERED-Version ohne jede CommissionTier-Zeile (mindestens eine erforderlich).");
    } else {
      if (!tiers.some((t) => t.thresholdMinor === 0)) {
        issues.push(
          "TIERED-Version benoetigt mindestens eine CommissionTier-Zeile mit thresholdMinor = 0 " +
            "(deckt jeden Betrag ab).",
        );
      }

      const seenThresholds = new Set<number>();
      const seenSortOrders = new Set<number>();
      for (const tier of tiers) {
        if (tier.thresholdMinor < 0) {
          issues.push(`CommissionTier "${tier.id}": thresholdMinor darf nicht negativ sein.`);
        }
        if (seenThresholds.has(tier.thresholdMinor)) {
          issues.push(
            `CommissionTier "${tier.id}": thresholdMinor ${tier.thresholdMinor} ist innerhalb ` +
              `dieser Version nicht eindeutig.`,
          );
        }
        seenThresholds.add(tier.thresholdMinor);

        if (seenSortOrders.has(tier.sortOrder)) {
          issues.push(
            `CommissionTier "${tier.id}": sortOrder ${tier.sortOrder} ist innerhalb dieser ` +
              `Version nicht eindeutig.`,
          );
        }
        seenSortOrders.add(tier.sortOrder);

        const hasAmount = tier.tierAmountMinor != null;
        const hasPercentage = tier.tierPercentageBasisPoints != null;
        if (hasAmount === hasPercentage) {
          issues.push(
            `CommissionTier "${tier.id}": genau eines von tierAmountMinor oder ` +
              `tierPercentageBasisPoints muss gesetzt sein (nie beides, nie keins).`,
          );
        }
      }
    }
  } else {
    issues.push(`Unbekannter commissionType "${version.commissionType}".`);
  }

  if (issues.length > 0) {
    throw new CommissionModelVersionInvalidError(versionId, issues);
  }

  return { valid: true };
}
