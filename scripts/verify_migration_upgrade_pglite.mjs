import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";

// Verifiziert die Phase-3B-Migration (20260801130000_recommendation_engine)
// gegen eine bereits mit (vor-Phase-3B) Daten befuellte Datenbank
// ("Upgrade-Test" gemaess PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 10).
//
// Zwei Szenarien:
//   A) Minimaler Fixture-Datensatz MIT einer bestehenden RULE_BASED-
//      SalesOpportunity (source='RULE_BASED', trigger_signal_id nicht
//      vorhanden vor Phase 3B) -> der Pre-Migration-Check MUSS die
//      Migration kontrolliert mit RAISE EXCEPTION abbrechen.
//   B) Derselbe Fixture-Datensatz, aber die DetectedNeed-Zeile ist
//      EMPLOYEE_MARKED statt RULE_BASED -> die Migration MUSS erfolgreich
//      durchlaufen (Regelfall gemaess Bestandsaufnahme im Plan).

const INIT_SQL = fs.readFileSync("prisma/migrations/20260731000000_init/migration.sql", "utf8");
const RESTRICT_SQL = fs.readFileSync(
  "prisma/migrations/20260801095926_analytics_events_employee_restrict/migration.sql",
  "utf8",
);
const PHASE3B_SQL = fs.readFileSync(
  "prisma/migrations/20260801130000_recommendation_engine/migration.sql",
  "utf8",
);

function uuid() {
  return crypto.randomUUID();
}

async function buildFixture(db, needSource) {
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
  await db.query(
    `INSERT INTO product_categories (id, tenant_id, key, name) VALUES ($1,$2,'k','K')`,
    [categoryId, tenantId],
  );
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
  const detectedNeedId = uuid();
  await db.query(
    `INSERT INTO detected_needs (id, tenant_id, consultation_session_id, need_type, source, detected_at) VALUES ($1,$2,$3,'STREAMING',$4,'2026-07-15T09:06:30Z')`,
    [detectedNeedId, tenantId, sessionId, needSource],
  );
  await db.query(
    `INSERT INTO sales_opportunities (id, tenant_id, consultation_session_id, detected_need_id, status, offered_at) VALUES ($1,$2,$3,$4,'OFFERED','2026-07-15T09:10:00Z')`,
    [uuid(), tenantId, sessionId, detectedNeedId],
  );

  // recommendation_items.business_priority_score im plausiblen Bereich,
  // damit der Bounds-Check (Abschnitt 0a der Migration) nicht separat greift.
  const ruleSetId = uuid();
  await db.query(`INSERT INTO rule_sets (id, tenant_id, key) VALUES ($1,$2,'rs')`, [
    ruleSetId,
    tenantId,
  ]);
  const ruleSetVersionId = uuid();
  await db.query(
    `INSERT INTO rule_set_versions (id, tenant_id, rule_set_id, label, valid_from, status) VALUES ($1,$2,$3,'V1','2026-01-01T00:00:00Z','ACTIVE')`,
    [ruleSetVersionId, tenantId, ruleSetId],
  );
  await db.query(
    `INSERT INTO eligibility_rules (id, tenant_id, rule_set_version_id, key, description, expression) VALUES ($1,$2,$3,'mind_18','D','true')`,
    [uuid(), tenantId, ruleSetVersionId],
  );
  const recommendationId = uuid();
  await db.query(
    `INSERT INTO recommendations (id, tenant_id, consultation_session_id, rule_set_version_id, generated_at) VALUES ($1,$2,$3,$4,'2026-07-15T09:07:00Z')`,
    [recommendationId, tenantId, sessionId, ruleSetVersionId],
  );
  await db.query(
    `INSERT INTO recommendation_items (id, tenant_id, recommendation_id, product_version_id, eligibility_passed, exclusion_reason_codes, business_priority_score, priority_rank)
     VALUES ($1,$2,$3,$4,true,'{}',0.8,1)`,
    [uuid(), tenantId, recommendationId, productVersionId],
  );
}

async function run(label, needSource, expectFailure) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(INIT_SQL);
  await db.exec(RESTRICT_SQL);
  await buildFixture(db, needSource);

  try {
    await db.exec(PHASE3B_SQL);
    if (expectFailure) {
      console.error(
        `FEHLER (${label}): Migration wurde faelschlicherweise akzeptiert, obwohl ein Abbruch erwartet wurde.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`OK (${label}): Migration erfolgreich angewendet, wie erwartet.`);
    }
  } catch (err) {
    const msg = err.message.split("\n")[0];
    if (expectFailure) {
      console.log(`OK (${label}): Migration wie erwartet abgebrochen:`, msg);
    } else {
      console.error(`FEHLER (${label}): Migration unerwartet fehlgeschlagen:`, msg);
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

async function main() {
  console.log("== Szenario A: bestehende RULE_BASED-SalesOpportunity (erwartet: Abbruch) ==");
  await run("RULE_BASED-Bestand", "RULE_BASED", true);

  console.log("== Szenario B: bestehende EMPLOYEE_MARKED-SalesOpportunity (erwartet: Erfolg) ==");
  await run("EMPLOYEE_MARKED-Bestand", "EMPLOYEE_MARKED", false);

  if (process.exitCode === 1) {
    console.error("\nUpgrade-Test FEHLGESCHLAGEN.");
    process.exit(1);
  }
  console.log("\nUpgrade-Test (beide Szenarien) ERFOLGREICH.");
}

main().catch((err) => {
  console.error("FEHLGESCHLAGEN:", err);
  process.exit(1);
});
