-- Phase 10 AP6 (Deal-Historisierung, siehe PHASE_10_IMPLEMENTATION_PLAN.md
-- Abschnitt 14 Punkt 1, ChatGPT-GO 2026-08-22). Rein additive Migration --
-- neue nullable Spalte auf deal_items, keine Aenderung an bestehenden Zeilen
-- (bestehende deal_items-Zeilen erhalten NULL, da sie vor dieser Phase ohne
-- Provisions-Historisierung angelegt wurden).
--
-- commission_model_version_id gehoert bewusst auf deal_items (nicht auf
-- deal_financial_snapshots) -- ein Deal kann mehrere Produkte mit
-- unterschiedlichen CommissionModelVersion-Zeilen enthalten. Nullable, da
-- nicht jedes Produkt zwingend eine aktive CommissionModelVersion besitzt.
-- FK mit ON DELETE RESTRICT, konsistent mit der Append-only-Philosophie
-- dieses Schemas (analog commission_tiers, Migration 20260821190000).

ALTER TABLE "deal_items" ADD COLUMN "commission_model_version_id" UUID;

CREATE INDEX "deal_items_tenant_id_commission_model_version_id_idx" ON "deal_items" ("tenant_id", "commission_model_version_id");

ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_tenant_id_commission_model_version_id_fkey" FOREIGN KEY ("tenant_id", "commission_model_version_id") REFERENCES "commission_model_versions" ("tenant_id", "id") ON DELETE RESTRICT;
