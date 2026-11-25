import { PROPOSALS_MAX, type ProposalKind, type ProposalNote } from "@/lib/memory-proposals";
import type { LibrarianSignal, ShownNote } from "@/lib/librarian";
import { TESTS_FACT, TREE_FACT, type RepoFact } from "@/lib/memory-bootstrap";
import { NOTE_TITLE_MAX, type MemoryType } from "@/lib/memory-config";
import { capText } from "@/lib/memory-signals";

/**
 * The simulated librarian (AGENTS_SIMULATED=true): a scripted stand-in for the model, so signals, proposals, the inbox
 * and the memory pull request can be tried without a key or spend. Deterministic, and its answer goes through the same
 * checks as a model's. Pure.
 *
 * Learning, one project proposal per signal with text, newest first: a signal that names a project note retires it when
 * it says "no longer", else updates it; anything else becomes a new note.
 */

const firstLine = (text: string) => text.split("\n")[0]!.trim();

const TYPES: Partial<Record<LibrarianSignal["kind"], MemoryType>> = { remember: "preference", answer: "decision", pr_rejected: "pitfall", rework: "pitfall" };
const PREFIX: Partial<Record<LibrarianSignal["kind"], string>> = { answer: "Decided: ", pr_rejected: "Avoid: ", rework: "Check: " };

type Answer = {
  action: ProposalKind;
  target: string | null;
  note: ProposalNote | null;
  rationale: string;
  signal_ids: number[];
};

function proposalFor(signal: LibrarianSignal, notes: readonly ShownNote[]): Answer | null {
  const { payload } = signal;
  const text = payload.text.trim();
  if (!text) return null;
  const base: Pick<Answer, "rationale" | "signal_ids"> = {
    rationale: `Simulated librarian: signal ${signal.id} (${signal.kind}) said it.`,
    signal_ids: [signal.id],
  };
  const named = notes.find((shown) => shown.scope === "project" && text.toLowerCase().includes(shown.note.title.toLowerCase()));
  if (named) {
    if (/no longer/i.test(text)) return { ...base, action: "retire", target: named.key, note: null };
    return { ...base, action: "update", target: named.key, note: { ...named.note, body: capText(`${named.note.body}\n${firstLine(text)}`, 600) } };
  }
  const title = payload.title ?? `${PREFIX[signal.kind] ?? ""}${firstLine(text)}`;
  const type = payload.type ?? TYPES[signal.kind] ?? "lesson";
  return { ...base, action: "add", target: null, note: { title: capText(title, NOTE_TITLE_MAX - 40), type, load: "on_demand", paths: [], body: capText(text, 600) } };
}

export function simulatedLearning(input: { signals: readonly LibrarianSignal[]; notes: readonly ShownNote[] }) {
  const proposals = input.signals.flatMap((signal) => proposalFor(signal, input.notes) ?? []);
  return { proposals: proposals.slice(0, PROPOSALS_MAX) };
}

/** A bootstrap from the facts alone: the conventions, the commands, the layout and the tests, as far as they exist. */
export function simulatedBootstrap(files: readonly RepoFact[]) {
  const fact = (path: string) => files.find((candidate) => candidate.path === path)?.content ?? "";
  const names = files.filter((file) => !file.path.startsWith("(")).map((file) => file.path);
  const scripts = Object.keys(parseScripts(fact("package.json")));
  const top = fact(TREE_FACT).split("\n").filter(Boolean).slice(0, 12);
  const tests = fact(TESTS_FACT).split("\n").filter(Boolean).slice(0, 5);
  const note = (title: string, type: MemoryType, body: string, from: string) => ({ title, type, paths: [], body: capText(body, 600), rationale: `Simulated librarian: from ${from}.` });
  return {
    conventions: note(
      "Project conventions",
      "convention",
      [`Files that describe this project: ${names.join(", ") || "none"}.`, scripts.length ? `Package scripts: ${scripts.join(", ")}.` : "There are no package scripts."].join("\n"),
      names.join(", ") || "the file tree"
    ),
    notes: [
      ...(top.length ? [note("Repository layout", "convention", `At the top level:\n${top.map((line) => `- ${line}`).join("\n")}`, "the file tree")] : []),
      ...(scripts.length ? [note("Commands in package.json", "command", scripts.map((name) => `- \`npm run ${name}\``).join("\n"), "package.json")] : []),
      ...(tests.length ? [note("Where the tests are", "convention", tests.map((line) => `- ${line}`).join("\n"), "the file tree")] : []),
    ],
  };
}

function parseScripts(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    const scripts = typeof parsed === "object" && parsed !== null ? (parsed as { scripts?: unknown }).scripts : null;
    return typeof scripts === "object" && scripts !== null ? (scripts as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
