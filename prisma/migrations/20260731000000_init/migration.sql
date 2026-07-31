-- Auto-generated initial migration (hand-authored transpiler, see docs/DECISION_LOG.md)
-- Mirrors prisma/schema.prisma 1:1. Generated because `prisma migrate diff` could not run
-- in this sandbox (binaries.prisma.sh is blocked). Superseded by a real
-- `prisma migrate dev` history on first run with normal internet access.

CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');
CREATE TYPE "RoleScopeType" AS ENUM ('TENANT', 'COMPANY', 'STORE');
CREATE TYPE "ProductType" AS ENUM ('MOBILE_NEW_CONTRACT', 'MOBILE_RENEWAL', 'MOBILE_SIM_ONLY', 'MOBILE_WITH_DEVICE', 'DSL', 'FIBER', 'PARTNER_CARD', 'FAMILY', 'YOUNG', 'STREAMING', 'DEVICE_PROTECTION', 'ACCESSORY', 'OTHER');
CREATE TYPE "CommissionType" AS ENUM ('FLAT', 'PERCENTAGE', 'TIERED');
CREATE TYPE "ConsultationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');
CREATE TYPE "ConsultationType" AS ENUM ('NEW_CONTRACT', 'RENEWAL');
CREATE TYPE "AnswerType" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'NUMBER', 'BOOLEAN', 'FREE_TEXT');
CREATE TYPE "NeedType" AS ENUM ('PARTNER_CARD', 'FAMILY', 'YOUNG', 'DSL', 'FIBER', 'STREAMING', 'ACCESSORY', 'DEVICE_PROTECTION', 'OTHER');
CREATE TYPE "NeedSource" AS ENUM ('RULE_BASED', 'EMPLOYEE_MARKED');
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'OFFERED', 'ACCEPTED', 'DECLINED', 'DEFERRED');
CREATE TYPE "RecommendationOutcomeType" AS ENUM ('ACCEPTED', 'REJECTED', 'DEFERRED');
CREATE TYPE "FollowUpReason" AS ENUM ('RENEWAL_LOOKAHEAD', 'CUSTOMER_REQUEST', 'DEFERRED_OPPORTUNITY', 'OTHER');
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');
CREATE TYPE "VisibilityOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN', 'IN', 'IS_ANSWERED');
CREATE TYPE "LegalBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGITIMATE_INTEREST');
CREATE TYPE "DeletionStatus" AS ENUM ('ACTIVE', 'DELETION_REQUESTED', 'DELETED');
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');
CREATE TYPE "RetentionDataCategory" AS ENUM ('SESSION_NO_DEAL', 'SESSION_WITH_DEAL', 'AGGREGATED_KPI', 'AUDIT_LOG');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE', 'ROLLBACK', 'DELETION_REQUESTED');
CREATE TYPE "AnalyticsEventType" AS ENUM ('CONSULTATION_STARTED', 'CONSULTATION_TOPIC_OPENED', 'QUESTION_ANSWERED', 'NEED_DETECTED', 'OPPORTUNITY_OFFERED', 'OPPORTUNITY_DECLINED', 'RECOMMENDATION_GENERATED', 'RECOMMENDATION_ACCEPTED', 'RECOMMENDATION_REJECTED', 'CONSULTATION_COMPLETED', 'CONSULTATION_ABANDONED', 'DEAL_CLOSED', 'FOLLOW_UP_CREATED');
CREATE TYPE "MeasurementSource" AS ENUM ('BASELINE_MANUAL', 'SYSTEM_ASSISTED');

CREATE TABLE "tenants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "companies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "stores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "user_id" UUID,
  "display_name" TEXT NOT NULL,
  "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
  "deactivated_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_system_defined" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "role_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "scope_type" "RoleScopeType" NOT NULL,
  "company_id" UUID,
  "store_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ,
  PRIMARY KEY ("id")
);

CREATE TABLE "providers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "product_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "product_type" "ProductType" NOT NULL,
  "name" TEXT NOT NULL,
  "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "product_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "currency" TEXT NOT NULL,
  "monthly_price_minor" INTEGER,
  "one_time_price_minor" INTEGER,
  "contract_months" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "tariff_attributes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "product_version_id" UUID NOT NULL,
  "attribute_key" TEXT NOT NULL,
  "attribute_value" TEXT NOT NULL,
  "value_type" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "commission_models" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "commission_model_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "commission_model_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "commission_type" "CommissionType" NOT NULL,
  "currency" TEXT NOT NULL,
  "commission_amount_minor" INTEGER,
  "commission_percentage_basis_points" INTEGER,
  "recurring_commission_amount_minor" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "product_cost_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "currency" TEXT NOT NULL,
  "hardware_purchase_cost_minor" INTEGER,
  "subsidy_cost_minor" INTEGER,
  "other_direct_cost_minor" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "campaign_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "customer_references" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "display_code" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "consultation_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "customer_reference_id" UUID,
  "consultation_type" "ConsultationType" NOT NULL,
  "status" "ConsultationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "started_at" TIMESTAMPTZ NOT NULL,
  "ended_at" TIMESTAMPTZ,
  "pause_seconds" INTEGER NOT NULL DEFAULT 0,
  "data_completeness_score" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "consultation_topics" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "topic_key" "NeedType" NOT NULL,
  "opened_at" TIMESTAMPTZ NOT NULL,
  "closed_at" TIMESTAMPTZ,
  PRIMARY KEY ("id")
);

CREATE TABLE "questionnaires" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "questionnaire_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "questionnaire_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "questions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "questionnaire_version_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "need_type" "NeedType" NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "question_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "question_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "answer_type" "AnswerType" NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "customer_answers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "question_version_id" UUID,
  "answer_type" "AnswerType" NOT NULL,
  "number_value" DOUBLE PRECISION,
  "boolean_value" BOOLEAN,
  "choice_values" TEXT[] NOT NULL DEFAULT '{}',
  "free_text_value" TEXT,
  "answered_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "detected_needs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "need_type" "NeedType" NOT NULL,
  "source" "NeedSource" NOT NULL DEFAULT 'RULE_BASED',
  "detected_at" TIMESTAMPTZ NOT NULL,
  "notes" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "sales_opportunities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "detected_need_id" UUID,
  "category_id" UUID,
  "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
  "offered_at" TIMESTAMPTZ,
  "resolved_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "rule_sets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "rule_set_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "recommendations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "rule_set_version_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "recommendation_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "recommendation_id" UUID NOT NULL,
  "product_version_id" UUID NOT NULL,
  "eligibility_passed" BOOLEAN NOT NULL,
  "exclusion_reason_codes" TEXT[] NOT NULL DEFAULT '{}',
  "business_priority_score" DOUBLE PRECISION NOT NULL,
  "priority_rank" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "recommendation_rationales" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "recommendation_item_id" UUID NOT NULL,
  "factor_key" TEXT NOT NULL,
  "factor_value" TEXT NOT NULL,
  "weight" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "rejection_reasons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "recommendation_outcomes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "recommendation_item_id" UUID NOT NULL,
  "outcome" "RecommendationOutcomeType" NOT NULL,
  "rejection_reason_id" UUID,
  "decided_by_employee_id" UUID NOT NULL,
  "decided_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "follow_ups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "customer_reference_id" UUID,
  "reason" "FollowUpReason" NOT NULL,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
  "due_date" TIMESTAMPTZ NOT NULL,
  "threshold_used_days" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "deals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "consultation_session_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "customer_reference_id" UUID,
  "currency" TEXT NOT NULL,
  "closed_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "deal_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "deal_id" UUID NOT NULL,
  "product_version_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "deal_financial_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "deal_id" UUID NOT NULL,
  "currency" TEXT NOT NULL,
  "monthly_recurring_revenue_minor" INTEGER NOT NULL,
  "total_contract_value_minor" INTEGER NOT NULL,
  "one_time_revenue_minor" INTEGER NOT NULL,
  "commission_amount_minor" INTEGER NOT NULL,
  "expected_recurring_commission_minor" INTEGER NOT NULL,
  "hardware_purchase_cost_minor" INTEGER NOT NULL,
  "subsidy_cost_minor" INTEGER NOT NULL,
  "discount_cost_minor" INTEGER NOT NULL,
  "other_direct_cost_minor" INTEGER NOT NULL,
  "contribution_margin_minor" INTEGER NOT NULL,
  "contribution_margin_formula_version" TEXT NOT NULL,
  "captured_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "answer_options" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "question_version_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "visibility_conditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "question_version_id" UUID NOT NULL,
  "target_question_id" UUID NOT NULL,
  "operator" "VisibilityOperator" NOT NULL,
  "comparison_value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "eligibility_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rule_set_version_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "expression" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "exclusion_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rule_set_version_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "expression" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "prioritization_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "rule_set_version_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "weight" INTEGER NOT NULL,
  "expression" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "configurable_thresholds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "contact_purposes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "customer_contact_data" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_reference_id" UUID NOT NULL,
  "purpose_id" UUID NOT NULL,
  "contact_name" TEXT,
  "contact_phone" TEXT,
  "contact_email" TEXT,
  "legal_basis" "LegalBasis" NOT NULL,
  "retention_until" TIMESTAMPTZ NOT NULL,
  "deletion_status" "DeletionStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "consent_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_contact_data_id" UUID NOT NULL,
  "legal_basis" "LegalBasis" NOT NULL,
  "consent_given_at" TIMESTAMPTZ,
  "consent_withdrawn_at" TIMESTAMPTZ,
  "consent_text" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "retention_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "data_category" "RetentionDataCategory" NOT NULL,
  "retention_days" INTEGER NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "deletion_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_contact_data_id" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMPTZ,
  "notes" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "analytics_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID,
  "employee_id" UUID,
  "event_type" "AnalyticsEventType" NOT NULL,
  "payload" JSONB,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "baseline_measurements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "employee_id" UUID,
  "metric_key" TEXT NOT NULL,
  "metric_value" NUMERIC NOT NULL,
  "period_start" TIMESTAMPTZ NOT NULL,
  "period_end" TIMESTAMPTZ NOT NULL,
  "measurement_source" TEXT NOT NULL,
  "measurement_method" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ,
  "ended_at" TIMESTAMPTZ,
  "active_duration_seconds" INTEGER,
  "inactive_duration_seconds" INTEGER,
  "consultation_outcome" TEXT,
  "deal_completed" BOOLEAN,
  "products_sold_count" INTEGER,
  "detected_cross_sell_count" INTEGER,
  "offered_cross_sell_count" INTEGER,
  "accepted_cross_sell_count" INTEGER,
  "data_completeness_score" NUMERIC,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" "AuditAction" NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "metadata" JSONB,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "configuration_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "config_key" TEXT NOT NULL,
  "old_value" TEXT,
  "new_value" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_key_key" ON "tenants" ("key");
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies" ("tenant_id", "id");
CREATE UNIQUE INDEX "companies_tenant_id_key_key" ON "companies" ("tenant_id", "key");
CREATE INDEX "companies_tenant_id_idx" ON "companies" ("tenant_id");
CREATE UNIQUE INDEX "stores_tenant_id_id_key" ON "stores" ("tenant_id", "id");
CREATE UNIQUE INDEX "stores_tenant_id_key_key" ON "stores" ("tenant_id", "key");
CREATE INDEX "stores_tenant_id_idx" ON "stores" ("tenant_id");
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users" ("tenant_id", "email");
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users" ("tenant_id", "id");
CREATE INDEX "users_tenant_id_idx" ON "users" ("tenant_id");
CREATE UNIQUE INDEX "employees_tenant_id_id_key" ON "employees" ("tenant_id", "id");
CREATE UNIQUE INDEX "employees_tenant_id_user_id_key" ON "employees" ("tenant_id", "user_id");
CREATE INDEX "employees_tenant_id_idx" ON "employees" ("tenant_id");
CREATE INDEX "employees_store_id_idx" ON "employees" ("store_id");
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions" ("key");
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles" ("tenant_id", "key");
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "roles" ("tenant_id", "id");
CREATE INDEX "roles_tenant_id_idx" ON "roles" ("tenant_id");
CREATE INDEX "role_assignments_tenant_id_idx" ON "role_assignments" ("tenant_id");
CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments" ("user_id");
CREATE UNIQUE INDEX "providers_key_key" ON "providers" ("key");
CREATE UNIQUE INDEX "product_categories_tenant_id_id_key" ON "product_categories" ("tenant_id", "id");
CREATE UNIQUE INDEX "product_categories_tenant_id_key_key" ON "product_categories" ("tenant_id", "key");
CREATE INDEX "product_categories_tenant_id_idx" ON "product_categories" ("tenant_id");
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products" ("tenant_id", "id");
CREATE INDEX "products_tenant_id_idx" ON "products" ("tenant_id");
CREATE INDEX "products_provider_id_idx" ON "products" ("provider_id");
CREATE UNIQUE INDEX "product_versions_tenant_id_id_key" ON "product_versions" ("tenant_id", "id");
CREATE UNIQUE INDEX "product_versions_tenant_id_product_id_version_number_key" ON "product_versions" ("tenant_id", "product_id", "version_number");
CREATE INDEX "product_versions_tenant_id_idx" ON "product_versions" ("tenant_id");
CREATE INDEX "product_versions_product_id_valid_from_valid_to_idx" ON "product_versions" ("product_id", "valid_from", "valid_to");
CREATE UNIQUE INDEX "tariff_attributes_product_version_id_attribute_key_key" ON "tariff_attributes" ("product_version_id", "attribute_key");
CREATE INDEX "tariff_attributes_tenant_id_idx" ON "tariff_attributes" ("tenant_id");
CREATE UNIQUE INDEX "commission_models_tenant_id_id_key" ON "commission_models" ("tenant_id", "id");
CREATE INDEX "commission_models_tenant_id_idx" ON "commission_models" ("tenant_id");
CREATE UNIQUE INDEX "commission_model_versions_tenant_id_commission_model_id_version" ON "commission_model_versions" ("tenant_id", "commission_model_id", "version_number");
CREATE INDEX "commission_model_versions_tenant_id_idx" ON "commission_model_versions" ("tenant_id");
CREATE INDEX "commission_model_versions_commission_model_id_valid_from_valid_" ON "commission_model_versions" ("commission_model_id", "valid_from", "valid_to");
CREATE UNIQUE INDEX "product_cost_versions_tenant_id_product_id_version_number_key" ON "product_cost_versions" ("tenant_id", "product_id", "version_number");
CREATE INDEX "product_cost_versions_tenant_id_idx" ON "product_cost_versions" ("tenant_id");
CREATE INDEX "product_cost_versions_product_id_valid_from_valid_to_idx" ON "product_cost_versions" ("product_id", "valid_from", "valid_to");
CREATE UNIQUE INDEX "campaigns_tenant_id_id_key" ON "campaigns" ("tenant_id", "id");
CREATE UNIQUE INDEX "campaigns_tenant_id_key_key" ON "campaigns" ("tenant_id", "key");
CREATE INDEX "campaigns_tenant_id_idx" ON "campaigns" ("tenant_id");
CREATE UNIQUE INDEX "campaign_versions_tenant_id_campaign_id_version_number_key" ON "campaign_versions" ("tenant_id", "campaign_id", "version_number");
CREATE INDEX "campaign_versions_tenant_id_idx" ON "campaign_versions" ("tenant_id");
CREATE INDEX "campaign_versions_campaign_id_valid_from_valid_to_idx" ON "campaign_versions" ("campaign_id", "valid_from", "valid_to");
CREATE UNIQUE INDEX "customer_references_tenant_id_id_key" ON "customer_references" ("tenant_id", "id");
CREATE INDEX "customer_references_tenant_id_store_id_idx" ON "customer_references" ("tenant_id", "store_id");
CREATE UNIQUE INDEX "consultation_sessions_tenant_id_id_key" ON "consultation_sessions" ("tenant_id", "id");
CREATE INDEX "consultation_sessions_tenant_id_idx" ON "consultation_sessions" ("tenant_id");
CREATE INDEX "consultation_sessions_store_id_started_at_idx" ON "consultation_sessions" ("store_id", "started_at");
CREATE INDEX "consultation_sessions_employee_id_started_at_idx" ON "consultation_sessions" ("employee_id", "started_at");
CREATE INDEX "consultation_topics_tenant_id_idx" ON "consultation_topics" ("tenant_id");
CREATE INDEX "consultation_topics_consultation_session_id_idx" ON "consultation_topics" ("consultation_session_id");
CREATE UNIQUE INDEX "questionnaires_tenant_id_id_key" ON "questionnaires" ("tenant_id", "id");
CREATE UNIQUE INDEX "questionnaires_tenant_id_key_key" ON "questionnaires" ("tenant_id", "key");
CREATE INDEX "questionnaires_tenant_id_idx" ON "questionnaires" ("tenant_id");
CREATE UNIQUE INDEX "questionnaire_versions_tenant_id_id_key" ON "questionnaire_versions" ("tenant_id", "id");
CREATE INDEX "questionnaire_versions_tenant_id_questionnaire_id_status_idx" ON "questionnaire_versions" ("tenant_id", "questionnaire_id", "status");
CREATE UNIQUE INDEX "questions_tenant_id_id_key" ON "questions" ("tenant_id", "id");
CREATE INDEX "questions_tenant_id_questionnaire_version_id_idx" ON "questions" ("tenant_id", "questionnaire_version_id");
CREATE UNIQUE INDEX "question_versions_tenant_id_id_key" ON "question_versions" ("tenant_id", "id");
CREATE INDEX "question_versions_tenant_id_question_id_status_idx" ON "question_versions" ("tenant_id", "question_id", "status");
CREATE INDEX "customer_answers_tenant_id_idx" ON "customer_answers" ("tenant_id");
CREATE INDEX "customer_answers_consultation_session_id_idx" ON "customer_answers" ("consultation_session_id");
CREATE UNIQUE INDEX "detected_needs_tenant_id_id_key" ON "detected_needs" ("tenant_id", "id");
CREATE INDEX "detected_needs_tenant_id_idx" ON "detected_needs" ("tenant_id");
CREATE INDEX "detected_needs_consultation_session_id_idx" ON "detected_needs" ("consultation_session_id");
CREATE INDEX "sales_opportunities_tenant_id_idx" ON "sales_opportunities" ("tenant_id");
CREATE INDEX "sales_opportunities_consultation_session_id_idx" ON "sales_opportunities" ("consultation_session_id");
CREATE UNIQUE INDEX "rule_sets_tenant_id_id_key" ON "rule_sets" ("tenant_id", "id");
CREATE UNIQUE INDEX "rule_sets_tenant_id_key_key" ON "rule_sets" ("tenant_id", "key");
CREATE INDEX "rule_sets_tenant_id_idx" ON "rule_sets" ("tenant_id");
CREATE UNIQUE INDEX "rule_set_versions_tenant_id_id_key" ON "rule_set_versions" ("tenant_id", "id");
CREATE INDEX "rule_set_versions_tenant_id_rule_set_id_status_idx" ON "rule_set_versions" ("tenant_id", "rule_set_id", "status");
CREATE UNIQUE INDEX "recommendations_tenant_id_id_key" ON "recommendations" ("tenant_id", "id");
CREATE INDEX "recommendations_tenant_id_idx" ON "recommendations" ("tenant_id");
CREATE INDEX "recommendations_consultation_session_id_idx" ON "recommendations" ("consultation_session_id");
CREATE UNIQUE INDEX "recommendation_items_tenant_id_id_key" ON "recommendation_items" ("tenant_id", "id");
CREATE INDEX "recommendation_items_tenant_id_idx" ON "recommendation_items" ("tenant_id");
CREATE INDEX "recommendation_items_recommendation_id_idx" ON "recommendation_items" ("recommendation_id");
CREATE INDEX "recommendation_rationales_tenant_id_idx" ON "recommendation_rationales" ("tenant_id");
CREATE INDEX "recommendation_rationales_recommendation_item_id_idx" ON "recommendation_rationales" ("recommendation_item_id");
CREATE UNIQUE INDEX "rejection_reasons_tenant_id_id_key" ON "rejection_reasons" ("tenant_id", "id");
CREATE UNIQUE INDEX "rejection_reasons_tenant_id_key_key" ON "rejection_reasons" ("tenant_id", "key");
CREATE INDEX "rejection_reasons_tenant_id_idx" ON "rejection_reasons" ("tenant_id");
CREATE UNIQUE INDEX "recommendation_outcomes_recommendation_item_id_key" ON "recommendation_outcomes" ("recommendation_item_id");
CREATE INDEX "recommendation_outcomes_tenant_id_idx" ON "recommendation_outcomes" ("tenant_id");
CREATE INDEX "follow_ups_tenant_id_idx" ON "follow_ups" ("tenant_id");
CREATE INDEX "follow_ups_due_date_idx" ON "follow_ups" ("due_date");
CREATE UNIQUE INDEX "deals_tenant_id_id_key" ON "deals" ("tenant_id", "id");
CREATE INDEX "deals_tenant_id_idx" ON "deals" ("tenant_id");
CREATE INDEX "deals_store_id_closed_at_idx" ON "deals" ("store_id", "closed_at");
CREATE INDEX "deal_items_tenant_id_idx" ON "deal_items" ("tenant_id");
CREATE INDEX "deal_items_deal_id_idx" ON "deal_items" ("deal_id");
CREATE UNIQUE INDEX "deal_financial_snapshots_deal_id_key" ON "deal_financial_snapshots" ("deal_id");
CREATE INDEX "deal_financial_snapshots_tenant_id_idx" ON "deal_financial_snapshots" ("tenant_id");
CREATE UNIQUE INDEX "answer_options_tenant_id_id_key" ON "answer_options" ("tenant_id", "id");
CREATE INDEX "answer_options_tenant_id_question_version_id_idx" ON "answer_options" ("tenant_id", "question_version_id");
CREATE UNIQUE INDEX "visibility_conditions_tenant_id_id_key" ON "visibility_conditions" ("tenant_id", "id");
CREATE INDEX "visibility_conditions_tenant_id_question_version_id_idx" ON "visibility_conditions" ("tenant_id", "question_version_id");
CREATE UNIQUE INDEX "eligibility_rules_tenant_id_id_key" ON "eligibility_rules" ("tenant_id", "id");
CREATE INDEX "eligibility_rules_tenant_id_rule_set_version_id_idx" ON "eligibility_rules" ("tenant_id", "rule_set_version_id");
CREATE UNIQUE INDEX "exclusion_rules_tenant_id_id_key" ON "exclusion_rules" ("tenant_id", "id");
CREATE INDEX "exclusion_rules_tenant_id_rule_set_version_id_idx" ON "exclusion_rules" ("tenant_id", "rule_set_version_id");
CREATE UNIQUE INDEX "prioritization_rules_tenant_id_id_key" ON "prioritization_rules" ("tenant_id", "id");
CREATE INDEX "prioritization_rules_tenant_id_rule_set_version_id_idx" ON "prioritization_rules" ("tenant_id", "rule_set_version_id");
CREATE UNIQUE INDEX "configurable_thresholds_tenant_id_id_key" ON "configurable_thresholds" ("tenant_id", "id");
CREATE UNIQUE INDEX "configurable_thresholds_tenant_id_key_valid_from_key" ON "configurable_thresholds" ("tenant_id", "key", "valid_from");
CREATE INDEX "configurable_thresholds_tenant_id_key_idx" ON "configurable_thresholds" ("tenant_id", "key");
CREATE UNIQUE INDEX "contact_purposes_tenant_id_id_key" ON "contact_purposes" ("tenant_id", "id");
CREATE UNIQUE INDEX "contact_purposes_tenant_id_key_key" ON "contact_purposes" ("tenant_id", "key");
CREATE INDEX "contact_purposes_tenant_id_idx" ON "contact_purposes" ("tenant_id");
CREATE UNIQUE INDEX "customer_contact_data_tenant_id_id_key" ON "customer_contact_data" ("tenant_id", "id");
CREATE INDEX "customer_contact_data_tenant_id_customer_reference_id_idx" ON "customer_contact_data" ("tenant_id", "customer_reference_id");
CREATE INDEX "customer_contact_data_tenant_id_retention_until_idx" ON "customer_contact_data" ("tenant_id", "retention_until");
CREATE UNIQUE INDEX "consent_records_tenant_id_id_key" ON "consent_records" ("tenant_id", "id");
CREATE INDEX "consent_records_tenant_id_customer_contact_data_id_idx" ON "consent_records" ("tenant_id", "customer_contact_data_id");
CREATE UNIQUE INDEX "retention_policies_tenant_id_id_key" ON "retention_policies" ("tenant_id", "id");
CREATE INDEX "retention_policies_tenant_id_data_category_valid_from_idx" ON "retention_policies" ("tenant_id", "data_category", "valid_from");
CREATE UNIQUE INDEX "deletion_requests_tenant_id_id_key" ON "deletion_requests" ("tenant_id", "id");
CREATE INDEX "deletion_requests_tenant_id_customer_contact_data_id_idx" ON "deletion_requests" ("tenant_id", "customer_contact_data_id");
CREATE INDEX "deletion_requests_tenant_id_status_idx" ON "deletion_requests" ("tenant_id", "status");
CREATE INDEX "analytics_events_tenant_id_event_type_occurred_at_idx" ON "analytics_events" ("tenant_id", "event_type", "occurred_at");
CREATE INDEX "analytics_events_tenant_id_store_id_occurred_at_idx" ON "analytics_events" ("tenant_id", "store_id", "occurred_at");
CREATE UNIQUE INDEX "baseline_measurements_tenant_id_id_key" ON "baseline_measurements" ("tenant_id", "id");
CREATE INDEX "baseline_measurements_tenant_id_store_id_metric_key_idx" ON "baseline_measurements" ("tenant_id", "store_id", "metric_key");
CREATE INDEX "baseline_measurements_tenant_id_employee_id_idx" ON "baseline_measurements" ("tenant_id", "employee_id");
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX "audit_logs_tenant_id_occurred_at_idx" ON "audit_logs" ("tenant_id", "occurred_at");
CREATE INDEX "audit_logs_tenant_id_actor_user_id_idx" ON "audit_logs" ("tenant_id", "actor_user_id");
CREATE INDEX "configuration_changes_tenant_id_config_key_occurred_at_idx" ON "configuration_changes" ("tenant_id", "config_key", "occurred_at");
CREATE INDEX "configuration_changes_tenant_id_actor_user_id_idx" ON "configuration_changes" ("tenant_id", "actor_user_id");

ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "products_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers" ("id") ON DELETE RESTRICT;
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "product_categories" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "tariff_attributes" ADD CONSTRAINT "tariff_attributes_tenant_id_product_version_id_fkey" FOREIGN KEY ("tenant_id", "product_version_id") REFERENCES "product_versions" ("tenant_id", "id") ON DELETE CASCADE;
ALTER TABLE "commission_models" ADD CONSTRAINT "commission_models_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "commission_models" ADD CONSTRAINT "commission_models_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "commission_model_versions" ADD CONSTRAINT "commission_model_versions_tenant_id_commission_model_id_fkey" FOREIGN KEY ("tenant_id", "commission_model_id") REFERENCES "commission_models" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "product_cost_versions" ADD CONSTRAINT "product_cost_versions_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "campaign_versions" ADD CONSTRAINT "campaign_versions_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_references" ADD CONSTRAINT "customer_references_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "customer_references" ADD CONSTRAINT "customer_references_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_tenant_id_customer_reference_id_fkey" FOREIGN KEY ("tenant_id", "customer_reference_id") REFERENCES "customer_references" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "consultation_topics" ADD CONSTRAINT "consultation_topics_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_tenant_id_questionnaire_id_fkey" FOREIGN KEY ("tenant_id", "questionnaire_id") REFERENCES "questionnaires" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "questions" ADD CONSTRAINT "questions_tenant_id_questionnaire_version_id_fkey" FOREIGN KEY ("tenant_id", "questionnaire_version_id") REFERENCES "questionnaire_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_tenant_id_question_id_fkey" FOREIGN KEY ("tenant_id", "question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_answers" ADD CONSTRAINT "customer_answers_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_answers" ADD CONSTRAINT "customer_answers_tenant_id_question_version_id_fkey" FOREIGN KEY ("tenant_id", "question_version_id") REFERENCES "question_versions" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "detected_needs" ADD CONSTRAINT "detected_needs_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_tenant_id_detected_need_id_fkey" FOREIGN KEY ("tenant_id", "detected_need_id") REFERENCES "detected_needs" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "rule_set_versions" ADD CONSTRAINT "rule_set_versions_tenant_id_rule_set_id_fkey" FOREIGN KEY ("tenant_id", "rule_set_id") REFERENCES "rule_sets" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_tenant_id_rule_set_version_id_fkey" FOREIGN KEY ("tenant_id", "rule_set_version_id") REFERENCES "rule_set_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_tenant_id_recommendation_id_fkey" FOREIGN KEY ("tenant_id", "recommendation_id") REFERENCES "recommendations" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_tenant_id_product_version_id_fkey" FOREIGN KEY ("tenant_id", "product_version_id") REFERENCES "product_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_rationales" ADD CONSTRAINT "recommendation_rationales_tenant_id_recommendation_item_id_fkey" FOREIGN KEY ("tenant_id", "recommendation_item_id") REFERENCES "recommendation_items" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "rejection_reasons" ADD CONSTRAINT "rejection_reasons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_tenant_id_recommendation_item_id_fkey" FOREIGN KEY ("tenant_id", "recommendation_item_id") REFERENCES "recommendation_items" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_tenant_id_rejection_reason_id_fkey" FOREIGN KEY ("tenant_id", "rejection_reason_id") REFERENCES "rejection_reasons" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_tenant_id_decided_by_employee_id_fkey" FOREIGN KEY ("tenant_id", "decided_by_employee_id") REFERENCES "employees" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_customer_reference_id_fkey" FOREIGN KEY ("tenant_id", "customer_reference_id") REFERENCES "customer_references" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_consultation_session_id_fkey" FOREIGN KEY ("tenant_id", "consultation_session_id") REFERENCES "consultation_sessions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_customer_reference_id_fkey" FOREIGN KEY ("tenant_id", "customer_reference_id") REFERENCES "customer_references" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_tenant_id_deal_id_fkey" FOREIGN KEY ("tenant_id", "deal_id") REFERENCES "deals" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_tenant_id_product_version_id_fkey" FOREIGN KEY ("tenant_id", "product_version_id") REFERENCES "product_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "deal_financial_snapshots" ADD CONSTRAINT "deal_financial_snapshots_tenant_id_deal_id_fkey" FOREIGN KEY ("tenant_id", "deal_id") REFERENCES "deals" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "answer_options" ADD CONSTRAINT "answer_options_tenant_id_question_version_id_fkey" FOREIGN KEY ("tenant_id", "question_version_id") REFERENCES "question_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "visibility_conditions" ADD CONSTRAINT "visibility_conditions_tenant_id_question_version_id_fkey" FOREIGN KEY ("tenant_id", "question_version_id") REFERENCES "question_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "visibility_conditions" ADD CONSTRAINT "visibility_conditions_tenant_id_target_question_id_fkey" FOREIGN KEY ("tenant_id", "target_question_id") REFERENCES "questions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "eligibility_rules" ADD CONSTRAINT "eligibility_rules_tenant_id_rule_set_version_id_fkey" FOREIGN KEY ("tenant_id", "rule_set_version_id") REFERENCES "rule_set_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "exclusion_rules" ADD CONSTRAINT "exclusion_rules_tenant_id_rule_set_version_id_fkey" FOREIGN KEY ("tenant_id", "rule_set_version_id") REFERENCES "rule_set_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "prioritization_rules" ADD CONSTRAINT "prioritization_rules_tenant_id_rule_set_version_id_fkey" FOREIGN KEY ("tenant_id", "rule_set_version_id") REFERENCES "rule_set_versions" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "configurable_thresholds" ADD CONSTRAINT "configurable_thresholds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "contact_purposes" ADD CONSTRAINT "contact_purposes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "customer_contact_data" ADD CONSTRAINT "customer_contact_data_tenant_id_customer_reference_id_fkey" FOREIGN KEY ("tenant_id", "customer_reference_id") REFERENCES "customer_references" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "customer_contact_data" ADD CONSTRAINT "customer_contact_data_tenant_id_purpose_id_fkey" FOREIGN KEY ("tenant_id", "purpose_id") REFERENCES "contact_purposes" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_customer_contact_data_id_fkey" FOREIGN KEY ("tenant_id", "customer_contact_data_id") REFERENCES "customer_contact_data" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_tenant_id_customer_contact_data_id_fkey" FOREIGN KEY ("tenant_id", "customer_contact_data_id") REFERENCES "customer_contact_data" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "baseline_measurements" ADD CONSTRAINT "baseline_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "baseline_measurements" ADD CONSTRAINT "baseline_measurements_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "baseline_measurements" ADD CONSTRAINT "baseline_measurements_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_actor_user_id_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE SET NULL;
ALTER TABLE "configuration_changes" ADD CONSTRAINT "configuration_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;
ALTER TABLE "configuration_changes" ADD CONSTRAINT "configuration_changes_tenant_id_actor_user_id_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE SET NULL;

-- =============================================================================
-- Phase 2B: Ergänzungen, die der hand-geschriebene Transpiler
-- (scripts/schema_to_sql.py) aus prisma/schema.prisma nicht erzeugen kann
-- (CHECK-Constraints, Cross-Table-Trigger, PostgreSQL EXCLUDE-Constraints).
-- Diese Ergänzungen sind reines, von Hand gepflegtes SQL und werden bei
-- jeder Neugenerierung der Datei über den Transpiler manuell wieder
-- angehängt (siehe docs/DECISION_LOG.md).
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1) RoleAssignment: Scope-Integrität (scopeType <-> companyId/storeId)
-- -----------------------------------------------------------------------

ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_consistency_check" CHECK (
  (scope_type = 'TENANT' AND company_id IS NULL AND store_id IS NULL) OR
  (scope_type = 'COMPANY' AND company_id IS NOT NULL AND store_id IS NULL) OR
  (scope_type = 'STORE' AND company_id IS NOT NULL AND store_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION check_role_assignment_store_company() RETURNS trigger AS $$
BEGIN
  IF NEW.store_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "stores"
      WHERE "tenant_id" = NEW.tenant_id AND "id" = NEW.store_id AND "company_id" = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'role_assignments: store_id % gehoert im Tenant % nicht zu company_id %', NEW.store_id, NEW.tenant_id, NEW.company_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_assignments_store_company_check
BEFORE INSERT OR UPDATE ON "role_assignments"
FOR EACH ROW EXECUTE FUNCTION check_role_assignment_store_company();

-- -----------------------------------------------------------------------
-- 2) Exclusion Constraints gegen ueberlappende Versions-Gueltigkeitszeitraeume
-- -----------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "product_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

ALTER TABLE "commission_model_versions" ADD CONSTRAINT "commission_model_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "commission_model_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

ALTER TABLE "product_cost_versions" ADD CONSTRAINT "product_cost_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "product_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

ALTER TABLE "campaign_versions" ADD CONSTRAINT "campaign_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "campaign_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "questionnaire_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

ALTER TABLE "rule_set_versions" ADD CONSTRAINT "rule_set_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "rule_set_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

ALTER TABLE "configurable_thresholds" ADD CONSTRAINT "configurable_thresholds_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "key" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  );

ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "data_category" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  );

-- -----------------------------------------------------------------------
-- 3) Echte Append-only-Durchsetzung (DB-Trigger statt nur Konvention)
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% ist append-only: % ist nicht erlaubt', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deal_financial_snapshots_append_only
BEFORE UPDATE OR DELETE ON "deal_financial_snapshots"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER configuration_changes_append_only
BEFORE UPDATE OR DELETE ON "configuration_changes"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER analytics_events_append_only
BEFORE UPDATE OR DELETE ON "analytics_events"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
