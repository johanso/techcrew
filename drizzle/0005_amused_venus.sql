ALTER TABLE "agent_runs" ADD COLUMN "security_report" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "approval" jsonb;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "risk" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "agent_merge_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Keep the v0.1 behavior: workspaces that merged automatically keep merging automatically (any risk).
UPDATE "workspaces" SET "agent_merge_mode" = 'auto' WHERE "agent_auto_merge" = true;