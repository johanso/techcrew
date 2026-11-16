import { SKILL_SCAN_SEVERITIES, type SkillScanFinding, type SkillScanSeverity } from "@/lib/agent-skills-config";
import { cn } from "@/lib/utils";

const SEVERITY: Record<SkillScanSeverity, { label: string; dot: string }> = {
  critical: { label: "Critical", dot: "bg-error" },
  high: { label: "High", dot: "bg-warning" },
  medium: { label: "Medium", dot: "bg-action" },
  low: { label: "Low", dot: "bg-muted-foreground" },
};

/** A skill's scan findings, worst first: severity (dot + word), title, where, and the detail. */
export function SkillFindings({ findings, className }: { findings: SkillScanFinding[]; className?: string }) {
  const sorted = [...findings].sort((a, b) => SKILL_SCAN_SEVERITIES.indexOf(a.severity) - SKILL_SCAN_SEVERITIES.indexOf(b.severity));
  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {sorted.map((finding) => (
        <li key={`${finding.source}-${finding.id}`} className="flex min-w-0 gap-2.5 text-xs">
          <span aria-hidden className={cn("mt-1 size-2 shrink-0 rounded-full", SEVERITY[finding.severity].dot)} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-foreground">
              {SEVERITY[finding.severity].label} · {finding.title}
              {finding.source === "ai" && <span className="font-normal text-muted-foreground"> (AI review)</span>}
            </span>
            {finding.path && <span className="truncate font-mono text-muted-foreground">{finding.path}</span>}
            <span className="text-muted-foreground">{finding.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
