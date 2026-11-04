CREATE TABLE "agent_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"task_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"conversation" text NOT NULL,
	"seq" integer NOT NULL,
	"message" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_messages_conversation_seq" UNIQUE("run_id","conversation","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"stage" text NOT NULL,
	"round" integer NOT NULL,
	"turn" integer NOT NULL,
	"seq" integer NOT NULL,
	"tool" text NOT NULL,
	"target" text,
	"ok" boolean NOT NULL,
	"summary" text,
	"model" text,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_steps_position" UNIQUE("run_id","stage","round","turn","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"stage" text,
	"branch" text,
	"brief" jsonb,
	"review" jsonb,
	"test_report" jsonb,
	"rework_rounds" integer DEFAULT 0 NOT NULL,
	"error" text,
	"failure" jsonb,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"created_by_id" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"model" text NOT NULL,
	"provider_models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"monthly_budget_cents" integer NOT NULL,
	"max_turns" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"trust_score" integer,
	"trust_report" jsonb,
	"trust_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agents_workspace_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "ai_provider_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"provider" text NOT NULL,
	"api_key" text NOT NULL,
	"hint" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_keys_workspace_provider" UNIQUE("workspace_id","provider")
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"github_user_id" bigint NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"access_token" text NOT NULL,
	"scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"task_id" integer,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"task_id" integer,
	"run_id" integer,
	"number" integer NOT NULL,
	"github_id" bigint NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"state" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"test_status" text DEFAULT 'pending' NOT NULL,
	"merge_error" text,
	"follow_up_task_id" integer,
	"merged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_requests_workspace_number_unique" UNIQUE("workspace_id","number")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"number" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"position" integer NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"due_date" date,
	"created_by_id" integer,
	"github_issue_id" bigint,
	"github_issue_number" integer,
	"github_issue_url" text,
	"github_issue_state" text,
	"github_updated_at" timestamp,
	"assignee_agent_id" text,
	"removed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_workspace_number_unique" UNIQUE("workspace_id","number"),
	CONSTRAINT "tasks_workspace_github_issue_unique" UNIQUE("workspace_id","github_issue_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"logo_key" text,
	"github_repo_id" bigint NOT NULL,
	"github_repo_full_name" text NOT NULL,
	"github_repo_url" text NOT NULL,
	"github_default_branch" text NOT NULL,
	"github_repo_private" boolean NOT NULL,
	"github_issues_synced_at" timestamp,
	"agent_auto_pickup" boolean DEFAULT false NOT NULL,
	"agent_auto_merge" boolean DEFAULT false NOT NULL,
	"ai_provider" text DEFAULT 'openai' NOT NULL,
	"ai_auto_failover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_messages" ADD CONSTRAINT "agent_run_messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_keys" ADD CONSTRAINT "ai_provider_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_follow_up_task_id_tasks_id_fk" FOREIGN KEY ("follow_up_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_activity_agent_created_idx" ON "agent_activity" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_activity_workspace_created_idx" ON "agent_activity" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_task_started_idx" ON "agent_runs" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_status_idx" ON "agent_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "notifications_user_workspace_created_idx" ON "notifications" USING btree ("user_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_requests_workspace_created_idx" ON "pull_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_workspace_status_position_idx" ON "tasks" USING btree ("workspace_id","status","position");--> statement-breakpoint
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces" USING btree ("owner_id");