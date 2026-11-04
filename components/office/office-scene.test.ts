import { describe, expect, it } from "vitest";

import { OFFICE, pctX, pctY, seatFor } from "@/components/office/office-scene";
import { AGENT_KEYS } from "@/lib/agent-config";

describe("live office scene", () => {
  it("gives every agent its own desk with a sprite", () => {
    const seats = AGENT_KEYS.map((key) => seatFor(key));
    expect(new Set(seats.map((s) => s.id)).size).toBe(AGENT_KEYS.length);
    for (const seat of seats) {
      expect(seat.sprite).toMatch(/^\/office\/.+\.webp$/);
      expect(seat.frames).toBeGreaterThan(1);
    }
  });

  it("keeps every seat inside the picture", () => {
    for (const seat of OFFICE.seats) {
      expect(seat.x + seat.width).toBeLessThanOrEqual(OFFICE.width);
      expect(seat.y + seat.height).toBeLessThanOrEqual(OFFICE.height);
      expect(seat.head.x).toBeGreaterThan(0);
      expect(seat.head.x).toBeLessThan(1);
    }
  });

  it("converts picture pixels to percentages", () => {
    expect(pctX(OFFICE.width / 2)).toBe("50%");
    expect(pctY(0)).toBe("0%");
  });
});
