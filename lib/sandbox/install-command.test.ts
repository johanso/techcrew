import { describe, expect, it } from "vitest";

import { localInstallCommand } from "@/lib/sandbox/install-command";

const off = (command: string) => localInstallCommand(command, false);

describe("localInstallCommand", () => {
  it("adds --ignore-scripts to the installs detectCommands produces", () => {
    expect(off("npm ci")).toBe("npm ci --ignore-scripts");
    expect(off("npm install")).toBe("npm install --ignore-scripts");
    expect(off("npx --yes pnpm install --frozen-lockfile")).toBe("npx --yes pnpm install --frozen-lockfile --ignore-scripts");
    expect(off("npx --yes yarn install --frozen-lockfile")).toBe("npx --yes yarn install --frozen-lockfile --ignore-scripts");
  });

  it("knows the short and other installing subcommands", () => {
    expect(off("npm i")).toBe("npm i --ignore-scripts");
    expect(off("npm add left-pad")).toBe("npm add left-pad --ignore-scripts");
    expect(off("npm clean-install")).toBe("npm clean-install --ignore-scripts");
    expect(off("pnpm i --frozen-lockfile")).toBe("pnpm i --frozen-lockfile --ignore-scripts");
    expect(off("pnpm add zod")).toBe("pnpm add zod --ignore-scripts");
    expect(off("yarn")).toBe("yarn --ignore-scripts");
    expect(off("yarn --frozen-lockfile")).toBe("yarn --frozen-lockfile --ignore-scripts");
    expect(off("yarn add zod")).toBe("yarn add zod --ignore-scripts");
    expect(off("corepack yarn install")).toBe("corepack yarn install --ignore-scripts");
  });

  it("rewrites every install in a chain and keeps the separators and the rest", () => {
    expect(off("npm ci && npm run build")).toBe("npm ci --ignore-scripts && npm run build");
    expect(off("cd web && npm ci")).toBe("cd web && npm ci --ignore-scripts");
    expect(off("npm ci; npm ci || npm install")).toBe("npm ci --ignore-scripts; npm ci --ignore-scripts || npm install --ignore-scripts");
    expect(off("npm ci | tee log.txt")).toBe("npm ci --ignore-scripts | tee log.txt");
    expect(off("npm ci\nnpm run lint")).toBe("npm ci --ignore-scripts\nnpm run lint");
    expect(off("npm ci 2>&1")).toBe("npm ci 2>&1 --ignore-scripts");
  });

  it("looks past environment prefixes", () => {
    expect(off("CI=1 npm ci")).toBe("CI=1 npm ci --ignore-scripts");
    expect(off("NODE_ENV=development HUSKY=0 pnpm install")).toBe("NODE_ENV=development HUSKY=0 pnpm install --ignore-scripts");
  });

  it("leaves a command that already has the flag alone", () => {
    expect(off("npm ci --ignore-scripts")).toBe("npm ci --ignore-scripts");
    expect(off("npm ci --ignore-scripts=true")).toBe("npm ci --ignore-scripts=true");
    expect(off("npm install --ignore-scripts && npm run build")).toBe("npm install --ignore-scripts && npm run build");
  });

  it("turns an explicit scripts-on flag back off: only the Settings checkbox allows scripts", () => {
    expect(off("npm ci --no-ignore-scripts")).toBe("npm ci --ignore-scripts");
    expect(off("npm ci --ignore-scripts=false")).toBe("npm ci --ignore-scripts");
  });

  it("leaves other commands untouched", () => {
    for (const command of ["npm test", "npm run build", "npm run setup", "node --version", "make install", "pip install -r requirements.txt", "echo npm ci", "npmx ci", "ls && pwd", ""]) {
      expect(off(command)).toBe(command);
    }
  });

  it("keeps surrounding whitespace", () => {
    expect(off("  npm ci  ")).toBe("  npm ci --ignore-scripts  ");
  });

  it("changes nothing when the owner allowed install scripts", () => {
    for (const command of ["npm ci", "npm ci --no-ignore-scripts", "pnpm install && pnpm build"]) {
      expect(localInstallCommand(command, true)).toBe(command);
    }
  });

  it("is idempotent", () => {
    for (const command of ["npm ci", "yarn", "cd a && npm i && pnpm add x", "npm ci --no-ignore-scripts"]) {
      expect(off(off(command))).toBe(off(command));
    }
  });
});
