import { describe, expect, it } from "vitest";
import { isReviewPageEnabled } from "@/server/review/review-access";

describe("isReviewPageEnabled", () => {
  it("ist aktiv in development", () => {
    expect(isReviewPageEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("ist aktiv in test", () => {
    expect(isReviewPageEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("ist deaktiviert in production", () => {
    expect(isReviewPageEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("ist deaktiviert bei fehlendem/unbekanntem NODE_ENV (fail closed)", () => {
    expect(isReviewPageEnabled({})).toBe(false);
    expect(isReviewPageEnabled({ NODE_ENV: "staging" })).toBe(false);
    expect(isReviewPageEnabled({ NODE_ENV: "" })).toBe(false);
  });

  it("ENABLE_REVIEW_PAGE=false erzwingt Deaktivierung, auch in development/test", () => {
    expect(isReviewPageEnabled({ NODE_ENV: "development", ENABLE_REVIEW_PAGE: "false" })).toBe(
      false,
    );
    expect(isReviewPageEnabled({ NODE_ENV: "test", ENABLE_REVIEW_PAGE: "false" })).toBe(false);
  });

  it("ENABLE_REVIEW_PAGE=true erzwingt Aktivierung, auch in production", () => {
    expect(isReviewPageEnabled({ NODE_ENV: "production", ENABLE_REVIEW_PAGE: "true" })).toBe(true);
  });
});
