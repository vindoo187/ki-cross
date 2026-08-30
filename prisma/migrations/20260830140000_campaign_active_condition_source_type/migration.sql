-- Phase 13 AP4 (Campaign Rule Integration, ChatGPT-GO 2026-08-30, siehe
-- PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3 AP4). Rein additive Migration
-- -- ein neuer Enum-Wert, keine Aenderung an bestehenden Zeilen/Tabellen.
--
-- CAMPAIGN_ACTIVE: neuer ConditionSourceType, mit dem
-- PrioritizationRuleCondition/CrossSellingRuleCondition pruefen koennen,
-- ob eine Campaign zum Auswertungszeitpunkt aktiv ist (veroeffentlichte
-- CampaignVersion + gueltiger Zeitraum + passender Scope). Serverseitig auf
-- diese beiden Regeltypen beschraenkt (rule-admin.ts::validateDraftRuleSetVersion()),
-- nicht durch einen DB-Constraint, da EligibilityRuleCondition/
-- ExclusionRuleCondition denselben Enum-Typ nutzen.

ALTER TYPE "ConditionSourceType" ADD VALUE 'CAMPAIGN_ACTIVE';
