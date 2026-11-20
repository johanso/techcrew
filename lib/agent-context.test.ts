import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";

import { FOLD_KEEP_TURNS, FOLD_THRESHOLD_CHARS, chatTurns, compactChatHistory, foldDigest, foldPoint, messageChars } from "@/lib/agent-context";

type Msg = ChatCompletionMessageParam;

/**
 * Run 53's development stage (DeepSeek V4 Pro, 40 turns, one tool call per turn after the first reads) by shape only:
 * per turn, the reasoning's length and each call as [tool, argument chars, output chars]. Content is filler.
 */
const RUN_53: [number, [string, number, number][]][] = [
  [93, [["list_files", 18, 350]]],
  [0, [["read_file", 56, 1235], ["read_file", 57, 2099], ["read_file", 58, 1221], ["read_file", 63, 983], ["read_file", 62, 6724], ["read_file", 59, 3728], ["read_file", 58, 424], ["read_file", 55, 323], ["read_file", 59, 357], ["read_file", 70, 418]]],
  [50713, [["write_file", 4734, 82]]],
  [1334, [["write_file", 6052, 87]]],
  [72, [["run_command", 69, 780]]],
  [89561, [["write_file", 3064, 75]]],
  [33, [["write_file", 8702, 78]]],
  [172, [["write_file", 24813, 76]]],
  [2322, [["replace_in_file", 422, 74]]],
  [0, [["replace_in_file", 418, 74]]],
  [41, [["replace_in_file", 503, 75]]],
  [0, [["replace_in_file", 539, 75]]],
  [59, [["run_build", 2, 506]]],
  [111, [["run_tests", 2, 4094]]],
  [9115, [["run_command", 158, 424]]],
  [179, [["read_file", 58, 4934]]],
  [39159, [["replace_in_file", 606, 75]]],
  [0, [["replace_in_file", 2430, 75]]],
  [70, [["replace_in_file", 2371, 75]]],
  [84, [["replace_in_file", 607, 75]]],
  [0, [["replace_in_file", 421, 75]]],
  [99, [["run_command", 30, 259]]],
  [872, [["read_file", 54, 860]]],
  [1602, [["read_file", 52, 533]]],
  [2947, [["replace_in_file", 462, 75]]],
  [0, [["run_command", 30, 123]]],
  [67912, [["replace_in_file", 1354, 75]]],
  [25248, [["write_file", 23994, 81]]],
  [33, [["run_command", 45, 12073]]],
  [5017, [["replace_in_file", 560, 80]]],
  [0, [["replace_in_file", 906, 80]]],
  [47, [["replace_in_file", 599, 80]]],
  [0, [["run_command", 45, 5029]]],
  [24739, [["replace_in_file", 1736, 80]]],
  [169, [["replace_in_file", 912, 80]]],
  [168, [["replace_in_file", 857, 80]]],
  [2634, [["read_file", 59, 1700]]],
  [0, [["replace_in_file", 701, 80]]],
  [58, [["read_file", 59, 1547]]],
  [0, [["replace_in_file", 1201, 80]]],
];

const fill = (n: number) => "x".repeat(Math.max(0, n));

function conversation(shape = RUN_53): Msg[] {
  const messages: Msg[] = [{ role: "user", content: `<task>${fill(8000)}</task>` }];
  shape.forEach(([reasoning, calls], t) => {
    const toolCalls = calls.map(([name, argChars], i) => ({
      id: `call_${t}_${i}`,
      type: "function" as const,
      function: {
        name,
        arguments: JSON.stringify({
          path: `src/file-${t}-${i}.ts`,
          ...(name === "write_file" ? { content: fill(argChars - 40) } : name === "replace_in_file" ? { new_text: fill(argChars - 40) } : {}),
        }),
      },
    }));
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: toolCalls,
      ...(reasoning ? { reasoning_details: [{ type: "reasoning.text", text: fill(reasoning), index: 0, format: "unknown" }] } : {}),
    } as Msg);
    calls.forEach(([name, , outChars], i) => {
      const first = name === "read_file" ? `src/file-${t}-${i}.ts (lines 1-40 of 40)` : `Edited src/file-${t}-${i}.ts on agent/x.`;
      messages.push({ role: "tool", tool_call_id: `call_${t}_${i}`, content: `${first}\n${fill(outChars - first.length - 1)}` });
    });
  });
  return messages;
}

/** Characters each request of the stage sends (system prompt and tools left out: they're the same either way). */
function sentPerTurn(history: Msg[], compact: boolean) {
  const turns = chatTurns(history);
  return turns.map((_, i) => {
    const sofar = history.slice(0, 1 + turns.slice(0, i).reduce((n, turn) => n + turn.messages.length, 0));
    const messages = compact ? compactChatHistory(sofar).messages : sofar;
    return messages.reduce((sum, message) => sum + messageChars(message), 0);
  });
}

describe("foldPoint", () => {
  it("folds nothing below the threshold", () => {
    expect(foldPoint([10, 20, 30], { thresholdChars: 100, keepTurns: 2 })).toBe(0);
  });

  it("folds all but the kept turns once the unfolded turns pass the threshold, then holds until the next step", () => {
    const options = { thresholdChars: 100, keepTurns: 2 };
    expect(foldPoint([40, 40, 40], options)).toBe(1);
    // After the step, turns 2–3 (80) are unfolded: a small 4th turn doesn't move the point.
    expect(foldPoint([40, 40, 40, 10], options)).toBe(1);
    expect(foldPoint([40, 40, 40, 10, 40], options)).toBe(3);
  });

  it("is the same point every turn computes for the same history", () => {
    const sizes = chatTurns(conversation()).map((turn) => turn.chars);
    const points = sizes.map((_, i) => foldPoint(sizes.slice(0, i + 1)));
    // Monotonic: a fold never comes back.
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThanOrEqual(points[i - 1]!);
    expect(foldPoint(sizes)).toBe(points.at(-1));
  });
});

describe("compactChatHistory", () => {
  it("leaves a short conversation unchanged", () => {
    const history = conversation(RUN_53.slice(0, 2));
    expect(compactChatHistory(history)).toEqual({ messages: history, folded: 0 });
  });

  it("sends the brief with a digest, then the kept turns verbatim with their reasoning", () => {
    const history = conversation();
    const { messages, folded } = compactChatHistory(history);
    const turns = chatTurns(history);
    expect(folded).toBeGreaterThan(0);
    expect(folded).toBeLessThanOrEqual(turns.length - FOLD_KEEP_TURNS);
    const head = messages[0]!;
    expect(head.role).toBe("user");
    expect(head.content).toContain("<task>");
    expect(head.content).toContain(`Turns 1–${folded} of this stage`);
    // The kept turns are byte-identical to the stored ones, starting with an assistant message.
    expect(messages.slice(1)).toEqual(turns.slice(folded).flatMap((turn) => turn.messages));
    expect(messages[1]!.role).toBe("assistant");
    // Every tool result answers a call in the kept turns.
    const ids = new Set(messages.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((c) => c.id) : [])));
    for (const m of messages) if (m.role === "tool") expect(ids.has(m.tool_call_id)).toBe(true);
  });

  it("keeps the request's prefix identical between fold steps (provider caches keep working)", () => {
    const history = conversation();
    const turns = chatTurns(history);
    let previous: Msg[] | null = null;
    let steps = 0;
    for (let i = 1; i <= turns.length; i++) {
      const sofar = history.slice(0, 1 + turns.slice(0, i).reduce((n, turn) => n + turn.messages.length, 0));
      const { messages } = compactChatHistory(sofar);
      if (previous) {
        const prefixKept = JSON.stringify(messages.slice(0, previous.length)) === JSON.stringify(previous);
        if (!prefixKept) steps++;
      }
      previous = messages;
    }
    // A handful of fold steps over 40 turns, not a new prefix every turn.
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(10);
  });

  it("cuts what run 53's development stage resent by more than two thirds", () => {
    const history = conversation();
    const before = sentPerTurn(history, false).reduce((a, b) => a + b, 0);
    const after = sentPerTurn(history, true).reduce((a, b) => a + b, 0);
    expect(after / before).toBeLessThan(1 / 3);
    // No request carries much more than the threshold plus the brief, its digest and the largest kept turns.
    expect(Math.max(...sentPerTurn(history, true))).toBeLessThan(FOLD_THRESHOLD_CHARS * 2);
  });
});

describe("foldDigest", () => {
  it("names each call with its target and first result line, never its content", () => {
    const history = conversation(RUN_53.slice(0, 3));
    const digest = foldDigest(chatTurns(history));
    expect(digest).toContain("- Turn 2: read_file src/file-1-0.ts → src/file-1-0.ts (lines 1-40 of 40) [1.2 KB of output]");
    expect(digest).toContain("- Turn 3: write_file src/file-2-0.ts (4.7 KB written) → Edited src/file-2-0.ts on agent/x.");
    expect(digest).not.toContain("xxxxxxxxxx");
  });

  it("keeps what the agent said, clipped", () => {
    const turns = chatTurns([
      { role: "user", content: "brief" },
      { role: "assistant", content: `Plan: ${"step ".repeat(200)}` },
      { role: "user", content: "Continue." },
    ]);
    const digest = foldDigest(turns);
    expect(digest).toContain("- Turn 1, you wrote: Plan: step");
    expect(digest).toMatch(/…/);
  });
});
