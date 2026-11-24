ALTER TABLE "ai_provider_keys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "switch_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trust_scans" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_provider_keys" CASCADE;--> statement-breakpoint
DROP TABLE "switch_connections" CASCADE;--> statement-breakpoint
DROP TABLE "trust_scans" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_auth_user_id_unique";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "switch_agent_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "auth_user_id";--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "ai_provider";