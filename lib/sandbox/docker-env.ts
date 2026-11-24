/**
 * The environment the docker CLI is spawned with: only what it needs, never the app's secrets. Pure.
 * Remote: exactly what the CLI got before local mode existed (PATH, HOME and DOCKER_HOST for ssh:// hosts).
 * Local: the engine is found through the default context (named pipe or socket), so DOCKER_HOST is never set, and a
 * DOCKER_HOST in the app's own environment is not passed on either (it could point at an unprepared remote engine).
 */

const WINDOWS_NAMES = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "TEMP",
  "TMP",
  "HOME",
];
const POSIX_NAMES = ["PATH", "HOME", "USER", "XDG_RUNTIME_DIR", "TMPDIR"];
// Which context or config folder to use: the owner's own choice for their local Docker.
const DOCKER_NAMES = ["DOCKER_CONFIG", "DOCKER_CONTEXT"];

export function dockerCliEnv(input: { host: string | null; env: Record<string, string | undefined>; platform: string }): Record<string, string | undefined> {
  if (input.host) {
    return { NODE_ENV: input.env.NODE_ENV, PATH: input.env.PATH ?? "", HOME: input.env.HOME ?? "", DOCKER_HOST: input.host };
  }
  const byLowerName = new Map(Object.entries(input.env).map(([name, value]) => [name.toLowerCase(), value]));
  const out: Record<string, string> = {};
  for (const name of [...(input.platform === "win32" ? WINDOWS_NAMES : POSIX_NAMES), ...DOCKER_NAMES]) {
    const value = byLowerName.get(name.toLowerCase());
    if (value) out[name] = value;
  }
  return out;
}
