import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RequestInboxPage from "./request-inbox-page";

const { useDataTableMock } = vi.hoisted(() => ({
  useDataTableMock: vi.fn(),
}));

vi.mock("../../_guards/lex-route-guard", () => ({
  // Simulate an unresolved or denied route. Children are deliberately not
  // rendered, which must also keep every inbox data hook dormant.
  LexRouteGuard: () => null,
}));

vi.mock("@/hooks/use-data-table", () => ({
  useDataTable: useDataTableMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("RequestInboxPage authorization boundary", () => {
  it("does not start inbox data queries before the route guard allows access", () => {
    render(<RequestInboxPage />);

    expect(useDataTableMock).not.toHaveBeenCalled();
  });
});
