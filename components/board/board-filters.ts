import type { BoardCard, IssueType } from "@/lib/board-config";

export type TypeFilter = "all" | IssueType;

export type BoardFilters = { query: string; type: TypeFilter };

export const NO_FILTERS: BoardFilters = { query: "", type: "all" };

export function isFiltering({ query, type }: BoardFilters) {
  return query.trim() !== "" || type !== "all";
}

/**
 * Text match on title, key or GitHub issue number. Keys match however people type them:
 * "ACM-142", "acm142", "#142" or just "142" (the last two also match GitHub issue #142).
 */
export function matchesQuery(card: BoardCard, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase().replace(/^#/, "");
  if (!query) return true;
  const key = card.key.toLowerCase();
  const compact = (value: string) => value.replace(/[\s-]/g, "");
  const issueNumber = card.github ? String(card.github.number) : null;
  return (
    card.title.toLowerCase().includes(query) ||
    key.includes(query) ||
    compact(key).includes(compact(query)) ||
    (issueNumber !== null && /^\d+$/.test(query) && issueNumber.includes(query))
  );
}

export function matchesFilters(card: BoardCard, filters: BoardFilters) {
  return (filters.type === "all" || card.type === filters.type) && matchesQuery(card, filters.query);
}

/** Cards a column shows before "Show more": the rest stays one click away (and in the column's own scroll). */
export const COLUMN_PREVIEW = 5;

/**
 * A collapsed column's cards: the first `limit`, plus any card in `keep` wherever it sits (the card being dragged, so
 * it never vanishes mid-drag, and one just created or saved). Order is kept; `hidden` counts the rest.
 */
export function previewCards<T extends { id: string }>(cards: T[], limit: number, keep: readonly (string | null)[] = []) {
  const shown = cards.filter((card, index) => index < limit || keep.includes(card.id));
  return { shown, hidden: cards.length - shown.length };
}
