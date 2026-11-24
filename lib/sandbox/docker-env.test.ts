import { describe, expect, it } from "vitest";

import { dockerCliEnv } from "@/lib/sandbox/docker-env";

// Fake secrets standing in for what the app's process holds: none may reach the docker CLI.
const SECRETS = {
  DATABASE_URL: "postgres://user:hunter2@db/app",
  TOKEN_ENCRYPTION_KEY: "fake-encryption-key-123",
  OPENAI_API_KEY: "sk-fake-openai",
  ANTHROPIC_API_KEY: "sk-ant-fake",
  GITHUB_CLIENT_SECRET: "fake-github-secret",
  S3_SECRET_ACCESS_KEY: "fake-s3-secret",
  DOCKER_HOST: "tcp://attacker.example:2375",
};

const windowsEnv = {
  Path: "C:\\Windows\\System32;C:\\Program Files\\Docker\\Docker\\resources\\bin",
  PATHEXT: ".COM;.EXE;.BAT",
  SystemRoot: "C:\\Windows",
  USERPROFILE: "C:\\Users\\me",
  APPDATA: "C:\\Users\\me\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  TEMP: "C:\\Temp",
  TMP: "C:\\Temp",
  HOME: "C:\\Users\\me",
  DOCKER_CONTEXT: "desktop-linux",
  ...SECRETS,
};

const posixEnv = { PATH: "/usr/bin:/bin", HOME: "/home/me", USER: "me", XDG_RUNTIME_DIR: "/run/user/1000", DOCKER_CONFIG: "/home/me/.docker", ...SECRETS };

describe("dockerCliEnv", () => {
  it("keeps remote exactly as it was: PATH, HOME, NODE_ENV and the host", () => {
    expect(dockerCliEnv({ host: "ssh://deploy@sandbox", env: { ...posixEnv, NODE_ENV: "production" }, platform: "linux" })).toEqual({
      NODE_ENV: "production",
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
      DOCKER_HOST: "ssh://deploy@sandbox",
    });
  });

  it("passes what Docker Desktop's CLI needs on Windows, whatever the case of the names", () => {
    const env = dockerCliEnv({ host: null, env: windowsEnv, platform: "win32" });
    expect(env).toMatchObject({
      PATH: windowsEnv.Path,
      PATHEXT: ".COM;.EXE;.BAT",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\me",
      APPDATA: windowsEnv.APPDATA,
      LOCALAPPDATA: windowsEnv.LOCALAPPDATA,
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
      HOME: "C:\\Users\\me",
      DOCKER_CONTEXT: "desktop-linux",
    });
  });

  it("passes the basics on POSIX", () => {
    expect(dockerCliEnv({ host: null, env: posixEnv, platform: "linux" })).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
      USER: "me",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DOCKER_CONFIG: "/home/me/.docker",
    });
  });

  it("never sets DOCKER_HOST in local mode, even when the app's own environment has one", () => {
    for (const [env, platform] of [[windowsEnv, "win32"], [posixEnv, "linux"], [posixEnv, "darwin"]] as const) {
      expect(dockerCliEnv({ host: null, env, platform })).not.toHaveProperty("DOCKER_HOST");
    }
  });

  it("never carries a secret, in either mode or platform", () => {
    const outputs = [
      dockerCliEnv({ host: null, env: windowsEnv, platform: "win32" }),
      dockerCliEnv({ host: null, env: posixEnv, platform: "linux" }),
      dockerCliEnv({ host: "ssh://u@h", env: posixEnv, platform: "linux" }),
      dockerCliEnv({ host: "ssh://u@h", env: windowsEnv, platform: "win32" }),
    ];
    for (const env of outputs) {
      const text = JSON.stringify(env);
      for (const [name, value] of Object.entries(SECRETS)) {
        if (name === "DOCKER_HOST") continue; // the remote host is the one allowed value, checked above
        expect(Object.keys(env)).not.toContain(name);
        expect(text).not.toContain(value);
      }
    }
  });

  it("skips names that aren't set", () => {
    expect(dockerCliEnv({ host: null, env: { PATH: "/bin" }, platform: "linux" })).toEqual({ PATH: "/bin" });
  });
});
