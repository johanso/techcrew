// The order a restore inserts tables in: every table after the tables its foreign keys point at. Pure.

/**
 * @typedef {{ name: string; foreignKeys: { column: string; references: string; nullable: boolean }[] }} OrderTable
 * @typedef {{ table: string; column: string }} DeferredColumn
 */

/**
 * Tables sorted so each follows the tables it references (Kahn's algorithm, ties by name, so the result is
 * deterministic). A foreign key that can't be satisfied in any order (a cycle, or a table pointing at itself) must be
 * nullable: it is returned in `deferred` and the restore inserts it as null, then updates it once every row exists.
 * Foreign keys to a table outside the list are ignored (that table is not restored).
 * @param {OrderTable[]} tables
 * @returns {{ order: string[]; deferred: DeferredColumn[] }}
 */
export function restoreOrder(tables) {
  const names = new Set(tables.map((table) => table.name));
  /** @type {Map<string, Map<string, string[]>>} table -> referenced table -> columns */
  const edges = new Map();
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    const out = new Map();
    for (const fk of [...table.foreignKeys].sort((a, b) => a.column.localeCompare(b.column))) {
      if (!names.has(fk.references)) continue;
      out.set(fk.references, [...(out.get(fk.references) ?? []), `${fk.column}${fk.nullable ? "" : "!"}`]);
    }
    edges.set(table.name, out);
  }

  /** @type {DeferredColumn[]} */
  const deferred = [];
  /** @param {string} from @param {string} to */
  const defer = (from, to) => {
    const columns = edges.get(from)?.get(to) ?? [];
    const required = columns.find((column) => column.endsWith("!"));
    if (required) throw new Error(`Foreign keys form a cycle that cannot be broken: ${from}.${required.slice(0, -1)} -> ${to} is required.`);
    for (const column of columns) deferred.push({ table: from, column });
    edges.get(from)?.delete(to);
  };

  // A table pointing at itself: its own rows can't all come first.
  for (const [name, out] of edges) if (out.has(name)) defer(name, name);

  const remaining = new Set(edges.keys());
  /** @type {string[]} */
  const order = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => [...(edges.get(name)?.keys() ?? [])].every((dep) => !remaining.has(dep))).sort();
    if (ready.length > 0) {
      for (const name of ready) {
        order.push(name);
        remaining.delete(name);
      }
      continue;
    }
    // Every remaining table waits on another remaining one: break the first edge (by name) whose columns are nullable.
    const breakable = [...remaining]
      .sort()
      .flatMap((from) => [...(edges.get(from)?.keys() ?? [])].sort().map((to) => ({ from, to })))
      .filter(({ from, to }) => remaining.has(to) && (edges.get(from)?.get(to) ?? []).every((column) => !column.endsWith("!")));
    if (breakable.length === 0) throw new Error("Foreign keys form a cycle with no nullable column to break it at.");
    defer(breakable[0].from, breakable[0].to);
  }
  return { order, deferred };
}
