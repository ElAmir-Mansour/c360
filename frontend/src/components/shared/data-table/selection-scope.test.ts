import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION_SCOPE,
  countScopeSelected,
  filterQueriesEqual,
  isScopeEmpty,
  normalizeFilterQuery,
  selectionScopeReducer,
  type SelectionScope,
} from "./selection-scope";

const allMatching = (
  filterQuery: Record<string, string | string[]> = { status: "active" },
  excludedIds: string[] = [],
): SelectionScope => ({ mode: "all-matching", filterQuery, excludedIds });

describe("selectionScopeReducer", () => {
  describe("page-selection-changed", () => {
    it("replaces the id list in page mode", () => {
      const next = selectionScopeReducer(
        { mode: "page", ids: ["a"] },
        {
          type: "page-selection-changed",
          selectedIds: ["a", "b"],
          pageIds: ["a", "b", "c"],
        },
      );
      expect(next).toEqual({ mode: "page", ids: ["a", "b"] });
    });

    it("records unchecked page rows as exclusions in all-matching mode", () => {
      const next = selectionScopeReducer(allMatching(), {
        type: "page-selection-changed",
        selectedIds: ["a", "c"],
        pageIds: ["a", "b", "c"],
      });
      expect(next.mode).toBe("all-matching");
      if (next.mode === "all-matching") {
        expect(next.excludedIds).toEqual(["b"]);
        expect(next.filterQuery).toEqual({ status: "active" });
      }
    });

    it("removes a re-checked row from the exclusions", () => {
      const next = selectionScopeReducer(allMatching(undefined, ["b", "z"]), {
        type: "page-selection-changed",
        selectedIds: ["a", "b", "c"],
        pageIds: ["a", "b", "c"],
      });
      expect(next.mode).toBe("all-matching");
      if (next.mode === "all-matching") {
        // "b" was re-checked on this page; "z" lives on another page and stays.
        expect(next.excludedIds).toEqual(["z"]);
      }
    });

    it("does not duplicate an already-excluded row", () => {
      const next = selectionScopeReducer(allMatching(undefined, ["b"]), {
        type: "page-selection-changed",
        selectedIds: ["a"],
        pageIds: ["a", "b"],
      });
      expect(next.mode).toBe("all-matching");
      if (next.mode === "all-matching") {
        expect(next.excludedIds).toEqual(["b"]);
      }
    });

    it("collapses an all-matching scope when every row is unchecked (header clear)", () => {
      const next = selectionScopeReducer(allMatching(undefined, ["x"]), {
        type: "page-selection-changed",
        selectedIds: [],
        pageIds: ["a", "b"],
      });
      expect(next).toEqual(EMPTY_SELECTION_SCOPE);
    });
  });

  describe("select-all-matching", () => {
    it("captures a normalized filter query with no exclusions", () => {
      const next = selectionScopeReducer(
        { mode: "page", ids: ["a", "b"] },
        {
          type: "select-all-matching",
          filterQuery: { type: "", status: "active", tags: ["b", "a"] },
        },
      );
      expect(next).toEqual({
        mode: "all-matching",
        filterQuery: { status: "active", tags: ["a", "b"] },
        excludedIds: [],
      });
    });
  });

  describe("filters-changed", () => {
    it("is a no-op in page mode", () => {
      const state: SelectionScope = { mode: "page", ids: ["a"] };
      const next = selectionScopeReducer(state, {
        type: "filters-changed",
        filterQuery: { status: "draft" },
      });
      expect(next).toBe(state);
    });

    it("keeps the scope when the query is equivalent after normalization", () => {
      const state = allMatching({ status: "active" });
      const next = selectionScopeReducer(state, {
        type: "filters-changed",
        filterQuery: { status: "active", type: "", empty: [] },
      });
      expect(next).toBe(state);
    });

    it("collapses the scope when the query actually changed", () => {
      const next = selectionScopeReducer(allMatching({ status: "active" }), {
        type: "filters-changed",
        filterQuery: { status: "draft" },
      });
      expect(next).toEqual(EMPTY_SELECTION_SCOPE);
    });
  });

  it("clear resets any scope", () => {
    expect(
      selectionScopeReducer(allMatching(undefined, ["a"]), { type: "clear" }),
    ).toEqual(EMPTY_SELECTION_SCOPE);
    expect(
      selectionScopeReducer({ mode: "page", ids: ["a"] }, { type: "clear" }),
    ).toEqual(EMPTY_SELECTION_SCOPE);
  });
});

describe("countScopeSelected / isScopeEmpty", () => {
  it("counts explicit ids in page mode", () => {
    expect(countScopeSelected({ mode: "page", ids: ["a", "b"] }, 500)).toBe(2);
    expect(isScopeEmpty({ mode: "page", ids: [] }, 500)).toBe(true);
  });

  it("counts total minus exclusions in all-matching mode, floored at zero", () => {
    expect(countScopeSelected(allMatching(undefined, ["a"]), 120)).toBe(119);
    expect(countScopeSelected(allMatching(undefined, ["a", "b"]), 1)).toBe(0);
    expect(isScopeEmpty(allMatching(), 0)).toBe(true);
  });
});

describe("normalizeFilterQuery / filterQueriesEqual", () => {
  it("drops empty values and sorts keys and array members", () => {
    expect(
      normalizeFilterQuery({
        z: "1",
        a: ["b", "a"],
        empty: "",
        none: [],
      }),
    ).toEqual({ a: ["a", "b"], z: "1" });
  });

  it("compares structurally regardless of key/array order", () => {
    expect(
      filterQueriesEqual(
        { status: "active", tags: ["x", "y"], blank: "" },
        { tags: ["y", "x"], status: "active" },
      ),
    ).toBe(true);
    expect(
      filterQueriesEqual({ status: "active" }, { status: "draft" }),
    ).toBe(false);
  });
});
