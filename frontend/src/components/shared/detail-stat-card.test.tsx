import { render, screen } from "@testing-library/react";
import { BriefcaseBusiness } from "lucide-react";
import { describe, expect, it } from "vitest";

import { DetailStatCard } from "./detail-stat-card";

describe("DetailStatCard", () => {
  it("defaults to the compact flat operational treatment", () => {
    const { container } = render(
      <DetailStatCard
        tone="teal"
        icon={BriefcaseBusiness}
        label="Counterparty"
        value="Al Noor Legal Services"
        helper="Primary counterparty"
      />,
    );

    const tile = screen
      .getByText("Counterparty")
      .closest('[class~="group/stat-inner"]');

    expect(tile).toHaveClass("min-h-32", "bg-card", "shadow-none");
    expect(tile).not.toHaveClass("kpi-card-themed");
    expect(screen.getByText("Al Noor Legal Services")).toBeInTheDocument();
    expect(screen.getByText("Primary counterparty")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("retains an explicit legacy appearance escape hatch", () => {
    const { container } = render(
      <DetailStatCard appearance="default" label="Version" value="v3" />,
    );

    expect(container.querySelector(".kpi-card-themed")).toBeInTheDocument();
  });
});
