// Two jobs, picked by the input's `mode` (one JSON object on stdin, already validated by the app; nothing from it is
// ever passed to a shell; one JSON line out on stdout):
// - "browse" (the default; browse_preview): opens one page of a run's preview, runs the steps in order and reports
//   what it saw (RunnerInput / RunnerOutput in lib/sandbox/browser-config.ts). The container has no internet (it only
//   joins the preview's internal network); requests to any other origin are aborted here too, so they fail fast.
// - "capture" (a link reference): capture.mjs, with internet but only to public addresses.
import { chromium } from "playwright-core";

import { capture } from "./capture.mjs";

// Kept in step with BROWSE_VIEWPORTS in lib/sandbox/browser-config.ts.
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  tablet: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};
const STEP_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500;
const LIST_MAX = 50;
const ENTRY_MAX = 500;
const OUTLINE_MAX = 20_000;

// Why each flag is here: "Chromium under gVisor" in lib/sandbox/browser-config.ts.
const CHROMIUM_ARGS = ["--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-breakpad"];

const clip = (value, max = ENTRY_MAX) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

// Playwright errors end with a long call log; the first lines say what went wrong.
const errorText = (error) =>
  clip(
    String(error instanceof Error ? error.message : error)
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, 4)
      .join("\n"),
    600
  );

// Resolves once the line is handed to the pipe: process.exit right after a plain write can cut a large line short.
const writeLine = (value) => new Promise((resolve) => process.stdout.write(`${JSON.stringify(value)}\n`, () => resolve()));

async function readInput() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

async function main() {
  const input = await readInput();
  if (input.mode === "capture") {
    await writeLine(await capture(input, CHROMIUM_ARGS));
    return;
  }
  const base = new URL(input.baseUrl);
  const deadline = Date.now() + input.timeoutMs;
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === base.origin;
    } catch {
      return false;
    }
  };
  const relative = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
    } catch {
      return clip(url, 200);
    }
  };

  const out = {
    url: null,
    title: null,
    status: null,
    opened: false,
    openError: null,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    steps: [],
    outline: null,
    screenshot: null,
    timedOut: false,
  };
  const push = (list, entry) => {
    if (list.length < LIST_MAX) list.push(clip(entry));
  };

  // Chromium's own sandbox on: under gVisor its renderers get their own user and PID namespaces even without
  // capabilities, so a renderer exploit still lands inside a second sandbox before the container's.
  // TECHTEAM_CHROMIUM_NO_SANDBOX=1 (local Docker only, lib/sandbox/docker-args.ts): the default runtime's seccomp profile
  // refuses the namespaces Chromium's sandbox needs once capabilities are dropped, so the container is the boundary.
  const chromiumSandbox = process.env.TECHTEAM_CHROMIUM_NO_SANDBOX !== "1";
  const browser = await chromium.launch({ args: CHROMIUM_ARGS, chromiumSandbox, timeout: 30_000 });
  try {
    const context = await browser.newContext({
      ...(Object.hasOwn(VIEWPORTS, input.viewport) ? VIEWPORTS[input.viewport] : VIEWPORTS.desktop),
      // prefers-color-scheme for the page's CSS and matchMedia.
      colorScheme: input.colorScheme === "dark" ? "dark" : "light",
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", (route) => (sameOrigin(route.request().url()) ? route.continue() : route.abort("blockedbyclient")));
    await context.routeWebSocket(/.*/, (socket) => (sameOrigin(socket.url().replace(/^ws/, "http")) ? socket.connectToServer() : socket.close()));
    const page = await context.newPage();
    // Popups and new tabs would escape the report: close them.
    context.on("page", (other) => {
      if (other !== page) void other.close().catch(() => undefined);
    });

    page.on("console", (message) => {
      // Requests blocked here already show under failed requests; Chromium also logs each one as a console error.
      if (message.type() === "error" && !message.text().includes("net::ERR_BLOCKED_BY_CLIENT")) push(out.consoleErrors, message.text());
    });
    page.on("pageerror", (error) => push(out.pageErrors, error.message));
    page.on("response", (response) => {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) out.status = response.status();
      if (response.status() >= 400) push(out.failedRequests, `${request.method()} ${relative(response.url())} → ${response.status()}`);
    });
    page.on("requestfailed", (request) => {
      const reason = sameOrigin(request.url()) ? (request.failure()?.errorText ?? "failed") : "blocked: outside the preview (no internet here)";
      push(out.failedRequests, `${request.method()} ${relative(request.url())} → ${reason}`);
    });

    const remaining = () => deadline - Date.now();
    const settle = () => page.waitForLoadState("networkidle", { timeout: Math.max(1, Math.min(SETTLE_MS, remaining())) }).catch(() => undefined);
    const open = async (path) => {
      const url = new URL(path, base);
      if (url.origin !== base.origin) throw new Error("Only paths on the preview can be opened.");
      await page.goto(url.href, { waitUntil: "load", timeout: Math.max(1, Math.min(NAVIGATION_TIMEOUT_MS, remaining())) });
    };
    const locate = (step) => {
      if (step.selector) return page.locator(step.selector);
      if (step.role) return page.getByRole(step.role, step.name ? { name: step.name } : {});
      if (step.text) return page.getByText(step.text);
      throw new Error("The step names no element.");
    };

    try {
      await open(input.path);
      out.opened = true;
      await settle();
    } catch (error) {
      out.openError = errorText(error);
    }

    if (out.opened) {
      for (const step of input.steps) {
        const timeout = Math.min(STEP_TIMEOUT_MS, remaining());
        if (timeout < 500) {
          out.timedOut = true;
          out.steps.push({ ok: false, error: "Out of time before this step." });
          break;
        }
        try {
          if (step.action === "click") await locate(step).click({ timeout });
          else if (step.action === "fill") await locate(step).fill(step.value ?? "", { timeout });
          else if (step.action === "press") {
            if (step.selector || step.role || step.text) await locate(step).press(step.value, { timeout });
            else await page.keyboard.press(step.value);
          } else if (step.action === "wait_for") await locate(step).first().waitFor({ state: "visible", timeout });
          else if (step.action === "goto") await open(step.value);
          else throw new Error(`Unknown action ${step.action}.`);
          await settle();
          out.steps.push({ ok: true, error: null });
        } catch (error) {
          out.steps.push({ ok: false, error: errorText(error) });
          break;
        }
      }
    }

    out.url = relative(page.url());
    out.title = clip(await page.title().catch(() => ""), 300);
    out.outline = await page
      .locator("body")
      .ariaSnapshot({ timeout: 5_000 })
      .catch(() => page.locator("body").innerText({ timeout: 3_000 }))
      .catch(() => null);
    if (out.outline) out.outline = clip(out.outline, OUTLINE_MAX);
    const png = await page.screenshot({ type: "png", timeout: 10_000, animations: "disabled", caret: "hide" }).catch(() => null);
    out.screenshot = png ? png.toString("base64") : null;
  } finally {
    await writeLine(out);
    // Closing can hang on a wedged renderer; the container is thrown away anyway.
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`[techteam-browser] ${errorText(error)}\n`);
    process.exit(1);
  });
