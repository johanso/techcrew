import { describe, expect, it } from "vitest";

import { selectNotes, validateBootstrap, validateLearning, type LibrarianSignal } from "@/lib/librarian";
import { simulatedBootstrap, simulatedLearning } from "@/lib/librarian-simulated";
import { TESTS_FACT, TREE_FACT } from "@/lib/memory-bootstrap";
import type { MemoryNote } from "@/lib/memory-config";

const signal = (id: number, kind: LibrarianSignal["kind"], payload: LibrarianSignal["payload"], trusted = false): LibrarianSignal => ({
  id,
  kind,
  trusted,
  payload,
  taskId: null,
  card: null,
  prNumber: null,
  createdAt: new Date(),
});

const NOTE: MemoryNote = {
  key: "project/port",
  scope: "project",
  userId: 1,
  workspaceId: 10,
  id: 1,
  file: null,
  type: "convention",
  title: "Dev port",
  body: "The app runs on 8080.",
  load: "on_demand",
  status: "active",
  paths: [],
  source: {},
  origin: "owner",
};

describe("the simulated librarian passes the same checks as a model", () => {
  const signals = [
    signal(1, "remember", { text: "Keep pull requests small.", scope: "project" }, true),
    signal(2, "rework", { text: "Lint failed on unused imports.", cause: "ci", round: 0 }),
    signal(3, "answer", { text: "The dev port moved: Dev port is 9000 now." }, true),
    signal(4, "pr_rejected", { text: "", reason: "style" }, true),
  ];
  const context = { signals, notes: [NOTE], shown: selectNotes([NOTE]), history: [] };

  it("adds and updates project notes only", () => {
    const result = validateLearning(simulatedLearning({ signals, notes: context.shown }), context);
    expect(result).toMatchObject({ ok: true, dropped: [] });
    expect(result.ok && result.proposals.map((p) => [p.kind, p.scope, p.untrustedOrigin])).toEqual([
      ["add", "project", false],
      ["add", "project", true],
      ["update", "project", false],
    ]);
  });

  it("retires a note a signal says no longer holds, and gives the same answer twice", () => {
    const retire = [signal(5, "lesson", { title: "Port", text: "Dev port no longer matters." })];
    const answer = simulatedLearning({ signals: retire, notes: context.shown });
    expect(answer).toEqual(simulatedLearning({ signals: retire, notes: context.shown }));
    const result = validateLearning(answer, { ...context, signals: retire });
    expect(result.ok && result.proposals.map((p) => [p.kind, p.targetKey])).toEqual([["retire", "project/port"]]);
  });

  it("builds a first memory from facts, and from an almost empty repository", () => {
    const files = [
      { path: TREE_FACT, content: "src/ (2 files)\npackage.json" },
      { path: TESTS_FACT, content: "src/: 1 (e.g. src/a.test.ts)" },
      { path: "package.json", content: JSON.stringify({ scripts: { test: "rm -rf dist && vitest", build: "tsc" } }) },
    ];
    const bootContext = { notes: [], shown: [], history: [], files: files.map((file) => file.path) };
    const result = validateBootstrap(simulatedBootstrap(files), bootContext);
    expect(result.ok && result.proposals.map((p) => p.note!.title)).toEqual(["Project conventions", "Repository layout", "Commands in package.json", "Where the tests are"]);
    expect(result).toMatchObject({ dropped: [] });
    const empty = validateBootstrap(simulatedBootstrap([{ path: TREE_FACT, content: "README.md" }]), bootContext);
    expect(empty.ok && empty.proposals).toHaveLength(2);
  });
});
