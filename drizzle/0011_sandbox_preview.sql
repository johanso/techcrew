ALTER TABLE "agent_run_steps" ADD COLUMN "screenshot_key" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "sandbox_preview" boolean DEFAULT false NOT NULL;