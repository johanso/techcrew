import {
  BotIcon,
  BoxesIcon,
  BrainCircuitIcon,
  BriefcaseIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  GlobeIcon,
  LayersIcon,
  LightbulbIcon,
  PaletteIcon,
  RocketIcon,
  ShieldIcon,
  SparklesIcon,
  TerminalIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

/** Icons a workspace can use instead of an uploaded logo. The key is what gets stored. */
export const WORKSPACE_ICONS = {
  rocket: RocketIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  bot: BotIcon,
  brain: BrainCircuitIcon,
  cpu: CpuIcon,
  zap: ZapIcon,
  sparkles: SparklesIcon,
  layers: LayersIcon,
  boxes: BoxesIcon,
  database: DatabaseIcon,
  globe: GlobeIcon,
  shield: ShieldIcon,
  palette: PaletteIcon,
  lightbulb: LightbulbIcon,
  briefcase: BriefcaseIcon,
} satisfies Record<string, LucideIcon>;

export type WorkspaceIconKey = keyof typeof WORKSPACE_ICONS;

export const DEFAULT_WORKSPACE_ICON: WorkspaceIconKey = "rocket";

export function isWorkspaceIcon(value: unknown): value is WorkspaceIconKey {
  return typeof value === "string" && Object.hasOwn(WORKSPACE_ICONS, value);
}
