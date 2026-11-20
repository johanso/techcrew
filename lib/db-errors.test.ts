import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "@/lib/db-errors";

describe("isUniqueViolation", () => {
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint_name: "agent_runs_one_active_per_task" });

  it("recognizes the driver's error, also wrapped by Drizzle", () => {
    expect(isUniqueViolation(driverError, "agent_runs_one_active_per_task")).toBe(true);
    expect(isUniqueViolation(new Error("Failed query", { cause: driverError }), "agent_runs_one_active_per_task")).toBe(true);
  });

  it("ignores other constraints and other errors", () => {
    expect(isUniqueViolation(driverError, "cli_settings_user_machine_cli")).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "23503", constraint_name: "agent_runs_one_active_per_task" }), "agent_runs_one_active_per_task")).toBe(false);
    expect(isUniqueViolation(null, "agent_runs_one_active_per_task")).toBe(false);
  });
});
