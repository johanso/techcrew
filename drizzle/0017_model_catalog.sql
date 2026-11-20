CREATE TABLE "model_catalog" (
	"openrouter_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"released_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"vision" boolean DEFAULT false NOT NULL,
	"context_length" integer,
	"pricing" jsonb NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"efforts" jsonb,
	"listed" boolean DEFAULT true NOT NULL,
	"seen_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
