import { describe, expect, it } from "vitest";
import { deriveQuestionnaireRunStatus } from "@/server/questionnaire/status";

describe("deriveQuestionnaireRunStatus", () => {
  it("ABANDONED bleibt ABANDONED, unabhaengig von Antworten", () => {
    const status = deriveQuestionnaireRunStatus(
      { status: "ABANDONED", endedAt: "2026-01-01T00:00:00.000Z" },
      "2026-02-01T00:00:00.000Z",
    );
    expect(status).toBe("ABANDONED");
  });

  it("IN_PROGRESS bleibt IN_PROGRESS", () => {
    const status = deriveQuestionnaireRunStatus({ status: "IN_PROGRESS", endedAt: null }, null);
    expect(status).toBe("IN_PROGRESS");
  });

  it("COMPLETED ohne spaetere Antwortaenderung bleibt COMPLETED", () => {
    const status = deriveQuestionnaireRunStatus(
      { status: "COMPLETED", endedAt: "2026-02-01T00:00:00.000Z" },
      "2026-01-01T00:00:00.000Z",
    );
    expect(status).toBe("COMPLETED");
  });

  it("COMPLETED ohne jegliche Antworten bleibt COMPLETED", () => {
    const status = deriveQuestionnaireRunStatus(
      { status: "COMPLETED", endedAt: "2026-02-01T00:00:00.000Z" },
      null,
    );
    expect(status).toBe("COMPLETED");
  });

  it("COMPLETED wird zu NEEDS_REVIEW, wenn eine aktive Antwort NACH Abschluss geaendert wurde", () => {
    const status = deriveQuestionnaireRunStatus(
      { status: "COMPLETED", endedAt: "2026-01-01T00:00:00.000Z" },
      "2026-02-01T00:00:00.000Z",
    );
    expect(status).toBe("NEEDS_REVIEW");
  });
});
