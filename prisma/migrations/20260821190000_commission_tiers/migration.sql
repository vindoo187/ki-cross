-- Phase 10 AP4 (TIERED-Provisionsstaffeln, siehe
-- PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 6, ChatGPT-GO 2026-08-21 mit
-- Praezisierungen). Rein additive Migration -- neue Tabelle
-- commission_tiers, keine Aenderung an bestehenden Tabellen/Daten.
--
-- Jede Stufe gehoert zu genau einer commission_model_versions-Zeile und ist
-- entweder Fix (tier_amount_minor) ODER Prozent (tier_percentage_basis_points),
-- nie beides und nie keins -- durchgesetzt per CHECK-Constraint. Die
-- fachliche Vollstaendigkeitsregel "mindestens eine Stufe mit
-- threshold_minor = 0" bezieht sich auf die Menge aller Zeilen einer
-- Version und ist daher NICHT per einzeiligem CHECK abbildbar; sie wird in
-- validateCommissionModelVersion() (Anwendungsschicht) geprueft.
--
-- Abweichung vom urspruenglichen Plan-Vorschlag (Abschnitt 6): FK auf
-- commission_model_versions mit ON DELETE RESTRICT statt CASCADE --
-- konsistent mit allen uebrigen FKs in diesem Schema (append-only-
-- Philosophie, commission_model_versions-Zeilen werden nie geloescht).
-- Wird ChatGPT im AP4-Statusbericht explizit zur Kenntnis gegeben.

CREATE TABLE "commission_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "commission_model_version_id" UUID NOT NULL,
    "threshold_minor" INTEGER NOT NULL,
    "tier_amount_minor" INTEGER,
    "tier_percentage_basis_points" INTEGER,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "commission_tiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_tiers_tenant_id_id_key" ON "commission_tiers" ("tenant_id", "id");
CREATE UNIQUE INDEX "commission_tiers_tenant_id_commission_model_version_id_threshold_minor_key" ON "commission_tiers" ("tenant_id", "commission_model_version_id", "threshold_minor");
CREATE UNIQUE INDEX "commission_tiers_tenant_id_commission_model_version_id_sort_order_key" ON "commission_tiers" ("tenant_id", "commission_model_version_id", "sort_order");
CREATE INDEX "commission_tiers_tenant_id_commission_model_version_id_idx" ON "commission_tiers" ("tenant_id", "commission_model_version_id");

ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_tenant_id_commission_model_version_id_fkey" FOREIGN KEY ("tenant_id", "commission_model_version_id") REFERENCES "commission_model_versions" ("tenant_id", "id") ON DELETE RESTRICT;

ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_threshold_minor_nonnegative_check" CHECK ("threshold_minor" >= 0);
ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_amount_xor_percentage_check" CHECK (("tier_amount_minor" IS NOT NULL) <> ("tier_percentage_basis_points" IS NOT NULL));
