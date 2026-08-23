-- Phase 12 AP1 (Freitext-KI-Angebotsfeature, ChatGPT-GO 2026-08-23, siehe
-- PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 7). Rein additive
-- Migration -- ein neues Boolean-Feld auf der bestehenden `tenants`-Tabelle,
-- keine Aenderung an bestehenden Zeilen/Tabellen sonst.
--
-- Tenant-Feature-Flag fuer die KI-Extraktion (Freitext -> strukturierte
-- Fakten-Kandidaten). Muss gemeinsam mit der Mitarbeiter-Permission
-- "consultation.ai_extraction.use" erfuellt sein (UND-Verknuepfung, siehe
-- src/server/authz/consultation-permissions.ts::isAiExtractionAvailable()).
-- Bewusst NICHT standardmaessig aktiviert (DEFAULT false).

ALTER TABLE "tenants" ADD COLUMN "ai_extraction_enabled" BOOLEAN NOT NULL DEFAULT false;
