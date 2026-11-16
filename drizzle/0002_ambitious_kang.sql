CREATE TABLE "switch_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"api_key" text,
	"hint" text,
	"auth_scheme" text NOT NULL,
	"instance_url" text NOT NULL,
	"tenant_id" text NOT NULL,
	"switch_workspace_id" text NOT NULL,
	"evaluation_id" text,
	"evaluation_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "switch_connections_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "trust_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"switch_run_id" text,
	"job_id" text,
	"token_hash" text,
	"error" text,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "switch_agent_id" text;--> statement-breakpoint
ALTER TABLE "switch_connections" ADD CONSTRAINT "switch_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scans" ADD CONSTRAINT "trust_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scans" ADD CONSTRAINT "trust_scans_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scans" ADD CONSTRAINT "trust_scans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_scans_agent_created_idx" ON "trust_scans" USING btree ("agent_id","created_at");