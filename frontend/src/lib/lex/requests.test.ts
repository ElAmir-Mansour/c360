import { describe, expect, it } from "vitest";
import { isContractLegalRequest, requestCanHaveSlaClock } from "./requests";

describe("isContractLegalRequest", () => {
  it("recognizes linked, intake-token, and Arabic contract requests", () => {
    expect(
      isContractLegalRequest({
        request_type: "other",
        subject_type: "contract",
      }),
    ).toBe(true);
    expect(isContractLegalRequest({ request_type: "contract_review" })).toBe(
      true,
    );
    expect(isContractLegalRequest({ request_type: "مراجعة عقد" })).toBe(true);
  });

  it("does not alter non-contract request workflows", () => {
    expect(isContractLegalRequest({ request_type: "legal_consultation" })).toBe(
      false,
    );
    expect(isContractLegalRequest({ request_type: "litigation_support" })).toBe(
      false,
    );
  });
});

describe("requestCanHaveSlaClock", () => {
  it("keeps the stopped review-round clock visible while a request is returned", () => {
    expect(requestCanHaveSlaClock("returned")).toBe(true);
    expect(requestCanHaveSlaClock("in_execution")).toBe(true);
    expect(requestCanHaveSlaClock("draft")).toBe(false);
  });
});
