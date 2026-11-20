import { describe, expect, it } from "vitest";

import { isFiltering, matchesFilters, matchesQuery, NO_FILTERS, previewCards } from "@/components/board/board-filters";
import type { BoardCard } from "@/lib/board-config";

const card = (overrides: Partial<BoardCard> = {}): BoardCard => ({
  id: "1",
  key: "ACM-142",
  type: "feature",
  title: "Add OAuth error states",
  description: "",
  priority: "medium",
  assignee: null,
  run: null,
  references: 0,
  labels: [],
  dueDate: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  github: null,
  ...overrides,
});

describe("matchesQuery", () => {
  it("matches the key however it's typed", () => {
    for (const query of ["ACM-142", "acm142", "acm 142", "142", "#142"]) expect(matchesQuery(card(), query)).toBe(true);
  });

  it("matches the title, case-insensitively", () => {
    expect(matchesQuery(card(), "oauth ERROR")).toBe(true);
    expect(matchesQuery(card(), "billing")).toBe(false);
  });

  it("matches a GitHub issue number only for synced cards", () => {
    const synced = card({ key: "ACM-3", github: { number: 87, url: "https://github.com/a/b/issues/87", state: "open" } });
    expect(matchesQuery(synced, "#87")).toBe(true);
    expect(matchesQuery(card({ key: "ACM-3" }), "#87")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery(card(), "   ")).toBe(true);
  });
});

describe("matchesFilters", () => {
  it("combines the type tab with the search", () => {
    expect(matchesFilters(card(), { query: "oauth", type: "feature" })).toBe(true);
    expect(matchesFilters(card(), { query: "oauth", type: "bug" })).toBe(false);
  });

  it("knows when filters are active", () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ query: " x ", type: "all" })).toBe(true);
    expect(isFiltering({ query: "", type: "issue" })).toBe(true);
  });
});

describe("previewCards", () => {
  const cards = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("shows the first cards and counts the rest", () => {
    expect(previewCards(cards, 3)).toEqual({ shown: [{ id: "a" }, { id: "b" }, { id: "c" }], hidden: 2 });
    expect(previewCards(cards, 10)).toEqual({ shown: cards, hidden: 0 });
  });

  it("keeps a dragged or highlighted card in place even past the limit", () => {
    expect(previewCards(cards, 2, ["e", null])).toEqual({ shown: [{ id: "a" }, { id: "b" }, { id: "e" }], hidden: 2 });
  });
});
