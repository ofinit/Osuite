CREATE TABLE "settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "tagline" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "includes" varchar(1000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "plans" SET "sort_order" = CASE "id" WHEN 'trial' THEN 0 WHEN 'starter' THEN 1 WHEN 'business' THEN 2 WHEN 'enterprise' THEN 3 ELSE 9 END;
