import { describe, expect, it } from "vitest";

import { contractWorkspaceHref } from "./contract-workspace-route";

describe("contractWorkspaceHref", () => {
  it.each([
    ["draft", "/lex/contracts/contract-1/draft"],
    ["internal_review", "/lex/contracts/contract-1/approval"],
    ["legal_review", "/lex/contracts/contract-1/approval"],
    ["negotiation", "/lex/contracts/contract-1/negotiation"],
    ["pending_signature", "/lex/contracts/contract-1/signature"],
    ["active", "/lex/contracts/contract-1"],
  ] as const)(
    "routes %s contracts to their persisted workspace",
    (status, expected) => {
      expect(contractWorkspaceHref({ id: "contract-1", status })).toBe(
        expected,
      );
    },
  );
});
