import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { getMessages } from "@/lib/i18n/messages";
import { DateRangePicker } from "./date-range-picker";

describe("DateRangePicker", () => {
  it("formats selected ranges with the English provider locale", () => {
    render(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages("en")}>
        <DateRangePicker
          value={{ from: new Date(2026, 5, 2), to: new Date(2026, 5, 25) }}
          onChange={vi.fn()}
        />
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Jun 2, 2026 – Jun 25, 2026" });
    expect(trigger).toHaveAttribute("dir", "ltr");
  });

  it("uses Arabic provider labels and RTL direction for the trigger and popover", async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider locale="ar" direction="rtl" messages={getMessages("ar")}>
        <DateRangePicker value={{ from: undefined, to: undefined }} onChange={vi.fn()} />
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "اختر النطاق الزمني" });
    expect(trigger).toHaveAttribute("dir", "rtl");

    await user.click(trigger);

    expect(await screen.findByRole("button", { name: "آخر 7 أيام" })).toBeInTheDocument();
    expect(screen.getByText("آخر 7 أيام").closest("[dir='rtl']")).toBeInTheDocument();
  });

  it("accepts caller labels and date formatting options", () => {
    render(
      <DateRangePicker
        locale="en-GB"
        labels={{ rangeSeparator: " to " }}
        dateFormatOptions={{ day: "2-digit", month: "2-digit", year: "numeric" }}
        value={{ from: new Date(2026, 5, 2), to: new Date(2026, 5, 25) }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "02/06/2026 to 25/06/2026" })).toHaveAttribute(
      "dir",
      "ltr",
    );
  });
});
