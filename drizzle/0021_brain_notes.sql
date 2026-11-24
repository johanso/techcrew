CREATE TABLE "memory_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workspace_id" integer,
	"scope" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"load" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paths" text[],
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "memory_mode" text DEFAULT 'repo' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "memory_bootstrapped_at" timestamp;--> statement-breakpoint
ALTER TABLE "memory_notes" ADD CONSTRAINT "memory_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_notes" ADD CONSTRAINT "memory_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_notes_user_idx" ON "memory_notes" USING btree ("user_id","scope");--> statement-breakpoint
CREATE INDEX "memory_notes_workspace_idx" ON "memory_notes" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_notes_global_unique" ON "memory_notes" USING btree ("user_id","content_hash") WHERE "memory_notes"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_notes_project_unique" ON "memory_notes" USING btree ("user_id","workspace_id","content_hash") WHERE "memory_notes"."workspace_id" is not null;