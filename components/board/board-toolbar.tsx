"use client";

import { useEffect, useRef } from "react";
import { LayersIcon, SearchIcon, XIcon } from "lucide-react";

import { isFiltering, type BoardFilters, type TypeFilter } from "@/components/board/board-filters";
import { ISSUE_TYPE_META } from "@/components/board/issue-meta";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { ISSUE_TYPES } from "@/lib/board-config";
import { cn } from "@/lib/utils";

const TABS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...ISSUE_TYPES.map((type) => ({ value: type, label: `${ISSUE_TYPE_META[type].label}s` })),
];

/** True when the keystroke happens inside something the user is typing into. */
function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function BoardToolbar({
  filters,
  onChange,
  counts,
  visible,
  total,
}: {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  /** Cards matching the search, per tab. */
  counts: Record<TypeFilter, number>;
  visible: number;
  total: number;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search from anywhere on the page, like GitHub and Linear.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <InputGroup className="h-10 bg-card lg:w-80">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filters.query) {
              event.preventDefault();
              onChange({ ...filters, query: "" });
            }
          }}
          placeholder="Search by title, key or #issue"
          aria-label="Search cards by title, key or GitHub issue number"
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        <InputGroupAddon align="inline-end">
          {filters.query ? (
            <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => onChange({ ...filters, query: "" })}>
              <XIcon />
            </InputGroupButton>
          ) : (
            <Kbd className="hidden sm:inline-flex" aria-hidden>
              /
            </Kbd>
          )}
        </InputGroupAddon>
      </InputGroup>

      {/* Segmented filter: native radios, so arrow keys and screen readers work out of the box. */}
      <div
        role="radiogroup"
        aria-label="Filter by type"
        // 2×2 on phones so every tab stays visible; a single row from `sm`.
        className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 ring-1 ring-border/70 sm:flex sm:w-fit"
      >
        {TABS.map(({ value, label }) => {
          const meta = value === "all" ? null : ISSUE_TYPE_META[value];
          const Icon = meta?.icon ?? LayersIcon;
          return (
            <label key={value} className="relative cursor-pointer">
              <input
                type="radio"
                name="type-filter"
                value={value}
                checked={filters.type === value}
                onChange={() => onChange({ ...filters, type: value })}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors",
                  "hover:text-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:ring-1 peer-checked:ring-border",
                  "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
                )}
              >
                <Icon className={cn("size-3.5", meta?.tone)} />
                {label}
                <span className="rounded-full bg-background/80 px-1.5 text-xs tabular-nums ring-1 ring-border/60">
                  {counts[value]}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {isFiltering(filters) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground lg:ml-auto" role="status">
          <span>
            Showing <span className="font-semibold text-foreground tabular-nums">{visible}</span> of{" "}
            <span className="tabular-nums">{total}</span> cards
          </span>
          <Button variant="ghost" size="sm" onClick={() => onChange({ query: "", type: "all" })}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
