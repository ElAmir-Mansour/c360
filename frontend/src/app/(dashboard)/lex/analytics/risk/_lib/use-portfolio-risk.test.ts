import { describe, expect, it } from "vitest";

import type { LexContract, LexMatter, LexObligation } from "@/types/suites";
import { buildPortfolioRisk } from "./use-portfolio-risk";

function contract(
  id: string,
  overrides: Partial<LexContract> = {},
): LexContract {
  return {
    id,
    title: id,
    status: "active",
    risk_level: "low",
    risk_score: 20,
    total_value: 1_000,
    currency: "SAR",
    ...overrides,
  } as LexContract;
}

describe("buildPortfolioRisk contributor ids", () => {
  it("preserves the exact contract contributors behind every portfolio KPI", () => {
    const high = contract("contract-high", {
      risk_level: "high",
      risk_score: 80,
      expiry_date: "2026-08-20",
    });
    const medium = contract("contract-medium", {
      risk_level: "medium",
      risk_score: 50,
      status: "renewed",
    });
    const inactive = contract("contract-inactive", {
      status: "expired",
      risk_level: "none",
      risk_score: null,
    });

    const result = buildPortfolioRisk({
      contracts: [high, medium, inactive],
      matters: [] as LexMatter[],
      obligations: [] as LexObligation[],
      now: new Date("2026-08-01T00:00:00Z"),
    });

    expect(result.kpis.portfolioContractIds).toEqual([
      high.id,
      medium.id,
      inactive.id,
    ]);
    expect(result.kpis.activeContractIds).toEqual([high.id, medium.id]);
    expect(result.kpis.valueAtRiskContractIds).toEqual([high.id]);
    expect(result.kpis.expiring90ContractIds).toEqual([high.id]);
    expect(result.distribution.scoredContractIds).toEqual([high.id, medium.id]);
    expect(result.distribution.unscoredContractIds).toEqual([inactive.id]);
    expect(result.distribution.bandContractIds.high).toEqual([high.id]);
    expect(
      result.distribution.buckets.find((bucket) =>
        bucket.contractIds.includes(high.id),
      )?.contractIds,
    ).toContain(high.id);
    expect(
      result.cliff.find((point) => point.month === "2026-08")?.contractIds,
    ).toEqual([high.id]);
  });

  it("preserves matter and obligation contributors behind every chart bucket", () => {
    const overdueMatter = {
      id: "matter-overdue",
      status: "open",
      priority: "high",
      due_date: "2026-07-31",
    } as LexMatter;
    const onTrackMatter = {
      id: "matter-on-track",
      status: "open",
      priority: "high",
      due_date: "2026-08-15",
    } as LexMatter;
    const overdueObligation = {
      id: "obligation-overdue",
      status: "open",
      due_date: "2026-07-31",
    } as LexObligation;

    const result = buildPortfolioRisk({
      contracts: [],
      matters: [overdueMatter, onTrackMatter],
      obligations: [overdueObligation],
      now: new Date("2026-08-01T00:00:00Z"),
    });

    const high = result.urgency.find((point) => point.priority === "high");
    expect(high?.matterIds).toEqual([overdueMatter.id, onTrackMatter.id]);
    expect(high?.overdueMatterIds).toEqual([overdueMatter.id]);
    expect(high?.onTrackMatterIds).toEqual([onTrackMatter.id]);
    expect(
      result.maturity.find((point) => point.key === "overdue")?.obligationIds,
    ).toEqual([overdueObligation.id]);
  });
});
