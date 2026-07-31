import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";

const db = new PGlite({ extensions: { btree_gist } });
const migrationSql = fs.readFileSync("prisma/migrations/20260731000000_init/migration.sql", "utf8");

function uuid() {
  return crypto.randomUUID();
}

async function q(sql, params = []) {
  return db.query(sql, params);
}

let failures = 0;

async function expectRejected(label, fn) {
  try {
    await fn();
    console.error(`FEHLER: ${label} wurde faelschlicherweise akzeptiert!`);
    failures += 1;
    process.exitCode = 1;
  } catch (err) {
    console.log(`OK (erwartet abgelehnt) ${label}:`, err.message.split("\n")[0]);
  }
}

async function main() {
  console.log("== 1) Migration ausfuehren ==");
  await db.exec(migrationSql);
  console.log("Migration OK");

  console.log("== 2) Globaler Katalog (Provider, Permissions) ==");
  const providerIds = {};
  for (const [key, name] of [
    ["o2-telefonica", "O2 / Telefonica (synthetisch)"],
    ["telekom", "Telekom (synthetisch)"],
    ["freenet", "freenet (synthetisch)"],
  ]) {
    const id = uuid();
    await q(`INSERT INTO providers (id, key, name, is_synthetic) VALUES ($1,$2,$3,true)`, [
      id,
      key,
      name,
    ]);
    providerIds[key] = id;
  }

  const permissionKeys = [
    "consultation.create",
    "consultation.view_own",
    "deal.create",
    "analytics.view_store",
    "master_data.manage",
  ];
  const permissionIds = [];
  for (const key of permissionKeys) {
    const id = uuid();
    await q(`INSERT INTO permissions (id, key, description) VALUES ($1,$2,$3)`, [
      id,
      key,
      `Berechtigung: ${key}`,
    ]);
    permissionIds.push(id);
  }

  // --- Full per-tenant seed, mirroring prisma/seed.ts field-for-field ---
  async function seedTenant(cfg) {
    const tenantId = uuid();
    await q(`INSERT INTO tenants (id, key, name, is_synthetic) VALUES ($1,$2,$3,true)`, [
      tenantId,
      cfg.key,
      cfg.name,
    ]);

    const companyId = uuid();
    await q(`INSERT INTO companies (id, tenant_id, key, name) VALUES ($1,$2,$3,$4)`, [
      companyId,
      tenantId,
      cfg.companyKey,
      cfg.companyName,
    ]);

    const storeIds = [];
    for (let i = 0; i < cfg.storeKeys.length; i++) {
      const storeId = uuid();
      await q(`INSERT INTO stores (id, tenant_id, company_id, key, name) VALUES ($1,$2,$3,$4,$5)`, [
        storeId,
        tenantId,
        companyId,
        cfg.storeKeys[i],
        `${cfg.companyName} Filiale ${i + 1}`,
      ]);
      storeIds.push(storeId);
    }

    const adminRoleId = uuid();
    await q(
      `INSERT INTO roles (id, tenant_id, key, name, is_system_defined) VALUES ($1,$2,'store_admin','Filialleitung',true)`,
      [adminRoleId, tenantId],
    );
    const salesRoleId = uuid();
    await q(
      `INSERT INTO roles (id, tenant_id, key, name, is_system_defined) VALUES ($1,$2,'sales_employee','Verkaufsberater:in',true)`,
      [salesRoleId, tenantId],
    );
    for (const permId of permissionIds) {
      await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [
        salesRoleId,
        permId,
      ]);
    }

    const employeeIds = [];
    const userIds = [];
    for (let i = 0; i < storeIds.length; i++) {
      const userId = uuid();
      await q(`INSERT INTO users (id, tenant_id, email, is_synthetic) VALUES ($1,$2,$3,true)`, [
        userId,
        tenantId,
        `${cfg.key}-mitarbeiter${i + 1}@example-synthetic.test`,
      ]);
      userIds.push(userId);
      const employeeId = uuid();
      await q(
        `INSERT INTO employees (id, tenant_id, store_id, user_id, display_name) VALUES ($1,$2,$3,$4,$5)`,
        [
          employeeId,
          tenantId,
          storeIds[i],
          userId,
          `Synthetische:r Mitarbeiter:in ${i + 1} (${cfg.key})`,
        ],
      );
      employeeIds.push(employeeId);
    }

    await q(
      `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, company_id, store_id) VALUES ($1,$2,$3,$4,'STORE',$5,$6)`,
      [uuid(), tenantId, userIds[0], adminRoleId, companyId, storeIds[0]],
    );

    const categoryId = uuid();
    await q(
      `INSERT INTO product_categories (id, tenant_id, key, name) VALUES ($1,$2,'mobilfunk','Mobilfunk')`,
      [categoryId, tenantId],
    );

    const productId = uuid();
    await q(
      `INSERT INTO products (id, tenant_id, provider_id, category_id, product_type, name, is_synthetic) VALUES ($1,$2,$3,$4,'MOBILE_NEW_CONTRACT','DemoTel Mobil M (synthetisch)',true)`,
      [productId, tenantId, providerIds["o2-telefonica"], categoryId],
    );

    const productVersionId = uuid();
    await q(
      `INSERT INTO product_versions (id, tenant_id, product_id, version_number, status, valid_from, currency, monthly_price_minor, one_time_price_minor, contract_months)
       VALUES ($1,$2,$3,1,'ACTIVE','2026-01-01T00:00:00Z','EUR',2999,0,24)`,
      [productVersionId, tenantId, productId],
    );

    await q(
      `INSERT INTO tariff_attributes (id, tenant_id, product_version_id, attribute_key, attribute_value, value_type) VALUES ($1,$2,$3,'data_gb','20','number')`,
      [uuid(), tenantId, productVersionId],
    );
    await q(
      `INSERT INTO tariff_attributes (id, tenant_id, product_version_id, attribute_key, attribute_value, value_type) VALUES ($1,$2,$3,'5g','true','boolean')`,
      [uuid(), tenantId, productVersionId],
    );

    const commissionModelId = uuid();
    await q(
      `INSERT INTO commission_models (id, tenant_id, product_id, name) VALUES ($1,$2,$3,'Standardprovision Mobil M')`,
      [commissionModelId, tenantId, productId],
    );
    await q(
      `INSERT INTO commission_model_versions (id, tenant_id, commission_model_id, version_number, status, valid_from, commission_type, currency, commission_amount_minor, recurring_commission_amount_minor)
       VALUES ($1,$2,$3,1,'ACTIVE','2026-01-01T00:00:00Z','FLAT','EUR',3000,100)`,
      [uuid(), tenantId, commissionModelId],
    );

    await q(
      `INSERT INTO configurable_thresholds (id, tenant_id, key, value, valid_from) VALUES ($1,$2,'renewal_lookahead_days','180','2026-01-01T00:00:00Z')`,
      [uuid(), tenantId],
    );

    const questionnaireId = uuid();
    await q(`INSERT INTO questionnaires (id, tenant_id, key) VALUES ($1,$2,'basisberatung')`, [
      questionnaireId,
      tenantId,
    ]);
    const questionnaireVersionId = uuid();
    await q(
      `INSERT INTO questionnaire_versions (id, tenant_id, questionnaire_id, label, valid_from, status) VALUES ($1,$2,$3,'Basisberatung v1','2026-01-01T00:00:00Z','ACTIVE')`,
      [questionnaireVersionId, tenantId, questionnaireId],
    );
    const questionId = uuid();
    await q(
      `INSERT INTO questions (id, tenant_id, questionnaire_version_id, key, need_type, sort_order) VALUES ($1,$2,$3,'hat_streaming_bedarf','STREAMING',1)`,
      [questionId, tenantId, questionnaireVersionId],
    );
    const questionVersionId = uuid();
    await q(
      `INSERT INTO question_versions (id, tenant_id, question_id, label, answer_type, is_required, valid_from, status)
       VALUES ($1,$2,$3,'Interessieren Sie sich fuer ein Streaming-Paket?','BOOLEAN',false,'2026-01-01T00:00:00Z','ACTIVE')`,
      [questionVersionId, tenantId, questionId],
    );

    const ruleSetId = uuid();
    await q(`INSERT INTO rule_sets (id, tenant_id, key) VALUES ($1,$2,'standardregeln')`, [
      ruleSetId,
      tenantId,
    ]);
    const ruleSetVersionId = uuid();
    await q(
      `INSERT INTO rule_set_versions (id, tenant_id, rule_set_id, label, valid_from, status) VALUES ($1,$2,$3,'Standardregeln v1','2026-01-01T00:00:00Z','ACTIVE')`,
      [ruleSetVersionId, tenantId, ruleSetId],
    );
    await q(
      `INSERT INTO eligibility_rules (id, tenant_id, rule_set_version_id, key, description, expression) VALUES ($1,$2,$3,'mind_18','Kunde ist volljaehrig (synthetische Platzhalterregel)','true')`,
      [uuid(), tenantId, ruleSetVersionId],
    );

    const customerReferenceId = uuid();
    await q(
      `INSERT INTO customer_references (id, tenant_id, store_id, display_code) VALUES ($1,$2,$3,$4)`,
      [customerReferenceId, tenantId, storeIds[0], `${cfg.key.toUpperCase()}-K-0001`],
    );

    const sessionId = uuid();
    await q(
      `INSERT INTO consultation_sessions (id, tenant_id, store_id, employee_id, customer_reference_id, consultation_type, status, started_at, ended_at, data_completeness_score)
       VALUES ($1,$2,$3,$4,$5,'NEW_CONTRACT','COMPLETED','2026-07-15T09:00:00Z','2026-07-15T09:20:00Z',0.9)`,
      [sessionId, tenantId, storeIds[0], employeeIds[0], customerReferenceId],
    );

    await q(
      `INSERT INTO consultation_topics (id, tenant_id, consultation_session_id, topic_key, opened_at, closed_at) VALUES ($1,$2,$3,'STREAMING','2026-07-15T09:05:00Z','2026-07-15T09:08:00Z')`,
      [uuid(), tenantId, sessionId],
    );

    await q(
      `INSERT INTO customer_answers (id, tenant_id, consultation_session_id, question_version_id, answer_type, boolean_value, answered_at)
       VALUES ($1,$2,$3,$4,'BOOLEAN',true,'2026-07-15T09:06:00Z')`,
      [uuid(), tenantId, sessionId, questionVersionId],
    );

    const detectedNeedId = uuid();
    await q(
      `INSERT INTO detected_needs (id, tenant_id, consultation_session_id, need_type, source, detected_at) VALUES ($1,$2,$3,'STREAMING','RULE_BASED','2026-07-15T09:06:30Z')`,
      [detectedNeedId, tenantId, sessionId],
    );

    await q(
      `INSERT INTO sales_opportunities (id, tenant_id, consultation_session_id, detected_need_id, status, offered_at) VALUES ($1,$2,$3,$4,'OFFERED','2026-07-15T09:10:00Z')`,
      [uuid(), tenantId, sessionId, detectedNeedId],
    );

    const recommendationId = uuid();
    await q(
      `INSERT INTO recommendations (id, tenant_id, consultation_session_id, rule_set_version_id, generated_at) VALUES ($1,$2,$3,$4,'2026-07-15T09:07:00Z')`,
      [recommendationId, tenantId, sessionId, ruleSetVersionId],
    );

    const recommendationItemId = uuid();
    await q(
      `INSERT INTO recommendation_items (id, tenant_id, recommendation_id, product_version_id, eligibility_passed, exclusion_reason_codes, business_priority_score, priority_rank)
       VALUES ($1,$2,$3,$4,true,'{}',0.8,1)`,
      [recommendationItemId, tenantId, recommendationId, productVersionId],
    );

    await q(
      `INSERT INTO recommendation_rationales (id, tenant_id, recommendation_item_id, factor_key, factor_value, weight) VALUES ($1,$2,$3,'detected_need_match','STREAMING',0.8)`,
      [uuid(), tenantId, recommendationItemId],
    );

    await q(
      `INSERT INTO recommendation_outcomes (id, tenant_id, recommendation_item_id, outcome, decided_by_employee_id, decided_at) VALUES ($1,$2,$3,'ACCEPTED',$4,'2026-07-15T09:15:00Z')`,
      [uuid(), tenantId, recommendationItemId, employeeIds[0]],
    );

    const dealId = uuid();
    await q(
      `INSERT INTO deals (id, tenant_id, consultation_session_id, store_id, employee_id, customer_reference_id, currency, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'EUR','2026-07-15T09:18:00Z')`,
      [dealId, tenantId, sessionId, storeIds[0], employeeIds[0], customerReferenceId],
    );

    await q(
      `INSERT INTO deal_items (id, tenant_id, deal_id, product_version_id, quantity) VALUES ($1,$2,$3,$4,1)`,
      [uuid(), tenantId, dealId, productVersionId],
    );

    await q(
      `INSERT INTO deal_financial_snapshots (id, tenant_id, deal_id, currency, monthly_recurring_revenue_minor, total_contract_value_minor, one_time_revenue_minor, commission_amount_minor, expected_recurring_commission_minor, hardware_purchase_cost_minor, subsidy_cost_minor, discount_cost_minor, other_direct_cost_minor, contribution_margin_minor, contribution_margin_formula_version, captured_at)
       VALUES ($1,$2,$3,'EUR',2999,${2999 * 24},0,3000,100,0,0,0,0,${2999 * 24 + 3000 - 100},'v1','2026-07-15T09:18:00Z')`,
      [uuid(), tenantId, dealId],
    );

    await q(
      `INSERT INTO follow_ups (id, tenant_id, consultation_session_id, customer_reference_id, reason, status, due_date, threshold_used_days)
       VALUES ($1,$2,$3,$4,'RENEWAL_LOOKAHEAD','OPEN','2028-01-15T09:00:00Z',180)`,
      [uuid(), tenantId, sessionId, customerReferenceId],
    );

    await q(
      `INSERT INTO analytics_events (id, tenant_id, store_id, employee_id, event_type, payload, occurred_at) VALUES ($1,$2,$3,$4,'DEAL_CLOSED',$5,'2026-07-15T09:18:00Z')`,
      [uuid(), tenantId, storeIds[0], employeeIds[0], JSON.stringify({ dealId })],
    );

    await q(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,'CREATE','Deal',$4,$5)`,
      [uuid(), tenantId, userIds[0], dealId, JSON.stringify({ source: "seed" })],
    );

    await q(
      `INSERT INTO baseline_measurements (id, tenant_id, store_id, employee_id, metric_key, metric_value, period_start, period_end, measurement_source, measurement_method, started_at, ended_at, active_duration_seconds, inactive_duration_seconds, consultation_outcome, deal_completed, products_sold_count, detected_cross_sell_count, offered_cross_sell_count, accepted_cross_sell_count, data_completeness_score)
       VALUES ($1,$2,$3,$4,'cross_sell_rate_before_rollout',0.12,'2026-06-01T00:00:00Z','2026-06-30T23:59:59Z','MANUAL','OBSERVATION','2026-06-15T09:00:00Z','2026-06-15T09:20:00Z',900,300,'COMPLETED',true,1,1,1,0,0.9)`,
      [uuid(), tenantId, storeIds[0], employeeIds[0]],
    );

    return {
      tenantId,
      companyId,
      storeIds,
      employeeIds,
      userIds,
      customerReferenceId,
      dealId,
      adminRoleId,
      productVersionId,
      productId,
    };
  }

  console.log("== 3) Tenant A (demotel-nord) ==");
  const tenantA = await seedTenant({
    key: "demotel-nord",
    name: "DemoTel Nord (synthetisch)",
    companyKey: "demotel-nord-gmbh",
    companyName: "DemoTel Nord GmbH",
    storeKeys: ["nord-filiale-1", "nord-filiale-2"],
  });
  console.log("Tenant A seeded OK:", tenantA.tenantId);

  console.log("== 4) Tenant B (demotel-sued) ==");
  const tenantB = await seedTenant({
    key: "demotel-sued",
    name: "DemoTel Sued (synthetisch)",
    companyKey: "demotel-sued-gmbh",
    companyName: "DemoTel Sued GmbH",
    storeKeys: ["sued-filiale-1", "sued-filiale-2"],
  });
  console.log("Tenant B seeded OK:", tenantB.tenantId);

  console.log("== 5) Zeilenzahlen pro Tabelle (Stichprobe) ==");
  const tables = [
    "tenants",
    "companies",
    "stores",
    "employees",
    "users",
    "products",
    "product_versions",
    "consultation_sessions",
    "deals",
    "deal_financial_snapshots",
    "customer_references",
    "follow_ups",
    "analytics_events",
    "audit_logs",
    "baseline_measurements",
  ];
  for (const t of tables) {
    const r = await q(`SELECT count(*)::int AS c FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0].c}`);
  }

  console.log("== 6) Isolationstest: Cross-Tenant-FK MUSS fehlschlagen ==");
  try {
    // Versuch: Store fuer Tenant A anlegen, aber mit company_id von Tenant B
    // (falscher tenant_id/company_id-Kombination). Der zusammengesetzte FK
    // (tenant_id, company_id) -> companies(tenant_id, id) MUSS das verhindern.
    await q(
      `INSERT INTO stores (id, tenant_id, company_id, key, name) VALUES ($1,$2,$3,'illegal-cross-tenant-store','Illegal')`,
      [uuid(), tenantA.tenantId, tenantB.companyId],
    );
    console.error("FEHLER: Cross-Tenant-Insert wurde faelschlicherweise akzeptiert!");
    process.exitCode = 1;
  } catch (err) {
    console.log("OK (erwartet abgelehnt):", err.message.split("\n")[0]);
  }

  console.log("== 7) Isolationstest: Tenant-Scoping-Query liefert nur eigene Zeilen ==");
  const onlyA = await q(`SELECT count(*)::int AS c FROM stores WHERE tenant_id = $1`, [
    tenantA.tenantId,
  ]);
  const onlyB = await q(`SELECT count(*)::int AS c FROM stores WHERE tenant_id = $1`, [
    tenantB.tenantId,
  ]);
  console.log(
    `  Stores Tenant A: ${onlyA.rows[0].c} (erwartet 2), Tenant B: ${onlyB.rows[0].c} (erwartet 2)`,
  );
  if (onlyA.rows[0].c !== 2 || onlyB.rows[0].c !== 2) {
    console.error("FEHLER: unerwartete Store-Anzahl pro Tenant");
    process.exitCode = 1;
  }

  console.log("== 8) Phase 2B: Tenant-gebundene composite FKs MUESSEN Cross-Tenant ablehnen ==");

  await expectRejected("employees.user_id (Cross-Tenant)", () =>
    q(
      `INSERT INTO employees (id, tenant_id, store_id, user_id, display_name) VALUES ($1,$2,$3,$4,'Illegal')`,
      [uuid(), tenantA.tenantId, tenantA.storeIds[0], tenantB.userIds[0]],
    ),
  );

  await expectRejected("role_assignments.user_id (Cross-Tenant)", () =>
    q(
      `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type) VALUES ($1,$2,$3,$4,'TENANT')`,
      [uuid(), tenantA.tenantId, tenantB.userIds[0], tenantA.adminRoleId],
    ),
  );

  await expectRejected("role_assignments.role_id (Cross-Tenant)", () =>
    q(
      `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type) VALUES ($1,$2,$3,$4,'TENANT')`,
      [uuid(), tenantA.tenantId, tenantA.userIds[0], tenantB.adminRoleId],
    ),
  );

  await expectRejected("audit_logs.actor_user_id (Cross-Tenant)", () =>
    q(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,'CREATE','Deal',$4)`,
      [uuid(), tenantA.tenantId, tenantB.userIds[0], tenantA.dealId],
    ),
  );

  console.log("== 9) Phase 2B: RoleAssignment Scope-Integritaet (CHECK-Constraint) ==");

  await expectRejected("scope_type=TENANT mit gesetzter company_id", () =>
    q(
      `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, company_id) VALUES ($1,$2,$3,$4,'TENANT',$5)`,
      [uuid(), tenantA.tenantId, tenantA.userIds[0], tenantA.adminRoleId, tenantA.companyId],
    ),
  );

  await expectRejected("scope_type=STORE ohne store_id", () =>
    q(
      `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, company_id) VALUES ($1,$2,$3,$4,'STORE',$5)`,
      [uuid(), tenantA.tenantId, tenantA.userIds[0], tenantA.adminRoleId, tenantA.companyId],
    ),
  );

  console.log("== 10) Phase 2B: RoleAssignment store_id muss zu company_id gehoeren (Trigger) ==");

  const companyId2 = uuid();
  await q(
    `INSERT INTO companies (id, tenant_id, key, name) VALUES ($1,$2,'demotel-nord-zweitfirma','DemoTel Nord Zweitfirma GmbH')`,
    [companyId2, tenantA.tenantId],
  );
  const storeId2 = uuid();
  await q(
    `INSERT INTO stores (id, tenant_id, company_id, key, name) VALUES ($1,$2,$3,'nord-zweitfirma-filiale-1','Zweitfirma Filiale 1')`,
    [storeId2, tenantA.tenantId, companyId2],
  );

  await expectRejected("store_id gehoert zu anderer company_id als angegeben", () =>
    q(
      `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, company_id, store_id) VALUES ($1,$2,$3,$4,'STORE',$5,$6)`,
      [
        uuid(),
        tenantA.tenantId,
        tenantA.userIds[0],
        tenantA.adminRoleId,
        tenantA.companyId,
        storeId2,
      ],
    ),
  );

  console.log("== 11) Phase 2B: Exclusion Constraint gegen ueberlappende Versionszeitraeume ==");

  await expectRejected("ueberlappende ACTIVE product_versions fuer dasselbe Produkt", () =>
    q(
      `INSERT INTO product_versions (id, tenant_id, product_id, version_number, status, valid_from, currency)
       VALUES ($1,$2,$3,2,'ACTIVE','2026-06-01T00:00:00Z','EUR')`,
      [uuid(), tenantA.tenantId, tenantA.productId],
    ),
  );

  console.log("== 12) Phase 2B: Append-only-Trigger lehnt UPDATE/DELETE ab ==");

  await expectRejected("UPDATE auf audit_logs (append-only)", () =>
    q(`UPDATE audit_logs SET metadata = '{"changed":true}' WHERE tenant_id = $1`, [
      tenantA.tenantId,
    ]),
  );

  await expectRejected("DELETE auf deal_financial_snapshots (append-only)", () =>
    q(`DELETE FROM deal_financial_snapshots WHERE deal_id = $1`, [tenantA.dealId]),
  );

  if (failures > 0) {
    console.error(`\n${failures} Phase-2B-Pruefung(en) FEHLGESCHLAGEN.`);
    process.exit(1);
  }

  console.log("\nALLE PRUEFUNGEN ABGESCHLOSSEN.");
}

main().catch((err) => {
  console.error("FEHLGESCHLAGEN:", err);
  process.exit(1);
});
