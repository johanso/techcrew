ALTER TABLE "workspaces" ADD COLUMN "sandbox_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "sandbox_commands" jsonb;