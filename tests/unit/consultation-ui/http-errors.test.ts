/**
 * Unit-Tests fuer die AP7-/AP8-Ergaenzungen an `mapKnownErrorToResponse()`
 * (`src/server/consultation-ui/http-errors.ts`, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 8 + 9). Reine Mapping-Logik, keine
 * DB -- plain Node vitest-Environment (kein jsdom noetig).
 */

import { describe, expect, it } from "vitest";
import { mapKnownErrorToResponse } from "@/server/consultation-ui/http-errors";
import {
  InvalidOpportunityStatusTransitionError,
  RecommendationItemNotFoundError,
  RecommendationOutcomeAlreadyExistsError,
  RejectionReasonNotApplicableError,
  RejectionReasonNotFoundError,
  RejectionReasonRequiredError,
  SalesOpportunityNotFoundError,
} from "@/server/recommendation/errors";

describe("mapKnownErrorToResponse (AP7 -- RecommendationOutcome-Fehlerklassen)", () => {
  it("mappt RecommendationItemNotFoundError auf 404", async () => {
    const response = mapKnownErrorToResponse(new RecommendationItemNotFoundError("item-1"));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(404);
    const body = await response?.json();
    expect(body.error).toBe("RecommendationItemNotFoundError");
  });

  it("mappt RejectionReasonNotFoundError auf 404", async () => {
    const response = mapKnownErrorToResponse(new RejectionReasonNotFoundError("reason-1"));
    expect(response?.status).toBe(404);
  });

  it("mappt RecommendationOutcomeAlreadyExistsError auf 409 mit decidedAt-Feld", async () => {
    const decidedAt = new Date("2026-08-01T10:00:00.000Z");
    const response = mapKnownErrorToResponse(
      new RecommendationOutcomeAlreadyExistsError("item-1", decidedAt),
    );
    expect(response?.status).toBe(409);
    const body = await response?.json();
    expect(body.error).toBe("RecommendationOutcomeAlreadyExistsError");
    expect(body.decidedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("liefert decidedAt = null, wenn RecommendationOutcomeAlreadyExistsError ohne Datum geworfen wird", async () => {
    const response = mapKnownErrorToResponse(
      new RecommendationOutcomeAlreadyExistsError("item-1", null),
    );
    const body = await response?.json();
    expect(body.decidedAt).toBeNull();
  });

  it("mappt RejectionReasonRequiredError auf 422", async () => {
    const response = mapKnownErrorToResponse(new RejectionReasonRequiredError("item-1"));
    expect(response?.status).toBe(422);
  });

  it("mappt RejectionReasonNotApplicableError auf 422", async () => {
    const response = mapKnownErrorToResponse(
      new RejectionReasonNotApplicableError("item-1", "ACCEPTED"),
    );
    expect(response?.status).toBe(422);
  });

  it("liefert null fuer unbekannte Fehler (kein Verschlucken)", () => {
    expect(mapKnownErrorToResponse(new Error("irgendwas"))).toBeNull();
  });
});

describe("mapKnownErrorToResponse (AP8 -- SalesOpportunity-Statusaktualisierung)", () => {
  it("mappt SalesOpportunityNotFoundError auf 404", async () => {
    const response = mapKnownErrorToResponse(new SalesOpportunityNotFoundError("opp-1"));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(404);
    const body = await response?.json();
    expect(body.error).toBe("SalesOpportunityNotFoundError");
  });

  it("mappt InvalidOpportunityStatusTransitionError auf 409 mit currentStatus/requestedStatus", async () => {
    const response = mapKnownErrorToResponse(
      new InvalidOpportunityStatusTransitionError("opp-1", "ACCEPTED", "OFFERED"),
    );
    expect(response?.status).toBe(409);
    const body = await response?.json();
    expect(body.error).toBe("InvalidOpportunityStatusTransitionError");
    expect(body.currentStatus).toBe("ACCEPTED");
    expect(body.requestedStatus).toBe("OFFERED");
  });
});
