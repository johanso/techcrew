// Reads a file line by line with a hard cap on the length of one line: a file from an archive is untrusted, and a
// single endless "line" must not fill the memory.
import { createReadStream } from "node:fs";

export const MAX_LINE_BYTES = 256 * 1024 * 1024;

/**
 * @param {string} file
 * @param {number} [maxLineBytes]
 * @returns {AsyncGenerator<string>}
 */
export async function* readLines(file, maxLineBytes = MAX_LINE_BYTES) {
  /** @type {Buffer[]} */
  let pending = [];
  let pendingBytes = 0;
  for await (const chunk of createReadStream(file)) {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline === -1) break;
      pending.push(chunk.subarray(start, newline));
      pendingBytes += newline - start;
      if (pendingBytes > maxLineBytes) throw new Error(`${file}: a line is longer than ${maxLineBytes} bytes.`);
      yield Buffer.concat(pending).toString("utf8");
      pending = [];
      pendingBytes = 0;
      start = newline + 1;
    }
    pending.push(chunk.subarray(start));
    pendingBytes += chunk.length - start;
    if (pendingBytes > maxLineBytes) throw new Error(`${file}: a line is longer than ${maxLineBytes} bytes.`);
  }
  if (pendingBytes > 0) yield Buffer.concat(pending).toString("utf8");
}
