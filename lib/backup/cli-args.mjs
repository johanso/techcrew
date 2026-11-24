// The command lines of `npm run backup` and `npm run restore`. Pure.

/**
 * @param {string[]} argv
 * @returns {{ help: boolean; yes: boolean; withS3: boolean; out: string | null; positional: string[] }}
 */
export function parseArgs(argv) {
  const result = { help: false, yes: false, withS3: false, out: null, positional: /** @type {string[]} */ ([]) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--yes" || arg === "-y") result.yes = true;
    else if (arg === "--with-s3") result.withS3 = true;
    else if (arg === "--out" || arg === "-o") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--out needs a file name.");
      result.out = value;
      i += 1;
    } else if (arg.startsWith("--out=")) result.out = arg.slice("--out=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}. Try --help.`);
    else result.positional.push(arg);
  }
  return result;
}
