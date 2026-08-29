import { describe, expect, it } from "vitest";
import { showSatisfactionMetric } from "./report-feature-flags";

describe("reports analytics feature flags", () => {
  it("hides satisfaction unless explicitly enabled", () => {
    expect(showSatisfactionMetric(undefined)).toBe(false);
    expect(showSatisfactionMetric("false")).toBe(false);
    expect(showSatisfactionMetric("true")).toBe(true);
    expect(showSatisfactionMetric(" TRUE ")).toBe(true);
  });
});
