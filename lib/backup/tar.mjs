// The archive itself: a .tar.gz made and read with the system `tar` (Windows 10+, macOS and Linux all ship one), run
// with an argument list and no shell. No npm package: this is the one place that touches the archive's bytes.
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { classifyEntry, pairTypes } from "./archive-paths.mjs";

// The archive travels through tar's stdin and stdout, so no path (drive letters, spaces) is ever an argument of tar:
// GNU tar reads "C:..." as a remote host and bsdtar doesn't. The only paths are the working folder and the names.
/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ input?: string; output?: string }} [pipes] a file to feed to stdin, a file to write stdout to
 * @returns {Promise<string>} stdout (empty when it went to a file)
 */
function runTar(args, cwd, pipes = {}) {
  return new Promise((resolve, reject) => {
    // COPYFILE_DISABLE: macOS's tar would add `._*` metadata entries, which a restore refuses.
    const child = spawn("tar", args, {
      cwd,
      stdio: [pipes.input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    let pending = pipes.output ? 2 : 1;
    let exit = null;
    const settle = () => {
      pending -= 1;
      if (pending > 0) return;
      if (exit === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(`tar failed (exit ${exit}): ${Buffer.concat(err).toString("utf8").trim().slice(0, 500)}`));
    };
    if (pipes.output) {
      const sink = createWriteStream(pipes.output, { flags: "wx", mode: 0o600 });
      child.stdout.pipe(sink);
      sink.on("error", reject);
      sink.on("close", settle);
    } else child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    if (pipes.input && child.stdin) {
      // tar may stop reading early (a bad archive): its exit code tells, not the broken pipe.
      child.stdin.on("error", () => {});
      const source = createReadStream(pipes.input);
      source.on("error", reject);
      source.pipe(child.stdin);
    }
    child.on("error", (error) => {
      reject(
        /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"
          ? new Error("The `tar` program was not found. Windows 10+, macOS and Linux include it; install it or add it to your PATH.")
          : error,
      );
    });
    child.on("close", (code) => {
      exit = code;
      settle();
    });
  });
}

/**
 * Packs manifest.json, tables/ and files/ of a staging folder into a .tar.gz.
 * @param {string} stagingDir @param {string} archivePath
 */
export async function createArchive(stagingDir, archivePath) {
  await runTar(["-czf", "-", "manifest.json", "tables", "files"], stagingDir, { output: path.resolve(archivePath) });
}

/**
 * The archive's entries (name and type), read without extracting anything.
 * @param {string} archivePath
 */
export async function listArchive(archivePath) {
  const input = path.resolve(archivePath);
  const names = (await runTar(["-tzf", "-"], path.dirname(input), { input })).split("\n").filter((line) => line.length > 0);
  const verbose = await runTar(["-tzvf", "-"], path.dirname(input), { input });
  return pairTypes(verbose, names);
}

/**
 * Extracts an archive into an empty folder that already exists.
 * @param {string} archivePath @param {string} destination
 */
export async function extractArchive(archivePath, destination) {
  await runTar(["-xzf", "-"], destination, { input: path.resolve(archivePath) });
}

/**
 * Walks an extracted folder and checks what is really on disk (not what the listing said): only plain files and
 * folders, every name accepted by classifyEntry. Returns the table files and stored files found.
 * @param {string} root
 * @param {Set<string>} knownTables
 * @returns {Promise<{ problems: string[]; files: { key: string; path: string; size: number }[]; tables: string[]; hasManifest: boolean }>}
 */
export async function inspectExtracted(root, knownTables) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ key: string; path: string; size: number }[]} */
  const files = [];
  /** @type {string[]} */
  const tables = [];
  let hasManifest = false;
  /** @param {string} directory @param {string} prefix */
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const full = path.join(directory, entry.name);
      const stats = await lstat(full);
      if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory()) || (stats.isFile() && stats.nlink > 1)) {
        problems.push(`${JSON.stringify(relative)}: a link or special file`);
        continue;
      }
      const classified = classifyEntry(stats.isDirectory() ? `${relative}/` : relative);
      if (classified.kind === "refused") problems.push(`${JSON.stringify(relative)}: ${classified.reason}`);
      else if (classified.kind === "manifest") hasManifest = true;
      else if (classified.kind === "table") {
        if (knownTables.has(classified.table)) tables.push(classified.table);
        else problems.push(`${JSON.stringify(relative)}: not a table of this TechTeam`);
      } else if (classified.kind === "file") files.push({ key: classified.key, path: full, size: stats.size });
      if (stats.isDirectory()) await walk(full, `${relative}/`);
    }
  }
  await walk(root, "");
  return { problems, files, tables, hasManifest };
}

