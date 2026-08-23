-- AnalyticsEvent.employee: onDelete SetNull -> Restrict
--
-- Grund: analytics_events ist append-only (Trigger forbid_update_delete(),
-- siehe Migration 20260731000000_init, Zeilen 1000-1020). SetNull erzeugt beim
-- Loeschen eines Employees ein UPDATE auf analytics_events (employee_id = NULL),
-- was der Append-only-Trigger fuer UPDATE UND DELETE blockiert. Das war kein
-- reiner Testbug, sondern ein Schema-Designfehler: Das Loeschen eines Employees
-- mit vorhandenen AnalyticsEvents haette denselben Fehler auch in Produktion
-- ausgeloest. Restrict passt zum Immutability-Design: ein Employee mit
-- vorhandenen AnalyticsEvents kann nicht geloescht werden.
--
-- BaselineMeasurement.employee behaelt bewusst SetNull, da baseline_measurements
-- keinen Append-only-Trigger hat und dort kein Konflikt besteht.

ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_tenant_id_employee_id_fkey";

ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees" ("tenant_id", "id") ON DELETE RESTRICT;
