CREATE TABLE "base_role" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "base_role_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"name" varchar(80) NOT NULL,
	"notes" text,
	"sales_access" varchar(50) DEFAULT 'view' NOT NULL,
	"purchase_access" varchar(50) DEFAULT 'view' NOT NULL,
	"inventory_access" varchar(50) DEFAULT 'view' NOT NULL,
	"masters_access" varchar(50) DEFAULT 'view' NOT NULL,
	"payments_access" varchar(50) DEFAULT 'view' NOT NULL,
	"accounts_access" varchar(50) DEFAULT 'view' NOT NULL,
	"gst_access" varchar(50) DEFAULT 'view' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" bigint;--> statement-breakpoint
ALTER TABLE "base_role" ADD CONSTRAINT "base_role_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_role" ADD CONSTRAINT "base_role_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_role_name_idx" ON "base_role" USING btree ("name");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_base_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."base_role"("id") ON DELETE restrict ON UPDATE no action;