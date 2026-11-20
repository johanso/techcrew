CREATE TABLE "cli_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"machine_id" text NOT NULL,
	"cli" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"on_limit" text,
	"confirmed_email" text,
	"confirmed_org" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cli_settings_user_machine_cli" UNIQUE("user_id","machine_id","cli")
);
--> statement-breakpoint
ALTER TABLE "agent_activity" ADD COLUMN "billing" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD COLUMN "equivalent_micros" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD COLUMN "tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "waiting" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cli_results" jsonb;--> statement-breakpoint
ALTER TABLE "cli_settings" ADD CONSTRAINT "cli_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_per_task" ON "agent_runs" USING btree ("task_id") WHERE "agent_runs"."status" in ('queued', 'running');