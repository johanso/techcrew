import { SKILL_SCAN_SEVERITIES, type SkillScanFinding, type SkillScanSeverity } from "@/lib/agent-skills-config";

/**
 * Deterministic security rules for uploaded skills. A skill's text goes into agent prompts, so anything that tries
 * to steer an agent away from its operating rules is a finding: prompt-injection phrases, credentials, pushing to the
 * default branch, disabling tests or CI, sending data or secrets to URLs, encoded blobs and hidden instructions.
 * Critical findings block the install. Pure and free; lib/agent-skills.ts adds an optional AI review.
 */

type Rule = {
  id: string;
  severity: SkillScanSeverity;
  title: string;
  detail: string;
  /** Matched line by line; the first matching line of each file is reported. */
  test: (line: string) => boolean;
  /** A line that forbids the thing ("Never push to main") is a guardrail, not a finding. */
  negatable?: boolean;
};

const NEGATION = /\b(never|do not|don't|must not|mustn't|no(?!-)|without|avoid|refuse)\b/i;

const INJECTION =
  /\b(ignore|disregard|forget|override|bypass)\b[^\n]{0,40}\b(previous|prior|above|earlier|system|operating|all (the )?other)\b[^\n]{0,20}\b(instructions?|rules|prompts?|protocol|guidelines)\b|\byou are no longer\b|\b(reveal|print|output|repeat) (your|the) (system prompt|instructions)\b|\bnew (system )?instructions:\s/i;
const CREDENTIAL =
  /(sk-(ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const PUSH_DEFAULT = /\b(push|commit|merge)(ed|ing)? (directly |straight )?(to|into|on(to)?) (the )?(main|master|default|production) branch\b|\b(push|commit)(ed|ing)? (directly )?(to|into) (main|master)\b|\bforce[- ]?push/i;
const SKIP_CHECKS = /\b(disable|skip|bypass|delete|remove|comment out|turn off)\b[^\n]{0,20}\b(tests?|ci|checks|linters?|lint|hooks|reviews?|branch protection)\b|--no-verify\b/i;
const SECRET_WORD = /\b(secrets?|tokens?|api[ _-]?keys?|credentials?|passwords?|env(ironment)? variables?|\.env\b|private keys?|cookies?|session ids?)/i;
const SEND_WORD = /\b(send|post|upload|transmit|forward|exfiltrate|leak|curl|wget|fetch|beacon|webhook|email)\b/i;
const URL = /\bhttps?:\/\/[^\s)>"']+|\bwebhook\b/i;
const SEND_TO_URL = /\b(send|post|upload|transmit|forward|report|submit)\b[^\n]{0,80}\bto\b[^\n]{0,20}(https?:\/\/|\bwebhook\b|\ban? (external|remote|third[- ]party) (server|endpoint|url|service)\b)/i;
const PIPE_SHELL = /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i;
const BLOB = /[A-Za-z0-9+/]{400,}={0,2}/;
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const COMMENT = /<!--([\s\S]*?)-->/g;
const IMPERATIVE = /\b(ignore|disregard|you (must|should|are)|always|never|instead|do not|don't|system|assistant|agent|instructions?|secret|token|push|merge|delete)\b/i;

const RULES: Rule[] = [
  {
    id: "prompt-injection",
    severity: "critical",
    title: "Prompt-injection phrase",
    detail: "The skill tells the agent to ignore or override its instructions. Skills are reference material and must never change an agent's rules.",
    test: (line) => INJECTION.test(line),
  },
  {
    id: "credential",
    severity: "critical",
    title: "Looks like a credential",
    detail: "The skill contains what looks like an API key, token or private key. It would be sent to the model on every read. Remove it and rotate the key.",
    test: (line) => CREDENTIAL.test(line),
  },
  {
    id: "exfiltrate-secrets",
    severity: "critical",
    title: "Sends secrets somewhere",
    detail: "The skill asks the agent to send secrets, tokens or environment variables out (to a URL, webhook or email).",
    test: (line) => /\bexfiltrat/i.test(line) || (SECRET_WORD.test(line) && SEND_WORD.test(line) && URL.test(line)),
    negatable: true,
  },
  {
    id: "push-default-branch",
    severity: "high",
    title: "Pushes to the default branch",
    detail: "The skill tells the agent to push or merge straight to the default branch. Agents work on their own branch and go through a pull request.",
    test: (line) => PUSH_DEFAULT.test(line),
    negatable: true,
  },
  {
    id: "skip-checks",
    severity: "high",
    title: "Disables tests or CI",
    detail: "The skill tells the agent to skip, disable or delete tests, CI, hooks or reviews: the safety net that catches its mistakes.",
    test: (line) => SKIP_CHECKS.test(line),
    negatable: true,
  },
  {
    id: "send-to-url",
    severity: "high",
    title: "Sends data to a URL",
    detail: "The skill tells the agent to send or upload data to an external URL or service.",
    test: (line) => SEND_TO_URL.test(line),
    negatable: true,
  },
  {
    id: "pipe-to-shell",
    severity: "high",
    title: "Runs a downloaded script",
    detail: "The skill pipes a download into a shell (curl … | sh). TechTeam agents can't run commands, and this pattern runs unreviewed code.",
    test: (line) => PIPE_SHELL.test(line),
  },
  {
    id: "hidden-characters",
    severity: "high",
    title: "Invisible characters",
    detail: "The skill contains zero-width or text-direction characters, which can hide instructions from a human reviewer.",
    test: (line) => HIDDEN_CHARS.test(line),
  },
  {
    id: "encoded-blob",
    severity: "medium",
    title: "Large encoded blob",
    detail: "The skill contains a long base64-like string. Encoded content can't be reviewed and may hide instructions or data.",
    test: (line) => BLOB.test(line),
  },
];

/** Hidden HTML comments that read like instructions (a reviewer reading the rendered markdown never sees them). */
function hiddenCommentLines(text: string) {
  const lines: number[] = [];
  for (const match of text.matchAll(COMMENT)) {
    const body = match[1] ?? "";
    if (body.trim().length >= 20 && IMPERATIVE.test(body)) lines.push(text.slice(0, match.index).split("\n").length);
  }
  return lines;
}

const MAX_FINDINGS = 25;

/** Every rule's first hit per file, worst first. */
export function scanSkillFiles(files: { path: string; content: string }[]): SkillScanFinding[] {
  const findings: SkillScanFinding[] = [];
  for (const file of files) {
    const lines = file.content.replace(/\r\n?/g, "\n").split("\n");
    for (const rule of RULES) {
      const index = lines.findIndex((line) => rule.test(line) && !(rule.negatable && NEGATION.test(line)));
      if (index === -1) continue;
      findings.push({ id: `${rule.id}:${file.path}`, severity: rule.severity, title: rule.title, detail: rule.detail, path: `${file.path}:${index + 1}`, source: "rules" });
    }
    const [comment] = hiddenCommentLines(file.content);
    if (comment) {
      findings.push({
        id: `hidden-comment:${file.path}`,
        severity: "high",
        title: "Hidden instructions in an HTML comment",
        detail: "An HTML comment (invisible when the markdown is rendered) contains instruction-like text aimed at the agent.",
        path: `${file.path}:${comment}`,
        source: "rules",
      });
    }
  }
  return sortSkillFindings(findings).slice(0, MAX_FINDINGS);
}

export function sortSkillFindings(findings: SkillScanFinding[]) {
  return [...findings].sort((a, b) => SKILL_SCAN_SEVERITIES.indexOf(a.severity) - SKILL_SCAN_SEVERITIES.indexOf(b.severity));
}
