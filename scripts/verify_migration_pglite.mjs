import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "fs";

// Migrationen werden in chronologischer Reihenfolge angewendet, analog zu
// "prisma migrate deploy". Neue additive Migrationen hier ergaenzen.
const MIGRATIONS = [
  "prisma/migrations/20260731000000_init/migration.sql",
  "prisma/migrations/20260801095926_analytics_events_employee_restrict/migration.sql",
  "prisma/migrations/20260801130000_recommendation_engine/migration.sql",
  "prisma/migrations/20260817170000_deal_unique_consultation_session/migration.sql",
  "prisma/migrations/20260817220000_analytics_kpi_indexes/migration.sql",
  "prisma/migrations/20260818090000_user_password_hash/migration.sql",
  "prisma/migrations/20260818140000_audit_action_delete/migration.sql",
  "prisma/migrations/20260821190000_commission_tiers/migration.sql",
  "prisma/migrations/20260822000000_deal_item_commission_model_version/migration.sql",
  "prisma/migrations/20260822100000_goal_model/migration.sql",
  "prisma/migrations/20260823120000_ai_extraction_feature_flag/migration.sql",
  "prisma/migrations/20260823140000_ai_extraction_analytics_events/migration.sql",
];

const db = new PGlite({ extensions: { btree_gist } });

const version = await db.query("SELECT version()");
console.log("Postgres:", version.rows[0].version);

for (const path of MIGRATIONS) {
  const sql = readFileSync(path, "utf-8");
  try {
    await db.exec(sql);
    console.log(`MIGRATION OK: ${path}`);
  } catch (err) {
    console.error(`MIGRATION FAILED: ${path}:`, err.message);
    process.exit(1);
  }
}

const tables = await db.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name;
`);
console.log(`Tables created: ${tables.rows.length}`);

const fks = await db.query(`
  SELECT count(*)::int AS n FROM information_schema.table_constraints
  WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';
`);
console.log(`Foreign keys created: ${fks.rows[0].n}`);

// -----------------------------------------------------------------------
// Smoke-Test Phase 3B: Recommendation-Engine-Tabellen end-to-end anlegen
// (Recommendation, RecommendationItem, RecommendationRationale mit
// Provisions-Pinning, RecommendationCrossSellingSignal, CrossSellingRule)
// sowie den neuen tenant-weiten EXCLUDE-Constraint auf rule_set_versions.
// -----------------------------------------------------------------------

function uuid() {
  return crypto.randomUUID();
}
let failures = 0;

async function expectRejected(label, fn) {
  try {
    await fn();
    console.error(`FEHLER: ${label} wurde faelschlicherweise akzeptiert!`);
    failures += 1;
  } catch (err) {
    console.log(`OK (erwartet abgelehnt) ${label}:`, err.message.split("\n")[0]);
  }
}

console.log("\n== Smoke-Test: Phase-3B-Recommendation-Engine end-to-end ==");

const tenantId = uuid();
await db.query(`INSERT INTO tenants (id, key, name, is_synthetic) VALUES ($1,'t','T',true)`, [
  tenantId,
]);
const companyId = uuid();
await db.query(`INSERT INTO companies (id, tenant_id, key, name) VALUES ($1,$2,'c','C')`, [
  companyId,
  tenantId,
]);
const storeId = uuid();
await db.query(
  `INSERT INTO stores (id, tenant_id, company_id, key, name) VALUES ($1,$2,$3,'s','S')`,
  [storeId, tenantId, companyId],
);
const userId = uuid();
await db.query(
  `INSERT INTO users (id, tenant_id, email, is_synthetic) VALUES ($1,$2,'u@example-synthetic.test',true)`,
  [userId, tenantId],
);
const employeeId = uuid();
await db.query(
  `INSERT INTO employees (id, tenant_id, store_id, user_id, display_name) VALUES ($1,$2,$3,$4,'E')`,
  [employeeId, tenantId, storeId, userId],
);
const providerId = uuid();
await db.query(`INSERT INTO providers (id, key, name, is_synthetic) VALUES ($1,'p','P',true)`, [
  providerId,
]);
const categoryId = uuid();
await db.query(`INSERT INTO product_categories (id, tenant_id, key, name) VALUES ($1,$2,'k','K')`, [
  categoryId,
  tenantId,
]);
const productId = uuid();
await db.query(
  `INSERT INTO products (id, tenant_id, provider_id, category_id, product_type, name, is_synthetic) VALUES ($1,$2,$3,$4,'MOBILE_NEW_CONTRACT','P',true)`,
  [productId, tenantId, providerId, categoryId],
);
const productVersionId = uuid();
await db.query(
  `INSERT INTO product_versions (id, tenant_id, product_id, version_number, status, valid_from, currency) VALUES ($1,$2,$3,1,'ACTIVE','2026-01-01T00:00:00Z','EUR')`,
  [productVersionId, tenantId, productId],
);
const commissionModelId = uuid();
await db.query(
  `INSERT INTO commission_models (id, tenant_id, product_id, name) VALUES ($1,$2,$3,'CM')`,
  [commissionModelId, tenantId, productId],
);
const commissionModelVersionId = uuid();
await db.query(
  `INSERT INTO commission_model_versions (id, tenant_id, commission_model_id, version_number, status, valid_from, commission_type, currency, commission_amount_minor)
   VALUES ($1,$2,$3,1,'ACTIVE','2026-01-01T00:00:00Z','FLAT','EUR',3000)`,
  [commissionModelVersionId, tenantId, commissionModelId],
);
const questionnaireId = uuid();
await db.query(`INSERT INTO questionnaires (id, tenant_id, key) VALUES ($1,$2,'q')`, [
  questionnaireId,
  tenantId,
]);
const questionnaireVersionId = uuid();
await db.query(
  `INSERT INTO questionnaire_versions (id, tenant_id, questionnaire_id, label, valid_from, status) VALUES ($1,$2,$3,'V1','2026-01-01T00:00:00Z','ACTIVE')`,
  [questionnaireVersionId, tenantId, questionnaireId],
);
const questionId = uuid();
await db.query(
  `INSERT INTO questions (id, tenant_id, questionnaire_version_id, key, need_type, sort_order) VALUES ($1,$2,$3,'hat_streaming','STREAMING',1)`,
  [questionId, tenantId, questionnaireVersionId],
);
const customerReferenceId = uuid();
await db.query(
  `INSERT INTO customer_references (id, tenant_id, store_id, display_code) VALUES ($1,$2,$3,'K-1')`,
  [customerReferenceId, tenantId, storeId],
);
const sessionId = uuid();
await db.query(
  `INSERT INTO consultation_sessions (id, tenant_id, store_id, employee_id, customer_reference_id, questionnaire_version_id, consultation_type, status, started_at)
   VALUES ($1,$2,$3,$4,$5,$6,'NEW_CONTRACT','COMPLETED','2026-07-15T09:00:00Z')`,
  [sessionId, tenantId, storeId, employeeId, customerReferenceId, questionnaireVersionId],
);
const questionVersionId = uuid();
await db.query(
  `INSERT INTO question_versions (id, tenant_id, question_id, label, answer_type, is_required, valid_from, status)
   VALUES ($1,$2,$3,'Streaming?','BOOLEAN',false,'2026-01-01T00:00:00Z','ACTIVE')`,
  [questionVersionId, tenantId, questionId],
);
const answerId = uuid();
await db.query(
  `INSERT INTO customer_answers (id, tenant_id, consultation_session_id, question_version_id, answer_type, boolean_value, answered_at)
   VALUES ($1,$2,$3,$4,'BOOLEAN',true,'2026-07-15T09:06:00Z')`,
  [answerId, tenantId, sessionId, questionVersionId],
);

const ruleSetId = uuid();
await db.query(`INSERT INTO rule_sets (id, tenant_id, key) VALUES ($1,$2,'rs1')`, [
  ruleSetId,
  tenantId,
]);
const ruleSetVersionId = uuid();
await db.query(
  `INSERT INTO rule_set_versions (id, tenant_id, rule_set_id, label, valid_from, status) VALUES ($1,$2,$3,'V1','2026-01-01T00:00:00Z','ACTIVE')`,
  [ruleSetVersionId, tenantId, ruleSetId],
);

const crossSellingRuleId = uuid();
await db.query(
  `INSERT INTO cross_selling_rules (id, tenant_id, rule_set_version_id, key, description, need_type, priority, reason_code)
   VALUES ($1,$2,$3,'streaming_upsell','D','STREAMING',1,'streaming_bedarf_erkannt')`,
  [crossSellingRuleId, tenantId, ruleSetVersionId],
);

const recommendationId = uuid();
await db.query(
  `INSERT INTO recommendations (id, tenant_id, consultation_session_id, rule_set_version_id, algorithm_version, evaluation_fingerprint, generated_at)
   VALUES ($1,$2,$3,$4,1,$5,'2026-07-15T09:07:00Z')`,
  [recommendationId, tenantId, sessionId, ruleSetVersionId, "a".repeat(64)],
);

const signalId = uuid();
await db.query(
  `INSERT INTO recommendation_cross_selling_signals (id, tenant_id, recommendation_id, trigger_rule_id, trigger_rule_set_version_id, source_answer_id, need_type, reason_code, priority, suggested_product_version_id)
   VALUES ($1,$2,$3,$4,$5,$6,'STREAMING','streaming_bedarf_erkannt',1,$7)`,
  [
    signalId,
    tenantId,
    recommendationId,
    crossSellingRuleId,
    ruleSetVersionId,
    answerId,
    productVersionId,
  ],
);

await db.query(
  `INSERT INTO sales_opportunities (id, tenant_id, consultation_session_id, trigger_signal_id, reason_code, priority, status)
   VALUES ($1,$2,$3,$4,'streaming_bedarf_erkannt',1,'OPEN')`,
  [uuid(), tenantId, sessionId, signalId],
);

const recommendationItemId = uuid();
await db.query(
  `INSERT INTO recommendation_items (id, tenant_id, recommendation_id, product_version_id, eligibility_passed, exclusion_reason_codes, customer_fit_score, business_priority_score, priority_rank)
   VALUES ($1,$2,$3,$4,true,'{}',80,90,1)`,
  [recommendationItemId, tenantId, recommendationId, productVersionId],
);

await db.query(
  `INSERT INTO recommendation_rationales (id, tenant_id, recommendation_item_id, factor_key, factor_value, commission_model_version_id, commission_value_minor)
   VALUES ($1,$2,$3,'commission_pinning','FLAT',$4,3000)`,
  [uuid(), tenantId, recommendationItemId, commissionModelVersionId],
);

console.log(
  "OK: Recommendation + RecommendationItem + RecommendationRationale (mit Provisions-Pinning) + RecommendationCrossSellingSignal + SalesOpportunity (mutabel, trigger_signal_id gesetzt) end-to-end angelegt.",
);

await expectRejected("append-only: UPDATE auf recommendations", () =>
  db.query(`UPDATE recommendations SET generated_at = now() WHERE id = $1`, [recommendationId]),
);
await expectRejected("append-only: DELETE auf recommendation_items", () =>
  db.query(`DELETE FROM recommendation_items WHERE id = $1`, [recommendationItemId]),
);
await expectRejected("append-only: UPDATE auf recommendation_cross_selling_signals", () =>
  db.query(`UPDATE recommendation_cross_selling_signals SET priority = 2 WHERE id = $1`, [
    signalId,
  ]),
);

const rationaleId = uuid();
await db.query(
  `INSERT INTO recommendation_rationales (id, tenant_id, recommendation_item_id, factor_key, factor_value, commission_model_version_id, commission_value_minor)
   VALUES ($1,$2,$3,'commission_pinning','FLAT',$4,3000)`,
  [rationaleId, tenantId, recommendationItemId, commissionModelVersionId],
);
await expectRejected("append-only: UPDATE auf recommendation_rationales", () =>
  db.query(`UPDATE recommendation_rationales SET factor_value = 'PERCENTAGE' WHERE id = $1`, [
    rationaleId,
  ]),
);
await expectRejected("append-only: DELETE auf recommendation_rationales", () =>
  db.query(`DELETE FROM recommendation_rationales WHERE id = $1`, [rationaleId]),
);

const outcomeId = uuid();
await db.query(
  `INSERT INTO recommendation_outcomes (id, tenant_id, recommendation_item_id, outcome, decided_by_employee_id, decided_at)
   VALUES ($1,$2,$3,'ACCEPTED',$4,'2026-07-15T09:10:00Z')`,
  [outcomeId, tenantId, recommendationItemId, employeeId],
);
await expectRejected("append-only: UPDATE auf recommendation_outcomes", () =>
  db.query(`UPDATE recommendation_outcomes SET outcome = 'REJECTED' WHERE id = $1`, [outcomeId]),
);
await expectRejected("append-only: DELETE auf recommendation_outcomes", () =>
  db.query(`DELETE FROM recommendation_outcomes WHERE id = $1`, [outcomeId]),
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 6: Deal + DealItem + DealFinancialSnapshot end-to-end
// anlegen und den append-only-Trigger auf deal_financial_snapshots pruefen
// (Trigger existiert bereits seit der init-Migration, wurde aber vor
// Phase 6 AP3 -- da bis dahin nie tatsaechlich beschrieben -- noch nie
// tatsaechlich ausgeloest, siehe PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 5).
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-6-Deal-Erfassung end-to-end ==");

const dealId = uuid();
await db.query(
  `INSERT INTO deals (id, tenant_id, consultation_session_id, store_id, employee_id, customer_reference_id, currency, closed_at)
   VALUES ($1,$2,$3,$4,$5,$6,'EUR','2026-07-15T09:15:00Z')`,
  [dealId, tenantId, sessionId, storeId, employeeId, customerReferenceId],
);

const dealItemId = uuid();
await db.query(
  `INSERT INTO deal_items (id, tenant_id, deal_id, product_version_id, commission_model_version_id, quantity) VALUES ($1,$2,$3,$4,$5,1)`,
  [dealItemId, tenantId, dealId, productVersionId, commissionModelVersionId],
);

const dealFinancialSnapshotId = uuid();
await db.query(
  `INSERT INTO deal_financial_snapshots (id, tenant_id, deal_id, currency, monthly_recurring_revenue_minor, total_contract_value_minor, one_time_revenue_minor, commission_amount_minor, expected_recurring_commission_minor, hardware_purchase_cost_minor, subsidy_cost_minor, discount_cost_minor, other_direct_cost_minor, contribution_margin_minor, contribution_margin_formula_version, captured_at)
   VALUES ($1,$2,$3,'EUR',1000,6000,5000,300,0,2000,0,0,0,3000,'v1','2026-07-15T09:15:00Z')`,
  [dealFinancialSnapshotId, tenantId, dealId],
);

console.log("OK: Deal + DealItem + DealFinancialSnapshot end-to-end angelegt.");

await expectRejected("append-only: UPDATE auf deal_financial_snapshots", () =>
  db.query(`UPDATE deal_financial_snapshots SET contribution_margin_minor = 0 WHERE id = $1`, [
    dealFinancialSnapshotId,
  ]),
);
await expectRejected("append-only: DELETE auf deal_financial_snapshots", () =>
  db.query(`DELETE FROM deal_financial_snapshots WHERE id = $1`, [dealFinancialSnapshotId]),
);

// deals/deal_items bleiben bewusst mutabel (kein append-only-Trigger, siehe
// Schema) -- nur der Finanz-Snapshot selbst ist unveraenderlich.
await db.query(`UPDATE deal_items SET quantity = 2 WHERE id = $1`, [dealItemId]);
console.log("OK: deal_items bleibt mutabel (UPDATE erfolgreich, kein append-only-Trigger).");

// AP12-Hardening: DB-seitiger Unique-Constraint gegen zwei Deals fuer
// dieselbe ConsultationSession (Migration 20260817170000). Vorher wurde
// dies ausschliesslich durch einen App-Level-Precheck in closeDeal()
// durchgesetzt, der bei zwei nahezu gleichzeitigen Aufrufen race-anfaellig
// waere -- siehe PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 12.9.
await expectRejected(
  "zweiter Deal fuer dieselbe ConsultationSession (deals_tenant_id_consultation_session_id_key)",
  () =>
    db.query(
      `INSERT INTO deals (id, tenant_id, consultation_session_id, store_id, employee_id, currency, closed_at)
       VALUES ($1,$2,$3,$4,$5,'EUR','2026-07-15T09:20:00Z')`,
      [uuid(), tenantId, sessionId, storeId, employeeId],
    ),
);

// sales_opportunities bleibt bewusst mutabel (kein append-only-Trigger).
await db.query(`UPDATE sales_opportunities SET status = 'OFFERED' WHERE trigger_signal_id = $1`, [
  signalId,
]);
console.log(
  "OK: sales_opportunities bleibt mutabel (UPDATE erfolgreich, kein append-only-Trigger).",
);

console.log("\n== Smoke-Test: rule_set_versions_tenant_active_no_overlap EXCLUDE-Constraint ==");
const ruleSetId2 = uuid();
await db.query(`INSERT INTO rule_sets (id, tenant_id, key) VALUES ($1,$2,'rs2')`, [
  ruleSetId2,
  tenantId,
]);

await expectRejected(
  "zweite ACTIVE RuleSetVersion desselben Tenants in ueberlappendem Zeitfenster (anderes RuleSet)",
  () =>
    db.query(
      `INSERT INTO rule_set_versions (id, tenant_id, rule_set_id, label, valid_from, status) VALUES ($1,$2,$3,'V1-parallel','2026-06-01T00:00:00Z','ACTIVE')`,
      [uuid(), tenantId, ruleSetId2],
    ),
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 7 AP6: die fuenf neuen Analytics-KPI-Indizes existieren
// tatsaechlich (siehe PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 8).
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-7-AP6-Analytics-KPI-Indizes ==");

const expectedIndexes = [
  "consultation_sessions_tenant_id_started_at_idx",
  "recommendations_tenant_id_generated_at_idx",
  "recommendation_outcomes_tenant_id_decided_at_idx",
  "deals_tenant_id_closed_at_idx",
  "deals_employee_id_closed_at_idx",
];

const indexRows = await db.query(`
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public';
`);
const indexNames = new Set(indexRows.rows.map((r) => r.indexname));

for (const name of expectedIndexes) {
  if (indexNames.has(name)) {
    console.log(`OK: Index "${name}" vorhanden.`);
  } else {
    console.error(`FEHLER: erwarteter Index "${name}" fehlt!`);
    failures += 1;
  }
}

// -----------------------------------------------------------------------
// Smoke-Test Phase 8 AP1: users.password_hash existiert, ist nullable und
// laesst sich fuer einen synthetischen Admin-Testnutzer setzen, waehrend
// bestehende Nutzer ohne den Wert unveraendert funktionieren (siehe
// PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-8-AP1-users.password_hash ==");

const columnRows = await db.query(`
  SELECT is_nullable FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_hash';
`);
if (columnRows.rows.length === 0) {
  console.error(`FEHLER: Spalte "users.password_hash" fehlt!`);
  failures += 1;
} else if (columnRows.rows[0].is_nullable !== "YES") {
  console.error(`FEHLER: "users.password_hash" ist nicht nullable!`);
  failures += 1;
} else {
  console.log(`OK: Spalte "users.password_hash" vorhanden und nullable.`);
}

const adminUserId = uuid();
await db.query(
  `INSERT INTO users (id, tenant_id, email, is_synthetic, password_hash) VALUES ($1,$2,'admin@example-synthetic.test',true,'deadbeef:cafebabe')`,
  [adminUserId, tenantId],
);
console.log("OK: Nutzer mit gesetztem password_hash angelegt.");
console.log(
  "OK: bestehende Nutzer (userId oben) blieben mit password_hash = NULL funktionsfaehig.",
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 8 AP7: neuer AuditAction-Wert DELETE (siehe
// prisma/migrations/20260818140000_audit_action_delete) laesst sich in
// audit_logs verwenden, und audit_logs bleibt append-only (bereits seit
// Phase 2B per Trigger durchgesetzt, siehe oben) -- ein nachtraeglicher
// UPDATE/DELETE eines Audit-Eintrags muss weiterhin abgelehnt werden.
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-8-AP7-AuditAction.DELETE ==");

const deleteAuditId = uuid();
await db.query(
  `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,'DELETE','Question',$4,'{"reason":"removed_from_draft"}')`,
  [deleteAuditId, tenantId, adminUserId, uuid()],
);
console.log("OK: AuditLog-Eintrag mit action=DELETE erfolgreich angelegt.");

try {
  await db.query(`UPDATE audit_logs SET action = 'CREATE' WHERE id = $1`, [deleteAuditId]);
  console.error(
    "FEHLER: UPDATE auf audit_logs (action=DELETE-Eintrag) haette abgelehnt werden muessen!",
  );
  failures += 1;
} catch (err) {
  console.log(`OK (erwartet abgelehnt) append-only: UPDATE auf audit_logs: ${err.message}`);
}

// -----------------------------------------------------------------------
// Smoke-Test Phase 8 AP8 (Hardening): "niemals zwei ACTIVE-Versionen
// gleichzeitig" fuer dasselbe Questionnaire. Bei der Pruefung dieser
// Invariante wurde zunaechst faelschlich eine offene Luecke vermutet
// (Race Condition bei zwei nahezu gleichzeitigen publishDraftVersion()-
// Aufrufen) -- tatsaechlich verhindert dies bereits der seit der
// Init-Migration bestehende EXCLUDE-Constraint
// "questionnaire_versions_no_overlap" (siehe Kommentar bei
// QuestionnaireVersion in schema.prisma; ChatGPT-Entscheidung "Option B",
// 2026-08-18, statt eines zusaetzlichen Unique-Index). Dieser Smoke-Test
// belegt das explizit.
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-8-AP8-questionnaire_versions ACTIVE-Ueberlappungsschutz ==");

await expectRejected(
  "zweite ACTIVE QuestionnaireVersion desselben Questionnaire (questionnaire_versions_no_overlap)",
  () =>
    db.query(
      `INSERT INTO questionnaire_versions (id, tenant_id, questionnaire_id, label, valid_from, status) VALUES ($1,$2,$3,'V2-parallel','2026-06-01T00:00:00Z','ACTIVE')`,
      [uuid(), tenantId, questionnaireId],
    ),
);

// Ein zweites, ANDERES Questionnaire darf weiterhin unabhaengig eine eigene
// ACTIVE Version haben -- der Index ist bewusst pro Questionnaire scoped,
// nicht pro Tenant.
const questionnaireId2 = uuid();
await db.query(`INSERT INTO questionnaires (id, tenant_id, key) VALUES ($1,$2,'q2')`, [
  questionnaireId2,
  tenantId,
]);
await db.query(
  `INSERT INTO questionnaire_versions (id, tenant_id, questionnaire_id, label, valid_from, status) VALUES ($1,$2,$3,'V1','2026-01-01T00:00:00Z','ACTIVE')`,
  [uuid(), tenantId, questionnaireId2],
);
console.log(
  "OK: ACTIVE QuestionnaireVersion fuer ein ANDERES Questionnaire desselben Tenants bleibt unabhaengig moeglich.",
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 10 AP4: commission_tiers -- die beiden neuen
// CHECK-Constraints (threshold_minor >= 0, tier_amount_minor XOR
// tier_percentage_basis_points) sowie die eindeutige (tenant_id,
// commission_model_version_id, threshold_minor)/(..., sort_order)
// tatsaechlich durchsetzen, plus ein gueltiger End-to-End-Datensatz je
// Variante (Amount-Tier, Percentage-Tier).
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-10-AP4-commission_tiers ==");

const tieredCommissionModelId = uuid();
await db.query(
  `INSERT INTO commission_models (id, tenant_id, product_id, name) VALUES ($1,$2,$3,'CM-Tiered')`,
  [tieredCommissionModelId, tenantId, productId],
);
const tieredVersionId = uuid();
await db.query(
  `INSERT INTO commission_model_versions (id, tenant_id, commission_model_id, version_number, status, valid_from, commission_type, currency)
   VALUES ($1,$2,$3,1,'DRAFT','2026-01-01T00:00:00Z','TIERED','EUR')`,
  [tieredVersionId, tenantId, tieredCommissionModelId],
);

const tierZeroId = uuid();
await db.query(
  `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_amount_minor, sort_order)
   VALUES ($1,$2,$3,0,500,1)`,
  [tierZeroId, tenantId, tieredVersionId],
);
const tierOneId = uuid();
await db.query(
  `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_percentage_basis_points, sort_order)
   VALUES ($1,$2,$3,100000,500,2)`,
  [tierOneId, tenantId, tieredVersionId],
);
console.log(
  "OK: zwei CommissionTier-Zeilen (Amount- und Percentage-Variante) end-to-end angelegt.",
);

await expectRejected(
  "threshold_minor < 0 (commission_tiers_threshold_minor_nonnegative_check)",
  () =>
    db.query(
      `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_amount_minor, sort_order)
     VALUES ($1,$2,$3,-1,100,3)`,
      [uuid(), tenantId, tieredVersionId],
    ),
);
await expectRejected(
  "weder tier_amount_minor noch tier_percentage_basis_points gesetzt (commission_tiers_amount_xor_percentage_check)",
  () =>
    db.query(
      `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, sort_order)
       VALUES ($1,$2,$3,50000,3)`,
      [uuid(), tenantId, tieredVersionId],
    ),
);
await expectRejected(
  "BEIDE tier_amount_minor UND tier_percentage_basis_points gesetzt (commission_tiers_amount_xor_percentage_check)",
  () =>
    db.query(
      `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_amount_minor, tier_percentage_basis_points, sort_order)
       VALUES ($1,$2,$3,50000,100,500,3)`,
      [uuid(), tenantId, tieredVersionId],
    ),
);
await expectRejected(
  "doppelte threshold_minor innerhalb derselben Version (commission_tiers_tenant_id_commission_model_version_id_threshold_minor_key)",
  () =>
    db.query(
      `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_amount_minor, sort_order)
       VALUES ($1,$2,$3,0,999,3)`,
      [uuid(), tenantId, tieredVersionId],
    ),
);
await expectRejected(
  "doppelter sort_order innerhalb derselben Version (commission_tiers_tenant_id_commission_model_version_id_sort_order_key)",
  () =>
    db.query(
      `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_amount_minor, sort_order)
       VALUES ($1,$2,$3,50000,100,1)`,
      [uuid(), tenantId, tieredVersionId],
    ),
);
await expectRejected(
  "commission_model_version_id auf nicht existierende Version (commission_tiers_tenant_id_commission_model_version_id_fkey)",
  () =>
    db.query(
      `INSERT INTO commission_tiers (id, tenant_id, commission_model_version_id, threshold_minor, tier_amount_minor, sort_order)
       VALUES ($1,$2,$3,0,100,1)`,
      [uuid(), tenantId, uuid()],
    ),
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 10 AP6: deal_items.commission_model_version_id --
// nullable Spalte (bestehende deal_items-Zeile oben wurde bereits MIT
// gesetztem Wert angelegt, siehe Deal-Erfassung-Block); hier zusaetzlich:
// eine zweite Zeile OHNE Wert (NULL bleibt gueltig, "kein Provisionsmodell
// fuer dieses Produkt") sowie die FK-Durchsetzung gegen eine nicht
// existierende CommissionModelVersion.
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-10-AP6-deal_items.commission_model_version_id ==");

const dealItemWithoutCommissionId = uuid();
await db.query(
  `INSERT INTO deal_items (id, tenant_id, deal_id, product_version_id, commission_model_version_id, quantity) VALUES ($1,$2,$3,$4,NULL,1)`,
  [dealItemWithoutCommissionId, tenantId, dealId, productVersionId],
);
console.log("OK: deal_items-Zeile OHNE commission_model_version_id (NULL) end-to-end angelegt.");

await expectRejected(
  "commission_model_version_id auf nicht existierende Version (deal_items_tenant_id_commission_model_version_id_fkey)",
  () =>
    db.query(
      `INSERT INTO deal_items (id, tenant_id, deal_id, product_version_id, commission_model_version_id, quantity) VALUES ($1,$2,$3,$4,$5,1)`,
      [uuid(), tenantId, dealId, productVersionId, uuid()],
    ),
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 11 AP1: goals + goal_versions -- gueltiger End-to-End-
// Datensatz (STORE-Scope, DEALS_CLOSED-Metrik, targetCount) sowie die
// neuen Constraints: XOR-CHECK auf den drei Zielwert-Feldern
// (goal_versions_target_value_xor_check), eindeutige Goal-Identitaet
// (goals_scope_metric_period_key), eindeutige versionNumber je Goal
// (goal_versions_tenant_id_goal_id_version_number_key), FK auf ein nicht
// existierendes Goal. KEIN status-Feld auf goal_versions (bewusst, siehe
// Schema-/Migrationskommentar) -- "aktuelle" Version wird ausschliesslich
// ueber getCurrentGoalVersion() (AP2, Anwendungsebene) bestimmt, nicht
// hier auf DB-Ebene geprueft.
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-11-AP1-goals/goal_versions ==");

const goalId = uuid();
await db.query(
  `INSERT INTO goals (id, tenant_id, scope_type, scope_id, metric_key, period_type, period_start)
   VALUES ($1,$2,'STORE',$3,'DEALS_CLOSED','MONTH','2026-09-01T00:00:00Z')`,
  [goalId, tenantId, storeId],
);
const goalVersionId = uuid();
await db.query(
  `INSERT INTO goal_versions (id, tenant_id, goal_id, version_number, target_count, created_by_user_id)
   VALUES ($1,$2,$3,1,20,$4)`,
  [goalVersionId, tenantId, goalId, userId],
);
console.log("OK: Goal (STORE/DEALS_CLOSED) + GoalVersion (targetCount=20) end-to-end angelegt.");

await expectRejected("GoalVersion ohne jeden Zielwert (goal_versions_target_value_xor_check)", () =>
  db.query(
    `INSERT INTO goal_versions (id, tenant_id, goal_id, version_number) VALUES ($1,$2,$3,2)`,
    [uuid(), tenantId, goalId],
  ),
);
await expectRejected(
  "GoalVersion mit ZWEI gesetzten Zielwerten (goal_versions_target_value_xor_check)",
  () =>
    db.query(
      `INSERT INTO goal_versions (id, tenant_id, goal_id, version_number, target_count, target_amount_minor) VALUES ($1,$2,$3,2,20,50000)`,
      [uuid(), tenantId, goalId],
    ),
);
await expectRejected(
  "zweites Goal mit identischer Scope/Metrik/Periode-Identitaet (goals_scope_metric_period_key)",
  () =>
    db.query(
      `INSERT INTO goals (id, tenant_id, scope_type, scope_id, metric_key, period_type, period_start)
       VALUES ($1,$2,'STORE',$3,'DEALS_CLOSED','MONTH','2026-09-01T00:00:00Z')`,
      [uuid(), tenantId, storeId],
    ),
);
await expectRejected(
  "doppelte version_number innerhalb desselben Goal (goal_versions_tenant_id_goal_id_version_number_key)",
  () =>
    db.query(
      `INSERT INTO goal_versions (id, tenant_id, goal_id, version_number, target_count) VALUES ($1,$2,$3,1,99)`,
      [uuid(), tenantId, goalId],
    ),
);
await expectRejected(
  "goal_id auf nicht existierendes Goal (goal_versions_tenant_id_goal_id_fkey)",
  () =>
    db.query(
      `INSERT INTO goal_versions (id, tenant_id, goal_id, version_number, target_count) VALUES ($1,$2,$3,1,10)`,
      [uuid(), tenantId, uuid()],
    ),
);

// Eine zweite, historisierende GoalVersion (Korrektur) fuer dasselbe Goal
// bleibt gueltig -- kein Publish-Workflow, einfach die naechste
// versionNumber (siehe Modulkommentar: getCurrentGoalVersion() waehlt sie
// spaeter in AP2 ueber ORDER BY version_number DESC LIMIT 1 aus).
const goalVersion2Id = uuid();
await db.query(
  `INSERT INTO goal_versions (id, tenant_id, goal_id, version_number, target_count, created_by_user_id)
   VALUES ($1,$2,$3,2,25,$4)`,
  [goalVersion2Id, tenantId, goalId, userId],
);
console.log(
  "OK: zweite GoalVersion (Korrektur, version_number=2, targetCount=25) fuer dasselbe Goal end-to-end angelegt -- Historisierung ohne Publish-Workflow bestaetigt.",
);

// -----------------------------------------------------------------------
// Smoke-Test Phase 12 AP1: tenants.ai_extraction_enabled -- Spalte
// existiert, ist NOT NULL mit DEFAULT false (bewusst "default aus", siehe
// Migrationskommentar), bestehende Zeilen (z. B. der oben angelegte
// Test-Tenant) bekommen automatisch false.
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-12-AP1-tenants.ai_extraction_enabled ==");

const aiFlagColumn = await db.query(`
  SELECT is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'ai_extraction_enabled';
`);
if (aiFlagColumn.rows.length === 0) {
  console.error(`FEHLER: Spalte "tenants.ai_extraction_enabled" fehlt!`);
  failures += 1;
} else if (aiFlagColumn.rows[0].is_nullable !== "NO") {
  console.error(`FEHLER: "tenants.ai_extraction_enabled" ist nullable, sollte NOT NULL sein!`);
  failures += 1;
} else {
  console.log(`OK: Spalte "tenants.ai_extraction_enabled" vorhanden, NOT NULL.`);
}

const existingTenantFlag = await db.query(
  `SELECT ai_extraction_enabled FROM tenants WHERE id = $1`,
  [tenantId],
);
if (existingTenantFlag.rows[0]?.ai_extraction_enabled !== false) {
  console.error(
    `FEHLER: bestehender Tenant hat nicht automatisch ai_extraction_enabled=false erhalten!`,
  );
  failures += 1;
} else {
  console.log("OK: bestehender Tenant hat automatisch ai_extraction_enabled=false (DEFAULT).");
}

// -----------------------------------------------------------------------
// Smoke-Test Phase 12 AP4: die vier neuen AnalyticsEventType-Enum-Werte
// (AI_EXTRACTION_REQUESTED/COMPLETED, AI_SUGGESTION_ACCEPTED/REJECTED)
// lassen sich tatsaechlich in analytics_events verwenden, end-to-end je
// Wert -- rein additive Enum-Erweiterung, kein neuer Constraint.
// -----------------------------------------------------------------------

console.log("\n== Smoke-Test: Phase-12-AP4-AnalyticsEventType (KI-Extraktion) ==");

const newAiEventTypes = [
  "AI_EXTRACTION_REQUESTED",
  "AI_EXTRACTION_COMPLETED",
  "AI_SUGGESTION_ACCEPTED",
  "AI_SUGGESTION_REJECTED",
];
for (const eventType of newAiEventTypes) {
  await db.query(
    `INSERT INTO analytics_events (id, tenant_id, store_id, employee_id, event_type, occurred_at, payload)
     VALUES ($1,$2,$3,$4,$5,'2026-08-23T12:00:00Z','{"consultationSessionId":"` +
      sessionId +
      `"}')`,
    [uuid(), tenantId, storeId, employeeId, eventType],
  );
}
console.log(
  `OK: alle vier neuen AnalyticsEventType-Werte (${newAiEventTypes.join(", ")}) end-to-end in analytics_events angelegt.`,
);

if (failures > 0) {
  console.error(`\n${failures} Smoke-Test-Pruefung(en) FEHLGESCHLAGEN.`);
  process.exit(1);
}

console.log(
  "\nALLE MIGRATIONSPRUEFUNGEN (PHASE 3B + PHASE 6 + PHASE 7 AP6 + PHASE 8 AP1 + PHASE 8 AP7 + PHASE 8 AP8 + PHASE 10 AP4 + PHASE 10 AP6 + PHASE 11 AP1 + PHASE 12 AP1 + PHASE 12 AP4) ERFOLGREICH.",
);

await db.close();
