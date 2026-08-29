import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LexFormatter } from "@/lib/lex/ksa";
import type { DetailedAnalyticsLabels } from "./_lib/detailed-analytics-labels";
import { AnalyticsMetricCard } from "./_components/analytics-metric-card";

const labels = {
  metrics: {
    unavailable: "No observations",
    newSincePrevious: "New vs previous period",
    noPreviousSample: "No comparable previous sample",
    versusPrevious: "vs previous period",
    points: "pts",
    hours: "hrs",
  },
  drilldown: {
    viewContributors: (label: string) => `View ${label}`,
  },
} as unknown as DetailedAnalyticsLabels;

const formatter = {
  formatNumber: (value: number) => String(value),
} as unknown as LexFormatter;

describe("analytics KPI layout", () => {
  it("stacks long labels and delta badges without shrinking the value row", () => {
    render(
      <AnalyticsMetricCard
        direction="ltr"
        label="Average processing time"
        metric={{
          value: 18,
          available: true,
          sample_size: 64,
          previous_value: 12,
          previous_available: true,
        }}
        format={(value) => `${value} hrs`}
        deltaKind="hours"
        labels={labels}
        f={formatter}
        onAction={vi.fn()}
      />,
    );

    const card = screen.getByTestId("analytics-metric-card");
    expect(card).toHaveClass("flex-col", "min-h-32", "min-w-0");
    expect(screen.getByText("Average processing time")).toHaveClass(
      "whitespace-normal",
    );
    expect(screen.getByText("+6 hrs")).toHaveClass("whitespace-normal");
    expect(screen.getByText("18 hrs").parentElement).toHaveClass("w-full");
  });
});
