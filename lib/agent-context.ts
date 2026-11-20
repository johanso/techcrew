import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Keeps an OpenRouter agent's requests small (lib/agent-loop.ts). Chat Completions is stateless, so every turn resends
 * the stage's whole conversation, and reasoning models need their reasoning sent back with it: in run 53 (DeepSeek, 40
 * development turns) two thirds of what each turn resent was earlier reasoning, then file contents the agent wrote.
 *
 * At send time (the stored conversation stays verbatim, at its fixed positions), once the turns since the last fold pass
 * FOLD_THRESHOLD_CHARS, every turn but the last FOLD_KEEP_TURNS is folded into a short digest appended to the brief: one
 * line per tool call with its target and outcome, no output, no arguments, no reasoning. The kept turns go back
 * unchanged, reasoning included (DeepSeek, Kimi and GLM require it for the tool calls they carry; Gemini its signatures).
 * The fold point is recomputed from the stored sizes every turn and only moves at the next threshold, so between folds
 * the request's prefix stays byte-identical and provider caches keep working. Not for Claude: a client-side edit of
 * earlier turns invalidates its thinking blocks; Anthropic agents use server-side context editing instead.
 */

/** Characters (of the stored JSON) the turns since the last fold may reach before the next fold: about 28K tokens. */
export const FOLD_THRESHOLD_CHARS = 100_000;
/** The most recent turns a fold keeps verbatim, so the agent keeps its current reasoning and latest results. */
export const FOLD_KEEP_TURNS = 2;

export type FoldOptions = { thresholdChars: number; keepTurns: number };
const DEFAULT_FOLD: FoldOptions = { thresholdChars: FOLD_THRESHOLD_CHARS, keepTurns: FOLD_KEEP_TURNS };

type ChatMessage = ChatCompletionMessageParam;

/** One model turn in the stored conversation: the assistant message, then its tool results (and an images message). */
export type ChatTurn = { messages: ChatMessage[]; chars: number };

export const messageChars = (message: ChatMessage) => JSON.stringify(message).length;

/** Splits a stored conversation (message 0 is the brief) into turns; each starts with an assistant message. */
export function chatTurns(history: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of history.slice(1)) {
    const current = turns.at(-1);
    if (message.role === "assistant" || !current) turns.push({ messages: [message], chars: messageChars(message) });
    else {
      current.messages.push(message);
      current.chars += messageChars(message);
    }
  }
  return turns;
}

/**
 * How many leading turns are folded, from the turns' sizes alone, so every turn computes the same point: it moves only
 * when the turns since the last fold pass the threshold, and then to all but the last `keepTurns`.
 */
export function foldPoint(sizes: number[], options: FoldOptions = DEFAULT_FOLD): number {
  let point = 0;
  let unfolded = 0;
  for (let i = 0; i < sizes.length; i++) {
    unfolded += sizes[i]!;
    const next = i + 1 - options.keepTurns;
    if (unfolded > options.thresholdChars && next > point) {
      point = next;
      unfolded = sizes.slice(point, i + 1).reduce((sum, size) => sum + size, 0);
    }
  }
  return point;
}

const LINE_MAX = 160;
const TEXT_MAX = 300;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const kb = (chars: number) => (chars < 1000 ? `${chars} chars` : `${(chars / 1000).toFixed(1)} KB`);

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The call's target as the agent log names it (path, prefix, query, command, reference id). */
function callTarget(args: Record<string, unknown>) {
  const value = args.path ?? args.path_prefix ?? args.query ?? args.command ?? args.id ?? args.name;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** How big the call's own content was (what a write sent), so the digest can say so without repeating it. */
function argumentSize(args: Record<string, unknown>) {
  const content = args.content ?? args.new_text;
  return typeof content === "string" ? ` (${kb(content.length)} written)` : "";
}

const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "")).join("\n")
      : "";

/** One turn as digest lines: each tool call with its target and the first line of its result. */
function turnLines(turn: ChatTurn, number: number): string[] {
  const [assistant, ...rest] = turn.messages;
  if (assistant?.role !== "assistant") return [];
  const outputs = new Map<string, string>();
  for (const message of rest) if (message.role === "tool") outputs.set(message.tool_call_id, textOf(message.content));

  const lines: string[] = [];
  const said = textOf(assistant.content).trim();
  if (said) lines.push(`- Turn ${number}, you wrote: ${clip(said.replace(/\s+/g, " "), TEXT_MAX)}`);
  for (const call of assistant.tool_calls ?? []) {
    if (call.type !== "function") continue;
    const args = parseArgs(call.function.arguments);
    const target = callTarget(args);
    const output = outputs.get(call.id) ?? "";
    const first = output.split("\n", 1)[0]!.trim();
    lines.push(
      `- Turn ${number}: ${call.function.name}${target ? ` ${clip(target, 80)}` : ""}${argumentSize(args)} → ${clip(first || "(no output)", LINE_MAX)}${
        output.length > first.length + 1 ? ` [${kb(output.length)} of output]` : ""
      }`
    );
  }
  return lines.length ? lines : [`- Turn ${number}: no tool call`];
}

/** The digest of folded turns 1…n, appended to the brief. Deterministic: the same turns always give the same text. */
export function foldDigest(turns: ChatTurn[]): string {
  const lines = turns.flatMap((turn, i) => turnLines(turn, i + 1));
  return `

<earlier-turns>
Turns 1–${turns.length} of this stage, folded to keep each request small: their tool output and your reasoning aren't shown any more. What you wrote is committed on the branch. When you need something exact again (a file, a test result), call the tool again.
${lines.join("\n")}
</earlier-turns>`;
}

/**
 * The conversation to send: the stored one when nothing is folded, else the brief with the digest of the folded turns,
 * then the kept turns unchanged. `folded`: how many turns the digest replaced.
 */
export function compactChatHistory(history: ChatMessage[], options: FoldOptions = DEFAULT_FOLD): { messages: ChatMessage[]; folded: number } {
  const [brief, ...rest] = history;
  if (!brief || !rest.length) return { messages: history, folded: 0 };
  const turns = chatTurns(history);
  const folded = foldPoint(
    turns.map((turn) => turn.chars),
    options
  );
  if (folded === 0) return { messages: history, folded: 0 };
  const digest = foldDigest(turns.slice(0, folded));
  const content = typeof brief.content === "string" ? `${brief.content}${digest}` : [...(Array.isArray(brief.content) ? brief.content : []), { type: "text" as const, text: digest }];
  const head = { ...brief, content } as ChatMessage;
  return { messages: [head, ...turns.slice(folded).flatMap((turn) => turn.messages)], folded };
}
