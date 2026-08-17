-- Phase 6 AP12 (Security/UI Hardening & Abnahme, siehe
-- PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 12.9, ChatGPT-Vorgabe "Doppelte
-- Abschluesse: Idempotenz bzw. entsprechende fachliche Sperre pruefen").
--
-- Befund: "ein Deal pro ConsultationSession" wurde bislang ausschliesslich
-- durch einen App-Level-Precheck in closeDeal() (deals/service.ts) vor der
-- eigentlichen Transaktion durchgesetzt -- ohne DB-seitigen Unique-
-- Constraint. Das ist race-anfaellig: zwei nahezu gleichzeitige Aufrufe
-- (Doppel-Klick ueber zwei Tabs, Netzwerk-Retry) koennten beide den
-- Precheck VOR der jeweils eigenen Transaktion passieren und zu zwei
-- Deal-Zeilen fuer dieselbe Session fuehren.
--
-- Additive Migration: bestehende Daten sind nicht betroffen (Phase 6 wurde
-- noch nicht produktiv genutzt, keine Bestandspruefung noetig -- dennoch
-- schadet ein Vorab-Check nicht, siehe unten).

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT tenant_id, consultation_session_id
    FROM "deals"
    GROUP BY tenant_id, consultation_session_id
    HAVING count(*) > 1
  ) dup;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Migration abgebrochen: % ConsultationSession(s) haben bereits mehr als einen Deal -- vor dem Unique-Constraint manuell bereinigen', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "deals_tenant_id_consultation_session_id_key" ON "deals" ("tenant_id", "consultation_session_id");
