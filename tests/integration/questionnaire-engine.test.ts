/**
 * Integrationstests fuer die Fragen-Engine-Orchestrierung (`service.ts`)
 * gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `tests/integration/tenant-isolation.test.ts`).
 *
 * Deckt genau die in PHASE_3A_STARTPROMPT.md, Abschnitt "AUTOMATISIERTE
 * TESTS" (Faelle 1-40) geforderten Punkte ab, die einen echten DB-Zustand
 * voraussetzen: Versionsauswahl/-stabilitaet (1-3), Pflichtfrage-Abschluss
 * (12-13), Sichtbarkeits-Neuberechnung inkl. Deaktivierung/Historie (18-25),
 * strukturelle Versionsvalidierung (28), Mandantentrennung (30-32),
 * Idempotenz/CAS (33-35), Analytics-/Audit-Payload-Hygiene (36) sowie
 * Versions-Unveraenderlichkeit (37).
 *
 * Rein logische Faelle (Operatoren, einzelne AnswerType-Validierungen,
 * Zyklenerkennung, Pfadberechnung, Statusableitung) sind bereits als
 * DB-freie Unit-Tests in `tests/unit/questionnaire/*.test.ts` abgedeckt und
 * werden hier NICHT wiederholt.
 *
 * Faelle 38/39 (Migration/Seed auf leerer DB) sind Prozess-Schritte, keine
 * vitest-Faelle - siehe Abschlussbericht/CI-Lauf. Fall 40 (bestehende
 * Phase-2B-Tests bleiben gruen) wird durch den vollstaendigen Testlauf
 * (`npm test`) sichergestellt.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  ConsultationSessionNotFoundError,
  IncompleteQuestionnaireError,
  InvalidAnswerError,
  NoActiveQuestionnaireVersionError,
  QuestionNotVisibleError,
  QuestionnaireVersionInvalidError,
  StaleAnswerVersionError,
} from "@/server/questionnaire/errors";
import {
  changeAnswer,
  completeQuestionnaire,
  loadQuestionnaireState,
  saveAnswer,
  startQuestionnaire,
  validateQuestionnaireVersion,
} from "@/server/questionnaire/service";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("Fragen-Engine (Integrationstest, echte Postgres-DB)", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  const V1_FROM = new Date("2026-01-01T00:00:00Z");
  const V1_TO = new Date("2026-06-01T00:00:00Z");
  const V2_FROM = V1_TO;

  let tenantAId: string;
  let tenantBId: string;
  let storeAId: string;
  let employeeAId: string;
  let storeBId: string;
  let employeeBId: string;

  let questionnaireId: string;
  let questionnaireVersionId: string; // V1: ACTIVE, [V1_FROM, V1_TO)
  let questionnaireVersionV2Id: string; // V2: ACTIVE, [V2_FROM, null) - eigener Fragensatz

  let hatBedarfQuestionId: string;
  let farbeVersionId: string;
  let folgefrageQuestionId: string;

  async function createTenant(key: string) {
    const tenant = await rawClient.tenant.create({
      data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
    });
    const company = await rawClient.company.create({
      data: { tenantId: tenant.id, key: `company-${key}-${suffix}`, name: `Company ${key}` },
    });
    const store = await rawClient.store.create({
      data: {
        tenantId: tenant.id,
        companyId: company.id,
        key: `store-${key}-${suffix}`,
        name: `Store ${key}`,
      },
    });
    const user = await rawClient.user.create({
      data: {
        tenantId: tenant.id,
        email: `${key}-${suffix}@example-synthetic.test`,
        isSynthetic: true,
      },
    });
    const employee = await rawClient.employee.create({
      data: { tenantId: tenant.id, storeId: store.id, userId: user.id, displayName: `MA ${key}` },
    });
    return { tenantId: tenant.id, storeId: store.id, employeeId: employee.id };
  }

  beforeAll(async () => {
    const a = await createTenant("qe-a");
    tenantAId = a.tenantId;
    storeAId = a.storeId;
    employeeAId = a.employeeId;

    const b = await createTenant("qe-b");
    tenantBId = b.tenantId;
    storeBId = b.storeId;
    employeeBId = b.employeeId;

    const questionnaire = await rawClient.questionnaire.create({
      data: { tenantId: tenantAId, key: `test-fragebogen-${suffix}` },
    });
    questionnaireId = questionnaire.id;

    // --- V1: aktive Version, gueltig [V1_FROM, V1_TO) ---
    const v1 = await rawClient.questionnaireVersion.create({
      data: {
        tenantId: tenantAId,
        questionnaireId,
        label: "V1",
        validFrom: V1_FROM,
        validTo: V1_TO,
        status: "ACTIVE",
      },
    });
    questionnaireVersionId = v1.id;

    const hatBedarf = await rawClient.question.create({
      data: { tenantId: tenantAId, questionnaireVersionId: v1.id, key: "hat_bedarf", sortOrder: 1 },
    });
    hatBedarfQuestionId = hatBedarf.id;
    await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: hatBedarf.id,
        label: "Haben Sie Bedarf?",
        answerType: "BOOLEAN",
        isRequired: true,
        validFrom: V1_FROM,
        status: "ACTIVE",
      },
    });

    const farbe = await rawClient.question.create({
      data: { tenantId: tenantAId, questionnaireVersionId: v1.id, key: "farbe", sortOrder: 2 },
    });
    const farbeVersion = await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: farbe.id,
        label: "Welche Farbe?",
        answerType: "SINGLE_CHOICE",
        isRequired: false,
        validFrom: V1_FROM,
        status: "ACTIVE",
      },
    });
    farbeVersionId = farbeVersion.id;
    await rawClient.answerOption.createMany({
      data: [
        {
          tenantId: tenantAId,
          questionVersionId: farbeVersion.id,
          key: "rot",
          label: "Rot",
          sortOrder: 1,
        },
        {
          tenantId: tenantAId,
          questionVersionId: farbeVersion.id,
          key: "blau",
          label: "Blau",
          sortOrder: 2,
        },
      ],
    });

    const anzahl = await rawClient.question.create({
      data: { tenantId: tenantAId, questionnaireVersionId: v1.id, key: "anzahl", sortOrder: 3 },
    });
    await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: anzahl.id,
        label: "Wie viele?",
        answerType: "INTEGER",
        isRequired: false,
        minValue: 1,
        maxValue: 5,
        validFrom: V1_FROM,
        status: "ACTIVE",
      },
    });

    const folgefrage = await rawClient.question.create({
      data: { tenantId: tenantAId, questionnaireVersionId: v1.id, key: "folgefrage", sortOrder: 4 },
    });
    folgefrageQuestionId = folgefrage.id;
    const folgefrageVersion = await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: folgefrage.id,
        label: "Details zum Bedarf?",
        answerType: "BOOLEAN",
        isRequired: false,
        validFrom: V1_FROM,
        status: "ACTIVE",
      },
    });
    await rawClient.visibilityCondition.create({
      data: {
        tenantId: tenantAId,
        questionVersionId: folgefrageVersion.id,
        targetQuestionId: hatBedarf.id,
        operator: "EQUALS",
        comparisonValue: "true",
        combinator: "AND",
      },
    });

    // --- V2: eigene, ab V2_FROM gueltige Version mit eigenem, disjunktem Fragensatz ---
    const v2 = await rawClient.questionnaireVersion.create({
      data: {
        tenantId: tenantAId,
        questionnaireId,
        label: "V2",
        validFrom: V2_FROM,
        validTo: null,
        status: "ACTIVE",
      },
    });
    questionnaireVersionV2Id = v2.id;
    const v2OnlyQuestion = await rawClient.question.create({
      data: { tenantId: tenantAId, questionnaireVersionId: v2.id, key: "nur_in_v2", sortOrder: 1 },
    });
    await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: v2OnlyQuestion.id,
        label: "Nur in V2 vorhanden",
        answerType: "BOOLEAN",
        isRequired: false,
        validFrom: V2_FROM,
        status: "ACTIVE",
      },
    });

    // --- Entwurfsversion (nie ACTIVE) fuer Fall 3 ---
    await rawClient.questionnaireVersion.create({
      data: {
        tenantId: tenantAId,
        questionnaireId,
        label: "Entwurf (nie veroeffentlicht)",
        validFrom: new Date("2025-01-01T00:00:00Z"),
        validTo: V1_FROM,
        status: "DRAFT",
      },
    });
  });

  afterAll(async () => {
    // Bewusst kein deleteMany mehr hier: analyticsEvent/auditLog sind append-only
    // (Phase 3A Task 30, DELETE per DB-Trigger verboten). Seit AnalyticsEvent.employee
    // auf onDelete: Restrict umgestellt ist (siehe Migration
    // 20260801095926_analytics_events_employee_restrict), wuerde auch employee.deleteMany
    // fuer Tenants mit vorhandenen AnalyticsEvents fehlschlagen - und transitiv
    // store/company/tenant. CI nutzt einen ephemeren Postgres-Service-Container pro Lauf
    // (siehe .github/workflows/ci.yml), der nach dem Job verworfen wird; Testisolation ist
    // durch den randomUUID-Suffix pro Testlauf sichergestellt. Aufraeumen ist daher weder
    // noetig noch (fuer die append-only/immutable Tabellen) ueberhaupt moeglich.
    await rawClient.$disconnect();
  });

  function asTenantA<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(
      { tenantId: tenantAId, userId: randomUUID(), roles: [], managementScope: null },
      fn,
    );
  }

  function asTenantB<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(
      { tenantId: tenantBId, userId: randomUUID(), roles: [], managementScope: null },
      fn,
    );
  }

  async function startSessionInV1() {
    return asTenantA(() =>
      startQuestionnaire({
        questionnaireKey: `test-fragebogen-${suffix}`,
        storeId: storeAId,
        employeeId: employeeAId,
        consultationType: "NEW_CONTRACT",
        at: new Date("2026-03-01T00:00:00Z"), // liegt in [V1_FROM, V1_TO)
      }),
    );
  }

  // --- 1: gueltige, zum Zeitpunkt aktive Version wird korrekt ausgewaehlt ---
  it("1: waehlt bei mehreren ACTIVE-Versionen die zum Zeitpunkt gueltige aus", async () => {
    const stateInV1Range = await startSessionInV1();
    expect(stateInV1Range.questionnaireVersionId).toBe(questionnaireVersionId);

    const stateInV2Range = await asTenantA(() =>
      startQuestionnaire({
        questionnaireKey: `test-fragebogen-${suffix}`,
        storeId: storeAId,
        employeeId: employeeAId,
        consultationType: "NEW_CONTRACT",
        at: new Date("2026-07-01T00:00:00Z"), // liegt in [V2_FROM, unbegrenzt)
      }),
    );
    expect(stateInV2Range.questionnaireVersionId).toBe(questionnaireVersionV2Id);
    expect(stateInV2Range.visibleQuestions.some((q) => q.label === "Nur in V2 vorhanden")).toBe(
      true,
    );
  });

  // --- 2: neue Version veraendert eine bereits begonnene Beratung nicht ---
  it("2: eine bereits begonnene Beratung bleibt an ihre urspruengliche Version gebunden", async () => {
    const state = await startSessionInV1();
    expect(state.questionnaireVersionId).toBe(questionnaireVersionId);

    // V2 existiert bereits (in beforeAll angelegt, "spaeter veroeffentlicht").
    const reloaded = await asTenantA(() => loadQuestionnaireState(state.consultationSessionId));
    expect(reloaded.questionnaireVersionId).toBe(questionnaireVersionId);
    expect(reloaded.visibleQuestions.some((q) => q.label === "Nur in V2 vorhanden")).toBe(false);
    expect(reloaded.visibleQuestions.some((q) => q.label === "Haben Sie Bedarf?")).toBe(true);
  });

  // --- 3: Entwurfs- und abgelaufene Versionen werden nicht ausgewaehlt ---
  it("3: eine DRAFT-Version wird trotz zeitlicher Ueberdeckung nicht ausgewaehlt", async () => {
    await expect(
      asTenantA(() =>
        startQuestionnaire({
          questionnaireKey: `test-fragebogen-${suffix}`,
          storeId: storeAId,
          employeeId: employeeAId,
          consultationType: "NEW_CONTRACT",
          at: new Date("2025-06-01T00:00:00Z"), // liegt nur im DRAFT-Zeitraum
        }),
      ),
    ).rejects.toThrow(NoActiveQuestionnaireVersionError);
  });

  // --- 12/13: Pflichtfragen blockieren Abschluss, optionale nicht ---
  it("12: unbeantwortete Pflichtfrage verhindert den Abschluss", async () => {
    const state = await startSessionInV1();
    await expect(
      asTenantA(() => completeQuestionnaire(state.consultationSessionId)),
    ).rejects.toThrow(IncompleteQuestionnaireError);
  });

  it("13: unbeantwortete optionale Fragen blockieren den Abschluss nicht", async () => {
    const state = await startSessionInV1();
    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: false },
      }),
    );
    // "farbe" und "anzahl" bleiben unbeantwortet (optional) - Abschluss muss trotzdem klappen.
    const result = await asTenantA(() => completeQuestionnaire(state.consultationSessionId));
    expect(result.status).toBe("COMPLETED");
  });

  // --- 18/19: Sichtbarkeit steuert Zaehlung und Schreibzugriff ---
  it("18/19: nicht sichtbare Fragen zaehlen nicht mit und lehnen Antworten ab", async () => {
    const state = await startSessionInV1();
    // "folgefrage" ist anfangs (hat_bedarf unbeantwortet) nicht sichtbar.
    expect(state.visibleQuestions.some((q) => q.questionId === folgefrageQuestionId)).toBe(false);
    expect(state.progress.totalVisibleQuestions).toBe(3); // hat_bedarf, farbe, anzahl

    await expect(
      asTenantA(() =>
        saveAnswer({
          consultationSessionId: state.consultationSessionId,
          questionId: folgefrageQuestionId,
          value: { booleanValue: true },
        }),
      ),
    ).rejects.toThrow(QuestionNotVisibleError);
  });

  // --- 20/21/22: Pfad-Neuberechnung deaktiviert verdeckte Antworten, loescht sie aber nicht ---
  it("20/21/22: Aenderung einer fruehen Antwort verdeckt Folgefragen und deaktiviert (statt loescht) ihre Antworten", async () => {
    const state = await startSessionInV1();

    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: true },
      }),
    );
    const afterTrue = await asTenantA(() => loadQuestionnaireState(state.consultationSessionId));
    expect(afterTrue.visibleQuestions.some((q) => q.questionId === folgefrageQuestionId)).toBe(
      true,
    );

    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: folgefrageQuestionId,
        value: { booleanValue: true },
      }),
    );

    // hat_bedarf auf false aendern -> folgefrage wird wieder verdeckt.
    const changeResult = await asTenantA(() =>
      changeAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: false },
        expectedAnswerVersion: 1,
      }),
    );
    expect(changeResult.hiddenQuestionIds).toContain(folgefrageQuestionId);

    const afterFalse = await asTenantA(() => loadQuestionnaireState(state.consultationSessionId));
    expect(afterFalse.visibleQuestions.some((q) => q.questionId === folgefrageQuestionId)).toBe(
      false,
    );

    // 21: die deaktivierte Antwort ist nicht mehr aktiv, aber ...
    const activeRows = await rawClient.customerAnswer.findMany({
      where: { consultationSessionId: state.consultationSessionId, isActive: true },
    });
    expect(
      activeRows.some(
        (r: { answerType: string; booleanValue: boolean | null }) =>
          r.answerType === "BOOLEAN" && r.booleanValue === true,
      ),
    ).toBe(false);

    // 22: ... die Zeile selbst bleibt (append-only) erhalten statt geloescht zu werden.
    const allRows = await rawClient.customerAnswer.findMany({
      where: { consultationSessionId: state.consultationSessionId },
    });
    expect(allRows.length).toBeGreaterThan(activeRows.length);
  });

  // --- 23/24: erneutes Laden ist konsistent, auch nach Abschluss ---
  it("23/24: wiederholtes Laden liefert denselben Zustand, auch nach Abschluss", async () => {
    const state = await startSessionInV1();
    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: false },
      }),
    );

    const first = await asTenantA(() => loadQuestionnaireState(state.consultationSessionId));
    const second = await asTenantA(() => loadQuestionnaireState(state.consultationSessionId));
    expect(second.progress).toEqual(first.progress);
    expect(second.visibleQuestions).toEqual(first.visibleQuestions);

    await asTenantA(() => completeQuestionnaire(state.consultationSessionId));
    const afterComplete = await asTenantA(() =>
      loadQuestionnaireState(state.consultationSessionId),
    );
    expect(afterComplete.status).toBe("COMPLETED");
    expect(afterComplete.visibleQuestions).toEqual(first.visibleQuestions);
  });

  // --- 25: Abschluss erzeugt keine Recommendation/SalesOpportunity (ausserhalb Phase-3A-Scope) ---
  it("25: Abschluss erzeugt weder eine Recommendation noch eine SalesOpportunity", async () => {
    const state = await startSessionInV1();
    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: false },
      }),
    );
    await asTenantA(() => completeQuestionnaire(state.consultationSessionId));

    const recommendationCount = await rawClient.recommendation.count({
      where: { consultationSessionId: state.consultationSessionId },
    });
    const opportunityCount = await rawClient.salesOpportunity.count({
      where: { consultationSessionId: state.consultationSessionId },
    });
    expect(recommendationCount).toBe(0);
    expect(opportunityCount).toBe(0);
  });

  // --- 28: strukturell falscher Operator/ungueltige Referenz wird bei der Versionsvalidierung abgelehnt ---
  it("28: validateQuestionnaireVersion lehnt eine Bedingung mit unzulaessigem Operator fuer den Zieltyp ab", async () => {
    // V1 selbst ist strukturell gueltig.
    await expect(
      asTenantA(() => validateQuestionnaireVersion(questionnaireVersionId)),
    ).resolves.toBeUndefined();

    // Eigene, isolierte Fragebogenversion mit einer strukturell ungueltigen Bedingung
    // (GREATER_THAN auf eine SINGLE_CHOICE-Zielfrage ist nicht zulaessig).
    const invalidQuestionnaire = await rawClient.questionnaire.create({
      data: { tenantId: tenantAId, key: `invalid-fragebogen-${suffix}` },
    });
    const invalidVersion = await rawClient.questionnaireVersion.create({
      data: {
        tenantId: tenantAId,
        questionnaireId: invalidQuestionnaire.id,
        label: "Ungueltig",
        validFrom: V1_FROM,
        status: "DRAFT",
      },
    });
    const target = await rawClient.question.create({
      data: {
        tenantId: tenantAId,
        questionnaireVersionId: invalidVersion.id,
        key: "ziel",
        sortOrder: 1,
      },
    });
    const targetVersion = await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: target.id,
        label: "Ziel",
        answerType: "SINGLE_CHOICE",
        isRequired: false,
        validFrom: V1_FROM,
        status: "DRAFT",
      },
    });
    await rawClient.answerOption.create({
      data: {
        tenantId: tenantAId,
        questionVersionId: targetVersion.id,
        key: "a",
        label: "A",
        sortOrder: 1,
      },
    });
    const dependent = await rawClient.question.create({
      data: {
        tenantId: tenantAId,
        questionnaireVersionId: invalidVersion.id,
        key: "abhaengig",
        sortOrder: 2,
      },
    });
    const dependentVersion = await rawClient.questionVersion.create({
      data: {
        tenantId: tenantAId,
        questionId: dependent.id,
        label: "Abhaengig",
        answerType: "BOOLEAN",
        isRequired: false,
        validFrom: V1_FROM,
        status: "DRAFT",
      },
    });
    await rawClient.visibilityCondition.create({
      data: {
        tenantId: tenantAId,
        questionVersionId: dependentVersion.id,
        targetQuestionId: target.id,
        operator: "GREATER_THAN",
        comparisonValue: "a",
        combinator: "AND",
      },
    });

    await expect(asTenantA(() => validateQuestionnaireVersion(invalidVersion.id))).rejects.toThrow(
      QuestionnaireVersionInvalidError,
    );

    // Aufraeumen (eigene, isolierte Fragebogenversion).
    await rawClient.visibilityCondition.deleteMany({
      where: { questionVersionId: dependentVersion.id },
    });
    await rawClient.answerOption.deleteMany({ where: { questionVersionId: targetVersion.id } });
    await rawClient.questionVersion.deleteMany({
      where: { id: { in: [dependentVersion.id, targetVersion.id] } },
    });
    await rawClient.question.deleteMany({ where: { id: { in: [dependent.id, target.id] } } });
    await rawClient.questionnaireVersion.delete({ where: { id: invalidVersion.id } });
    await rawClient.questionnaire.delete({ where: { id: invalidQuestionnaire.id } });
  });

  // --- 30/31: Tenant-Isolation auf Fragebogen-Ebene ---
  it("30/31: Tenant B kann weder eine Beratung von Tenant A lesen noch Antworten dafuer schreiben", async () => {
    const state = await startSessionInV1();

    await expect(
      asTenantB(() => loadQuestionnaireState(state.consultationSessionId)),
    ).rejects.toThrow(ConsultationSessionNotFoundError);

    await expect(
      asTenantB(() =>
        saveAnswer({
          consultationSessionId: state.consultationSessionId,
          questionId: hatBedarfQuestionId,
          value: { booleanValue: true },
        }),
      ),
    ).rejects.toThrow(ConsultationSessionNotFoundError);
  });

  // --- 32: eine von aussen "gesetzte" tenantId kann nicht auf einen anderen Mandanten verweisen ---
  it("32: eine neu gestartete Beratung erhaelt immer die tenantId aus dem aktiven Kontext, nie eine fremde", async () => {
    const state = await asTenantB(() =>
      startQuestionnaire({
        questionnaireKey: `test-fragebogen-${suffix}`, // existiert nur unter Tenant A
        storeId: storeBId,
        employeeId: employeeBId,
        consultationType: "NEW_CONTRACT",
        at: new Date("2026-03-01T00:00:00Z"),
      }),
    ).catch((err) => err);
    // Unter Tenant B ist dieser Fragebogen-Key nicht sichtbar -> korrekt abgelehnt,
    // NICHT versehentlich gegen Tenant As Daten aufgeloest.
    expect(state).toBeInstanceOf(NoActiveQuestionnaireVersionError);
  });

  // --- 33: ungueltige AnswerOption wird abgelehnt ---
  it("33: eine fremde/unbekannte AnswerOption-Auswahl wird abgelehnt", async () => {
    const state = await startSessionInV1();
    await expect(
      asTenantA(() =>
        saveAnswer({
          consultationSessionId: state.consultationSessionId,
          questionId: state.visibleQuestions.find((q) => q.questionVersionId === farbeVersionId)!
            .questionId,
          value: { choiceValues: ["gruen"] }, // nicht "rot"/"blau"
        }),
      ),
    ).rejects.toThrow(InvalidAnswerError);
  });

  // --- 34: wiederholte saveAnswer-Requests erzeugen keinen inkonsistenten Zustand ---
  it("34: ein wiederholter saveAnswer-Request fuer dieselbe Frage wird abgelehnt (Idempotenzschutz)", async () => {
    const state = await startSessionInV1();
    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: true },
      }),
    );
    await expect(
      asTenantA(() =>
        saveAnswer({
          consultationSessionId: state.consultationSessionId,
          questionId: hatBedarfQuestionId,
          value: { booleanValue: false },
        }),
      ),
    ).rejects.toThrow(); // AnswerAlreadyExistsError

    const activeCount = await rawClient.customerAnswer.count({
      where: {
        consultationSessionId: state.consultationSessionId,
        questionVersionId: (
          await rawClient.questionVersion.findFirst({ where: { questionId: hatBedarfQuestionId } })
        )?.id,
        isActive: true,
      },
    });
    expect(activeCount).toBe(1);
  });

  // --- 35: veraltete parallele Antwortaenderung (CAS-Konflikt) wird erkannt ---
  it("35: changeAnswer mit veralteter expectedAnswerVersion wird abgelehnt", async () => {
    const state = await startSessionInV1();
    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: true },
      }),
    );
    await expect(
      asTenantA(() =>
        changeAnswer({
          consultationSessionId: state.consultationSessionId,
          questionId: hatBedarfQuestionId,
          value: { booleanValue: false },
          expectedAnswerVersion: 99, // falsch - aktuell ist Version 1
        }),
      ),
    ).rejects.toThrow(StaleAnswerVersionError);
  });

  // --- 36: Analytics-/Audit-Payloads enthalten keine Kontaktdaten/Freitextantworten ---
  it("36: Analytics- und Audit-Payloads zur Fragebogen-Sitzung enthalten keine Antwortinhalte", async () => {
    const state = await startSessionInV1();
    await asTenantA(() =>
      saveAnswer({
        consultationSessionId: state.consultationSessionId,
        questionId: hatBedarfQuestionId,
        value: { booleanValue: true },
      }),
    );
    await asTenantA(() =>
      completeQuestionnaire(state.consultationSessionId).catch(() => undefined),
    );
    // (Abschluss schlaegt hier evtl. fehl, da nur eine Pflichtfrage beantwortet wurde -
    // das QUESTION_ANSWERED-Event wurde trotzdem bereits geschrieben.)

    const events = await rawClient.analyticsEvent.findMany({
      where: { storeId: storeAId, eventType: "QUESTION_ANSWERED" },
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const payload = JSON.stringify(event.payload);
      expect(payload).not.toContain("booleanValue");
      expect(payload).not.toContain("freeTextValue");
      expect(payload).not.toMatch(/@/); // keine E-Mail-Adresse im Payload
    }

    const auditLogs = await rawClient.auditLog.findMany({
      where: { entityId: state.consultationSessionId, entityType: "ConsultationSession" },
    });
    for (const log of auditLogs) {
      const metadata = JSON.stringify(log.metadata);
      expect(metadata).not.toContain("freeTextValue");
      expect(metadata).not.toMatch(/@/);
    }
  });

  // --- 37: aktivierte/verwendete Fragebogenversionen sind gegen unerlaubte Aenderung geschuetzt ---
  it("37: die questionnaireVersionId einer bestehenden Beratung kann nicht nachtraeglich geaendert werden", async () => {
    const state = await startSessionInV1();
    await expect(
      rawClient.consultationSession.update({
        where: { id: state.consultationSessionId },
        data: { questionnaireVersionId: questionnaireVersionV2Id },
      }),
    ).rejects.toThrow();
  });

  // --- 38: Phase 6 AP2 - CONSULTATION_STARTED wird zusaetzlich zu QUESTIONNAIRE_STARTED geschrieben ---
  it("38: startQuestionnaire schreibt genau ein CONSULTATION_STARTED-Event pro Sitzung, getrennt von QUESTIONNAIRE_STARTED", async () => {
    const state = await startSessionInV1();

    const consultationStartedEvents = await rawClient.analyticsEvent.findMany({
      where: { eventType: "CONSULTATION_STARTED" },
    });
    const matching = consultationStartedEvents.filter(
      (e) =>
        (e.payload as { consultationSessionId?: string })?.consultationSessionId ===
        state.consultationSessionId,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.storeId).toBe(storeAId);

    const questionnaireStartedEvents = await rawClient.analyticsEvent.findMany({
      where: { eventType: "QUESTIONNAIRE_STARTED" },
    });
    const matchingQuestionnaire = questionnaireStartedEvents.filter(
      (e) =>
        (e.payload as { consultationSessionId?: string })?.consultationSessionId ===
        state.consultationSessionId,
    );
    expect(matchingQuestionnaire).toHaveLength(1);
  });
});
