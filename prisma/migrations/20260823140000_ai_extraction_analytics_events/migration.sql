-- Phase 12 AP4 (Freitext-KI-Angebotsfeature, ChatGPT-GO 2026-08-23, siehe
-- PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 4 AP4 + Abschnitt 7). Rein
-- additive Migration -- vier neue Enum-Werte, keine Aenderung an
-- bestehenden Zeilen/Tabellen.
--
-- AI_EXTRACTION_REQUESTED/AI_EXTRACTION_COMPLETED: markieren Beginn/Ende
-- eines Extraktionsaufrufs (`requestAiExtraction()`).
-- AI_SUGGESTION_ACCEPTED/AI_SUGGESTION_REJECTED: markieren die explizite
-- Mitarbeiter-Entscheidung ueber einen einzelnen KI-Vorschlag
-- (Uebernehmen/Aendern vs. Verwerfen, siehe `QuestionFlow.tsx`).
-- Payload-Inhalt ausschliesslich technische Metadaten (siehe
-- `event-payload-schemas.ts`, PII-/Freitext-Grenze bleibt unveraendert).

ALTER TYPE "AnalyticsEventType" ADD VALUE 'AI_EXTRACTION_REQUESTED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'AI_EXTRACTION_COMPLETED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'AI_SUGGESTION_ACCEPTED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'AI_SUGGESTION_REJECTED';
