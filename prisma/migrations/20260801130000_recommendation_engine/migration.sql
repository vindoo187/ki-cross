-- Phase 3B: Deterministische Regel- und Empfehlungs-Engine
-- (ChatGPT-Implementierungs-GO 2026-08-01, PHASE_3B_IMPLEMENTATION_PLAN.md
-- Revision 3.2, korrigierte Fassung).
--
-- Additive Migration gemaess Plan-Abschnitt 10. Keine bestehende Migration
-- wird veraendert; alle Aenderungen sind additiv oder umbenennend
-- (expression -> legacy_expression), ausser dem einen dokumentierten
-- Typwechsel auf recommendation_items.business_priority_score.

-- =============================================================================
-- 0) Pre-Migration-Checks (kontrollierter Abbruch bei unerwarteten Bestandsdaten)
-- =============================================================================

-- 0a) business_priority_score-Wertebereich pruefen, bevor der Spaltentyp von
--     double precision auf integer gewechselt wird (Plan Abschnitt 10,
--     "Bestandspruefung").
DO $$
DECLARE
  out_of_range_count integer;
BEGIN
  SELECT count(*) INTO out_of_range_count
  FROM "recommendation_items"
  WHERE abs("business_priority_score") >= 2147483647;

  IF out_of_range_count > 0 THEN
    RAISE EXCEPTION 'Migration abgebrochen: % recommendation_items.business_priority_score-Werte ausserhalb des Int-Bereichs (abs >= 2147483647)', out_of_range_count;
  END IF;
END $$;

-- 0b) Bestehende RULE_BASED-SalesOpportunity-Zeilen pruefen. Fuer diese
--     Zeilen kann kein reproduzierbarer RecommendationCrossSellingSignal-
--     Snapshot nachtraeglich erzeugt werden (Plan Abschnitt 10,
--     "Cross-Selling-Upgrade-Pfad", Korrekturpunkt 5) - kontrollierter
--     Abbruch statt stillem Backfill oder erfundenem Snapshot.
DO $$
DECLARE
  rule_based_count integer;
BEGIN
  SELECT count(*) INTO rule_based_count
  FROM "sales_opportunities" so
  JOIN "detected_needs" dn ON dn.id = so.detected_need_id
  WHERE dn.source = 'RULE_BASED';

  IF rule_based_count > 0 THEN
    RAISE EXCEPTION 'Migration abgebrochen: % bestehende RULE_BASED-SalesOpportunity-Zeilen ohne trigger_signal_id gefunden - manuelle fachliche Pruefung noetig (siehe PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 10)', rule_based_count;
  END IF;
END $$;

-- =============================================================================
-- 1) Neuer Enum-Typ
-- =============================================================================

CREATE TYPE "ConditionSourceType" AS ENUM ('ANSWER', 'PRODUCT_ATTRIBUTE', 'SESSION_ATTRIBUTE');

-- =============================================================================
-- 2) Regeltabellen: expression -> legacy_expression, neue Spalten
-- =============================================================================

ALTER TABLE "eligibility_rules" RENAME COLUMN "expression" TO "legacy_expression";
ALTER TABLE "eligibility_rules" ALTER COLUMN "legacy_expression" DROP NOT NULL;
ALTER TABLE "eligibility_rules" ADD COLUMN "is_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "eligibility_rules" ADD COLUMN "fit_weight" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "exclusion_rules" RENAME COLUMN "expression" TO "legacy_expression";
ALTER TABLE "exclusion_rules" ALTER COLUMN "legacy_expression" DROP NOT NULL;
ALTER TABLE "exclusion_rules" ADD COLUMN "justification_params" JSONB;
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_reason_code_not_empty_check" CHECK ("reason_code" <> '');
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_tenant_id_rule_set_version_id_reason_code_key" UNIQUE ("tenant_id", "rule_set_version_id", "reason_code");

ALTER TABLE "prioritization_rules" RENAME COLUMN "expression" TO "legacy_expression";
ALTER TABLE "prioritization_rules" ALTER COLUMN "legacy_expression" DROP NOT NULL;
ALTER TABLE "prioritization_rules" ADD COLUMN "commission_required" BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- 3) sales_opportunities: neue, nullable Cross-Selling-/Follow-up-Felder
--    (bewusst ohne DB-CHECK auf Source-Konsistenz, siehe 3.4/3.6 des Plans -
--    Durchsetzung erfolgt in src/server/recommendation/sales-opportunity.ts)
-- =============================================================================

ALTER TABLE "sales_opportunities" ADD COLUMN "trigger_signal_id" UUID;
ALTER TABLE "sales_opportunities" ADD COLUMN "reason_code" TEXT;
ALTER TABLE "sales_opportunities" ADD COLUMN "justification_params" JSONB;
ALTER TABLE "sales_opportunities" ADD COLUMN "priority" INTEGER;
ALTER TABLE "sales_opportunities" ADD COLUMN "follow_up_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales_opportunities" ADD COLUMN "follow_up_reason_code" TEXT;

-- =============================================================================
-- 3b) customer_answers: fehlende @@unique([tenantId, id]) ergaenzen.
--     Wird von recommendation_cross_selling_signals.source_answer_id als
--     composite-FK-Ziel benoetigt (customer_answers war zuvor nie Ziel
--     einer tenant-gebundenen composite FK).
-- =============================================================================

CREATE UNIQUE INDEX "customer_answers_tenant_id_id_key" ON "customer_answers" ("tenant_id", "id");

-- Analog: commission_model_versions war zuvor nie composite-FK-Ziel;
-- wird von recommendation_rationales.commission_model_version_id benoetigt.
CREATE UNIQUE INDEX "commission_model_versions_tenant_id_id_key" ON "commission_model_versions" ("tenant_id", "id");

-- =============================================================================
-- 4) Neue Tabellen: CrossSellingRule + vier Condition-Tabellen
-- =============================================================================

CREATE TABLE "cross_selling_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rule_set_version_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "need_type" "NeedType" NOT NULL,
  "priority" INTEGER NOT NULL,
  "reason_code" TEXT NOT NULL,
  "suggested_product_version_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "eligibility_rule_conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "eligibility_rule_id" UUID NOT NULL,
  "group_index" INTEGER NOT NULL,
  "source_type" "ConditionSourceType" NOT NULL,
  "question_id" UUID,
  "attribute_key" TEXT,
  "operator" "VisibilityOperator" NOT NULL,
  "comparison_value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "exclusion_rule_conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "exclusion_rule_id" UUID NOT NULL,
  "group_index" INTEGER NOT NULL,
  "source_type" "ConditionSourceType" NOT NULL,
  "question_id" UUID,
  "attribute_key" TEXT,
  "operator" "VisibilityOperator" NOT NULL,
  "comparison_value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "prioritization_rule_conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "prioritization_rule_id" UUID NOT NULL,
  "group_index" INTEGER NOT NULL,
  "source_type" "ConditionSourceType" NOT NULL,
  "question_id" UUID,
  "attribute_key" TEXT,
  "operator" "VisibilityOperator" NOT NULL,
  "comparison_value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "cross_selling_rule_conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "cross_selling_rule_id" UUID NOT NULL,
  "group_index" INTEGER NOT NULL,
  "source_type" "ConditionSourceType" NOT NULL,
  "question_id" UUID,
  "attribute_key" TEXT,
  "operator" "VisibilityOperator" NOT NULL,
  "comparison_value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

-- =============================================================================
-- 5) recommendations: Algorithmus-/Fingerprint-Felder
--    (NOT NULL ohne Prisma-Default -> temporaerer SQL-Default fuer
--    bestehende Zeilen, danach DROP DEFAULT, damit das Schema exakt dem
--    Prisma-Modell entspricht und kuenftige INSERTs die Werte explizit
--    liefern muessen)
-- =============================================================================

ALTER TABLE "recommendations" ADD COLUMN "algorithm_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "recommendations" ALTER COLUMN "algorithm_version" DROP DEFAULT;

ALTER TABLE "recommendations" ADD COLUMN "evaluation_fingerprint" CHAR(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE "recommendations" ALTER COLUMN "evaluation_fingerprint" DROP DEFAULT;

ALTER TABLE "recommendations" ADD COLUMN "input_data_completeness_score" DOUBLE PRECISION;

ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_tenant_id_consultation_session_id_evaluation_fi" UNIQUE ("tenant_id", "consultation_session_id", "evaluation_fingerprint");

-- =============================================================================
-- 6) recommendation_cross_selling_signals
-- =============================================================================

CREATE TABLE "recommendation_cross_selling_signals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "recommendation_id" UUID NOT NULL,
  "trigger_rule_id" UUID NOT NULL,
  "trigger_rule_set_version_id" UUID NOT NULL,
  "source_answer_id" UUID,
  "need_type" "NeedType" NOT NULL,
  "reason_code" TEXT NOT NULL,
  "justification_params" JSONB,
  "priority" INTEGER NOT NULL,
  "suggested_product_version_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

-- =============================================================================
-- 7) recommendation_items: customer_fit_score + Typwechsel business_priority_score
-- =============================================================================

ALTER TABLE "recommendation_items" ADD COLUMN "customer_fit_score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "recommendation_items" ALTER COLUMN "customer_fit_score" DROP DEFAULT;

-- Wertebereich wurde in Abschnitt 0a bereits geprueft.
ALTER TABLE "recommendation_items" ALTER COLUMN "business_priority_score" TYPE INTEGER USING round("business_priority_score")::integer;

-- =============================================================================
-- 8) recommendation_rationales: Provisions-Pinning (einzige Stelle, siehe 3.8)
-- =============================================================================

ALTER TABLE "recommendation_rationales" ADD COLUMN "commission_model_version_id" UUID;
ALTER TABLE "recommendation_rationales" ADD COLUMN "commission_value_minor" INTEGER;

-- =============================================================================
-- 9) Unique-/Index-Definitionen fuer neue Tabellen
-- =============================================================================

CREATE UNIQUE INDEX "cross_selling_rules_tenant_id_id_key" ON "cross_selling_rules" ("tenant_id", "id");
CREATE INDEX "cross_selling_rules_tenant_id_rule_set_version_id_idx" ON "cross_selling_rules" ("tenant_id", "rule_set_version_id");

CREATE UNIQUE INDEX "eligibility_rule_conditions_tenant_id_id_key" ON "eligibility_rule_conditions" ("tenant_id", "id");
CREATE INDEX "eligibility_rule_conditions_tenant_id_eligibility_rule_id_idx" ON "eligibility_rule_conditions" ("tenant_id", "eligibility_rule_id");

CREATE UNIQUE INDEX "exclusion_rule_conditions_tenant_id_id_key" ON "exclusion_rule_conditions" ("tenant_id", "id");
CREATE INDEX "exclusion_rule_conditions_tenant_id_exclusion_rule_id_idx" ON "exclusion_rule_conditions" ("tenant_id", "exclusion_rule_id");

CREATE UNIQUE INDEX "prioritization_rule_conditions_tenant_id_id_key" ON "prioritization_rule_conditions" ("tenant_id", "id");
CREATE INDEX "prioritization_rule_conditions_tenant_id_prioritization_rule_id" ON "prioritization_rule_conditions" ("tenant_id", "prioritization_rule_id");

CREATE UNIQUE INDEX "cross_selling_rule_conditions_tenant_id_id_key" ON "cross_selling_rule_conditions" ("tenant_id", "id");
CREATE INDEX "cross_selling_rule_conditions_tenant_id_cross_selling_rule_id_i" ON "cross_selling_rule_conditions" ("tenant_id", "cross_selling_rule_id");

CREATE UNIQUE INDEX "recommendation_cross_selling_signals_tenant_id_id_key" ON "recommendation_cross_selling_signals" ("tenant_id", "id");
CREATE INDEX "recommendation_cross_selling_signals_tenant_id_recommendation_i" ON "recommendation_cross_selling_signals" ("tenant_id", "recommendation_id");

-- =============================================================================
-- 10) Fremdschluessel
-- =============================================================================

ALTER TABLE "cross_selling_rules" ADD CONSTRAINT "cross_selling_rules_tenant_id_rule_set_version_id_fkey" FOREIGN KEY ("tenant_id", "rule_set_version_id") REFERENCES "rule_set_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "cross_selling_rules" ADD CONSTRAINT "cross_selling_rules_tenant_id_suggested_product_version_id_fkey" FOREIGN KEY ("tenant_id", "suggested_product_version_id") REFERENCES "product_versions" ("tenant_id", "id") ON DELETE SET NULL;

ALTER TABLE "eligibility_rule_conditions" ADD CONSTRAINT "eligibility_rule_conditions_tenant_id_eligibility_rule_id_fkey" FOREIGN KEY ("tenant_id", "eligibility_rule_id") REFERENCES "eligibility_rules" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "eligibility_rule_conditions" ADD CONSTRAINT "eligibility_rule_conditions_tenant_id_question_id_fkey" FOREIGN KEY ("tenant_id", "question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "exclusion_rule_conditions" ADD CONSTRAINT "exclusion_rule_conditions_tenant_id_exclusion_rule_id_fkey" FOREIGN KEY ("tenant_id", "exclusion_rule_id") REFERENCES "exclusion_rules" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exclusion_rule_conditions" ADD CONSTRAINT "exclusion_rule_conditions_tenant_id_question_id_fkey" FOREIGN KEY ("tenant_id", "question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "prioritization_rule_conditions" ADD CONSTRAINT "prioritization_rule_conditions_tenant_id_prioritization_rule_id" FOREIGN KEY ("tenant_id", "prioritization_rule_id") REFERENCES "prioritization_rules" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "prioritization_rule_conditions" ADD CONSTRAINT "prioritization_rule_conditions_tenant_id_question_id_fkey" FOREIGN KEY ("tenant_id", "question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "cross_selling_rule_conditions" ADD CONSTRAINT "cross_selling_rule_conditions_tenant_id_cross_selling_rule_id_f" FOREIGN KEY ("tenant_id", "cross_selling_rule_id") REFERENCES "cross_selling_rules" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "cross_selling_rule_conditions" ADD CONSTRAINT "cross_selling_rule_conditions_tenant_id_question_id_fkey" FOREIGN KEY ("tenant_id", "question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "recommendation_cross_selling_signals" ADD CONSTRAINT "recommendation_cross_selling_signals_tenant_id_recommendation_i" FOREIGN KEY ("tenant_id", "recommendation_id") REFERENCES "recommendations" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_cross_selling_signals" ADD CONSTRAINT "recommendation_cross_selling_signals_tenant_id_trigger_rule_id_" FOREIGN KEY ("tenant_id", "trigger_rule_id") REFERENCES "cross_selling_rules" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_cross_selling_signals" ADD CONSTRAINT "recommendation_cross_selling_signals_tenant_id_trigger_rule_set" FOREIGN KEY ("tenant_id", "trigger_rule_set_version_id") REFERENCES "rule_set_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_cross_selling_signals" ADD CONSTRAINT "recommendation_cross_selling_signals_tenant_id_source_answer_id" FOREIGN KEY ("tenant_id", "source_answer_id") REFERENCES "customer_answers" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_cross_selling_signals" ADD CONSTRAINT "recommendation_cross_selling_signals_tenant_id_suggested_produc" FOREIGN KEY ("tenant_id", "suggested_product_version_id") REFERENCES "product_versions" ("tenant_id", "id") ON DELETE RESTRICT;

-- sales_opportunities.trigger_signal_id -> RESTRICT (nicht SetNull): eine
-- SalesOpportunity mit RULE_BASED-Herkunft darf ihren Signal-Snapshot nicht
-- verlieren (Plan Abschnitt 3.4/3.6).
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_tenant_id_trigger_signal_id_fkey" FOREIGN KEY ("tenant_id", "trigger_signal_id") REFERENCES "recommendation_cross_selling_signals" ("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "recommendation_rationales" ADD CONSTRAINT "recommendation_rationales_tenant_id_commission_model_version_id" FOREIGN KEY ("tenant_id", "commission_model_version_id") REFERENCES "commission_model_versions" ("tenant_id", "id") ON DELETE RESTRICT;

-- =============================================================================
-- 11) Neuer EXCLUDE-Constraint: hoechstens eine ACTIVE RuleSetVersion je
--     Tenant ueber alle RuleSets hinweg (zusaetzlich zum bestehenden
--     rule_set_versions_no_overlap, der je RuleSet scoped ist).
--     btree_gist ist bereits durch die init-Migration installiert.
-- =============================================================================

ALTER TABLE "rule_set_versions" ADD CONSTRAINT "rule_set_versions_tenant_active_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');

-- =============================================================================
-- 12) Append-only-Trigger (forbid_update_delete() bereits in der
--     init-Migration definiert) - explizit NICHT auf sales_opportunities
--     (bleibt mutabel, siehe 3.6).
-- =============================================================================

CREATE TRIGGER recommendations_append_only
BEFORE UPDATE OR DELETE ON "recommendations"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER recommendation_items_append_only
BEFORE UPDATE OR DELETE ON "recommendation_items"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER recommendation_rationales_append_only
BEFORE UPDATE OR DELETE ON "recommendation_rationales"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER recommendation_outcomes_append_only
BEFORE UPDATE OR DELETE ON "recommendation_outcomes"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER recommendation_cross_selling_signals_append_only
BEFORE UPDATE OR DELETE ON "recommendation_cross_selling_signals"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
