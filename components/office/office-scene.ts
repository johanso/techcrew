import type { AgentKey } from "@/lib/agent-config";
import scene from "@/lib/office-scene.json";

/**
 * The office picture and its seats, generated from the scene bundle by `npm run office:assets`
 * (scripts/build-office-assets.mjs). Positions are in the picture's own pixels; the UI turns them into percentages.
 */
export const OFFICE = scene;
export type OfficeSeat = (typeof scene.seats)[number];

/** Which desk each agent sits at, matched to what's on its monitors. */
const AGENT_SEAT: Record<AgentKey, string> = {
  developer: "seat-mw1ziece", // back desk, code on both screens
  reviewer: "seat-mw1zisdp", // left desk, code on both screens
  tester: "seat-1", // right desk, results in green
  analyst: "seat-mw1zj9g6", // front desk, charts and dashboards
};

export function seatFor(agent: AgentKey): OfficeSeat {
  return OFFICE.seats.find((seat) => seat.id === AGENT_SEAT[agent])!;
}

/** Percent of the picture's width / height, so seats scale with the office at any size. */
export const pctX = (px: number) => `${(px / OFFICE.width) * 100}%`;
export const pctY = (px: number) => `${(px / OFFICE.height) * 100}%`;

/** Typing speed: the bundle doesn't set one; 8 frames per second reads as steady typing. */
export const TYPING_FPS = 8;
