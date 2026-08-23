-- Phase 7 AP6 (Performance-Indizes fuer die Analytics-KPI-Abfragen, siehe
-- PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 8). Rein additive Migration
-- (nur neue Indizes, keine Datenaenderung) -- kein Vorab-Datencheck noetig.
--
-- Hintergrund: die KPI-Aggregationsfunktionen (src/server/analytics/kpis.ts)
-- filtern IMMER nach tenantId (automatisch durch den mandantengescopten
-- Prisma-Client injiziert, siehe scoped-client.ts) sowie einem
-- Zeitraum-Feld, OPTIONAL zusaetzlich nach storeId/storeId-IN-Liste/
-- employeeId (storeEmployeeWhere()). Die bisherigen Indizes decken nur den
-- Fall MIT gesetztem storeId/employeeId-Filter ab; fuer den ebenfalls
-- haeufigen Fall ohne diese Einschraenkung (z. B. TENANT-Management-Scope
-- ohne Filialfilter, oder Mitarbeitersicht ohne gesetzten storeId) fehlte
-- bislang ein reiner (tenantId, <Zeitraum-Spalte>)-Index. Zusaetzlich fehlte
-- fuer deals ein employeeId-Index ueberhaupt (bisher nur storeId indiziert).

-- consultation_sessions: getConsultationVolumeKpi() -- startedAt-Zeitraum
-- ohne Filial-/Mitarbeitereinschraenkung.
CREATE INDEX "consultation_sessions_tenant_id_started_at_idx" ON "consultation_sessions" ("tenant_id", "started_at");

-- recommendations: getRecommendationOutcomeKpi() (itemsGenerated) --
-- generatedAt-Zeitraum. storeId/employeeId werden ueber die verknuepfte
-- ConsultationSession gefiltert, nicht auf dieser Tabelle.
CREATE INDEX "recommendations_tenant_id_generated_at_idx" ON "recommendations" ("tenant_id", "generated_at");

-- recommendation_outcomes: getRecommendationOutcomeKpi() (accepted/
-- rejected/deferred) -- decidedAt-Zeitraum, analog ueber die verknuepfte
-- Session gefiltert.
CREATE INDEX "recommendation_outcomes_tenant_id_decided_at_idx" ON "recommendation_outcomes" ("tenant_id", "decided_at");

-- deals: getDealKpi() -- closedAt-Zeitraum ohne Filial-/
-- Mitarbeitereinschraenkung, sowie die bislang fehlende employeeId-Variante
-- des Filters.
CREATE INDEX "deals_tenant_id_closed_at_idx" ON "deals" ("tenant_id", "closed_at");
CREATE INDEX "deals_employee_id_closed_at_idx" ON "deals" ("employee_id", "closed_at");
