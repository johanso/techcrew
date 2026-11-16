import { describe, expect, it } from "vitest";

import { describeCardChanges, type TaskSnapshot } from "@/lib/task-events";

const before: TaskSnapshot = {
  id: 1,
  number: 7,
  title: "Fix the button",
  description: "It doesn't click.",
  type: "bug",
  priority: "medium",
  status: "todo",
  dueDate: null,
  labels: ["ui"],
};
const same = { type: "bug", title: "Fix the button", description: "It doesn't click.", priority: "medium", status: "todo", dueDate: null, labels: ["ui"] } as const;

describe("describeCardChanges", () => {
  it("reports nothing when the dialog saved the same values", () => {
    expect(describeCardChanges(before, { ...same, labels: ["ui"] })).toEqual({ changes: [], movedTo: null, onlyMoved: false });
  });

  it("names changed fields and a column change", () => {
    const result = describeCardChanges(before, { ...same, labels: ["ui", "p1"], priority: "high", dueDate: "2026-12-01", status: "in_review" });
    expect(result).toEqual({ changes: ["priority", "due date", "labels"], movedTo: "in_review", onlyMoved: false });
  });

  it("treats a column change alone as a move", () => {
    expect(describeCardChanges(before, { ...same, labels: ["ui"], status: "done" })).toEqual({ changes: [], movedTo: "done", onlyMoved: true });
  });

  it("ignores fields a GitHub card's dialog doesn't send", () => {
    expect(describeCardChanges(before, { type: "feature", priority: "medium", status: "todo", dueDate: null })).toMatchObject({ changes: ["type"] });
  });
});
