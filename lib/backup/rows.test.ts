import { describe, expect, it } from "vitest";

import { allTables } from "./registry.mjs";
import { checkValue, deferredUpdateSql, insertSql, parseLine, quote, selectSql, serializeRow } from "./rows.mjs";

const col = (kind: string, notNull = true) => ({ name: "c", kind, notNull });

describe("checkValue per column type", () => {
  it("integers and serials are safe integers", () => {
    expect(checkValue(col("serial"), 7)).toBe(7);
    expect(checkValue(col("integer"), -3)).toBe(-3);
    expect(() => checkValue(col("integer"), "7")).toThrow(/c:/);
    expect(() => checkValue(col("integer"), 1.5)).toThrow();
    expect(() => checkValue(col("integer"), 2 ** 40)).toThrow();
  });

  it("bigints travel as strings and never lose digits", () => {
    expect(checkValue(col("bigint"), "9223372036854775807")).toBe("9223372036854775807");
    expect(checkValue(col("bigint"), 123)).toBe("123");
    expect(() => checkValue(col("bigint"), "12x")).toThrow();
    expect(() => checkValue(col("bigint"), 1.5)).toThrow();
  });

  it("timestamps keep microseconds, dates stay plain", () => {
    expect(checkValue(col("timestamp"), "2026-11-24T10:20:30.123456")).toBe("2026-11-24T10:20:30.123456");
    expect(checkValue(col("timestamp"), "2026-11-24T10:20:30")).toBe("2026-11-24T10:20:30");
    expect(() => checkValue(col("timestamp"), "yesterday")).toThrow();
    expect(() => checkValue(col("timestamp"), 1700000000000)).toThrow();
    expect(checkValue(col("date"), "2026-12-01")).toBe("2026-12-01");
    expect(() => checkValue(col("date"), "2026-12-01T00:00:00")).toThrow();
  });

  it("text, booleans, arrays and jsonb", () => {
    expect(checkValue(col("text"), 'héllo\n"quoted"')).toBe('héllo\n"quoted"');
    expect(() => checkValue(col("text"), "a\0b")).toThrow();
    expect(checkValue(col("boolean"), false)).toBe(false);
    expect(() => checkValue(col("boolean"), "true")).toThrow();
    expect(checkValue(col("array"), ["a", "b,c", "{d}"])).toEqual(["a", "b,c", "{d}"]);
    expect(checkValue(col("array"), [])).toEqual([]);
    expect(() => checkValue(col("array"), "{a}")).toThrow();
    expect(() => checkValue(col("array"), [1])).toThrow();
    const json = { a: [1, { b: null }], c: "x" };
    expect(checkValue(col("jsonb"), json)).toEqual(json);
  });

  it("null is allowed only on nullable columns", () => {
    expect(checkValue(col("text", false), null)).toBeNull();
    expect(() => checkValue(col("text"), null)).toThrow(/required/);
  });
});

describe("rows round-trip through a line", () => {
  const columns = [
    { name: "id", kind: "serial", notNull: true },
    { name: "github_id", kind: "bigint", notNull: true },
    { name: "created_at", kind: "timestamp", notNull: true },
    { name: "due_date", kind: "date", notNull: false },
    { name: "labels", kind: "array", notNull: true },
    { name: "report", kind: "jsonb", notNull: false },
    { name: "title", kind: "text", notNull: true },
    { name: "enabled", kind: "boolean", notNull: true },
  ];

  it("writes and reads back the same values, ignoring keys it does not know", () => {
    const row = {
      id: 5,
      github_id: "9007199254740993",
      created_at: "2026-11-24T10:20:30.5",
      due_date: null,
      labels: ["a", "b"],
      report: { score: 1.5 },
      title: "t",
      enabled: true,
    };
    const line = JSON.stringify(serializeRow(columns, row));
    expect(parseLine(columns, JSON.stringify({ ...JSON.parse(line), extra: "ignored" }))).toEqual(row);
  });

  it("refuses lines that are not rows", () => {
    expect(() => parseLine(columns, "not json")).toThrow(/not JSON/);
    expect(() => parseLine(columns, "[1]")).toThrow(/not an object/);
    expect(() => parseLine(columns, JSON.stringify({ id: "x" }))).toThrow(/id:/);
  });

  it("serializes every column of the real schema from a value of its kind", () => {
    const sample: Record<string, unknown> = {
      serial: 1,
      integer: 2,
      bigint: "3",
      text: "x",
      boolean: true,
      timestamp: "2026-01-01T00:00:00",
      date: "2026-01-01",
      jsonb: {},
      array: ["x"],
    };
    for (const table of allTables()) {
      const row = Object.fromEntries(table.columns.map((column) => [column.name, sample[column.kind]]));
      expect(() => serializeRow(table.columns, row), table.name).not.toThrow();
    }
  });
});

describe("SQL builders", () => {
  it("selects bigint as text and the rest through to_jsonb", () => {
    expect(
      selectSql(
        "tasks",
        [
          { name: "id", kind: "serial" },
          { name: "github_issue_id", kind: "bigint" },
        ],
        "id",
      ),
    ).toBe('SELECT to_jsonb("id") AS "id", "github_issue_id"::text AS "github_issue_id" FROM public."tasks" ORDER BY "id"');
  });

  it("inserts a JSON batch, with deferred columns as NULL", () => {
    expect(insertSql("t", [{ name: "id" }, { name: "parent_id" }], ["parent_id"])).toBe(
      'INSERT INTO public."t" ("id", "parent_id") SELECT r."id", NULL FROM jsonb_populate_recordset(NULL::public."t", $1::jsonb) AS r',
    );
  });

  it("updates deferred columns by primary key", () => {
    expect(deferredUpdateSql("t", "id", "parent_id", "serial", "integer")).toContain("v(pk integer, value integer)");
  });

  it("quotes identifiers", () => {
    expect(quote('a"b')).toBe('"a""b"');
  });
});
