-- Phase 11 AP1 (Ziele-Modell, siehe PHASE_11_IMPLEMENTATION_PLAN.md,
-- ChatGPT finales GO 2026-08-22, Commit 5cd94d2). Rein additive Migration --
-- drei neue Enums, zwei neue Tabellen, keine Aenderung an bestehenden
-- Tabellen/Zeilen.
--
-- Goal (Identitaet: Scope+Metrik+Periode) + GoalVersion (Zielwert-Historie)
-- -- bewusst KEIN status-Feld auf GoalVersion (kein Draft/Publish-Workflow
-- wie bei Questionnaire/RuleSet/CommissionModel, siehe Schema-Kommentar).
-- scopeId ist bewusst KEIN Fremdschluessel (polymorph je nach scopeType) --
-- Tenant-Bindung wird serverseitig in AP2 (goal-admin.ts) geprueft.
-- periodEnd wird bewusst NICHT gespeichert (kalendarisch ueber
-- getCalendarPeriodBounds() abgeleitet, halboffenes Intervall
-- [periodStart, periodEnd)).

-- =============================================================================
-- 1) Neue Enum-Typen
-- =============================================================================

CREATE TYPE "GoalPeriodType" AS ENUM ('MONTH', 'QUARTER', 'YEAR');
CREATE TYPE "GoalScopeType" AS ENUM ('TENANT', 'COMPANY', 'STORE', 'EMPLOYEE');
CREATE TYPE "GoalMetricKey" AS ENUM ('DEALS_CLOSED', 'REVENUE', 'CLOSE_RATE');

-- =============================================================================
-- 2) goals
-- =============================================================================

CREATE TABLE "goals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "scope_type" "GoalScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "metric_key" "GoalMetricKey" NOT NULL,
  "period_type" "GoalPeriodType" NOT NULL,
  "period_start" TIMESTAMPTZ NOT NULL,
  "currency" CHAR(3),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "goals_tenant_id_id_key" ON "goals" ("tenant_id", "id");
CREATE UNIQUE INDEX "goals_scope_metric_period_key" ON "goals" ("tenant_id", "scope_type", "scope_id", "metric_key", "period_type", "period_start");
CREATE INDEX "goals_tenant_id_scope_type_scope_id_idx" ON "goals" ("tenant_id", "scope_type", "scope_id");

-- =============================================================================
-- 3) goal_versions
-- =============================================================================

CREATE TABLE "goal_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "goal_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "target_amount_minor" INTEGER,
  "target_count" INTEGER,
  "target_percentage_basis_points" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by_user_id" UUID,
  PRIMARY KEY ("id")
);

ALTER TABLE "goal_versions" ADD CONSTRAINT "goal_versions_tenant_id_goal_id_fkey" FOREIGN KEY ("tenant_id", "goal_id") REFERENCES "goals" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "goal_versions" ADD CONSTRAINT "goal_versions_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE SET NULL;

-- Metrik-unabhaengige Basis-Invariante: genau eines der drei Zielwert-Felder
-- ist gesetzt. Welches davon fachlich zum Goal.metricKey passt, wird
-- serverseitig in goal-validator.ts (AP3) geprueft -- eine metricKey-
-- abhaengige Regel ist per Cross-Table-CHECK nicht abbildbar (analog der
-- commission_model_versions-Entscheidung, siehe Modulkommentar dort).
ALTER TABLE "goal_versions" ADD CONSTRAINT "goal_versions_target_value_xor_check" CHECK (
  (("target_amount_minor" IS NOT NULL)::int +
   ("target_count" IS NOT NULL)::int +
   ("target_percentage_basis_points" IS NOT NULL)::int) = 1
);

CREATE UNIQUE INDEX "goal_versions_tenant_id_id_key" ON "goal_versions" ("tenant_id", "id");
CREATE UNIQUE INDEX "goal_versions_tenant_id_goal_id_version_number_key" ON "goal_versions" ("tenant_id", "goal_id", "version_number");
CREATE INDEX "goal_versions_tenant_id_goal_id_idx" ON "goal_versions" ("tenant_id", "goal_id");
CREATE INDEX "goal_versions_tenant_id_created_by_user_id_idx" ON "goal_versions" ("tenant_id", "created_by_user_id");
