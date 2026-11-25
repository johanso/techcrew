CREATE TABLE "memory_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"target_key" text,
	"target" jsonb,
	"note" jsonb,
	"rationale" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"untrusted_origin" boolean NOT NULL,
	"origin" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pr_number" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "memory_auto_learn" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "memory_librarian" jsonb;--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_proposals_workspace_status_idx" ON "memory_proposals" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "memory_proposals_user_scope_idx" ON "memory_proposals" USING btree ("user_id","scope");