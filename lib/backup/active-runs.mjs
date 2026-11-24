// Runs that are queued or running don't continue on another computer. What an export does about them, pure.

/**
 * @param {{ count: number; yes: boolean; interactive: boolean }} input `interactive`: stdin is a terminal
 * @returns {"proceed" | "ask" | "refuse"}
 */
export function activeRunsDecision({ count, yes, interactive }) {
  if (count === 0 || yes) return "proceed";
  return interactive ? "ask" : "refuse";
}

/** @param {number} count */
export function activeRunsWarning(count) {
  return `${count} agent run${count === 1 ? " is" : "s are"} queued or running. They will not continue on the new computer. The restored cards will show them as running: use Stop agents on a card, then Run it again.`;
}
