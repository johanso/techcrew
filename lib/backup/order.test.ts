import { describe, expect, it } from "vitest";

import { restoreOrder } from "./order.mjs";
import { exportTables } from "./registry.mjs";

const fk = (column: string, references: string, nullable = true) => ({ column, references, nullable });

describe("restoreOrder on the real schema", () => {
  const tables = exportTables();
  const { order, deferred } = restoreOrder(tables);

  it("puts every table after the tables it references", () => {
    const position = new Map(order.map((name, index) => [name, index]));
    expect(order).toHaveLength(tables.length);
    for (const table of tables) {
      for (const key of table.foreignKeys) {
        if (deferred.some((d) => d.table === table.name && d.column === key.column)) continue;
        expect(position.get(key.references), `${table.name}.${key.column}`).toBeLessThan(position.get(table.name) as number);
      }
    }
  });

  it("needs no deferred column today (the schema has no cycle) and is deterministic", () => {
    expect(deferred).toEqual([]);
    expect(restoreOrder([...tables].reverse()).order).toEqual(order);
  });
});

describe("restoreOrder with cycles", () => {
  it("defers a nullable foreign key that closes a cycle", () => {
    const result = restoreOrder([
      { name: "a", foreignKeys: [fk("b_id", "b", false)] },
      { name: "b", foreignKeys: [fk("a_id", "a", true)] },
    ]);
    expect(result.order).toEqual(["b", "a"]);
    expect(result.deferred).toEqual([{ table: "b", column: "a_id" }]);
  });

  it("defers a table's reference to itself", () => {
    expect(restoreOrder([{ name: "t", foreignKeys: [fk("parent_id", "t")] }])).toEqual({
      order: ["t"],
      deferred: [{ table: "t", column: "parent_id" }],
    });
  });

  it("refuses a cycle of required columns and a required self reference", () => {
    expect(() =>
      restoreOrder([
        { name: "a", foreignKeys: [fk("b_id", "b", false)] },
        { name: "b", foreignKeys: [fk("a_id", "a", false)] },
      ]),
    ).toThrow(/cycle/);
    expect(() => restoreOrder([{ name: "t", foreignKeys: [fk("parent_id", "t", false)] }])).toThrow(/cycle/);
  });

  it("ignores references to tables that are not restored", () => {
    expect(restoreOrder([{ name: "a", foreignKeys: [fk("x_id", "github_connections", false)] }]).order).toEqual(["a"]);
  });
});
