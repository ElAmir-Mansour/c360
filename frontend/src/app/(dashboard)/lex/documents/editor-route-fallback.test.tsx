import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexDocumentEditorPage from "./editor/page";

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/lex/documents/editor",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: "u-1", email: "legal@example.test", roles: ["legal"] },
  }),
}));

describe("Lex document editor route entrypoint", () => {
  it("exports the document editor page module", () => {
    expect(LexDocumentEditorPage).toEqual(expect.any(Function));
  });

  it("renders the editor route empty state when no document id is supplied", () => {
    renderWithQuery(<LexDocumentEditorPage />);

    expect(
      screen.getByRole("heading", { name: "Document editor" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Choose a document" }),
    ).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
