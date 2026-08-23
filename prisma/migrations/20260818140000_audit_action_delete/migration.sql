-- Phase 8 AP7 (Audit-Re-Pruefung gegen die tatsaechliche Mutationskette,
-- siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9). Rein additiver
-- Enum-Wert, keine Datenaenderung -- kein Vorab-Datencheck noetig.
--
-- Grund: removeQuestionFromDraft() (Frage aus einem DRAFT entfernen) hatte
-- bislang keinen passenden AuditAction-Wert. DEACTIVATE ist als Gegenstueck
-- zu ACTIVATE reserviert, DELETION_REQUESTED ist fuer DSGVO-Loeschantraege
-- reserviert -- beide waeren eine Zweckentfremdung gewesen (ChatGPT-
-- Entscheidung 2026-08-18, "Option A": eigener Wert statt Zweckentfremdung).
ALTER TYPE "AuditAction" ADD VALUE 'DELETE';
