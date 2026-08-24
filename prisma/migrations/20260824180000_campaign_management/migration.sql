-- Phase 13 AP1 (Campaign Management, siehe PHASE_13_IMPLEMENTATION_PLAN.md,
-- ChatGPT-GO 2026-08-24). Erweitert das bestehende Phase-2-Skelett
-- (campaigns/campaign_versions existierten bereits mit EXCLUDE-Constraint,
-- siehe 20260731000000_init) um Scope/Audit-Felder auf campaign_versions
-- sowie zwei neue Tabellen: campaign_conditions (Kampagnen-Bedingungen,
-- ChatGPT-Detailentscheidung Punkt 1) und recommendation_campaign_signals
-- (Analytics-Grundlage fuer AP7, ChatGPT-Detailentscheidung Punkt 3).
--
-- Referenzpruefung vor dieser Migration (ChatGPT-Auflage, "keine stille
-- Breaking-Change-Migration"): campaign_versions hatte bislang KEINE
-- eingehenden Fremdschluessel von anderen Tabellen (siehe AP0-Discovery) --
-- die Spaltenaenderungen unten sind daher gefahrlos additiv/non-breaking.

-- =============================================================================
-- 1) campaign_versions: Scope- und Audit-Felder ergaenzen
-- =============================================================================

CREATE TYPE "CampaignScopeType" AS ENUM ('TENANT', 'STORE');

-- scope_type/scope_id zunaechst NULLable hinzufuegen (Tabelle kann bereits
-- Zeilen aus dem Phase-2-Skelett enthalten), dann NOT NULL erzwingen -- in
-- der synthetischen Test-/Seed-Datenbank sind aktuell keine Zeilen vorhanden,
-- daher ist der zweite Schritt unkritisch.
ALTER TABLE "campaign_versions" ADD COLUMN "scope_type" "CampaignScopeType";
ALTER TABLE "campaign_versions" ADD COLUMN "scope_id" UUID;
UPDATE "campaign_versions" SET "scope_type" = 'TENANT', "scope_id" = "tenant_id" WHERE "scope_type" IS NULL;
ALTER TABLE "campaign_versions" ALTER COLUMN "scope_type" SET NOT NULL;
ALTER TABLE "campaign_versions" ALTER COLUMN "scope_id" SET NOT NULL;

ALTER TABLE "campaign_versions" ALTER COLUMN "description" DROP NOT NULL;

ALTER TABLE "campaign_versions" ADD COLUMN "created_by_user_id" UUID;
ALTER TABLE "campaign_versions" ADD CONSTRAINT "campaign_versions_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE SET NULL;

CREATE INDEX "campaign_versions_tenant_id_scope_type_scope_id_idx" ON "campaign_versions" ("tenant_id", "scope_type", "scope_id");
CREATE INDEX "campaign_versions_tenant_id_created_by_user_id_idx" ON "campaign_versions" ("tenant_id", "created_by_user_id");

-- Nachbesserung (CI #113 rot, Prisma-Validierungsfehler P1012): fehlte im
-- ersten Anlauf, wird von campaign_conditions.campaign_version_id und
-- recommendation_campaign_signals.campaign_version_id referenziert -- analog
-- den bestehenden *_tenant_id_id_key-Indizes bei question_versions,
-- rule_set_versions, commission_model_versions, goal_versions.
CREATE UNIQUE INDEX "campaign_versions_tenant_id_id_key" ON "campaign_versions" ("tenant_id", "id");

-- =============================================================================
-- 2) campaign_conditions
-- =============================================================================

CREATE TABLE "campaign_conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "campaign_version_id" UUID NOT NULL,
  "group_index" INTEGER NOT NULL,
  "source_type" "ConditionSourceType" NOT NULL,
  "question_id" UUID,
  "attribute_key" TEXT,
  "operator" "VisibilityOperator" NOT NULL,
  "comparison_value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "campaign_conditions" ADD CONSTRAINT "campaign_conditions_tenant_id_campaign_version_id_fkey" FOREIGN KEY ("tenant_id", "campaign_version_id") REFERENCES "campaign_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "campaign_conditions" ADD CONSTRAINT "campaign_conditions_tenant_id_question_id_fkey" FOREIGN KEY ("tenant_id", "question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "campaign_conditions_tenant_id_id_key" ON "campaign_conditions" ("tenant_id", "id");
CREATE INDEX "campaign_conditions_tenant_id_campaign_version_id_idx" ON "campaign_conditions" ("tenant_id", "campaign_version_id");

-- =============================================================================
-- 3) recommendation_campaign_signals (Analytics-Grundlage, AP7-Vorbereitung)
-- =============================================================================

CREATE TABLE "recommendation_campaign_signals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "recommendation_item_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "campaign_version_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "recommendation_campaign_signals" ADD CONSTRAINT "rec_campaign_signal_item_fkey" FOREIGN KEY ("tenant_id", "recommendation_item_id") REFERENCES "recommendation_items" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_campaign_signals" ADD CONSTRAINT "rec_campaign_signal_campaign_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_campaign_signals" ADD CONSTRAINT "rec_campaign_signal_campaign_version_fkey" FOREIGN KEY ("tenant_id", "campaign_version_id") REFERENCES "campaign_versions" ("tenant_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "recommendation_campaign_signals_tenant_id_id_key" ON "recommendation_campaign_signals" ("tenant_id", "id");
CREATE INDEX "rec_campaign_signals_item_idx" ON "recommendation_campaign_signals" ("tenant_id", "recommendation_item_id");
CREATE INDEX "recommendation_campaign_signals_tenant_id_campaign_id_idx" ON "recommendation_campaign_signals" ("tenant_id", "campaign_id");

-- =============================================================================
-- 4) Append-only-Durchsetzung (bestehender Trigger-Mechanismus, siehe
--    20260731000000_init Abschnitt 3) auf die neue Signal-Tabelle ausweiten,
--    analog recommendation_cross_selling_signals.
-- =============================================================================

CREATE TRIGGER recommendation_campaign_signals_append_only
BEFORE UPDATE OR DELETE ON "recommendation_campaign_signals"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
