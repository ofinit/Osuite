CREATE TABLE "account_account" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"code" varchar(10) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(50) NOT NULL,
	"key" varchar(30),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "account_entry" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_entry_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"number" varchar(30) NOT NULL,
	"date" date NOT NULL,
	"reference" varchar(60) NOT NULL,
	"narration" varchar(200),
	"ref_model" varchar(60) NOT NULL,
	"ref_id" integer NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"reversed_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "account_entry_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_entry_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"entry_id" bigint,
	"sequence" integer,
	"date" date NOT NULL,
	"account_id" bigint NOT NULL,
	"partner_id" bigint,
	"debit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(16, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_account" ADD CONSTRAINT "account_account_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_account" ADD CONSTRAINT "account_account_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry" ADD CONSTRAINT "account_entry_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry" ADD CONSTRAINT "account_entry_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry" ADD CONSTRAINT "account_entry_reversed_by_id_account_entry_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."account_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry_line" ADD CONSTRAINT "account_entry_line_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry_line" ADD CONSTRAINT "account_entry_line_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry_line" ADD CONSTRAINT "account_entry_line_entry_id_account_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."account_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry_line" ADD CONSTRAINT "account_entry_line_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entry_line" ADD CONSTRAINT "account_entry_line_partner_id_contact_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_account_code_idx" ON "account_account" USING btree ("code");--> statement-breakpoint
CREATE INDEX "account_account_type_idx" ON "account_account" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "account_account_key_idx" ON "account_account" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "account_entry_number_idx" ON "account_entry" USING btree ("number");--> statement-breakpoint
CREATE INDEX "account_entry_date_idx" ON "account_entry" USING btree ("date");--> statement-breakpoint
CREATE INDEX "account_entry_reference_idx" ON "account_entry" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "account_entry_reversed_by_id_idx" ON "account_entry" USING btree ("reversed_by_id");--> statement-breakpoint
CREATE INDEX "account_entry_line_entry_id_idx" ON "account_entry_line" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "account_entry_line_date_idx" ON "account_entry_line" USING btree ("date");--> statement-breakpoint
CREATE INDEX "account_entry_line_account_id_idx" ON "account_entry_line" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_entry_line_partner_id_idx" ON "account_entry_line" USING btree ("partner_id");