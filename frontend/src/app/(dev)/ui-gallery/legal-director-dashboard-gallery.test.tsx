import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegalDirectorDashboardGallery } from "./legal-director-dashboard-gallery";

const STATES = [
  "Ready",
  "Loading",
  "Empty",
  "Error with retry",
  "Zero",
  "Partial",
  "Overflow",
] as const;

describe("LegalDirectorDashboardGallery", () => {
  it("renders every Step 5 full-composition state in English and Arabic", () => {
    const { container } = render(<LegalDirectorDashboardGallery />);

    for (const localeName of [
      "English · LTR",
      "العربية · من اليمين إلى اليسار",
    ]) {
      const localeSection = screen
        .getByRole("heading", { name: localeName })
        .closest("section");
      expect(localeSection).not.toBeNull();

      for (const state of STATES) {
        expect(
          within(localeSection!).getByRole("heading", { name: state }),
        ).toBeVisible();
      }
    }

    expect(
      container.querySelectorAll("[data-legal-director-dashboard-view]"),
    ).toHaveLength(14);
    for (const strip of container.querySelectorAll(
      "[data-legal-director-kpi-strip]",
    )) {
      expect(strip.children).toHaveLength(6);
    }
  });

  it("exposes stable state references, unique heading relationships, and RTL output", () => {
    const { container } = render(<LegalDirectorDashboardGallery />);

    expect(
      container.querySelector("#legal-director-dashboard-en-ready"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("#legal-director-dashboard-ar-overflow"),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[dir="rtl"][lang="ar"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        "#legal-director-dashboard-ar-zero [data-legal-director-dashboard-view]",
      ),
    ).toHaveAttribute("dir", "rtl");

    const viewHeadingIds = Array.from(
      container.querySelectorAll(
        "[data-legal-director-dashboard-view] > h1, [data-legal-director-dashboard-view] h1",
      ),
      (heading) => heading.id,
    );
    expect(new Set(viewHeadingIds).size).toBe(viewHeadingIds.length);
  });

  it("keeps zero distinct from empty, renders complete ready domains, and omits deferred panels", () => {
    const { container } = render(<LegalDirectorDashboardGallery />);
    const ready = container.querySelector<HTMLElement>(
      "#legal-director-dashboard-en-ready",
    );
    const empty = container.querySelector<HTMLElement>(
      "#legal-director-dashboard-en-empty",
    );
    const zero = container.querySelector<HTMLElement>(
      "#legal-director-dashboard-ar-zero",
    );

    expect(ready).not.toBeNull();
    expect(empty).not.toBeNull();
    expect(zero).not.toBeNull();
    // Scoped to the domains grid: the specimen also contains the calendar
    // band's per-event links, which are not domain tiles.
    expect(
      ready!.querySelectorAll("[data-legal-domains-grid] a"),
    ).toHaveLength(18);
    expect(within(empty!).getByText("No warning data available")).toBeVisible();
    expect(within(zero!).getAllByText("٠").length).toBeGreaterThan(0);
    // The AI Agent panel has no backend yet (LEX-LD-GAP-DESIGN G4) and stays
    // omitted; the Calendar band now composes the shipped unified calendar.
    expect(
      screen.queryByRole("heading", { name: /My AI Agent/i }),
    ).not.toBeInTheDocument();
  });

  it("wires every error retry to the dev-only interaction counter", () => {
    const { container } = render(<LegalDirectorDashboardGallery />);

    expect(screen.getByText("Step 5 retry interactions: 0")).toBeVisible();
    const englishError = container.querySelector<HTMLElement>(
      "#legal-director-dashboard-en-error",
    );
    const arabicError = container.querySelector<HTMLElement>(
      "#legal-director-dashboard-ar-error",
    );
    fireEvent.click(
      within(englishError!).getAllByRole("button", { name: "Retry" })[0],
    );
    fireEvent.click(
      within(arabicError!).getAllByRole("button", {
        name: "إعادة المحاولة",
      })[0],
    );
    expect(screen.getByText("Step 5 retry interactions: 2")).toBeVisible();
  });

  it("is mounted once on the internal UI gallery host", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(dev)/ui-gallery/page.tsx"),
      "utf8",
    );

    expect(page.match(/<LegalDirectorDashboardGallery \/>/g)).toHaveLength(1);
  });
});
