CREATE TABLE "user_ai_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"api_key" text NOT NULL,
	"hint" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_keys_user_provider" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "user_ai_keys" ADD CONSTRAINT "user_ai_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Keys move to the owner's account (the newest one per provider), where every workspace of theirs uses them.
INSERT INTO "user_ai_keys" ("user_id", "provider", "api_key", "hint", "updated_at")
SELECT DISTINCT ON (w."owner_id", k."provider") w."owner_id", k."provider", k."api_key", k."hint", k."updated_at"
FROM "ai_provider_keys" k JOIN "workspaces" w ON w."id" = k."workspace_id"
ORDER BY w."owner_id", k."provider", k."updated_at" DESC;
--> statement-breakpoint
-- The account's key wins, so a workspace key for the same provider would never be used again.
DELETE FROM "ai_provider_keys" k USING "workspaces" w, "user_ai_keys" u
WHERE w."id" = k."workspace_id" AND u."user_id" = w."owner_id" AND u."provider" = k."provider";
