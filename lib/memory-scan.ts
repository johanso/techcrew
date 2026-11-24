import type { SkillScanFinding, SkillScanSeverity } from "@/lib/agent-skills-config";
import { BLOB, COMMENT, CREDENTIAL, HIDDEN_CHARS, IMPERATIVE, INJECTION, NEGATION, PIPE_SHELL, PUSH_DEFAULT, SKIP_CHECKS, sortSkillFindings } from "@/lib/skill-scan";

/**
 * Deterministic security rules for a Brain note. A note's text goes into every agent's prompt, so anything that tries
 * to steer an agent away from its operating rules is a finding: prompt-injection phrases, claims of authority,
 * commands to run, requests for secrets or for more permissions, credentials, links outside a small allowlist and
 * characters a reviewer can't see. A critical finding blocks saving (and a note already stored is skipped at load);
 * the rest are shown and allowed. Shares its patterns with the skill scanner (lib/skill-scan.ts). Pure and free.
 */

/** Hosts a note may link to. Anything else is a critical finding unless the caller passes its own list. */
export const MEMORY_ALLOWED_HOSTS = ["github.com", "docs.github.com"];

// Loopback addresses name a local dev server in a command ("open http://localhost:3000"): they reach nothing outside.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type MemoryScanFinding = SkillScanFinding;

type Rule = {
  id: string;
  severity: SkillScanSeverity;
  title: string;
  detail: string;
  /** Index of the first match in the line, or -1. */
  find: (line: string) => number;
  /** A line that forbids the thing ("Never commit secrets") is a guardrail, not a finding: a negation before the match. */
  negatable?: boolean;
};

const at = (pattern: RegExp) => (line: string) => line.search(pattern);

const INJECTION_MORE = [
  /\b(forget|ignore|disregard)\b[^\n]{0,30}\b(everything|anything|all)\b[^\n]{0,30}\b(told|said|above|before|instructed|learned)\b/i,
  /\byou are (now|actually|really)\b[^\n]{0,40}\b(an? |the )?(unrestricted|jailbroken|root|admin|administrator|developer mode|dan)\b/i,
  /\b(pretend|act|behave)\b[^\n]{0,15}\b(to be|as (if )?(you (are|were)|an?|the))\b[^\n]{0,40}\b(unrestricted|no (rules|restrictions|limits)|admin|administrator|root|system)\b/i,
  /\b(developer|god|jailbreak|sudo|admin) mode\b|\bjailbreak\b/i,
  /\bfrom now on\b[^\n]{0,30}\b(you|ignore|always|never|do not|don't)\b/i,
  /<\|?(im_start|im_end|system|endoftext)\|?>|\[\/?INST\]|<<\/?SYS>>/i,
  /^\s*[[<#*_]*(system|admin(istrator)?|root|developer|assistant)(\s+(message|prompt|note|override|instruction))?[\]>*_]*\s*:/i,
  /\b(this|the following) (message|note|text|instruction)s? (is|are|comes?) (from|by) (the )?(system|admin|administrator|developer|owner|operator|anthropic|openai|techteam)\b/i,
  /\b(i am|i'm|this is) (the )?(system|admin|administrator|operator|developer of this)\b|\bauthorized (by|from) (the )?(admin|administrator|owner|operator|security team|techteam)\b/i,
  /\b(operating )?protocol\b[^\n]{0,30}\b(does(n't| not) apply|is (void|disabled|suspended|overridden|obsolete)|no longer applies)\b/i,
  /<\/?(memory|task|skill|system|assistant)\b/i,
];

const SECRET_WORD = /\b(secrets?|api[ _-]?keys?|(access|auth(entication)?|bearer|oauth|github|personal access|refresh|session) tokens?|private keys?|ssh keys?|credentials?|passwords?|passphrases?|\.env\b|env(ironment)? variables?|session (ids?|cookies?))\b/i;
const SECRET_VERB = /\b(print|reveal|show|send|share|output|echo|upload|post|paste|expose|leak|exfiltrate|display|dump|disclose|tell|email|forward)\b/i;
const SECRET_READ = /\b(cat|type|less|head|tail)\s+\S*\.env\b|\bprintenv\b|\becho\s+\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)/i;
const CONNECTION_STRING = /\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|amqps?|mssql):\/\/[^\s:@/]+:[^\s@]+@/i;
const ASSIGNED_SECRET = /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|auth)\w*\s*[:=]\s*["']?[A-Za-z0-9/+_.=-]{16,}/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;
const PERMISSION_GRANT = /\b(grant|give|enable|allow|add|unlock|expand)\b[^\n]{0,30}\b(yourself|you|agents?|the agent)\b[^\n]{0,30}\b(permissions?|tools?|access|write access|admin|privileges?)\b/i;
const PROTOCOL_CHANGE = /\b(ignore|skip|disable|bypass|override|change|modify|turn off|relax|lift|remove)\b[^\n]{0,25}\b(the )?(protocol|permissions?|guardrails?|restrictions?|safety|safeguards?|boundaries|operating rules)\b/i;
const SKIP_REVIEW = /\b(without|skip|bypass|no need for)\b[^\n]{0,15}\b(asking|review|approval|human|permission|confirmation)\b[^\n]{0,30}\b(merge|push|deploy|publish|delete|run|execute|commit)\b|\b(auto[- ]?merge|merge)\b[^\n]{0,20}\bwithout\b[^\n]{0,15}\b(review|approval|checks)\b/i;
const DESTRUCTIVE = /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\b|\brm\s+-[a-z]*f[a-z]*r\b|\bdrop\s+(table|database)\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bformat\s+c:/i;
const EVAL = /\beval\s*\(|\beval\s+["'$`]|\bexec\s*\(\s*["'`]|\bnew Function\s*\(|\bpowershell(\.exe)?\s+-e(nc|ncodedcommand)?\b|\bbase64\s+(-d|--decode)\b[^\n]*\|\s*(ba|z)?sh\b|\bchmod\s+(-R\s+)?[0-7]*777\b|\bsudo\b/i;
const URL_PATTERN = /\b(?:https?|ftp|wss?):\/\/[^\s)>\]"'`]+|\b(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s)>\]"'`]*/gi;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/;
const RAW_HTML = /<\/?(script|iframe|object|embed|style|form|link|meta|img|svg|a)\b/i;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/;

function negated(line: string, index: number) {
  return NEGATION.test(line.slice(Math.max(0, index - 60), index + 1));
}

/** A line's findings from the pattern rules (the allowlist and hidden-comment rules need the whole text). */
const RULES: Rule[] = [
  {
    id: "prompt-injection",
    severity: "critical",
    title: "Prompt-injection phrase",
    detail: "The note tells the agent to ignore or override its instructions, claims authority, or imitates a system message. A note is reference data and must never steer an agent.",
    find: (line) => {
      const indexes = [at(INJECTION)(line), ...INJECTION_MORE.map((pattern) => at(pattern)(line))].filter((i) => i >= 0);
      return indexes.length ? Math.min(...indexes) : -1;
    },
  },
  {
    id: "credential",
    severity: "critical",
    title: "Looks like a credential",
    detail: "The note contains what looks like an API key, token, private key, password or connection string. It would be sent to the model on every run. Remove it and rotate the key.",
    find: (line) => {
      const indexes = [at(CREDENTIAL)(line), at(CONNECTION_STRING)(line), at(ASSIGNED_SECRET)(line), at(JWT)(line)].filter((i) => i >= 0);
      return indexes.length ? Math.min(...indexes) : -1;
    },
  },
  {
    id: "pipe-to-shell",
    severity: "critical",
    title: "Runs a downloaded script",
    detail: "The note pipes a download into a shell (curl … | sh). That runs unreviewed code.",
    find: at(PIPE_SHELL),
  },
  {
    id: "destructive-command",
    severity: "critical",
    title: "A destructive command",
    detail: "The note contains a command that deletes files or data (rm -rf, drop table …). Notes describe conventions; they are not scripts.",
    find: at(DESTRUCTIVE),
    negatable: true,
  },
  {
    id: "code-execution",
    severity: "critical",
    title: "Executes code or elevates privileges",
    detail: "The note asks for eval, a shell with elevated rights, encoded commands or world-writable permissions.",
    find: at(EVAL),
    negatable: true,
  },
  {
    id: "secret-request",
    severity: "critical",
    title: "Asks for secrets",
    detail: "The note tells the agent to read, print, send or store secrets, tokens, keys or environment variables.",
    find: (line) => {
      const read = line.search(SECRET_READ);
      if (read >= 0) return read;
      const secret = line.search(SECRET_WORD);
      const verb = line.search(SECRET_VERB);
      return secret >= 0 && verb >= 0 && Math.abs(secret - verb) <= 80 ? Math.min(secret, verb) : -1;
    },
    negatable: true,
  },
  {
    id: "permission-change",
    severity: "critical",
    title: "Asks for permissions or tools",
    detail: "The note tells the agent to grant itself permissions, tools or access, or to change the operating protocol. Only the owner configures that, in AI Team.",
    find: (line) => {
      const indexes = [at(PERMISSION_GRANT)(line), at(PROTOCOL_CHANGE)(line), at(SKIP_REVIEW)(line)].filter((i) => i >= 0);
      return indexes.length ? Math.min(...indexes) : -1;
    },
    negatable: true,
  },
  {
    id: "control-characters",
    severity: "critical",
    title: "Control or invisible characters",
    detail: "The note contains control, zero-width or text-direction characters, which can hide instructions from a person reading it.",
    find: (line) => {
      const indexes = [line.search(CONTROL_CHARS), line.search(HIDDEN_CHARS)].filter((i) => i >= 0);
      return indexes.length ? Math.min(...indexes) : -1;
    },
  },
  {
    id: "push-default-branch",
    severity: "high",
    title: "Pushes to the default branch",
    detail: "The note tells the agent to push or merge straight to the default branch. Agents work on their own branch and go through a pull request.",
    find: at(PUSH_DEFAULT),
    negatable: true,
  },
  {
    id: "skip-checks",
    severity: "high",
    title: "Disables tests or CI",
    detail: "The note tells the agent to skip, disable or delete tests, CI, hooks or reviews: the safety net that catches its mistakes.",
    find: at(SKIP_CHECKS),
    negatable: true,
  },
  {
    id: "raw-html",
    severity: "medium",
    title: "HTML in a note",
    detail: "Notes are plain Markdown. Tags such as script, iframe or img have no place in them.",
    find: at(RAW_HTML),
  },
  {
    id: "markdown-image",
    severity: "medium",
    title: "An image link",
    detail: "A Markdown image is fetched by whoever renders the note and can carry data in its address. Describe it in words instead.",
    find: at(MARKDOWN_IMAGE),
  },
  {
    id: "encoded-blob",
    severity: "medium",
    title: "Large encoded blob",
    detail: "The note contains a long base64-like string. Encoded content can't be reviewed. Notes are short summaries.",
    find: at(BLOB),
  },
];

function hostOf(url: string) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hidden HTML comments that read like instructions (nobody reading the rendered note sees them). */
function hiddenComment(text: string) {
  for (const match of text.matchAll(COMMENT)) {
    const body = match[1] ?? "";
    if (body.trim().length >= 12 && IMPERATIVE.test(body)) return text.slice(0, match.index).split("\n").length;
  }
  return 0;
}

const MAX_FINDINGS = 25;

/**
 * Every rule's first hit per field, worst first. `allowedHosts` replaces the default link allowlist. A finding's `path`
 * says where: `title` or `body:<line>`.
 */
export function scanMemoryNote(note: { title: string; body: string }, { allowedHosts = MEMORY_ALLOWED_HOSTS }: { allowedHosts?: readonly string[] } = {}): MemoryScanFinding[] {
  const findings: MemoryScanFinding[] = [];
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const fields: [string, string][] = [
    ["title", note.title],
    ["body", note.body],
  ];
  for (const [field, text] of fields) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const where = (line: number) => (field === "title" ? "title" : `body:${line + 1}`);
    for (const rule of RULES) {
      const line = lines.findIndex((candidate) => {
        const index = rule.find(candidate);
        return index >= 0 && !(rule.negatable && negated(candidate, index));
      });
      if (line === -1) continue;
      findings.push({ id: `${rule.id}:${field}`, severity: rule.severity, title: rule.title, detail: rule.detail, path: where(line), source: "rules" });
    }
    const offending = lines.flatMap((line, index) =>
      [...line.matchAll(URL_PATTERN)].flatMap((match) => {
        const host = hostOf(match[0]);
        return host && !allowed.has(host) && !LOOPBACK.has(host) ? [{ host, line: index }] : [];
      })
    );
    if (offending[0]) {
      findings.push({
        id: `url:${field}`,
        severity: "critical",
        title: "A link outside the allowlist",
        detail: `The note links to ${offending[0].host}. Notes may only link to ${[...allowed].join(", ")}: a link can carry data out and sends agents to content nobody reviewed. Describe the thing in words.`,
        path: where(offending[0].line),
        source: "rules",
      });
    }
    const comment = hiddenComment(text);
    if (comment) {
      findings.push({
        id: `hidden-comment:${field}`,
        severity: "critical",
        title: "Hidden instructions in an HTML comment",
        detail: "An HTML comment (invisible when the note is rendered) contains instruction-like text aimed at the agent.",
        path: where(comment - 1),
        source: "rules",
      });
    }
  }
  return sortSkillFindings(findings).slice(0, MAX_FINDINGS);
}

/** Whether a finding stops a note from being saved or loaded. */
export const blocksNote = (findings: readonly Pick<MemoryScanFinding, "severity">[]) => findings.some((finding) => finding.severity === "critical");
