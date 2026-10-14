CREATE TABLE "account_settlement" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_settlement_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"date" date NOT NULL,
	"direction" varchar(50) NOT NULL,
	"partner_id" bigint NOT NULL,
	"source_model" varchar(60) NOT NULL,
	"source_id" integer NOT NULL,
	"source_number" varchar(30) NOT NULL,
	"doc_model" varchar(60) NOT NULL,
	"doc_id" integer NOT NULL,
	"doc_number" varchar(30) NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"state" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_year_close" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_year_close_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"fy" varchar(5) NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"profit" numeric(16, 2) NOT NULL,
	"entry_id" bigint,
	"state" varchar(50) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_settlement" ADD CONSTRAINT "account_settlement_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_settlement" ADD CONSTRAINT "account_settlement_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_settlement" ADD CONSTRAINT "account_settlement_partner_id_contact_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_year_close" ADD CONSTRAINT "account_year_close_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_year_close" ADD CONSTRAINT "account_year_close_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_year_close" ADD CONSTRAINT "account_year_close_entry_id_account_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."account_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_settlement_partner_id_idx" ON "account_settlement" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "account_year_close_fy_idx" ON "account_year_close" USING btree ("fy");--> statement-breakpoint
CREATE INDEX "account_year_close_entry_id_idx" ON "account_year_close" USING btree ("entry_id");