import { describe, expect, it } from "vitest";
import {
  advisorWorkloadPercent,
  buildDepartmentFilterOptions,
  buildMetricSparkline,
  buildServiceDistribution,
  departmentDisplayLabel,
  formatAnalyticsMonth,
  metricDisplayValue,
} from "./detailed-analytics-view-model";

describe("detailed analytics view model", () => {
  it("merges duplicate localized service labels and rolls the long tail into Other", () => {
    const result = buildServiceDistribution(
      [
        { key: "consultation", count: 7 },
        { key: "legal_consultation", count: 5 },
        { key: "contract_review", count: 9 },
        { key: "investigation", count: 4 },
        { key: "litigation", count: 3 },
        { key: "approval", count: 2 },
      ],
      (value) =>
        value === "consultation" || value === "legal_consultation"
          ? "Legal consultation"
          : value,
      "Other",
    );

    expect(result.total).toBe(30);
    expect(result.items).toEqual([
      {
        name: "Legal consultation",
        value: 12,
        keys: ["consultation", "legal_consultation"],
      },
      { name: "contract_review", value: 9, keys: ["contract_review"] },
      { name: "investigation", value: 4, keys: ["investigation"] },
      { name: "Other", value: 5, keys: ["litigation", "approval"] },
    ]);
  });

  it("uses real previous/current metric values when no time series exists", () => {
    expect(
      buildMetricSparkline({
        value: 91,
        available: true,
        sample_size: 12,
        previous_value: 88,
        previous_available: true,
      }),
    ).toEqual([
      { label: "previous", value: 88 },
      { label: "current", value: 91 },
    ]);
  });

  it("calculates advisor workload without inventing data for an empty portfolio", () => {
    const advisor = {
      advisor_name: "Ada Okafor",
      total_requests: 10,
      completed_requests: 6,
      active_requests: 4,
      rating_count: 2,
      resolved_slas: 5,
    };
    expect(advisorWorkloadPercent(advisor)).toBe(40);
    expect(advisorWorkloadPercent({ ...advisor, total_requests: 0 })).toBe(0);
  });

  it("renders finite values from legacy metric payloads that omit available", () => {
    expect(
      metricDisplayValue(
        { value: 64 },
        (value) => String(value),
        "No observations",
      ),
    ).toBe("64");
    expect(
      metricDisplayValue(
        { value: 0, available: false },
        (value) => String(value),
        "No observations",
      ),
    ).toBe("No observations");
  });

  it("formats month labels without appending the metric count to the year", () => {
    expect(
      formatAnalyticsMonth("2026-01-01T00:00:00Z", "en-US", "long"),
    ).toBe("January 2026");
    expect(
      formatAnalyticsMonth("2026-01-01T00:00:00Z", "en-US", "short"),
    ).toBe("Jan");
  });

  it("localizes the unspecified department sentinel without changing its raw filter value", () => {
    expect(departmentDisplayLabel("unspecified", "Unspecified")).toBe(
      "Unspecified",
    );
    expect(departmentDisplayLabel("Legal", "Unspecified")).toBe("Legal");

    expect(
      buildDepartmentFilterOptions(
        ["Legal", "Finance"],
        [
          { key: "Legal", count: 43 },
          { key: "unspecified", count: 21 },
        ],
        "Unspecified",
      ),
    ).toEqual([
      { value: "Legal", label: "Legal" },
      { value: "Finance", label: "Finance" },
      { value: "unspecified", label: "Unspecified" },
    ]);
  });

  it("does not invent an unspecified filter when the distribution has no matching records", () => {
    expect(
      buildDepartmentFilterOptions(
        ["Legal"],
        [{ key: "unspecified", count: 0 }],
        "Unspecified",
      ),
    ).toEqual([{ value: "Legal", label: "Legal" }]);
  });
});
