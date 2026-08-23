import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SavingIndicator } from "@/components/consultation/StatusBanners";

describe("Komponententest-Setup (Smoke-Test)", () => {
  it("rendert SavingIndicator im 'saving'-Status", () => {
    render(<SavingIndicator status="saving" />);
    expect(screen.getByText("Speichert…")).toBeInTheDocument();
  });

  it("rendert nichts im 'idle'-Status", () => {
    const { container } = render(<SavingIndicator status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });
});
