-- Phase 14 AP1 (Sales Playbook / Beratungsintelligenz, siehe
-- PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 2, ChatGPT-GO 2026-08-31).
-- Neues Feature, kein bestehendes Skelett zu erweitern (anders als
-- campaigns/campaign_versions in 20260731000000_init) -- alle drei
-- Tabellen sowie beide Enums werden hier neu angelegt, strukturell analog
-- dem Campaign-Muster (Datenmodell/Versionierung/EXCLUDE-Constraint).
--
-- Zentrale Architekturgrenze (siehe PHASE_14_DISCOVERY.md Abschnitt 3/7):
-- Playbook-Tabellen haben KEINE Fremdschluesselbeziehung zu Recommendation/
-- RecommendationItem/RecommendationRationale oder zur Rule Engine -- das
-- Playbook bestimmt niemals WAS/OB empfohlen wird.

-- =============================================================================
-- 1) Enums
-- =============================================================================

CREATE TYPE "PlaybookScopeType" AS ENUM ('TENANT', 'STORE');

CREATE TYPE "PlaybookSectionType" AS ENUM (
  'CONVERSATION_GUIDANCE',
  'ARGUMENTATION',
  'OBJECTION_HANDLING',
  'PRODUCT_ARGUMENT',
  'CUSTOMER_SITUATION',
  'CLOSING',
  'UPSELL_CROSS_SELL',
  'NO_GO',
  'TONALITY',
  'GENERAL_PRINCIPLE'
);

-- =============================================================================
-- 2) playbooks
-- =============================================================================

CREATE TABLE "playbooks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "playbooks_tenant_id_id_key" ON "playbooks" ("tenant_id", "id");
CREATE UNIQUE INDEX "playbooks_tenant_id_key_key" ON "playbooks" ("tenant_id", "key");
CREATE INDEX "playbooks_tenant_id_idx" ON "playbooks" ("tenant_id");

-- =============================================================================
-- 3) playbook_versions
-- =============================================================================

CREATE TABLE "playbook_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "playbook_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "scope_type" "PlaybookScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "description" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by_user_id" UUID,
  PRIMARY KEY ("id")
);

ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_tenant_id_playbook_id_fkey" FOREIGN KEY ("tenant_id", "playbook_id") REFERENCES "playbooks" ("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users" ("tenant_id", "id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "playbook_versions_tenant_id_playbook_id_version_number_key" ON "playbook_versions" ("tenant_id", "playbook_id", "version_number");
CREATE UNIQUE INDEX "playbook_versions_tenant_id_id_key" ON "playbook_versions" ("tenant_id", "id");
CREATE INDEX "playbook_versions_tenant_id_idx" ON "playbook_versions" ("tenant_id");
CREATE INDEX "playbook_versions_playbook_id_valid_from_valid_to_idx" ON "playbook_versions" ("playbook_id", "valid_from", "valid_to");
CREATE INDEX "playbook_versions_tenant_id_scope_type_scope_id_idx" ON "playbook_versions" ("tenant_id", "scope_type", "scope_id");
CREATE INDEX "playbook_versions_tenant_id_created_by_user_id_idx" ON "playbook_versions" ("tenant_id", "created_by_user_id");

-- EXCLUDE-Constraint gegen ueberlappende Gueltigkeitszeitraeume, exakt
-- analog campaign_versions_no_overlap (siehe 20260731000000_init Abschnitt
-- 2) -- innerhalb DERSELBEN playbook_id, keine globale Exklusivitaet
-- ueber alle Playbooks hinweg. btree_gist ist bereits durch
-- 20260731000000_init aktiviert.
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =, "playbook_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'EXPIRED'));

-- =============================================================================
-- 4) playbook_sections
-- =============================================================================

CREATE TABLE "playbook_sections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "playbook_version_id" UUID NOT NULL,
  "section_type" "PlaybookSectionType" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "related_topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "related_product_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "related_situations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "priority" INTEGER,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "playbook_sections" ADD CONSTRAINT "playbook_sections_tenant_id_playbook_version_id_fkey" FOREIGN KEY ("tenant_id", "playbook_version_id") REFERENCES "playbook_versions" ("tenant_id", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "playbook_sections_tenant_id_id_key" ON "playbook_sections" ("tenant_id", "id");
CREATE INDEX "playbook_sections_tenant_id_playbook_version_id_idx" ON "playbook_sections" ("tenant_id", "playbook_version_id");
