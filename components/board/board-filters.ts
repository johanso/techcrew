import type { BoardCard, IssueType } from "@/lib/board-config";

export type TypeFilter = "all" | IssueType;

export type BoardFilters = { query: string; type: TypeFilter };

export const NO_FILTERS: BoardFilters = { query: "", type: "all" };

export function isFiltering({ query, type }: BoardFilters) {
  return query.trim() !== "" || type !== "all";
}

/**
 * Text match on title or key. The key matches however people type it:
 * "ACM-142", "acm142", "#142" or just "142".
 */
export function matchesQuery(card: BoardCard, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase().replace(/^#/, "");
  if (!query) return true;
  const key = card.key.toLowerCase();
  const compact = (value: string) => value.replace(/[\s-]/g, "");
  return card.title.toLowerCase().includes(query) || key.includes(query) || compact(key).includes(compact(query));
}

export function matchesFilters(card: BoardCard, filters: BoardFilters) {
  return (filters.type === "all" || card.type === filters.type) && matchesQuery(card, filters.query);
}
