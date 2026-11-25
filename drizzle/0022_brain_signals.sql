CREATE TABLE "memory_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"run_id" integer,
	"pr_number" integer,
	"task_id" integer,
	"payload" jsonb NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp,
	CONSTRAINT "memory_signals_source_unique" UNIQUE("workspace_id","kind","source_key")
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "rejection_prompt" text;--> statement-breakpoint
ALTER TABLE "memory_signals" ADD CONSTRAINT "memory_signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_signals" ADD CONSTRAINT "memory_signals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_signals" ADD CONSTRAINT "memory_signals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_signals_workspace_created_idx" ON "memory_signals" USING btree ("workspace_id","created_at");